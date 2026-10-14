/**
 * Honest field-style performance capture for the precision-polish pass.
 *
 *   node scripts/perf-measure.mjs before
 *   node scripts/perf-measure.mjs after
 *
 * Measures, per route, with a cold cache and Chrome DevTools mobile throttling
 * (4x CPU, "Slow 4G"-style network): LCP, CLS, FCP, TTFB, request count and
 * JavaScript transfer/decoded bytes.
 *
 * This is NOT Lighthouse and does not produce Lighthouse category scores. It
 * reports only metrics it actually observes. INP is not measured here (it needs
 * real interactions); `npm run perf:inp` covers that separately.
 *
 * Target defaults to a locally built preview (PERF_BASE_URL), never production.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = process.argv[2] ?? "before";
const BASE = process.env.PERF_BASE_URL ?? "http://localhost:4173";
const OUT = join(ROOT, "artifacts", "precision-polish", LABEL);

const ROUTES = ["/", "/security", "/methodology", "/contact", "/legal/privacy", "/legal/terms", "/login", "/signup"];

/** Chrome's "Slow 4G" preset, as used by Lighthouse mobile throttling. */
const NETWORK = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};
const CPU_SLOWDOWN = 4;

/** Collect LCP/CLS/FCP from inside the page via PerformanceObserver. */
const COLLECTOR = `
  window.__perf = { lcp: 0, lcpEl: '', cls: 0, fcp: 0, shifts: [] };
  const describe = (n) => n ? (n.tagName || '') + (n.id ? '#' + n.id : '') +
    (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\\s+/).slice(0, 3).join('.') : '') : '(none)';
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) { window.__perf.lcp = e.startTime; window.__perf.lcpEl = describe(e.element); }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__perf.cls += e.value;
      for (const s of e.sources || []) window.__perf.shifts.push({ at: Math.round(e.startTime), value: +e.value.toFixed(4), node: describe(s.node) });
    }
  }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__perf.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
`;

async function measure(browser, route) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 823 },
    deviceScaleFactor: 1.75,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  });
  await context.addInitScript(COLLECTOR);
  const page = await context.newPage();

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", NETWORK);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });

  // Size accounting straight from the network layer, so it reflects the wire.
  const resources = new Map();
  cdp.on("Network.responseReceived", (e) => {
    resources.set(e.requestId, { url: e.response.url, type: e.type, transfer: 0, decoded: 0 });
  });
  cdp.on("Network.dataReceived", (e) => {
    const r = resources.get(e.requestId);
    if (!r) return;
    r.transfer += e.encodedDataLength;
    r.decoded += e.dataLength;
  });
  cdp.on("Network.loadingFinished", (e) => {
    const r = resources.get(e.requestId);
    if (r && e.encodedDataLength) r.transfer = e.encodedDataLength;
  });

  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  const url = BASE + route;
  await page.goto(url, { waitUntil: "load", timeout: 90_000 });
  // Let late layout shifts (font swap, auth-config-driven provider buttons) land.
  await page.waitForTimeout(3500);

  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return n ? { ttfb: n.responseStart, domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd } : null;
  });
  const perf = await page.evaluate(() => window.__perf);

  const all = [...resources.values()];
  const js = all.filter((r) => r.type === "Script");
  const css = all.filter((r) => r.type === "Stylesheet");
  const result = {
    route,
    url,
    lcpMs: Math.round(perf.lcp),
    lcpElement: perf.lcpEl,
    fcpMs: Math.round(perf.fcp),
    cls: Number(perf.cls.toFixed(4)),
    clsSources: perf.shifts.slice(0, 8),
    ttfbMs: nav ? Math.round(nav.ttfb) : null,
    loadMs: nav ? Math.round(nav.load) : null,
    requests: all.length,
    jsRequests: js.length,
    jsTransferBytes: js.reduce((s, r) => s + r.transfer, 0),
    jsDecodedBytes: js.reduce((s, r) => s + r.decoded, 0),
    cssTransferBytes: css.reduce((s, r) => s + r.transfer, 0),
    totalTransferBytes: all.reduce((s, r) => s + r.transfer, 0),
    consoleErrors,
  };

  await context.close();
  return result;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const route of ROUTES) {
      const r = await measure(browser, route);
      results.push(r);
      console.log(
        `${route.padEnd(14)} LCP ${String(r.lcpMs).padStart(5)}ms  CLS ${String(r.cls).padEnd(6)}  ` +
          `req ${String(r.requests).padStart(3)}  JS ${(r.jsTransferBytes / 1024).toFixed(1)}KB tx / ` +
          `${(r.jsDecodedBytes / 1024).toFixed(1)}KB dec` +
          (r.consoleErrors.length ? `  [${r.consoleErrors.length} console errors]` : ""),
      );
    }
  } finally {
    await browser.close();
  }

  const report = {
    label: LABEL,
    capturedAt: new Date().toISOString(),
    base: BASE,
    environment: {
      note: "Local production build served by wrangler dev. NOT production, NOT Lighthouse.",
      throttling: { cpuSlowdown: CPU_SLOWDOWN, network: "Slow 4G (150ms RTT, 1.6Mbps down)" },
      device: "412x823 @1.75 DPR, mobile UA",
    },
    routes: results,
  };
  const file = join(OUT, "perf.json");
  await writeFile(file, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${file.slice(ROOT.length + 1)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
