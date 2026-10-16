/**
 * Lightweight public quick scan. It is HTTP-only (no browser). Fetches the target
 * once through the SSRF-safe client, extracts metadata, runs the deterministic
 * rule set, checks robots.txt and sitemap availability, validates a bounded set
 * of same-origin links for obvious breakage, then scores the result.
 *
 * Returns real findings and scores; no result is hidden behind account access.
 */

import { safeFetch, type SafeFetchOptions, type SafeFetchOutcome } from "./http";
import { extractPageMeta, hasMeaningfulHtmlContent, hasUnverifiedMediaContent, isGenericErrorHtmlDocument, isHtmlDocument } from "./html";
import { headerMap, runAllRules, type PageContext } from "../audit/rules";
import { groupFindings, sortBySeverity, type Finding, type GroupedFinding } from "@shared/findings";
import { computeScores, type AuditScore } from "@shared/scoring";
import { normalizeOrigin, isSameOrigin, isUnsafeCrawlPath } from "@shared/url";
import { isDisallowed, loadRobots } from "./robots";
import { sanitizeAuditUrl } from "@shared/audit-privacy";

export interface QuickScanResult {
  ok: true;
  url: string;
  finalUrl: string;
  score: AuditScore;
  /** Top findings shown to everyone. */
  topFindings: PublicFinding[];
  /** Number of additional findings beyond the short summary. */
  additionalFindingCount: number;
  robotsTxtFound: boolean;
  sitemapFound: boolean | null;
  brokenLinks: number;
  checkedLinks: number;
  linkCoverage: {
    discovered: number;
    discoveryTruncated: boolean;
    checked: number;
    limit: number;
    omittedByLimit: number;
    blockedByUnsafePath: number;
    blockedByRobots: number;
    blockedBySafety: number;
    rateLimited: number;
    complete: boolean | null;
  };
  httpsRedirects: boolean | null;
}

export interface QuickScanError {
  ok: false;
  errorCode: string;
  reason: string;
}

export interface PublicFinding {
  ruleId: string;
  category: GroupedFinding["category"];
  severity: GroupedFinding["severity"];
  title: string;
  description: string;
  recommendation: string;
}

const MAX_LINKS_TO_CHECK = 8;
const TOP_FINDINGS = 6;

