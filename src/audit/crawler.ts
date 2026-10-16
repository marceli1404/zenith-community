/**
 * Bounded, robots-aware, same-origin crawler. Every fetch goes through the
 * SSRF-safe client. Hard limits on pages, depth, concurrency, and response size
 * prevent this from becoming a scanning/abuse tool or falling into crawler traps.
 * Only safe GETs are performed; state-changing routes are skipped.
 */

import { safeFetch, type SafeFetchErrorCode } from "../lib/http";
import { isDisallowed, loadRobots } from "../lib/robots";
import { extractPageMeta, isGenericErrorHtmlDocument, isHtmlDocument } from "../lib/html";
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
  | { kind: "partial_page"; status: 206 }
  | { kind: "generic_error_page"; status: number }
  | { kind: "empty_page"; status: number }
  | { kind: "not_html"; contentType: string | null }
  | { kind: "request_failed"; errorCode: SafeFetchErrorCode };

export type RobotsBlock =
  | { kind: "disallowed"; path: string; origin?: string }
  | { kind: "unreachable"; status?: number; errorCode?: SafeFetchErrorCode; origin?: string };

export interface UnsafePathBlock {
  kind: "unsafe_path";
  path: string;
  origin: string;
}

export interface CrawlOutput {
  pages: CrawledPage[];
  findings: Finding[];
  brokenLinks: number;
  /** Pages whose response exceeded the configured read limit and was not fully assessed. */
  assessmentTruncatedUrls: string[];
  homepageFailure: HomepageFailure | null;
  robotsBlock: RobotsBlock | null;
  unsafePathBlock: UnsafePathBlock | null;
  /** Cached allow check for every browser navigation, redirect, and subresource. */
  browserRequestAllowed: (url: string) => Promise<boolean>;
}

const DEFAULTS: CrawlOptions = { maxPages: 25, maxDepth: 3, concurrency: 3 };

