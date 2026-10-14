/**
 * Bounded, robots-aware, same-origin crawler (§22). Every fetch goes through the
 * SSRF-safe client. Hard limits on pages, depth, concurrency, and response size
 * prevent this from becoming a scanning/abuse tool or falling into crawler traps.
 * Only safe GETs are performed; state-changing routes are skipped.
 */

import { safeFetch, type SafeFetchErrorCode } from "../lib/http";
import { extractPageMeta, isHtmlDocument } from "../lib/html";
import { headerMap, runAllRules, type PageContext } from "./rules";
import type { Finding } from "@shared/findings";
import { canonicalizeUrl, isSameOrigin, isUnsafeCrawlPath } from "@shared/url";

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  concurrency: number;
}

export interface CrawledPage {
  ctx: PageContext;
  findings: Finding[];
  depth: number;
}

export type HomepageFailure =
  | { kind: "http_error"; status: number }
  | { kind: "request_failed"; errorCode: SafeFetchErrorCode };

export interface CrawlOutput {
  pages: CrawledPage[];
  brokenLinks: number;
  homepageFailure: HomepageFailure | null;
}

const DEFAULTS: CrawlOptions = { maxPages: 25, maxDepth: 3, concurrency: 3 };

export async function crawlSite(origin: string, options: Partial<CrawlOptions> = {}): Promise<CrawlOutput> {
  const opts = { ...DEFAULTS, ...options };
  const disallow = await loadRobots(origin);

  const seen = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: origin, depth: 0 }];
  seen.add(canonicalizeUrl(origin) ?? origin);

  const pages: CrawledPage[] = [];
  let brokenLinks = 0;
  let homepageFailure: HomepageFailure | null = null;

  while (queue.length > 0 && pages.length < opts.maxPages) {
    const batch = queue.splice(0, opts.concurrency);
    const results = await Promise.all(
      batch.map(async ({ url, depth }) => {
        const res = await safeFetch(url, { readBody: true, maxBytes: 1_500_000, timeoutMs: 12_000 });
        return { url, depth, res };
      }),
    );

    for (const { url, depth, res } of results) {
      if (pages.length >= opts.maxPages) break;
      if (!res.ok) {
        if (depth === 0) homepageFailure = { kind: "request_failed", errorCode: res.errorCode };
        brokenLinks += 1;
        continue;
      }
      if (depth === 0 && res.status >= 400) homepageFailure = { kind: "http_error", status: res.status };
      // Linked files (security.txt, PDFs, feeds) are reachable, not broken, but
      // they are not pages: page rules would only produce false findings.
      if (res.status < 400 && !isHtmlDocument(res.headers.get("content-type"), res.body)) continue;
      const meta = await extractPageMeta(res.body ?? "", res.finalUrl);
      const ctx: PageContext = {
        url,
        finalUrl: res.finalUrl,
        statusCode: res.status,
        responseMs: res.responseMs,
        bytes: res.contentLength ?? (res.body ? res.body.length : 0),
        headers: headerMap(res.headers),
        meta,
      };
      pages.push({ ctx, findings: runAllRules(ctx), depth });

      // Enqueue same-origin, safe, unseen links up to depth/page limits.
      if (depth < opts.maxDepth) {
        for (const link of meta.links) {
          if (pages.length + queue.length >= opts.maxPages * 2) break;
          const canon = canonicalizeUrl(link, res.finalUrl);
          if (!canon) continue;
          if (!isSameOrigin(canon, origin)) continue;
          if (seen.has(canon)) continue;
          const path = new URL(canon).pathname;
          if (isUnsafeCrawlPath(path)) continue;
          if (isDisallowed(disallow, path)) continue;
          seen.add(canon);
          queue.push({ url: canon, depth: depth + 1 });
        }
      }
    }
  }

  return { pages, brokenLinks, homepageFailure };
}

/** Parse robots.txt Disallow rules for our UA and the wildcard group. */
async function loadRobots(origin: string): Promise<string[]> {
  const res = await safeFetch(`${origin}/robots.txt`, { readBody: true, maxBytes: 100_000, timeoutMs: 6000 });
  if (!res.ok || res.status >= 400 || !res.body) return [];
  const lines = res.body.split(/\r?\n/);
  const disallow: string[] = [];
  let applies = false;
  for (const raw of lines) {
    const line = raw.split("#")[0]!.trim();
    if (line === "") continue;
    const [field, ...rest] = line.split(":");
    const key = field?.toLowerCase().trim();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      applies = value === "*" || value.toLowerCase().includes("webhealth");
    } else if (key === "disallow" && applies && value) {
      disallow.push(value);
    }
  }
  return disallow;
}

function isDisallowed(disallow: string[], path: string): boolean {
  return disallow.some((rule) => rule !== "" && path.startsWith(rule));
}
