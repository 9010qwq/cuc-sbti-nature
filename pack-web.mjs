import fs from "node:fs";
fs.writeFileSync("dist-web/.nojekyll", "");
for (const file of ["LICENSE", "ASSET_NOTICE.md", "FONT_LICENSE.txt"])
  fs.copyFileSync(file, `dist-web/${file}`);
console.log("Web build ready in dist-web; publish this directory as a static site.");
