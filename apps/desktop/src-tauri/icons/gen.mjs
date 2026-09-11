// One-off: generate brand-colored placeholder icons (sky blue #2F79CE) that
// Tauri can embed at compile time. Real icons come later from the design pass.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const R = 0x2f, G = 0x79, B = 0xce, A = 0xff;

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) { const o = 1 + x * 4; row[o] = R; row[o+1] = G; row[o+2] = B; row[o+3] = A; }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function ico(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; entry[1] = size >= 256 ? 0 : size;
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8); entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, pngBuf]);
}

const here = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
writeFileSync(here + "32x32.png", png(32));
writeFileSync(here + "128x128.png", png(128));
writeFileSync(here + "128x128@2x.png", png(256));
writeFileSync(here + "icon.png", png(512));
writeFileSync(here + "icon.ico", ico(png(32), 32));
console.log("icons written to", here);
