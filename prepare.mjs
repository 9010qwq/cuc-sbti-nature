import fs from "node:fs";
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
];
const entries = ids.map((id) => {
  const file = `assets/${id}.png`;
  if (!fs.existsSync(file)) throw Error(`Missing ${file}`);
  return [
    id,
    "data:image/png;base64," + fs.readFileSync(file).toString("base64"),
  ];
});
fs.writeFileSync(
  "src/assets.ts",
  "export const art: Record<string,string> = " +
    JSON.stringify(Object.fromEntries(entries)) +
    ";",
);
let css = fs.readFileSync(
  "node_modules/@fontsource/noto-sans-sc/400.css",
  "utf8",
);
css = css.replace(
  /src: url\(([^)]+\.woff2)\) format\('woff2'\), url\([^)]+\) format\('woff'\);/g,
  (_, p) =>
    `src: url(data:font/woff2;base64,${fs.readFileSync("node_modules/@fontsource/noto-sans-sc/" + p).toString("base64")}) format('woff2');`,
);
fs.writeFileSync("src/font.css", css);
console.log("Prepared 17 images and local OFL font.");
