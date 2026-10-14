import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Automated accessibility checks (axe-core) on the public pages. Runs via CDP so
 * it works even under the production CSP. Fails on serious/critical violations.
 */

const PAGES = [
  { path: "/", name: "landing" },
  { path: "/login", name: "login" },
  { path: "/signup", name: "signup" },
  { path: "/security", name: "security" },
  { path: "/methodology", name: "methodology" },
  { path: "/contact", name: "contact" },
  { path: "/legal/privacy", name: "legal-privacy" },
  { path: "/legal/terms", name: "legal-terms" },
];

/**
 * Every page mounts with a staggered entrance (styles/motion.css `.lx-enter`,
 * styles/auth.css) that fades opacity in over ~400-760ms. Reading computed
 * styles mid-fade hands axe a half-transparent colour blended with the page
 * background, which reads as a false color-contrast violation even though the
 * settled page is fine. Below-the-fold content instead animates on a scroll-
 * linked `animation-timeline: view()` (styles/scroll.css `lx-sd-*`), which by
 * design only moves transform/clip-path and never touches colour or opacity —
 * confirmed by probing `document.getAnimations()` against these pages, so it
 * cannot cause a contrast false-positive. It also never reaches the "finished"
 * play state until scrolled past, so waiting on it would hang the test.
 *
 * So: scroll the page through once (bottom, then back to top) so anything
 * view()-driven has actually played through at least once, then wait only for
 * the document-timeline entrance animations to finish before handing the page
 * to axe.
 */
async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => requestAnimationFrame(r));
    window.scrollTo(0, 0);
    await new Promise((r) => requestAnimationFrame(r));
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.timeline === document.timeline)
        .filter((a) => {
          const t = a.effect?.getTiming();
          return t && t.iterations !== Infinity;
        })
        .map((a) => a.finished.catch(() => {})),
    );
  });
}

for (const p of PAGES) {
  test(`a11y: ${p.name} has no serious/critical violations`, async ({ page }) => {
    // Not networkidle: the Turnstile widget holds connections open, so networkidle
    // never settles on pages that embed it.
    await page.goto(p.path, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("h1", { timeout: 10_000 }).catch(() => {});
    await settleAnimations(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      // Cloudflare's Turnstile iframe is third-party markup we don't control.
      .options({ iframes: false })
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    if (serious.length) {
      console.log(`\n${p.name} serious/critical violations:`);
      for (const v of serious) {
        console.log(`  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`);
        for (const node of v.nodes) console.log(node.target, node.failureSummary);
      }
    }
    expect(serious, `serious/critical a11y violations on ${p.name}`).toEqual([]);
  });
}
