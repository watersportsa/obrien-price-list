import fs from "node:fs/promises";
import crypto from "node:crypto";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const localName = (url) => {
  const m = new URL(url).pathname.match(/\.(jpe?g|png|webp)$/i);
  const ext = m ? m[1].toLowerCase() : "jpg";
  return `images/${crypto.createHash("sha1").update(url).digest("hex").slice(0, 12)}.${ext}`;
};

const products = JSON.parse(await fs.readFile("products.json", "utf8"));
await fs.mkdir("images", { recursive: true });

const urls = [...new Set(products.map((p) => p.image).filter(Boolean))];
const map = {};

for (const url of urls) {
  const file = localName(url);
  try {
    await fs.access(file);            // already mirrored
    map[url] = file;
    continue;
  } catch {}
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) { console.warn("SKIP", res.status, url); continue; }
    await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
    map[url] = file;
    console.log("Saved", file);
  } catch (e) {
    console.warn("ERROR", url, e.message);
  }
}

await fs.writeFile("image-map.json", JSON.stringify(map));
console.log(`Mapped ${Object.keys(map).length} of ${urls.length} images`);
