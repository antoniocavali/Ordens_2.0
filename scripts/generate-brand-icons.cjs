const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const requireWeb = createRequire(path.join(root, 'apps/web/package.json'));
const { chromium } = requireWeb('@playwright/test');

async function main() {
  const publicDir = path.join(root, 'apps/web/public');
  const appDir = path.join(root, 'apps/web/src/app');
  const source = await fs.readFile(path.join(publicDir, 'brand/cooperfarms-mark.png'));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    // Trace the original alpha contour, not an approximation of an infinity sign.
    const trace = await page.evaluate(async (base64) => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, image.width, image.height);
      const w = image.width, h = image.height;
      const filled = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] >= 128;
      const edges = new Map(); const key = (x, y) => y * (w + 1) + x;
      const add = (x, y, xx, yy) => edges.set(key(x, y), key(xx, yy));
      let left = w, top = h, right = 0, bottom = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (filled(x, y)) {
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
        if (!filled(x, y - 1)) add(x, y, x + 1, y);
        if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1);
        if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1);
        if (!filled(x - 1, y)) add(x, y + 1, x, y);
      }
      const simplify = (points) => {
        if (points.length <= 2) return points;
        const [ax, ay] = points[0], [bx, by] = points.at(-1);
        let max = 0, index = 0;
        for (let i = 1; i < points.length - 1; i++) {
          const [x, y] = points[i], dx = bx - ax, dy = by - ay;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
          const distance = Math.hypot(x - ax - t * dx, y - ay - t * dy);
          if (distance > max) { max = distance; index = i; }
        }
        return max > 0.8 ? [...simplify(points.slice(0, index + 1)).slice(0, -1), ...simplify(points.slice(index))] : [points[0], points.at(-1)];
      };
      const contours = [];
      while (edges.size) {
        const start = edges.keys().next().value; let current = start;
        const points = [];
        do {
          points.push([current % (w + 1), Math.floor(current / (w + 1))]);
          const next = edges.get(current); edges.delete(current); current = next;
        } while (current !== start && current !== undefined);
        if (points.length > 100) {
          const mid = Math.floor(points.length / 2);
          const reduced = [...simplify(points.slice(0, mid + 1)).slice(0, -1), ...simplify([...points.slice(mid), points[0]])];
          contours.push('M' + reduced.map(([x, y]) => `${x - left},${y - top}`).join('L') + 'Z');
        }
      }
      return { d: contours.join(''), width: right - left, height: bottom - top };
    }, source.toString('base64'));
    const scale = 14 / trace.width;
    const y = (16 - trace.height * scale) / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="#6D28D9"/><path fill="#fff" fill-rule="evenodd" transform="translate(1 ${y}) scale(${scale})" d="${trace.d}"/></svg>\n`;
    for (const target of [path.join(appDir, 'icon.svg'), path.join(publicDir, 'favicon.svg')]) await fs.writeFile(target, svg);
    const pngs = new Map();
    for (const size of [16, 32, 48, 192, 512]) {
      // Render vector paths directly at target resolution: no resized raster intermediary.
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<style>body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
      pngs.set(size, await page.screenshot({ omitBackground: true }));
    }
    const sizes = [16, 32, 48]; const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, i) => {
      const entry = 6 + i * 16, bytes = pngs.get(size);
      header[entry] = size; header[entry + 1] = size;
      header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(bytes.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
      offset += bytes.length;
    });
    await fs.writeFile(path.join(appDir, 'favicon.ico'), Buffer.concat([header, ...sizes.map(size => pngs.get(size))]));
    for (const size of [16, 32, 192, 512]) {
      await fs.writeFile(path.join(publicDir, `brand/${size <= 32 ? 'favicon' : 'icon'}-${size}.png`), pngs.get(size));
    }
    console.log(`Generated native SVG and directly rendered ICO/PNG sizes; traced original ${trace.width}x${trace.height} silhouette.`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
