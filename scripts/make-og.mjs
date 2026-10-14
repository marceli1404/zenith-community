/**
 * Generates the 1200x630 Open Graph image (public/og.png) by rendering a branded
 * card in headless Chromium with the site's own fonts. Social platforms handle PNG
 * reliably; SVG OG images are widely ignored. Re-run with `node scripts/make-og.mjs`
 * if the brand or headline changes.
 */

import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "og.png");
// Embedded as data URLs: setContent() pages are about:blank and can't load file:// fonts.
const font = (f) => "data:font/woff2;base64," + readFileSync(join(ROOT, "public", "fonts", f)).toString("base64");

const MARK = (col) =>
  `<path d="M5 25.5a11 11 0 0 1 22 0" fill="none" stroke="${col}" stroke-width="2.8" stroke-linecap="round"/><circle cx="16" cy="14.5" r="3.4" fill="${col}"/>`;

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: Geist; src: url("${font("geist-variable.woff2")}"); font-weight: 100 900; }
  @font-face { font-family: GeistMono; src: url("${font("geist-mono-variable.woff2")}"); font-weight: 100 900; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: #0a0b0d; color: #ecedf0; font-family: Geist, sans-serif; position: relative; overflow: hidden; }
  .light { position: absolute; inset: -30% -10% auto 30%; height: 90%; background: radial-gradient(closest-side, rgba(198,244,50,.16), transparent); }
  .wrap { position: relative; height: 100%; padding: 64px 72px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 16px; font-size: 34px; font-weight: 600; letter-spacing: -1.2px; }
  .tile { width: 56px; height: 56px; border-radius: 16px; background: #c6f432; display: grid; place-items: center; }
  h1 { margin-top: auto; font-size: 76px; line-height: 1.02; font-weight: 600; letter-spacing: -3.4px; max-width: 640px; }
  h1 span { color: #9fa1a8; }
  p { margin-top: 22px; font-size: 26px; line-height: 1.4; color: #a3a5ab; max-width: 600px; }
  .panel { position: absolute; right: 52px; top: 118px; width: 410px; padding: 7px; border-radius: 22px; border: 1px solid #25272c; background: rgba(17,18,21,.6);
    transform: perspective(1400px) rotateY(-14deg) rotateX(6deg); }
  .core { border-radius: 16px; background: #111215; border: 1px solid #1f2126; padding: 28px; }
  .row { display: flex; justify-content: space-between; font: 14px GeistMono, monospace; color: #8b8d94; padding-bottom: 16px; border-bottom: 1px solid #1f2126; }
  .score { display: flex; align-items: flex-end; gap: 12px; padding: 22px 0 18px; }
  .score b { font: 500 92px/0.85 GeistMono, monospace; letter-spacing: -6px; }
  .score span { font-size: 16px; color: #a3a5ab; }
  .cat { display: grid; grid-template-columns: 1fr auto; gap: 8px 0; padding: 9px 0; font-size: 16px; color: #a3a5ab; }
  .cat i { grid-column: 1 / -1; height: 3px; border-radius: 3px; background: #c6f432; }
  .cat em { font: normal 16px GeistMono, monospace; color: #ecedf0; }
</style></head><body>
  <div class="light"></div>
  <div class="wrap">
    <div class="brand"><div class="tile"><svg width="44" height="44" viewBox="0 0 32 32">${MARK("#0a0b0d")}</svg></div>Zenith</div>
    <h1>Know your website <span>is healthy.</span></h1>
    <p>Uptime, security headers, accessibility and search, with a fix prompt for every finding.</p>
  </div>
  <div class="panel"><div class="core">
    <div class="row"><span>Zenith report</span><span>sample</span></div>
    <div class="score"><b>84</b><span>/100 Good</span></div>
    <div class="cat">Security<em>72</em><i style="width:72%"></i></div>
    <div class="cat">Accessibility<em>81</em><i style="width:81%"></i></div>
    <div class="cat">Search<em>93</em><i style="width:93%"></i></div>
    <div class="cat">Performance<em>88</em><i style="width:88%"></i></div>
  </div></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(HTML, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: OUT, type: "png" });
await browser.close();
console.log("wrote", OUT);