export async function quickScan(target: string, appName: string): Promise<QuickScanResult | QuickScanError> {
  // Kept in the public helper signature for callers that provide a display
  // name; the quick scan itself derives its title from the fetched document.
  void appName;
  const requestedOrigin = normalizeOrigin(target);
  if (!requestedOrigin) {
    return { ok: false, errorCode: "bad_origin", reason: "Could not determine the site origin." };
  }
  const robotsCache = new Map<string, Awaited<ReturnType<typeof loadRobots>>>();
  const getRobots = async (origin: string, timeoutMs = 6_000) => {
    let policy = robotsCache.get(origin);
    if (!policy) {
      policy = await loadRobots(origin, timeoutMs);
      robotsCache.set(origin, policy);
    }
    return policy;
  };
  const checkCrawlTarget: NonNullable<SafeFetchOptions["redirectPolicy"]> = async (redirectUrl, remainingMs) => {
    const redirected = new URL(redirectUrl);
    const path = `${redirected.pathname || "/"}${redirected.search}`;
    if (isUnsafeCrawlPath(path)) {
      return { allowed: false, code: "unsafe_crawl_path", reason: "The redirect points to a path excluded from scanning." };
    }
    const policy = await getRobots(redirected.origin, Math.min(6_000, remainingMs));
    if (policy.block) {
      return { allowed: false, code: "robots_unreachable", reason: "robots.txt for the redirect destination could not be read." };
    }
    if (isDisallowed(policy.rules, path)) {
      return { allowed: false, code: "robots_disallowed", reason: "robots.txt disallows the redirect destination." };
    }
    return { allowed: true };
  };

  let requestedUrl: URL;
  try {
    requestedUrl = new URL(target);
  } catch {
    return { ok: false, errorCode: "bad_origin", reason: "Could not determine the site origin." };
  }
  const requestedPath = `${requestedUrl.pathname || "/"}${requestedUrl.search}`;
  if (isUnsafeCrawlPath(requestedPath)) {
    return notAssessedQuickScan(target, false, {
      ruleId: "reliability.unsafe-path",
      title: "Scan not assessed because the requested path is unsafe",
      description: "The requested path is excluded from scanning because it may change site state. No site pages were assessed.",
      recommendation: "Submit a read-only page URL, then run the scan again.",
    });
  }
  const requestedPolicy = await getRobots(requestedOrigin);
  if (requestedPolicy.block || isDisallowed(requestedPolicy.rules, `${requestedUrl.pathname || "/"}${requestedUrl.search}`)) {
    const description = requestedPolicy.block
      ? "robots.txt could not be read, so the scanner did not request any site pages."
      : "robots.txt disallows the scanner from requesting this page; no site pages were assessed.";
    return notAssessedQuickScan(target, requestedPolicy.found, {
      ruleId: "reliability.robots-disallowed",
      title: "Scan not assessed because of robots.txt",
      description,
      recommendation: "If you want this site assessed, permit the ZenithCommunityBot user agent in robots.txt, then run the scan again.",
    });
  }

  const primary = await safeFetch(target, {
    readBody: true,
    maxBytes: 1_500_000,
    timeoutMs: 12_000,
    redirectPolicy: checkCrawlTarget,
  });
  if (!primary.ok) {
    if (primary.errorCode === "redirect_policy") {
      const isRobots = primary.policyCode?.startsWith("robots_") ?? false;
      return notAssessedQuickScan(target, requestedPolicy.found, {
        ruleId: isRobots ? "reliability.robots-disallowed" : "reliability.unsafe-redirect",
        title: isRobots ? "Scan not assessed because of robots.txt" : "Scan not assessed because of an unsafe redirect",
        description: `${primary.reason} No site pages were assessed.`,
        recommendation: isRobots
          ? "If you want this site assessed, permit the ZenithCommunityBot user agent in robots.txt, then run the scan again."
          : "Redirect the homepage to a read-only page route, then run the scan again.",
      });
    }
    if (primary.errorCode === "blocked_redirect") {
      return notAssessedQuickScan(target, requestedPolicy.found, {
        ruleId: "reliability.unsafe-redirect",
        title: "Scan not assessed because of an unsafe redirect",
        description: `${primary.reason} No site pages were assessed.`,
        recommendation: "Redirect the homepage to a read-only page route, then run the scan again.",
      });
    }
    if (primary.errorCode !== "blocked_target") {
      return unavailableQuickScan(target, primary.errorCode, { robotsTxtFound: requestedPolicy.found });
    }
    return { ok: false, errorCode: primary.errorCode, reason: primary.reason };
  }

  if (primary.status >= 400 || (primary.status >= 300 && primary.status < 400 && primary.status !== 304)) {
    return unavailableQuickScan(target, `http_${primary.status}`, { status: primary.status });
  }
  if (primary.status === 206) {
    return unavailableQuickScan(target, "partial_homepage", { status: primary.status });
  }
  if (primary.bodyTruncated) {
    return notAssessedQuickScan(target, requestedPolicy.found, {
      ruleId: "reliability.analysis-truncated",
      title: "Quick Scan could not fully assess the homepage",
      description: "The homepage response exceeded Quick Scan's 1.5 MB limit. Only part of the page was read, so no score was calculated.",
      recommendation: "Reduce the response size or raise the scan limit in your Community installation, then run Quick Scan again.",
    });
  }
  if ([204, 205, 304].includes(primary.status) || !primary.body?.trim()) {
    return unavailableQuickScan(target, "empty_homepage", {
      status: primary.status,
      contentType: primary.headers.get("content-type"),
    });
  }
  if (!isHtmlDocument(primary.headers.get("content-type"), primary.body)) {
    return unavailableQuickScan(target, "non_html_homepage", {
      contentType: primary.headers.get("content-type"),
    });
  }
  if (isGenericErrorHtmlDocument(primary.body)) {
    return unavailableQuickScan(target, "generic_error_page", { status: primary.status });
  }
  if (!hasMeaningfulHtmlContent(primary.body)) {
    if (hasUnverifiedMediaContent(primary.body)) {
      return notAssessedQuickScan(target, requestedPolicy.found, {
        ruleId: "reliability.content-unverified",
        title: "Quick scan could not verify page content",
        description: "The homepage contains media markup, but Quick Scan did not find readable text. It reads the homepage HTML without rendering it or loading embedded media, so it could not confirm what visitors see. No score was calculated.",
        recommendation: "Add readable text describing the page, then run Quick Scan again.",
      });
    }
    return unavailableQuickScan(target, "empty_homepage", {
      status: primary.status,
      contentType: primary.headers.get("content-type"),
    });
  }

  const origin = normalizeOrigin(primary.finalUrl);
  if (!origin) {
    return { ok: false, errorCode: "bad_origin", reason: "Could not determine the site origin." };
  }

  const meta = await extractPageMeta(primary.body ?? "", primary.finalUrl, origin);
  const headers = headerMap(primary.headers);
  const bytes = primary.contentLength ?? (primary.body ? primary.body.length : 0);

  const ctx: PageContext = {
    url: sanitizeAuditUrl(target),
    finalUrl: sanitizeAuditUrl(primary.finalUrl),
    statusCode: primary.status,
    responseMs: primary.responseMs,
    bytes,
    headers,
    meta,
  };

  const findings: Finding[] = runAllRules(ctx);
  // HTTP -> HTTPS redirect behaviour.
  const httpsRedirects = await checkHttpsRedirect(origin);
  if (httpsRedirects.redirects === false) {
    findings.push({
      category: "security",
      severity: "medium",
      ruleId: "security.no-http-redirect",
      title: "HTTP does not redirect to HTTPS",
      description: "Visiting the site over plain HTTP did not redirect to HTTPS.",
      pageUrl: origin,
      evidence: { httpStatus: httpsRedirects.status },
      recommendation: "Add a permanent redirect from HTTP to HTTPS.",
    });
  }

  // robots.txt & sitemap.xml availability.
  const robotsTxt = await getRobots(origin);
  const robotsTxtFound = robotsTxt.found;
  const sitemapPath = "/sitemap.xml";
  const sitemapAllowed = !robotsTxt.block && !isDisallowed(robotsTxt.rules, sitemapPath);
  const sitemap = sitemapAllowed
    ? await safeFetch(`${origin}${sitemapPath}`, { readBody: false, timeoutMs: 6000, redirectPolicy: checkCrawlTarget })
    : null;
  const sitemapPolicyBlocked = sitemap !== null
    && !sitemap.ok
    && (sitemap.errorCode === "redirect_policy" || sitemap.errorCode === "blocked_target");
  const sitemapFound = sitemap === null || sitemapPolicyBlocked || !sitemap?.ok
    ? null
    : sitemap.status >= 200 && sitemap.status < 300
      ? true
      : sitemap.status === 404 || sitemap.status === 410
        ? false
        : null;
  if (sitemapFound === false) {
    findings.push({
      category: "seo",
      severity: "low",
      ruleId: "seo.sitemap-missing",
      title: "No sitemap.xml found",
      description: "A sitemap.xml was not found at the site root.",
      pageUrl: origin,
      evidence: { url: `${origin}/sitemap.xml` },
      recommendation: "Publish a sitemap.xml to help search engines discover pages.",
    });
  }

  // Bounded broken-link check on same-origin links.
  const discoveredSameOriginLinks = dedupe(meta.links.filter((link) => isSameOrigin(link, origin)));
  const unsafeSameOriginLinks = discoveredSameOriginLinks.filter((link) => {
    try {
      const parsed = new URL(link);
      const path = `${parsed.pathname}${parsed.search}`;
      return isUnsafeCrawlPath(path);
    } catch {
      return true;
    }
  });
  const safeSameOriginLinks = discoveredSameOriginLinks.filter((link) => !unsafeSameOriginLinks.includes(link));
  const robotsDisallowedLinks = safeSameOriginLinks.filter((link) => {
    if (robotsTxt.block) return true;
    try {
      const parsed = new URL(link);
      return isDisallowed(robotsTxt.rules, `${parsed.pathname}${parsed.search}`);
    } catch {
      return true;
    }
  });
  const allowedSameOriginLinks = safeSameOriginLinks.filter((link) => !robotsDisallowedLinks.includes(link));
  const omittedByLimit = Math.max(0, allowedSameOriginLinks.length - MAX_LINKS_TO_CHECK);
  const sameOriginLinks = allowedSameOriginLinks.slice(0, MAX_LINKS_TO_CHECK);
  let brokenLinks = 0;
  let checkedLinks = 0;
  let blockedBySafety = 0;
  let rateLimited = 0;
  const linkResults = await Promise.all(
    sameOriginLinks.map((l) => headWithGetFallback(l, { timeoutMs: 6000, redirectPolicy: checkCrawlTarget })),
  );
  for (let i = 0; i < linkResults.length; i++) {
    const r = linkResults[i]!;
    // A crawl-policy or SSRF guard intentionally prevents the destination from
    // being assessed; that is neither a broken link nor a checked endpoint.
    if (!r.ok && (r.errorCode === "redirect_policy" || r.errorCode === "blocked_target")) {
      blockedBySafety += 1;
      continue;
    }
    // A 429 limits this scanner's request; it does not establish whether a
    // normal visitor can open the link, so leave it unverified and unscored.
    if (r.ok && r.status === 429) {
      rateLimited += 1;
      continue;
    }
    checkedLinks += 1;
    if (!r.ok || r.status >= 300) {
      brokenLinks += 1;
      const severity = !r.ok ? "medium" : r.status >= 500 ? "critical" : "high";
      findings.push({
        category: "reliability",
        severity,
        ruleId: "reliability.broken-link",
        title: "Broken link",
        description: `A same-origin link returned an error or was unreachable.`,
        // Keep each failing target distinct so grouped reliability scoring
        // charges for multiple broken links instead of collapsing them into
        // the one page that contains the links.
        pageUrl: sameOriginLinks[i]!,
        evidence: { link: sameOriginLinks[i], status: r.ok ? r.status : r.errorCode },
        recommendation: "Fix or remove the broken link.",
      });
    }
  }

  const linkCoverageComplete = omittedByLimit === 0 && unsafeSameOriginLinks.length === 0
    && robotsDisallowedLinks.length === 0 && blockedBySafety === 0 && rateLimited === 0;
  if (!linkCoverageComplete) {
    findings.push({
      category: "reliability",
      severity: "info",
      ruleId: "reliability.link-coverage-incomplete",
      title: "Quick Scan did not check every discovered link",
      description: "Some discovered same-origin links were left unchecked, so Quick Scan withheld the overall score.",
      pageUrl: origin,
      evidence: {
        discoveredLinks: discoveredSameOriginLinks.length,
        checkedLinks,
        omittedByLimit,
        blockedByUnsafePath: unsafeSameOriginLinks.length,
        blockedByRobots: robotsDisallowedLinks.length,
        blockedBySafety,
        rateLimited,
      },
      recommendation: "Resolve the coverage limits or robots policy, then run a deeper audit for a complete result.",
    });
  }

  const grouped = groupFindings(findings);
  const score = computeScores(grouped, { siteAvailable: true });

  // Keep the public response concise while reporting how many findings remain.
  const ranked = sortBySeverity(grouped);
  const top = ranked.slice(0, TOP_FINDINGS).map<PublicFinding>((g) => ({
    ruleId: g.ruleId,
    category: g.category,
    severity: g.severity,
    title: g.title,
    description: g.description,
    recommendation: g.recommendation,
  }));

  return {
    ok: true,
    url: sanitizeAuditUrl(target),
    finalUrl: sanitizeAuditUrl(primary.finalUrl),
    score: { ...score, overall: linkCoverageComplete ? score.overall : null },
    topFindings: top,
    additionalFindingCount: Math.max(0, ranked.length - top.length),
    robotsTxtFound,
    sitemapFound,
    brokenLinks,
    checkedLinks,
    linkCoverage: {
      discovered: discoveredSameOriginLinks.length,
      discoveryTruncated: meta.sameOriginLinksTruncated === true,
      checked: checkedLinks,
      limit: MAX_LINKS_TO_CHECK,
      omittedByLimit,
      blockedByUnsafePath: unsafeSameOriginLinks.length,
      blockedByRobots: robotsDisallowedLinks.length,
      blockedBySafety,
      rateLimited,
      complete: linkCoverageComplete,
    },
    httpsRedirects: httpsRedirects.redirects,
  };
}


