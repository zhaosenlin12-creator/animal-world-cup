// Build a multi-size Windows .ico from the lion avatar PNG.
// electron-builder's PNG->ICO conversion only produces a single 256px entry,
// which Windows must downscale for taskbar use (causing artifacts). Embedding
// each size explicitly gives crisp icons at every Windows UI scale.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const PACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(PACK, "..");
const SRC = path.join(ROOT, "public", "icon-512.png");
const OUT = path.join(PACK, "app", "icon.ico");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const pngs = [];
for (const size of SIZES) {
  const buf = await sharp(SRC)
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  pngs.push({ size, buf });
}

// ICO header: reserved(2)=0, type(2)=1, count(2)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);

let offset = 6 + pngs.length * 16;
const dirEntries = [];
const dataParts = [];
for (const { size, buf } of pngs) {
  const e = Buffer.alloc(16);
  e.writeUInt8(size === 256 ? 0 : size, 0); // width (0 means 256)
  e.writeUInt8(size === 256 ? 0 : size, 1); // height
  e.writeUInt8(0, 2); // colors
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // color planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(buf.length, 8);
  e.writeUInt32LE(offset, 12);
  dirEntries.push(e);
  dataParts.push(buf);
  offset += buf.length;
}

fs.writeFileSync(OUT, Buffer.concat([header, ...dirEntries, ...dataParts]));
console.log(`[make-icon] wrote ${OUT} with sizes: ${SIZES.join(", ")}`);
console.log(`[make-icon] total ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
