/**
 * Creates minimal valid PNG icons using raw binary data.
 * No external dependencies needed.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const outDir = path.join(__dirname, '..', 'src', 'icons');

function crc32(buf) {
  let crc = 0xffffffff;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPngChunk(type, data) {
  const typeData = Buffer.from(type, 'ascii');
  const combined = Buffer.concat([typeData, data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(combined));
  return Buffer.concat([length, combined, crc]);
}

function createPng(size) {
  // Create a simple icon: dark rounded-rect background with red circle
  const pixels = Buffer.alloc(size * size * 4); // RGBA

  const center = size / 2;
  const bgR = 26, bgG = 32, bgB = 44; // #1a202c
  const circleR = 229, circleG = 62, circleB = 62; // #e53e3e
  const radius = size * 0.30;
  const cornerRadius = size * 0.2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Check if inside rounded rect
      const inRoundedRect = isInRoundedRect(x, y, 0, 0, size, size, cornerRadius);

      if (!inRoundedRect) {
        // Transparent
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
        continue;
      }

      // Check if inside circle
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        // Red circle with slight anti-aliasing at edge
        const alpha = dist > radius - 1 ? Math.max(0, (radius - dist)) : 1;
        pixels[idx] = circleR;
        pixels[idx + 1] = circleG;
        pixels[idx + 2] = circleB;
        pixels[idx + 3] = Math.round(alpha * 255);
      } else {
        // Dark background
        pixels[idx] = bgR;
        pixels[idx + 1] = bgG;
        pixels[idx + 2] = bgB;
        pixels[idx + 3] = 255;
      }
    }
  }

  // Build PNG file
  // Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0); // width
  ihdrData.writeUInt32BE(size, 4); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type (RGBA)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createPngChunk('IHDR', ihdrData);

  // IDAT chunk — raw pixel data with filter bytes
  const rawData = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rawData[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(rawData, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const compressed = zlib.deflateSync(rawData);
  const idat = createPngChunk('IDAT', compressed);

  // IEND chunk
  const iend = createPngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function isInRoundedRect(x, y, rx, ry, rw, rh, cr) {
  // Check corners
  if (x < rx + cr && y < ry + cr) {
    return Math.sqrt((x - rx - cr) ** 2 + (y - ry - cr) ** 2) <= cr;
  }
  if (x > rx + rw - cr && y < ry + cr) {
    return Math.sqrt((x - rx - rw + cr) ** 2 + (y - ry - cr) ** 2) <= cr;
  }
  if (x < rx + cr && y > ry + rh - cr) {
    return Math.sqrt((x - rx - cr) ** 2 + (y - ry - rh + cr) ** 2) <= cr;
  }
  if (x > rx + rw - cr && y > ry + rh - cr) {
    return Math.sqrt((x - rx - rw + cr) ** 2 + (y - ry - rh + cr) ** 2) <= cr;
  }
  return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
}

// Generate all sizes
[16, 48, 128].forEach(size => {
  const png = createPng(size);
  const filePath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Created ${filePath} (${png.length} bytes)`);
});

console.log('Done! PNG icons created.');