function homepageUnavailableFinding(
  pageUrl: string,
  description: string,
  evidence: Record<string, unknown> = {},
  recommendation = "Restore access to the homepage, then run the scan again.",
): Finding {
  return {
    category: "reliability",
    severity: "critical",
    ruleId: "reliability.homepage-unavailable",
    title: "Homepage could not be assessed",
    description,
    pageUrl,
    evidence,
    recommendation,
  };
}

function notAssessedQuickScan(
  target: string,
  robotsTxtFound: boolean,
  finding: Pick<PublicFinding, "ruleId" | "title" | "description" | "recommendation">,
): QuickScanResult {
  return {
    ok: true,
    url: sanitizeAuditUrl(target),
    finalUrl: sanitizeAuditUrl(target),
    score: {
      overall: null,
      categories: { security: null, accessibility: null, performance: null, seo: null },
      reliabilityDeduction: null,
    },
    topFindings: [{
      ...finding,
      category: "reliability",
      severity: "info",
    }],
    additionalFindingCount: 0,
    robotsTxtFound,
    sitemapFound: null,
    brokenLinks: 0,
    checkedLinks: 0,
    linkCoverage: { discovered: 0, discoveryTruncated: false, checked: 0, limit: MAX_LINKS_TO_CHECK, omittedByLimit: 0, blockedByUnsafePath: 0, blockedByRobots: 0, blockedBySafety: 0, rateLimited: 0, complete: null },
    httpsRedirects: null,
  };
}

