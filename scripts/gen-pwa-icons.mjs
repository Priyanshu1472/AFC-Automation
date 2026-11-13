// One-off script: builds square, padded PWA icons from the existing
// public/afc-logo.png (a 341x492 portrait crest+wordmark, not square,
// with a "Since 1968" line below the crest that would otherwise get cut
// off when force-fit into a square). Crops off that bottom line first,
// then fits the crest itself into a padded square canvas. Not part of
// the build — run manually if the source logo ever changes.
import { Jimp } from "jimp";
import { mkdirSync } from "fs";

const SRC = "public/afc-logo.png";
const OUT_DIR = "public/icons";
const BG = 0x0a2a25ff; // matches the splash-screen gradient's dark green
const CREST_HEIGHT = 435; // crops off the "Since 1968" line below the crest

mkdirSync(OUT_DIR, { recursive: true });

async function makeIcon(size, paddingRatio, filename) {
  const crest = await Jimp.read(SRC);
  crest.crop({ x: 0, y: 0, w: crest.width, h: CREST_HEIGHT });
  const inner = Math.round(size * (1 - paddingRatio * 2));
  crest.contain({ w: inner, h: inner });

  const canvas = new Jimp({ width: size, height: size, color: BG });
  canvas.composite(crest, Math.round((size - crest.width) / 2), Math.round((size - crest.height) / 2));
  await canvas.write(`${OUT_DIR}/${filename}`);
  console.log(`wrote ${OUT_DIR}/${filename} (${size}x${size})`);
}

await makeIcon(192, 0.1, "icon-192.png");
await makeIcon(512, 0.1, "icon-512.png");
await makeIcon(512, 0.2, "icon-maskable-512.png"); // extra padding for the maskable safe zone
await makeIcon(180, 0.12, "apple-touch-icon.png");
