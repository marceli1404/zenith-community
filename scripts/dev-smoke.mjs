/**
 * Quick render check against a running server: does each route actually paint an
 * <h1>, and does the console stay clean? Used to separate real regressions from
 * unrelated pre-existing test failures.
 *
 *   node scripts/dev-smoke.mjs [baseUrl]
 */
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:5173";
const ROUTES = ["/", "/security", "/methodology", "/contact", "/legal/privacy", "/legal/terms", "/login", "/signup", "/nope-404"];

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

for (const route of ROUTES) {
  errors.length = 0;
  const res = await page.goto(BASE + route, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(1500);
  const h1 = await page.locator("h1").first().textContent().catch(() => null);
  const lang = await page.evaluate(() => document.documentElement.lang);
  const title = await page.title();
  console.log(
    `${route.padEnd(14)} ${res.status()}  lang="${lang}"  title="${(title || "").slice(0, 40)}"  h1="${(h1 || "(none)").trim().slice(0, 45)}"` +
      (errors.length ? `  ERR: ${errors.slice(0, 2).join(" | ").slice(0, 160)}` : ""),
  );
}
await browser.close();
