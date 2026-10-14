/**
 * Dashboard capture for the precision-polish pass.
 *
 *   npm run dashboard:after
 *
 * The dashboard is behind authentication and this machine has no local account,
 * no OAuth secrets and no seeded D1 data. Rather than mutate a real account for
 * screenshots, every API response is served from an ISOLATED LOCAL FIXTURE
 * defined in this file and injected with Playwright request interception. No
 * production data is read or written, and no real session is created.
 *
 * Fixtures cover the states PRECISION_POLISH.md asks for: no sites, one site,
 * many sites, healthy vs incident, an audit that is running vs completed, and a
 * refresh that is slow or that fails. Each fixture name is written into the
 * capture's JSON so no screenshot can be mistaken for production.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = process.argv[2] ?? "after";
const BASE = process.env.DASH_BASE_URL ?? "http://localhost:4173";
const OUT = join(ROOT, "artifacts", "precision-polish", LABEL, "dashboard");

const ME = { user: { id: "fixture-user", email: "fixture@example.test" }, plan: "pro" };
const CONFIG = {
  appName: "Zenith", turnstileSiteKey: "0x4AAAAAAEuCHVcKT3sNuMg7", environment: "production",
  authProviders: { google: true, github: true }, emailEnabled: true,
};

// Milliseconds. The API stores and returns ms (src/routes/dashboard.ts uses
// Date.now()) and web/lib/format.ts relativeTime() subtracts from Date.now().
// An earlier revision of this file used seconds, which rendered every fixture
// timestamp as January 1970.
const now = Date.now();
const seconds = 1000;
const minutes = 60 * seconds;
const hours = 60 * minutes;
const site = (i, ok) => ({
  id: `site-${i}`, name: `example-${i}.test`, origin: `https://example-${i}.test`,
  verified: true, status: ok ? "up" : "down", uptime24h: ok ? 100 : 96.4,
  last_checked_at: now - 60 * i, latest_score: ok ? 92 - i : 61,
  open_incidents: ok ? 0 : 1,
});

const audit = (id, status, agoMs, score, siteIndex) => ({
  id, status, queued_at: now - agoMs, overall_score: score,
  site_name: `example-${siteIndex}.test`, target_origin: null,
  origin: `https://example-${siteIndex}.test`, result_id: score === null ? null : `r-${id}`,
  source: "scheduled",
});

const OVERVIEW_HEALTHY = {
  sites: 12, verifiedSites: 11, openIncidents: 0, uptime24h: 99.98, avgHealthScore: 88,
  recentAudits: [
    audit("a1", "completed", 1 * hours, 92, 1),
    audit("a2", "running", 5 * minutes, null, 2),
    audit("a3", "queued", 1 * minutes, null, 3),
  ],
  recentIncidents: [],
};

const INCIDENTS = [
  { id: "i1", site_id: "site-4", site_name: "example-4.test", started_at: now - 90 * minutes, resolved_at: null, reason: "connection timed out", initial_status_code: null },
  { id: "i2", site_id: "site-7", site_name: "example-7.test", started_at: now - 24 * hours, resolved_at: now - 23 * hours, reason: "500 from origin", initial_status_code: 500 },
];

const AUDIT_ROWS = [
  audit("a1", "completed", 1 * hours, 92, 1),
  audit("a5", "completed", 26 * hours, 78, 5),
  audit("a2", "running", 5 * minutes, null, 2),
  audit("a4", "failed", 15 * minutes, null, 4),
];

const FIXTURES = {
  "overview-empty": {
    "/api/dashboard/overview": { sites: 0, verifiedSites: 0, openIncidents: 0, uptime24h: 100, avgHealthScore: null, recentAudits: [], recentIncidents: [] },
  },
  "overview-one-site": {
    "/api/dashboard/overview": { sites: 1, verifiedSites: 1, openIncidents: 0, uptime24h: 100, avgHealthScore: 92, recentAudits: [audit("a1", "completed", 1 * hours, 92, 1)], recentIncidents: [] },
  },
  "overview-many-healthy": { "/api/dashboard/overview": OVERVIEW_HEALTHY },
  "overview-incident": {
    "/api/dashboard/overview": {
      sites: 12, verifiedSites: 11, openIncidents: 2, uptime24h: 97.2, avgHealthScore: 64,
      recentAudits: [audit("a4", "failed", 15 * minutes, null, 4)],
      recentIncidents: INCIDENTS.map(({ id, started_at, resolved_at, reason, site_name }) => ({ id, started_at, resolved_at, reason, site_name })),
    },
  },
  // Initial load fails outright — this is the *first-load* failure state, not a
  // refresh. The refresh path is exercised by `overview-revalidate-*` below.
  "overview-initial-load-failed": { __fail: ["/api/dashboard/overview"] },
  "overview-initial-load-slow": { __slowMs: 4000, "/api/dashboard/overview": OVERVIEW_HEALTHY },

  // Real revalidation: the first response succeeds, then the tab is hidden and
  // re-shown to trigger a genuine background refresh whose second response is
  // slow / fails. Previously loaded values must stay on screen throughout.
  "overview-revalidate-slow": {
    __revalidate: true, __slowAfterFirst: 4000, "/api/dashboard/overview": OVERVIEW_HEALTHY,
  },
  "overview-revalidate-failed": {
    __revalidate: true, __failAfterFirst: ["/api/dashboard/overview"], "/api/dashboard/overview": OVERVIEW_HEALTHY,
  },
  // ... then the retry succeeds and the values update.
  "overview-revalidate-recovered": {
    __revalidate: true, __failAfterFirst: ["/api/dashboard/overview"], __retryAfterFail: true,
    "/api/dashboard/overview": OVERVIEW_HEALTHY,
    __secondBody: { ...OVERVIEW_HEALTHY, sites: 13, openIncidents: 1, avgHealthScore: 84 },
  },

  "sites-many": {
    "/api/dashboard/overview": { ...OVERVIEW_HEALTHY, openIncidents: 1, uptime24h: 99.4, avgHealthScore: 84 },
    "/api/sites": { sites: [...Array(12)].map((_, i) => site(i + 1, i !== 3)) },
  },
  "sites-empty": { "/api/sites": { sites: [] } },
  "audits-list": { "/api/audits": { audits: AUDIT_ROWS } },
  "incidents-list": { "/api/dashboard/incidents": { incidents: INCIDENTS } },
  "incidents-empty": { "/api/dashboard/incidents": { incidents: [] } },
  "reports-list": { "/api/audits": { audits: AUDIT_ROWS } },
};

/** Which route each fixture is captured on, and at which viewports. */
const SCENARIOS = [
  { fixture: "overview-empty", route: "/app", all: true },
  { fixture: "overview-one-site", route: "/app", all: true },
  { fixture: "overview-many-healthy", route: "/app", all: true },
  { fixture: "overview-incident", route: "/app", all: true },
  { fixture: "overview-initial-load-failed", route: "/app", all: true },
  { fixture: "overview-initial-load-slow", route: "/app", all: false },
  { fixture: "overview-revalidate-slow", route: "/app", all: false },
  { fixture: "overview-revalidate-failed", route: "/app", all: false },
  { fixture: "overview-revalidate-recovered", route: "/app", all: false },
  { fixture: "sites-many", route: "/app/sites", all: false },
  { fixture: "sites-empty", route: "/app/sites", all: false },
  { fixture: "audits-list", route: "/app/audits", all: false },
  { fixture: "incidents-list", route: "/app/incidents", all: false },
  { fixture: "incidents-empty", route: "/app/incidents", all: false },
  { fixture: "reports-list", route: "/app/reports", all: false },
];

