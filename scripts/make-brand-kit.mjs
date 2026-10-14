/**
 * Generates the Zenith brand kit in assets/brand/: vector marks, an app icon, and PNG
 * exports (icon + horizontal lockups) for places that need raster files — Stripe
 * Branding, GitHub/social avatars, decks. Re-run after changing the mark.
 * Colours mirror the site tokens: lime accent #c6f432 on ink #0b0c0e.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "assets", "brand");
const ACCENT = "#c6f432", ACCENT_LIGHT_BG = "#4d6b00", INK = "#0b0c0e", SNOW = "#ecedef";
const mark = (col) => `<path d="M5 25.5a11 11 0 0 1 22 0" fill="none" stroke="${col}" stroke-width="2.8" stroke-linecap="round"/><circle cx="16" cy="14.5" r="3.4" fill="${col}"/>`;
const svg = (body, vb = "0 0 32 32") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>\n`;

// Vector files
writeFileSync(join(OUT, "zenith-mark.svg"), svg(mark(ACCENT_LIGHT_BG)));
writeFileSync(join(OUT, "zenith-mark-dark-bg.svg"), svg(mark(ACCENT)));
writeFileSync(join(OUT, "zenith-mark-white.svg"), svg(mark("#ffffff")));
writeFileSync(join(OUT, "zenith-mark-black.svg"), svg(mark(INK)));
writeFileSync(join(OUT, "zenith-app-icon.svg"), svg(`<rect width="32" height="32" rx="7" fill="${ACCENT}"/><g transform="translate(3.52 3.52) scale(0.78)">${mark(INK)}</g>`));

// Raster exports
// Embedded as a data URL: pages created with setContent() are about:blank and can't
// load file:// fonts, which silently falls back to a serif.
const FONT = "data:font/woff2;base64," + readFileSync(join(process.cwd(), "public", "fonts", "geist-variable.woff2")).toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function shot(name, w, h, html) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><style>@font-face{font-family:HG;src:url("${FONT}");font-weight:100 900}body{margin:0}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, name), clip: { x: 0, y: 0, width: w, height: h }, omitBackground: true });
  console.log("wrote", name);
}
const iconHtml = (px, radius) => `<div style="width:${px}px;height:${px}px;background:${ACCENT};border-radius:${radius}px;display:grid;place-items:center">
  <svg width="${px * 0.78}" height="${px * 0.78}" viewBox="0 0 32 32">${mark(INK)}</svg></div>`;
await shot("zenith-icon-1024.png", 1024, 1024, iconHtml(1024, 0));          // square: Stripe / GitHub / social crop it themselves
await shot("zenith-icon-rounded-512.png", 512, 512, iconHtml(512, 112));    // pre-rounded, transparent corners
const lockup = (col, text, bg) => `<div style="width:1200px;height:360px;${bg ? `background:${bg};` : ""}display:flex;align-items:center;justify-content:center;gap:18px">
  <svg width="205" height="205" viewBox="0 0 32 32">${mark(col)}</svg>
  <span style="font-family:HG;font-weight:600;font-size:168px;letter-spacing:-0.045em;color:${text};line-height:1">Zenith</span></div>`;
await shot("zenith-lockup-light.png", 1200, 360, lockup(INK, INK, "#ffffff"));
await shot("zenith-lockup-dark.png", 1200, 360, lockup(ACCENT, SNOW, INK));
await shot("zenith-lockup-transparent.png", 1200, 360, lockup(INK, INK, null));
await browser.close();
