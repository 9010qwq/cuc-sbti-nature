import fs from "node:fs";
import crypto from "node:crypto";
import sharp from "sharp";

// Preserve full PNG masters. These WebP files and the contact sheet only serve
// the app's delivery/preview needs; no role is cut out of the overview image.
export async function prepareArt(ids) {
  fs.mkdirSync("generated/art", { recursive: true });
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync("generated/art-cache.json", "utf8")); } catch {}
  const next = {};
  for (const id of ids) {
    const input = `assets/${id}.png`;
    if (!fs.existsSync(input)) throw Error(`Missing original character: ${input}`);
    const hash = crypto.createHash("sha256").update(fs.readFileSync(input)).update("webp-v2-quality90").digest("hex");
    const output = `generated/art/${id}.webp`;
    if (previous[id] !== hash || !fs.existsSync(output))
      await sharp(input).webp({ quality: 90, effort: 5 }).toFile(output);
    next[id] = hash;
  }
  const mainIds = ids.filter(id => /^[BD][HO][TS][FP]$/.test(id));
  if (mainIds.length !== 16) throw Error("Overview must contain exactly 16 main types.");
  const atlasHash = mainIds.map(id => next[id]).join(":");
  if (previous.ATLAS !== atlasHash || !fs.existsSync("generated/art/ATLAS.webp")) {
    const tile = 256;
    const layers = await Promise.all(mainIds.map(async (id, i) => ({
      input: await sharp(`assets/${id}.png`).resize(tile, tile, { fit: "contain", background: "#f4f0e5" }).toBuffer(),
      left: (i % 4) * tile,
      top: Math.floor(i / 4) * tile,
    })));
    await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#f4f0e5" } })
      .composite(layers).webp({ quality: 86, effort: 5 }).toFile("generated/art/ATLAS.webp");
  }
  next.ATLAS = atlasHash;
  fs.writeFileSync("generated/art-cache.json", JSON.stringify(next, null, 2));
}