function unavailableQuickScan(target: string, errorCode: string, evidence: Record<string, unknown> = {}): QuickScanResult {
  const status = typeof evidence.status === "number" ? evidence.status : null;
  const contentType = typeof evidence.contentType === "string" ? evidence.contentType : null;
  const description = errorCode === "generic_error_page"
    ? `The homepage returned HTTP ${status ?? "200"}, but its short HTML response matches a common server-error pattern. Quick Scan does not render the page, so it treats this response as unavailable and sets the score to 0.`
    : status !== null
    ? errorCode === "partial_homepage"
      ? "The homepage returned partial content (HTTP 206); the complete page could not be assessed."
      : `The homepage returned HTTP ${status}${errorCode === "empty_homepage" ? " without page content" : ""}; the site could not be assessed.`
    : errorCode === "empty_homepage"
      ? "The homepage returned no page content; the site could not be assessed."
    : errorCode === "non_html_homepage"
      ? `The homepage returned ${contentType ?? "a non-HTML response"} instead of an HTML page; the site could not be assessed.`
      : `${unavailableReason(errorCode)} The site could not be assessed.`;
  const finding = homepageUnavailableFinding(
    target,
    description,
    { errorCode, ...evidence },
    unavailableRecommendation(errorCode),
  );
  return {
    ok: true,
    url: sanitizeAuditUrl(target),
    finalUrl: sanitizeAuditUrl(target),
    score: computeScores([], { siteAvailable: false }),
    topFindings: [{
      ruleId: finding.ruleId,
      category: finding.category,
      severity: finding.severity,
      title: errorCode === "generic_error_page" ? "Homepage response matches a server-error pattern" : finding.title,
      description: finding.description,
      recommendation: finding.recommendation,
    }],
    additionalFindingCount: 0,
    robotsTxtFound: evidence.robotsTxtFound === true,
    sitemapFound: null,
    brokenLinks: 0,
    checkedLinks: 0,
    linkCoverage: { discovered: 0, discoveryTruncated: false, checked: 0, limit: MAX_LINKS_TO_CHECK, omittedByLimit: 0, blockedByUnsafePath: 0, blockedByRobots: 0, blockedBySafety: 0, rateLimited: 0, complete: null },
    httpsRedirects: null,
  };
}

