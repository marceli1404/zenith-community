/**
 * Browser analysis step. Reserved for deep audits, and only on a bounded
 * subset of pages (the homepage here) to control Browser Rendering cost. NEVER
 * used for uptime checks.
 *
 * SSRF: request interception validates EVERY navigation and subresource URL
 * against validatePublicTarget and aborts anything non-public, so a malicious
 * page cannot pivot the headless browser to internal targets.
 *
 * Failure isolation: any error here returns null and the audit still
 * completes with HTTP-level results — a browser crash never destroys a valid
 * audit.
 */

import puppeteer from "@cloudflare/puppeteer";
import type { Bindings } from "../env";
import { checkBrowserRequest } from "./browser-request";
import { hasRenderedPageContent } from "./rendered-content";
import {
  GENERIC_ERROR_DEBUG_CONTEXT_PATTERN,
  GENERIC_ERROR_PAGE_SIGNATURES,
  hasGenericErrorPageContent,
} from "@shared/availability";
import { USER_AGENT } from "../lib/http";
import { validatePublicTarget } from "@shared/ssrf";

export interface BrowserAnalysis {
  mainDocumentStatus: number | null;
  hasRenderedContent: boolean;
  hasGenericErrorPage: boolean;
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
  browserRequestAllowed?: (url: string) => Promise<boolean>;
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

    // Match the HTTP crawler's product token so both phases use the same
    // robots.txt group, while retaining a browser UA for rendering differences.
    await page.setUserAgent(`${await browser.userAgent()} ${USER_AGENT}`);

    // Enforce SSRF and robots.txt policy on every request, including redirects
    // and subresources. Fail closed if the policy check itself fails.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      void (async () => {
        const check = checkBrowserRequest(req.url(), req.method());
        if (!check.allowed) {
          await req.abort();
          return;
        }
        if (input.browserRequestAllowed && !await input.browserRequestAllowed(check.url)) {
          await req.abort();
          return;
        }
        await req.continue({ url: check.url });
      })().catch(() => req.abort().catch(() => {}));
    });

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err).slice(0, 300)));

    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const mainResponse = await page.goto(target.url, { waitUntil: "networkidle0", timeout: 30_000 });
    const mainDocumentStatus = mainResponse?.status() ?? null;
    const mainFrameHasRenderedContent = await page.evaluate(hasRenderedPageContent).catch(() => false);
    const childFrameSignals = await Promise.all(page.frames()
      .filter((frame) => frame !== page.mainFrame())
      .map(async (frame) => {
        try {
          const frameElement = await frame.frameElement();
          if (!frameElement) return { hasRenderedContent: false, hasGenericErrorPage: false };
          const frameIsVisible = await frameElement.evaluate(hasRenderedPageContent).catch(() => false);
          if (!frameIsVisible) return { hasRenderedContent: false, hasGenericErrorPage: false };
          const [hasRenderedContent, hasGenericErrorPage] = await Promise.all([
            frame.evaluate(hasRenderedPageContent).catch(() => false),
            frame.evaluate(hasGenericErrorPageContent, {
              signatures: [...GENERIC_ERROR_PAGE_SIGNATURES],
              debugContextPattern: GENERIC_ERROR_DEBUG_CONTEXT_PATTERN,
            }).catch(() => false),
          ]);
          return { hasRenderedContent, hasGenericErrorPage };
        } catch {
          return { hasRenderedContent: false, hasGenericErrorPage: false };
        }
      }));
    const hasRenderedContent = mainFrameHasRenderedContent || childFrameSignals.some((signal) => signal.hasRenderedContent);
    const mainFrameHasGenericErrorPage = await page.evaluate(
      hasGenericErrorPageContent,
      {
        signatures: [...GENERIC_ERROR_PAGE_SIGNATURES],
        debugContextPattern: GENERIC_ERROR_DEBUG_CONTEXT_PATTERN,
      },
    ).catch(() => false);
    const hasGenericErrorPage = mainFrameHasGenericErrorPage || childFrameSignals.some((signal) => signal.hasGenericErrorPage);

    // A failed or incomplete response is not a homepage to score or capture
    // as a successful audit screenshot.
    if (
      mainDocumentStatus === null
      || mainDocumentStatus < 200
      || mainDocumentStatus >= 300
      || [204, 205, 206].includes(mainDocumentStatus)
      || !hasRenderedContent
      || hasGenericErrorPage
    ) {
      return {
        mainDocumentStatus,
        hasRenderedContent,
        hasGenericErrorPage,
        desktopScreenshotKey: null,
        mobileScreenshotKey: null,
        renderedTitle: null,
        consoleErrors: [],
        perf: {
          domContentLoadedMs: null,
          loadEventMs: null,
          resourceCount: null,
          transferredBytes: null,
        },
      };
    }

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

    // Screenshots are optional artifacts. Their capture or storage can fail
    // independently without invalidating the browser checks above.
    let desktopScreenshotKey: string | null = null;
    const desktopKey = `${input.r2KeyPrefix}/desktop.webp`;
    try {
      const desktopShot = (await page.screenshot({ type: "webp", quality: 80 })) as unknown as Uint8Array;
      await env.REPORTS_BUCKET.put(desktopKey, desktopShot, { httpMetadata: { contentType: "image/webp" } });
      desktopScreenshotKey = desktopKey;
    } catch (err) {
      console.error("Desktop screenshot persistence failed", err instanceof Error ? err.message : err);
    }

    let mobileScreenshotKey: string | null = null;
    const mobileKey = `${input.r2KeyPrefix}/mobile.webp`;
    try {
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
      await page.reload({ waitUntil: "networkidle0", timeout: 30_000 }).catch(() => {});
      const mobileShot = (await page.screenshot({ type: "webp", quality: 80 })) as unknown as Uint8Array;
      await env.REPORTS_BUCKET.put(mobileKey, mobileShot, { httpMetadata: { contentType: "image/webp" } });
      mobileScreenshotKey = mobileKey;
    } catch (err) {
      console.error("Mobile screenshot persistence failed", err instanceof Error ? err.message : err);
    }

    return {
      mainDocumentStatus,
      hasRenderedContent,
      hasGenericErrorPage,
      desktopScreenshotKey,
      mobileScreenshotKey,
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
