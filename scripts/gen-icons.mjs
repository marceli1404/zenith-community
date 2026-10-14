// One-off: rasterize the Zenith mark into PWA icons via Playwright Chromium
// (already a dev dependency for prerendering). The mark's drawing fills ~69% of its
// own 32-grid, so the SVG is sized to 78% of the canvas: the visible arc and point
// span ~54% of the icon, inside the 80% maskable safe zone, so the same files serve
// as both "any" and "maskable" icons.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "public", "icons");
mkdirSync(OUT, { recursive: true });

const mark = (px) => `
<svg width="${px}" height="${px}" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M5 25.5a11 11 0 0 1 22 0" fill="none" stroke="#0b0c0e" stroke-width="2.8" stroke-linecap="round"/><circle cx="16" cy="14.5" r="3.4" fill="#0b0c0e"/>
</svg>`;

const page = await (await chromium.launch()).newPage();
for (const size of [192, 512]) {
  const m = Math.round(size * 0.78);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0"><div style="width:${size}px;height:${size}px;background:#c6f432;display:grid;place-items:center">${mark(m)}</div></body>`,
  );
  await page.screenshot({ path: join(OUT, `icon-${size}.png`), clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`wrote icon-${size}.png`);
}
await page.context().browser().close();
