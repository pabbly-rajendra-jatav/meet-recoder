/**
 * Generates PNG icons for the Chrome extension from an inline SVG.
 * Uses only Node.js built-in modules — no dependencies required.
 *
 * Each icon is a simple red circle (record button) on a rounded white background.
 * For production, replace these with proper designed icons.
 */

const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];
const outDir = path.join(__dirname, '..', 'src', 'icons');

function generateSvg(size) {
  const padding = Math.round(size * 0.15);
  const bgRadius = Math.round(size * 0.2);
  const circleRadius = Math.round((size - padding * 2) * 0.35);
  const center = size / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${bgRadius}" fill="#1a202c"/>
  <circle cx="${center}" cy="${center}" r="${circleRadius}" fill="#e53e3e"/>
</svg>`;
}

// Write SVG files (Chrome can use SVGs, and we'll also keep them for reference)
// For actual PNG generation we'd need canvas/sharp, so we ship SVGs and
// provide a simple fallback: the manifest also accepts SVG via a data URI workaround,
// but the simplest approach is to just use SVG files renamed to .png
// Actually, Chrome requires actual PNG. Let's create minimal valid PNGs.

// Minimal 1x1 PNG creation helper (for a colored square)
// We'll use a BMP-in-PNG approach — write the simplest valid PNG
function createMinimalPng(size, svgContent) {
  // Since we can't easily create PNGs without dependencies,
  // we'll write the SVG files and instruct the user to convert them,
  // OR we can embed the SVG as a data URI in the manifest.
  // For now, let's save SVGs and create a simple HTML-canvas based converter.
  return svgContent;
}

// Save SVG icons
for (const size of sizes) {
  const svg = generateSvg(size);
  const svgPath = path.join(outDir, `icon${size}.svg`);
  fs.writeFileSync(svgPath, svg);
  console.log(`Created ${svgPath}`);
}

// Also create a simple HTML file that can convert SVGs to PNGs in browser
const converterHtml = `<!DOCTYPE html>
<html>
<head><title>Icon Converter</title></head>
<body>
<h3>Icon Converter — Open this file in Chrome and right-click each icon to save as PNG</h3>
${sizes.map(size => {
  const svg = generateSvg(size);
  const dataUri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  return `<div style="margin:20px">
    <p>icon${size}.png (${size}x${size})</p>
    <canvas id="c${size}" width="${size}" height="${size}"></canvas>
    <script>
      const img${size} = new Image();
      img${size}.onload = () => {
        const ctx = document.getElementById('c${size}').getContext('2d');
        ctx.drawImage(img${size}, 0, 0);
      };
      img${size}.src = '${dataUri}';
    <\/script>
  </div>`;
}).join('\n')}
<script>
  // Auto-download PNGs
  window.onload = () => {
    ${sizes.map(size => `
    setTimeout(() => {
      const canvas = document.getElementById('c${size}');
      const link = document.createElement('a');
      link.download = 'icon${size}.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    }, ${size * 10});`).join('\n')}
  };
</script>
</body>
</html>`;

fs.writeFileSync(path.join(outDir, 'convert-icons.html'), converterHtml);
console.log('Created convert-icons.html — open in Chrome to generate PNGs');

console.log('\nDone! To generate PNG icons:');
console.log('1. Open src/icons/convert-icons.html in Chrome');
console.log('2. PNGs will auto-download');
console.log('3. Move them to src/icons/');
