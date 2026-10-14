/**
 * Lightweight public quick scan. It is HTTP-only (no browser). Fetches the target
 * once through the SSRF-safe client, extracts metadata, runs the deterministic
 * rule set, checks robots.txt and sitemap availability, validates a bounded set
 * of same-origin links for obvious breakage, then scores the result.
 *
 * Returns real findings and scores; no result is hidden behind account access.
 */

import { safeFetch } from "./http";
import { extractPageMeta } from "./html";
import { headerMap, runAllRules, type PageContext } from "../audit/rules";
import { groupFindings, sortBySeverity, type Finding, type GroupedFinding } from "@shared/findings";
import { computeScores, type AuditScore } from "@shared/scoring";
import { normalizeOrigin, isSameOrigin } from "@shared/url";

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
  sitemapFound: boolean;
  brokenLinks: number;
  checkedLinks: number;
  httpsRedirects: boolean;
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
  const primary = await safeFetch(target, { readBody: true, maxBytes: 1_500_000, timeoutMs: 12_000 });
  if (!primary.ok) {
    if (primary.errorCode !== "blocked_target") {
      return unavailableQuickScan(target, primary.errorCode);
    }
    return { ok: false, errorCode: primary.errorCode, reason: primary.reason };
  }

  const origin = normalizeOrigin(primary.finalUrl);
  if (!origin) {
    return { ok: false, errorCode: "bad_origin", reason: "Could not determine the site origin." };
  }

  const meta = await extractPageMeta(primary.body ?? "", primary.finalUrl);
  const headers = headerMap(primary.headers);
  const bytes = primary.contentLength ?? (primary.body ? primary.body.length : 0);

  const ctx: PageContext = {
    url: target,
    finalUrl: primary.finalUrl,
    statusCode: primary.status,
    responseMs: primary.responseMs,
    bytes,
    headers,
    meta,
  };

  const findings: Finding[] = runAllRules(ctx);
  if (primary.status >= 400) {
    findings.push(homepageUnavailableFinding(target, `The homepage returned HTTP ${primary.status}.`, { status: primary.status }));
  }

  // HTTP -> HTTPS redirect behaviour.
  const httpsRedirects = await checkHttpsRedirect(origin);
  if (!httpsRedirects.redirects && origin.startsWith("https:")) {
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
  const [robots, sitemap] = await Promise.all([
    safeFetch(`${origin}/robots.txt`, { readBody: false, timeoutMs: 6000 }),
    safeFetch(`${origin}/sitemap.xml`, { readBody: false, timeoutMs: 6000 }),
  ]);
  const robotsTxtFound = robots.ok && robots.status < 400;
  const sitemapFound = sitemap.ok && sitemap.status < 400;
  if (!sitemapFound) {
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
  const sameOriginLinks = dedupe(meta.links.filter((l) => isSameOrigin(l, origin))).slice(0, MAX_LINKS_TO_CHECK);
  let brokenLinks = 0;
  const linkResults = await Promise.all(
    sameOriginLinks.map((l) => safeFetch(l, { method: "HEAD", readBody: false, timeoutMs: 6000 })),
  );
  for (let i = 0; i < linkResults.length; i++) {
    const r = linkResults[i]!;
    if (!r.ok || r.status >= 400) {
      brokenLinks += 1;
      findings.push({
        category: "reliability",
        severity: "medium",
        ruleId: "reliability.broken-link",
        title: "Broken link",
        description: `A same-origin link returned an error or was unreachable.`,
        pageUrl: primary.finalUrl,
        evidence: { link: sameOriginLinks[i], status: r.ok ? r.status : r.errorCode },
        recommendation: "Fix or remove the broken link.",
      });
    }
  }

  const grouped = groupFindings(findings);
  const score = computeScores(grouped, { siteAvailable: primary.status < 400 });

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
    url: target,
    finalUrl: primary.finalUrl,
    score,
    topFindings: top,
    additionalFindingCount: Math.max(0, ranked.length - top.length),
    robotsTxtFound,
    sitemapFound,
    brokenLinks,
    checkedLinks: sameOriginLinks.length,
    httpsRedirects: httpsRedirects.redirects,
  };
}


function homepageUnavailableFinding(pageUrl: string, description: string, evidence: Record<string, unknown> = {}): Finding {
  return {
    category: "reliability",
    severity: "critical",
    ruleId: "reliability.homepage-unavailable",
    title: "Homepage unavailable",
    description: `${description} The site could not be assessed.`,
    pageUrl,
    evidence,
    recommendation: "Restore access to the homepage, then run the scan again.",
  };
}

function unavailableQuickScan(target: string, errorCode: string): QuickScanResult {
  const finding = homepageUnavailableFinding(
    target,
    "The homepage could not be reached during the scan; the site could not be assessed.",
    { errorCode },
  );
  return {
    ok: true,
    url: target,
    finalUrl: target,
    score: computeScores([], { siteAvailable: false }),
    topFindings: [{
      ruleId: finding.ruleId,
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
      description: finding.description,
      recommendation: finding.recommendation,
    }],
    additionalFindingCount: 0,
    robotsTxtFound: false,
    sitemapFound: false,
    brokenLinks: 0,
    checkedLinks: 0,
    httpsRedirects: false,
  };
}

async function checkHttpsRedirect(httpsOrigin: string): Promise<{ redirects: boolean; status?: number }> {
  const httpOrigin = httpsOrigin.replace(/^https:/, "http:");
  const res = await safeFetch(httpOrigin, { method: "HEAD", maxRedirects: 0, timeoutMs: 6000 });
  if (!res.ok) {
    // A blocked_redirect here means it tried to redirect somewhere; treat as redirecting.
    return { redirects: res.errorCode === "too_many_redirects" || res.errorCode === "blocked_redirect" };
  }
  // With maxRedirects 0, a 3xx is surfaced as too_many_redirects above; a 2xx
  // means it served content over plain HTTP without redirecting.
  return { redirects: res.finalUrl.startsWith("https:"), status: res.status };
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
