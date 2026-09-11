import fs from "node:fs";
import { prepareArt } from "./optimize-art.mjs";
const web = process.argv.includes("--web");
const ids = [
  "BHTF",
  "BHTP",
  "BHSF",
  "BHSP",
  "BOTF",
  "BOTP",
  "BOSF",
  "BOSP",
  "DHTF",
  "DHTP",
  "DHSF",
  "DHSP",
  "DOTF",
  "DOTP",
  "DOSF",
  "DOSP",
  "NAIWA",
  "LARVA",
];
await prepareArt(ids);
const entries = [...ids, "ATLAS"].map((id) => {
  const file = `generated/art/${id}.webp`;
  if (!fs.existsSync(file)) throw Error(`Missing ${file}`);
  if (web) return [id, `new URL(${JSON.stringify("../" + file)}, import.meta.url).href`];
  return [
    id,
    "data:image/webp;base64," + fs.readFileSync(file).toString("base64"),
  ];
});
fs.writeFileSync(
  "src/assets.ts",
  "export const art: Record<string,string> = " +
    (web ? "{" + entries.map(([id, expression]) => JSON.stringify(id) + ":" + expression).join(",") + "}" : JSON.stringify(Object.fromEntries(entries))) +
    ";",
);
let css = fs.readFileSync(
  "node_modules/@fontsource/noto-sans-sc/400.css",
  "utf8",
);
css = css.replace(
  /src: url\(([^)]+\.woff2)\) format\('woff2'\), url\([^)]+\) format\('woff'\);/g,
  (_, p) => web
    ? `src: url(../node_modules/@fontsource/noto-sans-sc/${p}) format('woff2');`
    : `src: url(data:font/woff2;base64,${fs.readFileSync("node_modules/@fontsource/noto-sans-sc/" + p).toString("base64")}) format('woff2');`,
);
fs.writeFileSync("src/font.css", css);
console.log(web ? "Prepared 18 external character images, one overview and font subsets." : "Prepared 18 embedded characters, one overview and local OFL font.");
