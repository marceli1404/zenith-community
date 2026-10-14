/**
 * Browser analysis step (§29). Reserved for deep audits, and only on a bounded
 * subset of pages (the homepage here) to control Browser Rendering cost. NEVER
 * used for uptime checks.
 *
 * SSRF: request interception validates EVERY navigation and subresource URL
 * against validatePublicTarget and aborts anything non-public, so a malicious
 * page cannot pivot the headless browser to internal targets.
 *
 * Failure isolation (§55): any error here returns null and the audit still
 * completes with HTTP-level results — a browser crash never destroys a valid
 * audit.
 */

import puppeteer from "@cloudflare/puppeteer";
import type { Bindings } from "../env";
import { validatePublicTarget } from "@shared/ssrf";

export interface BrowserAnalysis {
  desktopScreenshotKey: string | null;
  mobileScreenshotKey: string | null;
  renderedTitle: string | null;
  consoleErrors: string[];
  perf: {
    domContentLoadedMs: number | null;
    loadEventMs: number | null;
    resourceCount: number | null;
    transferredBytes: number | null;
  };
}

export interface BrowserAnalysisInput {
  origin: string;
  r2KeyPrefix: string; // e.g. users/{userId}/sites/{siteId}/audits/{auditId}
}

export async function runBrowserAnalysis(
  env: Bindings,
  input: BrowserAnalysisInput,
): Promise<BrowserAnalysis | null> {
  // Guard: only proceed for a valid public target.
  const target = validatePublicTarget(input.origin);
  if (!target.ok) return null;

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();

    // Enforce SSRF on every request the page makes.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const check = validatePublicTarget(req.url());
      if (check.ok) void req.continue();
      else void req.abort();
    });

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err).slice(0, 300)));

    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(target.url, { waitUntil: "networkidle0", timeout: 30_000 });

    const renderedTitle = await page.title().catch(() => null);

    const perf = await page
      // Runs in the page (browser) context; use loose typing since DOM perf
      // types are not part of the Worker lib.

      .evaluate(() => {

        const nav: any = (performance as any).getEntriesByType("navigation")[0];

        const resources: any[] = (performance as any).getEntriesByType("resource");
        const transferred = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
        return {
          domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
          loadEventMs: nav ? Math.round(nav.loadEventEnd) : null,
          resourceCount: resources.length,
          transferredBytes: transferred || null,
        };
      })
      .catch(() => ({ domContentLoadedMs: null, loadEventMs: null, resourceCount: null, transferredBytes: null }));

    // Desktop screenshot.
    const desktopKey = `${input.r2KeyPrefix}/desktop.webp`;
    const desktopShot = (await page.screenshot({ type: "webp", quality: 80 })) as unknown as Uint8Array;
    await env.REPORTS_BUCKET.put(desktopKey, desktopShot, { httpMetadata: { contentType: "image/webp" } });

    // Mobile screenshot.
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
    await page.reload({ waitUntil: "networkidle0", timeout: 30_000 }).catch(() => {});
    const mobileKey = `${input.r2KeyPrefix}/mobile.webp`;
    const mobileShot = (await page.screenshot({ type: "webp", quality: 80 })) as unknown as Uint8Array;
    await env.REPORTS_BUCKET.put(mobileKey, mobileShot, { httpMetadata: { contentType: "image/webp" } });

    return {
      desktopScreenshotKey: desktopKey,
      mobileScreenshotKey: mobileKey,
      renderedTitle,
      consoleErrors: consoleErrors.slice(0, 20),
      perf,
    };
  } catch (err) {
    console.error("Browser analysis failed", err instanceof Error ? err.message : err);
    return null;
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}
