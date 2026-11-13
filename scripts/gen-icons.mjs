import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "src-tauri", "icons");
mkdirSync(out, { recursive: true });

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const s = size / 32;
  const corner = 8 * s;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const dx = Math.min(x, size - 1 - x);
      const dy = Math.min(y, size - 1 - y);
      let alpha = 255;
      if (dx < corner && dy < corner) {
        const d = Math.hypot(corner - dx, corner - dy);
        alpha = d <= corner ? 255 : Math.max(0, Math.round((1 - (d - corner) / s) * 255));
      }
      // violet -> blue diagonal gradient
      const t = (x / size) * 0.55 + (y / size) * 0.45;
      const r = Math.round(124 + (60 - 124) * t);
      const g = Math.round(92 + (110 - 92) * t);
      const b = Math.round(255 - (30 * t));
      // three stacked "layers" glyph
      const cx = size / 2;
      const cy = size / 2;
      const px = (x - cx) / s;
      const py = (y - cy) / s;
      let glyph = 0;
      for (let k = 0; k < 3; k++) {
        const oy = -5 + k * 5;
        const w = 9 - k * 0.0;
        const h = 2.1;
        const ax = Math.abs(px) / w;
        const ay = Math.abs(py - oy) / h;
        const d = Math.pow(ax, 6) + Math.pow(ay, 6);
        if (d <= 1) glyph = Math.max(glyph, 0.95 - k * 0.16);
      }
      if (glyph > 0) {
        raw[i] = Math.round(r * (1 - glyph) + 255 * glyph);
        raw[i + 1] = Math.round(g * (1 - glyph) + 255 * glyph);
        raw[i + 2] = Math.round(b * (1 - glyph) + 255 * glyph);
      } else {
        raw[i] = r;
        raw[i + 1] = g;
        raw[i + 2] = b;
      }
      raw[i + 3] = alpha;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", (() => {
      const b = Buffer.alloc(13);
      b.writeUInt32BE(size, 0);
      b.writeUInt32BE(size, 4);
      b[8] = 8;
      b[9] = 6;
      return b;
    })()),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function ico(pngBuffers) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngBuffers.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngBuffers.length;
  for (const { size, data } of pngBuffers) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngBuffers.map((p) => p.data)]);
}

const files = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
  ["Square30x30Logo.png", 30],
  ["Square44x44Logo.png", 44],
  ["Square71x71Logo.png", 71],
  ["Square89x89Logo.png", 89],
  ["Square107x107Logo.png", 107],
  ["Square142x142Logo.png", 142],
  ["Square150x150Logo.png", 150],
  ["Square284x284Logo.png", 284],
  ["Square310x310Logo.png", 310],
  ["StoreLogo.png", 50],
];

for (const [name, size] of files) writeFileSync(join(out, name), png(size));
writeFileSync(
  join(out, "icon.ico"),
  ico([
    { size: 32, data: png(32) },
    { size: 64, data: png(64) },
    { size: 128, data: png(128) },
    { size: 256, data: png(256) },
  ]),
);
console.log(`icons → ${out}`);