export async function crawlSite(origin: string, options: Partial<CrawlOptions> = {}): Promise<CrawlOutput> {
  const opts = { ...DEFAULTS, ...options };
  const robots = await loadRobots(origin);
  const homepage = new URL(origin);
  const homepagePath = `${homepage.pathname || "/"}${homepage.search}`;
  const robotsByOrigin = new Map<string, Promise<Awaited<ReturnType<typeof loadRobots>>>>();
  robotsByOrigin.set(homepage.origin, Promise.resolve(robots));
  const getRobots = (targetOrigin: string, timeoutMs = 6_000) => {
    let policyPromise = robotsByOrigin.get(targetOrigin);
    if (!policyPromise) {
      policyPromise = loadRobots(targetOrigin, timeoutMs);
      robotsByOrigin.set(targetOrigin, policyPromise);
    }
    return policyPromise;
  };
  const browserRequestAllowed = async (targetUrl: string): Promise<boolean> => {
    try {
      const target = new URL(targetUrl);
      const policy = await getRobots(target.origin);
      return policy.block === null && !isDisallowed(policy.rules, `${target.pathname || "/"}${target.search}`);
    } catch {
      return false;
    }
  };
  const robotsBlock = robots.block ?? (isDisallowed(robots.rules, homepagePath)
    ? { kind: "disallowed" as const, path: homepagePath }
    : null);
  if (robotsBlock) {
    return { pages: [], findings: [], brokenLinks: 0, assessmentTruncatedUrls: [], homepageFailure: null, robotsBlock, unsafePathBlock: null, browserRequestAllowed };
  }
  const robotsRules = robots.rules;
  const redirectBlocks = new Map<string, RobotsBlock | UnsafePathBlock>();
  const redirectPolicy = async (targetUrl: string, remainingMs: number) => {
    const target = new URL(targetUrl);
    const path = `${target.pathname || "/"}${target.search}`;
    if (isUnsafeCrawlPath(path)) {
      const block: UnsafePathBlock = { kind: "unsafe_path", path, origin: target.origin };
      redirectBlocks.set(targetUrl, block);
      return {
        allowed: false as const,
        code: "unsafe_crawl_path",
        reason: `This redirect points to ${target.origin}${path}, which matches a path excluded from crawling.`,
      };
    }
    const policy = await getRobots(target.origin, Math.min(6_000, remainingMs));
    if (policy.block) {
      const block: RobotsBlock = { ...policy.block, origin: target.origin };
      redirectBlocks.set(targetUrl, block);
      return {
        allowed: false as const,
        code: "robots_unreachable",
        reason: `robots.txt for ${target.origin} could not be read; this redirect was not followed.`,
      };
    }
    if (isDisallowed(policy.rules, path)) {
      const block: RobotsBlock = { kind: "disallowed", path, origin: target.origin };
      redirectBlocks.set(targetUrl, block);
      return {
        allowed: false as const,
        code: "robots_disallowed",
        reason: `robots.txt disallows this crawler from requesting ${target.origin}${path}.`,
      };
    }
    return { allowed: true as const };
  };

  const seen = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: origin, depth: 0 }];
  seen.add(canonicalizeUrl(origin) ?? origin);

  const pages: CrawledPage[] = [];
  const findings: Finding[] = [];
  let brokenLinks = 0;
  const assessmentTruncatedUrls: string[] = [];
  let homepageFailure: HomepageFailure | null = null;
  let homepageRedirectRobotsBlock: RobotsBlock | null = null;
  let homepageRedirectUnsafePathBlock: UnsafePathBlock | null = null;

  while (queue.length > 0 && pages.length < opts.maxPages) {
    const batch = queue.splice(0, opts.concurrency);
    const results = await Promise.all(
      batch.map(async ({ url, depth }) => {
        const res = await safeFetch(url, {
          readBody: true,
          maxBytes: 1_500_000,
          timeoutMs: 12_000,
          redirectPolicy,
        });
        return { url, depth, res };
      }),
    );

    for (const { url, depth, res } of results) {
      if (pages.length >= opts.maxPages) break;
      if (!res.ok) {
        if (res.errorCode === "redirect_policy") {
          const block = redirectBlocks.get(res.redirectUrl ?? "") ?? {
            kind: "unreachable" as const,
            errorCode: "dns_or_network" as const,
          };
          if (depth === 0) {
            if (block.kind === "unsafe_path") homepageRedirectUnsafePathBlock = block;
            else homepageRedirectRobotsBlock = block;
            break;
          }
          // A policy-blocked child page is unassessed, not a broken link.
          continue;
        }
        if (depth === 0) homepageFailure = { kind: "request_failed", errorCode: res.errorCode };
        brokenLinks += 1;
        if (depth > 0) findings.push(brokenPageFinding(url, res.errorCode));
        continue;
      }
      if (res.status >= 400) {
        if (depth === 0) homepageFailure = { kind: "http_error", status: res.status };
        else {
          brokenLinks += 1;
          findings.push(brokenPageFinding(url, undefined, res.status));
        }
        continue;
      }
      if (res.status === 206) {
        if (depth === 0) homepageFailure = { kind: "partial_page", status: 206 };
        else {
          brokenLinks += 1;
          findings.push(brokenPageFinding(url, undefined, res.status));
        }
        continue;
      }
      const emptyBody = !res.body?.trim();
      const noContentStatus = [204, 205, 304].includes(res.status);
      if (noContentStatus) {
        if (depth === 0) homepageFailure = { kind: "empty_page", status: res.status };
        else {
          brokenLinks += 1;
          findings.push(emptyPageFinding(url, res.status));
        }
        continue;
      }
      if (res.status >= 300) {
        if (depth === 0) homepageFailure = { kind: "http_error", status: res.status };
        else {
          brokenLinks += 1;
          findings.push(brokenPageFinding(url, undefined, res.status));
        }
        continue;
      }
      if (emptyBody && (depth === 0 || isHtmlDocument(res.headers.get("content-type"), res.body))) {
        if (depth === 0) homepageFailure = { kind: "empty_page", status: res.status };
        else {
          brokenLinks += 1;
          findings.push(emptyPageFinding(url, res.status));
        }
        continue;
      }
      // Linked files (security.txt, PDFs, feeds) are reachable, not broken, but
      // they are not pages: page rules would only produce false findings.
      if (!isHtmlDocument(res.headers.get("content-type"), res.body)) {
        if (depth === 0) homepageFailure = { kind: "not_html", contentType: res.headers.get("content-type") };
        continue;
      }
      if (isGenericErrorHtmlDocument(res.body)) {
        if (depth === 0) homepageFailure = { kind: "generic_error_page", status: res.status };
        else {
          brokenLinks += 1;
          findings.push(genericErrorPageFinding(url, res.status));
        }
        continue;
      }
      if (res.bodyTruncated) {
        assessmentTruncatedUrls.push(url);
        continue;
      }
      const meta = await extractPageMeta(res.body ?? "", res.finalUrl, origin);
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
          const pageUrl = new URL(canon);
          // RFC 9309 path matching includes the query component.
          const path = `${pageUrl.pathname}${pageUrl.search}`;
          if (isUnsafeCrawlPath(path)) continue;
          if (isDisallowed(robotsRules, path)) continue;
          seen.add(canon);
          queue.push({ url: canon, depth: depth + 1 });
        }
      }
    }
  }

  return {
    pages,
    findings,
    brokenLinks,
    assessmentTruncatedUrls,
    homepageFailure,
    robotsBlock: homepageRedirectRobotsBlock,
    unsafePathBlock: homepageRedirectUnsafePathBlock,
    browserRequestAllowed,
  };
}

function genericErrorPageFinding(url: string, status: number): Finding {
  return {
    category: "reliability",
    severity: "critical",
    ruleId: "reliability.generic-error-page",
    title: "Generic server-error page",
    description: `The page returned HTTP ${status} with content matching a generic server-error screen.`,
    pageUrl: url,
    evidence: { statusCode: status },
    recommendation: "Replace the generic error screen with the intended page, then run the audit again.",
  };
}

function brokenPageFinding(url: string, errorCode?: SafeFetchErrorCode, status?: number): Finding {
  const severity = status !== undefined ? (status >= 500 ? "critical" : "high") : "medium";
  return {
    category: "reliability",
    severity,
    ruleId: "reliability.broken-page",
    title: "Linked page unavailable",
    description: status !== undefined
      ? `A linked page returned HTTP ${status}.`
      : "A linked page could not be reached during the audit.",
    pageUrl: url,
    evidence: status !== undefined ? { status } : { errorCode },
    recommendation: "Restore the page or update links that point to it.",
  };
}

function emptyPageFinding(url: string, status: number): Finding {
  return {
    category: "reliability",
    severity: "medium",
    ruleId: "reliability.empty-page",
    title: "Linked page returned no content",
    description: `A linked page returned HTTP ${status} without page content.`,
    pageUrl: url,
    evidence: { status },
    recommendation: "Serve page content at this URL or update links that point to it.",
  };
}