function unavailableRecommendation(errorCode: string): string {
  if (errorCode === "generic_error_page") return "Restore the intended homepage response, then run Quick Scan again.";
  if (errorCode === "partial_homepage") return "Serve the complete homepage response, then run the scan again.";
  if (errorCode === "empty_homepage") return "Serve page content at the homepage, then run the scan again.";
  if (errorCode === "non_html_homepage") return "Serve an HTML page at the homepage, then run the scan again.";
  if (errorCode.startsWith("http_")) return "Configure the homepage to return a successful page response, then run the scan again.";
  return "Restore access to the homepage, then run the scan again.";
}

function unavailableReason(errorCode: string): string {
  switch (errorCode) {
    case "dns_or_network": return "The homepage could not be reached because of a DNS or network error.";
    case "timeout": return "The homepage request timed out.";
    case "tls": return "The homepage could not be reached because its TLS connection failed.";
    case "too_many_redirects": return "The homepage request exceeded the redirect limit.";
    case "blocked_redirect": return "The homepage redirected to a destination the scanner could not verify.";
    case "aborted": return "The homepage request was interrupted before it completed.";
    default: return `The homepage request failed (${errorCode}).`;
  }
}

async function checkHttpsRedirect(httpsOrigin: string): Promise<{ redirects: boolean | null; status?: number }> {
  const httpOrigin = httpsOrigin.replace(/^https:/, "http:");
  const res = await headWithGetFallback(httpOrigin, { maxRedirects: 0, timeoutMs: 6000 });
  if (!res.ok) {
    if (res.errorCode !== "too_many_redirects" || !res.redirectUrl) return { redirects: null };
    // A redirect only counts if its resolved destination actually uses HTTPS.
    return { redirects: res.redirectUrl.startsWith("https:") };
  }
  // An HTTP error response does not establish whether a healthy page would
  // upgrade to HTTPS, so leave this probe unverified instead of scoring it.
  if (res.status >= 300) return { redirects: null, status: res.status };
  // With maxRedirects 0, a 3xx is surfaced above; otherwise the request reached
  // a response over plain HTTP without upgrading to HTTPS.
  return { redirects: res.finalUrl.startsWith("https:"), status: res.status };
}

/** Confirm HEAD failures with one GET because some servers handle the methods differently. */
async function headWithGetFallback(
  url: string,
  options: Pick<SafeFetchOptions, "maxRedirects" | "timeoutMs" | "redirectPolicy">,
): Promise<SafeFetchOutcome> {
  const head = await safeFetch(url, { ...options, method: "HEAD", readBody: false });
  // A transport failure can also be specific to HEAD (for example, a proxy
  // rejecting that method). Confirm only transient connection failures with
  // the GET users would make; never retry target or redirect-policy blocks.
  if (!head.ok && ["dns_or_network", "tls", "timeout"].includes(head.errorCode)) {
    return safeFetch(url, { ...options, method: "GET", readBody: false });
  }
  // A method-specific 4xx/5xx response does not prove that the linked GET is
  // broken. Confirm it with the request users would make. Respect 429 instead
  // of retrying around the destination's rate limit.
  if (head.ok && head.status >= 300 && head.status !== 429) {
    return safeFetch(url, { ...options, method: "GET", readBody: false });
  }
  return head;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
