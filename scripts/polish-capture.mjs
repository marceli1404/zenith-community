/**
 * Login precision-polish capture: the exact matrix PRECISION_POLISH.md requires.
 *
 *   npm run polish:before      # against the unchanged local build
 *   npm run polish:after       # against the polished local build
 *
 * For every viewport x theme it writes a PNG plus a JSON record containing the
 * aside panel rect, the artwork SVG rect, the star path rect, the measured
 * centre error at t=0/5/15s, orbit-radius stability, the outermost ring's
 * clearance from the fixed aside copy, horizontal overflow, and the full
 * inventory of form controls (tag, text, type, order, bounding rect) so the
 * immutable login contract can be diffed mechanically.
 *
 * Runs against a LOCAL build only (POLISH_BASE_URL). Production is never
 * touched and no form is ever submitted.
 *
 * Local fixture: this environment has no OAuth secrets, so /api/config reports
 * both providers disabled and the provider buttons would not render at all.
 * The response is stubbed to {google:true, github:true} — matching the real
 * production capability set — purely so the rendered result is comparable with
 * the production baseline. The stub is recorded in every JSON file.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = process.argv[2] ?? "after";
const BASE = process.env.POLISH_BASE_URL ?? "http://localhost:4173";
const OUT = join(ROOT, "artifacts", "precision-polish", LABEL, "login");

const VIEWPORTS = [
  { w: 1920, h: 1080 }, { w: 1440, h: 900 }, { w: 1280, h: 800 }, { w: 1024, h: 768 },
  { w: 768, h: 1024 }, { w: 390, h: 844 }, { w: 375, h: 667 }, { w: 320, h: 667 },
];
const THEMES = ["light", "dark"];

const CONFIG_FIXTURE = {
  appName: "Zenith",
  turnstileSiteKey: "0x4AAAAAAEuCHVcKT3sNuMg7",
  environment: "production",
  authProviders: { google: true, github: true },
  emailEnabled: true,
};

/** Read every geometry fact we care about, in the page, in one pass. */
function readGeometry() {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: +r.x.toFixed(3), y: +r.y.toFixed(3), width: +r.width.toFixed(3), height: +r.height.toFixed(3), cx: +(r.x + r.width / 2).toFixed(3), cy: +(r.y + r.height / 2).toFixed(3) };
  };
  const panelEl = document.querySelector("aside.auth-aside");
  const svgEl = document.querySelector("aside.auth-aside svg");
  const starEl = document.querySelector('aside.auth-aside [data-star], aside.auth-aside path');
  const copyEl = document.querySelector("aside.auth-aside .auth-aside-copy") ?? document.querySelector("aside.auth-aside > div:last-child");
  const ringEls = [...document.querySelectorAll("aside.auth-aside circle[data-ring]")];
  const nodeEls = [...document.querySelectorAll("aside.auth-aside [data-orbit-node]")];

  const panel = rect(panelEl);
  const svg = rect(svgEl);
  const star = rect(starEl);
  const copy = rect(copyEl);

  // Screen-space radius of each orbit node measured from the panel centre — must
  // stay constant while the wrapper rotates.
  const nodeRadii = nodeEls.map((n) => {
    const r = n.getBoundingClientRect();
    if (!panel) return null;
    const dx = r.x + r.width / 2 - panel.cx;
    const dy = r.y + r.height / 2 - panel.cy;
    return +Math.hypot(dx, dy).toFixed(3);
  });

  // Outermost ring's lowest painted point vs the top of the fixed aside copy.
  let ringClearance = null;
  if (ringEls.length && copy) {
    const bottoms = ringEls.map((c) => c.getBoundingClientRect().bottom);
    ringClearance = +(copy.y - Math.max(...bottoms)).toFixed(3);
  }

  return {
    panel, svg, star, copy, nodeRadii, ringClearance,
    starCentreErrorPx: panel && star ? +(star.cy - panel.cy).toFixed(3) : null,
    svgCentreErrorPx: panel && svg ? +(svg.cy - panel.cy).toFixed(3) : null,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    controls: [...document.querySelectorAll("main button, main input, main a")].map((el) => ({
      tag: el.tagName,
      text: (el.textContent || "").trim(),
      type: el.getAttribute("type"),
      rect: rect(el),
    })),
  };
}