const VIEWPORTS = [
  { name: "desktop", w: 1440, h: 900 },
  { name: "tablet", w: 768, h: 1024 },
  { name: "mobile", w: 390, h: 844 },
];

async function capture(browser, fixtureName, route, vp, theme, reducedMotion) {
  const fixture = FIXTURES[fixtureName];
  const context = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    colorScheme: theme,
    deviceScaleFactor: 1,
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  await context.addInitScript((t) => { try { localStorage.setItem("wh-theme", t); } catch { /* blocked */ } }, theme);

  // Per-endpoint call counts, so "first response" and "every response after the
  // first" can behave differently and a real revalidation can be exercised.
  const calls = new Map();
  await context.route("**/api/**", async (route_) => {
    const path = new URL(route_.request().url()).pathname;
    if (path === "/api/config") return route_.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CONFIG) });
    if (path === "/api/me") return route_.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ME) });

    const n = (calls.get(path) ?? 0) + 1;
    calls.set(path, n);
    const json = (body, status = 200) =>
      route_.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (fixture.__fail?.includes(path)) return json({ error: "fixture failure" }, 500);
    if (fixture[path] === undefined) return json({});

    if (n === 1) return json(fixture[path]);

    // Second and later responses — the revalidation behaviour under test.
    if (fixture.__failAfterFirst?.includes(path)) {
      // A later retry may be configured to succeed with updated values.
      if (fixture.__retryAfterFail && n >= 3) return json(fixture.__secondBody ?? fixture[path]);
      return json({ error: "fixture revalidation failure" }, 500);
    }
    if (fixture.__slowAfterFirst) await new Promise((r) => setTimeout(r, fixture.__slowAfterFirst));
    return json(fixture.__secondBody ?? fixture[path]);
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto(BASE + route, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(fixture.__slowMs ? 1200 : 2200);

  let revalidation = null;
  if (fixture.__revalidate) {
    // Record what is on screen after a *successful* first load, then trigger a
    // genuine background revalidation the way a returning user does — the tab
    // becoming visible again — and confirm those values survive it.
    const before = await readStats(page);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(fixture.__slowAfterFirst ? 900 : 1400);
    const during = await readStats(page);
    let after = during;
    if (fixture.__retryAfterFail) {
      const retry = page.getByRole("button", { name: "Try again" });
      if (await retry.count()) { await retry.first().click(); await page.waitForTimeout(1600); }
      after = await readStats(page);
    }
    revalidation = { afterFirstLoad: before, duringRevalidation: during, afterRetry: after };
  }

  const shift = await page.evaluate(() => {
    let cls = 0;
    for (const e of performance.getEntriesByType("layout-shift")) if (!e.hadRecentInput) cls += e.value;
    return +cls.toFixed(4);
  });
  const activeAnimations = await page.evaluate(() =>
    document.getAnimations().filter((a) => a.playState === "running").map((a) => a.animationName ?? "(transition)"),
  );

  const axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]);
  const axeResult = await axe.analyze();
  const violations = axeResult.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));

  const suffix = reducedMotion ? "-reduced" : "";
  const file = join(OUT, `${fixtureName}-${vp.name}-${theme}${suffix}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await writeFile(file.replace(/\.png$/, ".json"), JSON.stringify({
    label: LABEL, fixture: fixtureName, route, viewport: vp, theme, reducedMotion,
    source: "ISOLATED LOCAL FIXTURE — no production data, no real session",
    cumulativeLayoutShift: shift, activeAnimations, axeSeriousCritical: violations,
    revalidation, consoleErrors,
  }, null, 2));
  await context.close();
  return {
    fixtureName, route, vp: vp.name, theme, reducedMotion, cls: shift,
    axe: violations.length, activeAnimations: activeAnimations.length,
    revalidation, consoleErrors: consoleErrors.length,
  };
}

/** The four stat-card values as rendered, so retention across a refresh is a fact. */
function readStats(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("main .grid > div")].slice(0, 4).map((c) => (c.textContent || "").trim()),
  );
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const rows = [];
  try {
    for (const theme of ["light", "dark"]) {
      for (const s of SCENARIOS) {
        const viewports = s.all ? VIEWPORTS : [VIEWPORTS[0]];
        for (const vp of viewports) rows.push(await capture(browser, s.fixture, s.route, vp, theme, false));
      }
    }
    // Reduced motion across the states that actually animate.
    for (const [fixture, route, theme] of [
      ["overview-many-healthy", "/app", "dark"],
      ["overview-incident", "/app", "light"],
      ["sites-many", "/app/sites", "dark"],
      ["audits-list", "/app/audits", "light"],
    ]) {
      rows.push(await capture(browser, fixture, route, VIEWPORTS[0], theme, true));
    }
  } finally {
    await browser.close();
  }

  let axeTotal = 0;
  for (const r of rows) {
    axeTotal += r.axe;
    console.log(
      `${r.fixtureName.padEnd(28)} ${r.vp.padEnd(8)} ${r.theme.padEnd(5)}${r.reducedMotion ? " reduced" : "        "}` +
        ` CLS ${String(r.cls).padEnd(7)} axe ${String(r.axe).padEnd(3)} anim ${String(r.activeAnimations).padEnd(3)}` +
        (r.consoleErrors ? ` ${r.consoleErrors} console errors` : ""),
    );
    if (r.revalidation) {
      const same = JSON.stringify(r.revalidation.afterFirstLoad) === JSON.stringify(r.revalidation.duringRevalidation);
      console.log(`    revalidation: values retained during refresh = ${same ? "YES" : "NO"}; after retry = ${JSON.stringify(r.revalidation.afterRetry)}`);
    }
  }
  console.log(`\ntotal serious/critical axe violations: ${axeTotal}`);
  await writeFile(join(OUT, "summary.json"), JSON.stringify({ label: LABEL, capturedAt: new Date().toISOString(), base: BASE, axeTotal, rows }, null, 2));
  console.log(`wrote ${OUT.slice(ROOT.length + 1)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
