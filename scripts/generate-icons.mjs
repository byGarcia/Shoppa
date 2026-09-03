// One-shot icon generation from public/favicon.svg using sharp (devDep).
// Run from the repository root: node scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";

const svg = await readFile(new URL("../public/favicon.svg", import.meta.url));
await mkdir(new URL("../public/icons", import.meta.url), { recursive: true });

for (const size of [180, 192, 512, 1024]) {
  await sharp(svg, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(new URL(`../public/icons/icon-${size}.png`, import.meta.url).pathname);
  console.log(`icon-${size}.png`);
}
