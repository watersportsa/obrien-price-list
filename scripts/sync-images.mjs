import fs from "node:fs/promises";
import crypto from "node:crypto";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const IMG_RE = /\.(jpe?g|png|webp)$/i;

const extOf = (url) => {
  const m = new URL(url).pathname.match(IMG_RE);
  return m ? m[1].toLowerCase() : "jpg";
};
const localName = (url) =>
  `images/${crypto.createHash("sha1").update(url).digest("hex").slice(0, 12)}.${extOf(url)}`;

async function download(url) {
  // 1. Direct
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    console.warn("Direct", res.status, url);
  } catch (e) { console.warn("Direct error", url, e.message); }
  // 2. Via proxy (different IPs, in case the WAF blocks GitHub)
  try {
    const out = extOf(url).replace("jpeg", "jpg");
    const proxy = `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=${out}&w=1200`;
    const res = await fetch(proxy, { headers: { "User-Agent": UA } });
    if (res.ok) { console.log("  (via proxy)"); return Buffer.from(await res.arrayBuffer()); }
    console.warn("Proxy", res.status, url);
  } catch (e) { console.warn("Proxy error", url, e.message); }
  return null;
}

// ---- Load products.json ----
const candidates = ["products.json", "docs/products.json", "data/products.json", "public/products.json"];
let raw = null;
for (const c of candidates) { try { raw = await fs.readFile(c, "utf8"); break; } catch {} }
if (!raw) { console.error("products.json not found"); process.exit(1); }
let data;
try { data = JSON.parse(raw); } catch (e) { console.error("Invalid JSON:", e.message); process.exit(1); }
const products = Array.isArray(data) ? data : Object.values(data || {}).find(Array.isArray);
if (!products) { console.error("No product array found"); process.exit(1); }
console.log("Products found:", products.length);

// ---- Manual images, matched by SKU (file name without extension) ----
const manualBySku = {};
try {
  for (const f of await fs.readdir("manual-images")) {
    if (IMG_RE.test(f)) manualBySku[f.replace(IMG_RE, "").toLowerCase()] = `manual-images/${f}`;
  }
} catch {}
console.log("Manual images:", Object.keys(manualBySku).length);

// ---- Mirror remote images ----
await fs.mkdir("images", { recursive: true });
const urls = [...new Set(products.map((p) => p && p.image).filter(Boolean))];
const map = {};
for (const url of urls) {
  try {
    // Already a local repo path (written by the Apps Script sync): nothing to download
    if (!/^https?:\/\//i.test(url)) { map[url] = url; continue; }

    const file = localName(url);
    try { await fs.access(file); map[url] = file; continue; } catch {}
    const buf = await download(url);
    if (!buf) continue;
    await fs.writeFile(file, buf);
    map[url] = file;
    console.log("Saved", file);
  } catch (e) {
    console.warn("Skipping bad URL:", url, e.message);
  }
}

// ---- Apply manual images by SKU, collect gaps ----
const usedManual = new Set();
const missing = [];
for (const p of products) {
  if (!p) continue;
  const skus = [p.sku, ...(Array.isArray(p.variations) ? p.variations : []).map((v) => v.sku)].filter(Boolean);
  let hasManualParent = false;
  for (const sku of skus) {
    const m = manualBySku[String(sku).toLowerCase()];
    if (m) {
      map["sku:" + sku] = m;
      usedManual.add(m);
      if (sku === p.sku) hasManualParent = true;
    }
  }
  if (!hasManualParent && !(p.image && map[p.image])) missing.push(`${p.sku || "(no sku)"} — ${p.name}`);
}
const unmatched = Object.values(manualBySku).filter((f) => !usedManual.has(f));

await fs.writeFile("image-map.json", JSON.stringify(map));
console.log(`Mapped ${Object.keys(map).length} entries; ${missing.length} products without a local image`);

// ---- Run summary ----
let md = `### Image sync\n- Remote images mirrored: ${Object.keys(map).filter((k) => !k.startsWith("sku:")).length} of ${urls.length}\n- Manual images matched: ${usedManual.size}\n\n`;
if (missing.length) md += `**Products still without a local image** (upload \`<SKU>.jpg\` to manual-images/):\n${missing.map((m) => `- ${m}`).join("\n")}\n\n`;
if (unmatched.length) md += `**Manual files matching no SKU (check the file names):**\n${unmatched.map((m) => `- ${m}`).join("\n")}\n`;
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, md);