async function capture(browser, vp, theme, reducedMotion) {
  const context = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    colorScheme: theme,
    deviceScaleFactor: 1,
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  await context.addInitScript((t) => {
    try { localStorage.setItem("wh-theme", t); } catch { /* storage blocked */ }
  }, theme);
  await context.route("**/api/config", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CONFIG_FIXTURE) }),
  );

  const page = await context.newPage();
  await page.goto(BASE + "/login", { waitUntil: "load", timeout: 60_000 });
  await page.waitForSelector("h1", { timeout: 15_000 });
  await page.waitForTimeout(900); // entrance animations settle

  const t0 = await page.evaluate(readGeometry);
  await page.waitForTimeout(5000);
  const t5 = await page.evaluate(readGeometry);
  await page.waitForTimeout(10_000);
  const t15 = await page.evaluate(readGeometry);

  // Resize must not move the centre either.
  await page.setViewportSize({ width: Math.max(320, vp.w - 120), height: vp.h });
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: vp.w, height: vp.h });
  await page.waitForTimeout(700);
  const afterResize = await page.evaluate(readGeometry);

  const suffix = reducedMotion ? "-reduced" : "";
  const file = join(OUT, `login-${vp.w}-${theme}${suffix}.png`);
  await page.screenshot({ path: file });

  const record = {
    label: LABEL, url: BASE + "/login", viewport: vp, theme, reducedMotion,
    fixture: "local /api/config stubbed to google+github enabled (no OAuth secrets locally)",
    t0, t5, t15, afterResize,
  };
  await writeFile(file.replace(/\.png$/, ".json"), JSON.stringify(record, null, 2));
  await context.close();
  return record;
}

function verdict(r) {
  // Below the existing `lg` breakpoint the aside is display:none, so every rect
  // collapses to zero. Treat that as "hidden", not as a perfectly centred star.
  const asideVisible = !!r.t0.panel && r.t0.panel.width > 0 && r.t0.panel.height > 0;
  if (!asideVisible) {
    return { asideVisible, overflow: r.t0.overflow, notes: "aside hidden at this width (existing lg breakpoint)" };
  }
  const errs = [r.t0.starCentreErrorPx, r.t5.starCentreErrorPx, r.t15.starCentreErrorPx, r.afterResize.starCentreErrorPx];
  const worst = errs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  const radii = [r.t0.nodeRadii, r.t5.nodeRadii, r.t15.nodeRadii];
  const radiusDrift = r.t0.nodeRadii.map((_, i) => {
    const vals = radii.map((set) => set[i]).filter((v) => typeof v === "number");
    return vals.length ? +(Math.max(...vals) - Math.min(...vals)).toFixed(3) : null;
  });
  return {
    asideVisible,
    worstCentreErrorPx: worst,
    centrePass: Math.abs(worst) <= 0.5,
    radiusDriftPx: radiusDrift,
    radiusPass: radiusDrift.every((d) => d === null || d <= 0.5),
    ringClearancePx: r.t0.ringClearance,
    clearancePass: r.t0.ringClearance === null ? null : r.t0.ringClearance >= 16,
    overflow: r.t0.overflow,
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const summary = [];
  try {
    for (const theme of THEMES) {
      for (const vp of VIEWPORTS) {
        const r = await capture(browser, vp, theme, false);
        const v = verdict(r);
        summary.push({ viewport: `${vp.w}x${vp.h}`, theme, ...v });
        console.log(
          `${String(vp.w).padStart(4)} ${theme.padEnd(5)} ` +
            (v.asideVisible
              ? `centre ${String(v.worstCentreErrorPx).padStart(7)}px ${v.centrePass ? "PASS" : "FAIL"}  ` +
                `radiusDrift ${JSON.stringify(v.radiusDriftPx)} ${v.radiusPass ? "PASS" : "FAIL"}  ` +
                `clearance ${v.ringClearancePx}px ${v.clearancePass === null ? "n/a" : v.clearancePass ? "PASS" : "FAIL"}`
              : "aside hidden (expected below lg)") +
            `  overflow ${v.overflow}`,
        );
      }
    }
    // Reduced motion, at the two sizes where the aside is visible and not.
    for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
      const r = await capture(browser, vp, "dark", true);
      summary.push({ viewport: `${vp.w}x${vp.h}`, theme: "dark", reducedMotion: true, ...verdict(r) });
      console.log(`${String(vp.w).padStart(4)} dark  reduced-motion captured`);
    }
  } finally {
    await browser.close();
  }
  await writeFile(join(OUT, "summary.json"), JSON.stringify({ label: LABEL, capturedAt: new Date().toISOString(), base: BASE, summary }, null, 2));
  console.log(`\nwrote ${OUT.slice(ROOT.length + 1)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
