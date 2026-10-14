/**
 * Renders every site icon from the Zenith mark, so browsers, Google Search,
 * iOS and installed-app launchers all show the same brand.
 *
 *   node scripts/make-icons.mjs
 *
 * Writes to public/:
 *   favicon.ico            16, 32 and 48 px (browsers and Google's favicon fetcher ask for this path)
 *   apple-touch-icon.png   180 px, full-bleed (iOS rounds the corners itself)
 *   icons/icon-192.png     192 px rounded tile, purpose "any"
 *   icons/icon-512.png     512 px rounded tile, purpose "any" (also the Organization logo)
 *   icons/icon-maskable-512.png  512 px full-bleed with the mark inside the 80% safe zone
 * The ICO is assembled by hand (PNG-in-ICO, supported by every current browser).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const LIME = "#c6f432";
const INK = "#0b0c0e";
const MARK = `<path d="M5 25.5a11 11 0 0 1 22 0" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/><circle cx="16" cy="14.5" r="3.4" fill="${INK}"/>`;

/** The tile used in the favicon: rounded corners, mark at 78%. */
const tile = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${LIME}"/><g transform="translate(3.52 3.52) scale(0.78)">${MARK}</g></svg>`;
/** Full-bleed square; `scale` of the mark keeps it inside a platform's crop. */
const bleed = (scale) => {
  const off = (32 - 32 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${LIME}"/><g transform="translate(${off} ${off}) scale(${scale})">${MARK}</g></svg>`;
};

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function render(svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  return page.locator("svg").screenshot({ omitBackground: true, type: "png" });
}

mkdirSync(join(pub, "icons"), { recursive: true });
const outputs = [
  ["icons/icon-192.png", tile(), 192],
  ["icons/icon-512.png", tile(), 512],
  ["icons/icon-maskable-512.png", bleed(0.6), 512],
  ["apple-touch-icon.png", bleed(0.72), 180],
];
for (const [file, svg, size] of outputs) {
  writeFileSync(join(pub, file), await render(svg, size));
  console.log("wrote", file);
}

// favicon.ico: an ICONDIR header, one entry per size, then the PNG bytes.
const sizes = [16, 32, 48];
const pngs = [];
for (const s of sizes) pngs.push(await render(tile(), s));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  header.writeUInt8(s, e); // width
  header.writeUInt8(s, e + 1); // height
  header.writeUInt8(0, e + 2); // palette
  header.writeUInt8(0, e + 3); // reserved
  header.writeUInt16LE(1, e + 4); // colour planes
  header.writeUInt16LE(32, e + 6); // bits per pixel
  header.writeUInt32LE(pngs[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
writeFileSync(join(pub, "favicon.ico"), Buffer.concat([header, ...pngs]));
console.log("wrote favicon.ico", sizes.join("/"));
await browser.close();
