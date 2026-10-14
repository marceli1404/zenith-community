/**
 * Deterministic audit rules. Each rule inspects a PageContext (HTTP response +
 * extracted metadata) and emits zero or more structured Findings. These run for
 * BOTH the free quick scan (one page) and the deep audit (every crawled page),
 * so the analysis is consistent. Browser-only checks (axe accessibility, lab
 * performance metrics) live in the browser step, not here.
 *
 * Wording is deliberately measured (§25/§26/§27): we never claim a site is
 * "secure" or "accessible", only what these specific checks observed.
 */

import type { Finding, Severity } from "@shared/findings";
import type { PageMeta } from "../lib/html";

export interface PageContext {
  /** The URL as requested. */
  url: string;
  /** The final URL after redirects. */
  finalUrl: string;
  statusCode: number;
  responseMs: number;
  /** Transferred/observed bytes (may be approximate). */
  bytes: number;
  /** Response headers, lowercased keys. */
  headers: Record<string, string>;
  meta: PageMeta;
}

function f(
  category: Finding["category"],
  severity: Severity,
  ruleId: string,
  title: string,
  description: string,
  recommendation: string,
  pageUrl: string,
  evidence: Record<string, unknown>,
): Finding {
  return { category, severity, ruleId, title, description, recommendation, pageUrl, evidence };
}

function isHttps(url: string): boolean {
  return url.toLowerCase().startsWith("https:");
}

// ---------------------------------------------------------------------------
// Security (passive header checks — NOT a penetration test)
// ---------------------------------------------------------------------------
export function securityRules(ctx: PageContext): Finding[] {
  const out: Finding[] = [];
  const h = ctx.headers;
  const url = ctx.finalUrl;

  if (!isHttps(url)) {
    out.push(
      f("security", "critical", "security.no-https", "Site is not served over HTTPS",
        "The page was reachable over plain HTTP, which exposes visitors to interception and browser 'Not secure' warnings.",
        "Serve all traffic over HTTPS and redirect HTTP to HTTPS.", url, { finalUrl: url }),
    );
  }

  if (isHttps(url) && !h["strict-transport-security"]) {
    out.push(
      f("security", "high", "security.no-hsts", "Missing Strict-Transport-Security header",
        "HSTS is not set, so browsers may still attempt insecure connections.",
        "Send Strict-Transport-Security with a long max-age once HTTPS is stable.", url,
        { "strict-transport-security": null }),
    );
  }

  if (!h["content-security-policy"]) {
    out.push(
      f("security", "medium", "security.no-csp", "No Content-Security-Policy header",
        "A Content-Security-Policy was not observed. A CSP reduces the impact of content injection.",
        "Introduce a Content-Security-Policy, starting in report-only mode.", url,
        { "content-security-policy": null }),
    );
  }

  if (!h["x-content-type-options"]) {
    out.push(
      f("security", "low", "security.no-xcto", "Missing X-Content-Type-Options header",
        "X-Content-Type-Options: nosniff was not observed, allowing MIME-type sniffing.",
        "Send X-Content-Type-Options: nosniff.", url, { "x-content-type-options": null }),
    );
  }

  const csp = h["content-security-policy"] ?? "";
  if (!h["x-frame-options"] && !/frame-ancestors/i.test(csp)) {
    out.push(
      f("security", "medium", "security.no-frame-protection", "No clickjacking protection",
        "Neither X-Frame-Options nor a CSP frame-ancestors directive was observed.",
        "Set X-Frame-Options: DENY or a CSP frame-ancestors directive.", url, {}),
    );
  }

  if (!h["referrer-policy"]) {
    out.push(
      f("security", "low", "security.no-referrer-policy", "Missing Referrer-Policy header",
        "A Referrer-Policy was not observed; the full URL may leak in the Referer header.",
        "Send a Referrer-Policy such as strict-origin-when-cross-origin.", url, {}),
    );
  }

  if (!h["permissions-policy"]) {
    out.push(
      f("security", "info", "security.no-permissions-policy", "No Permissions-Policy header",
        "A Permissions-Policy was not observed; powerful browser features are not explicitly restricted.",
        "Consider a Permissions-Policy limiting features you do not use.", url, {}),
    );
  }

  const setCookie = h["set-cookie"];
  if (setCookie && (!/;\s*secure/i.test(setCookie) || !/;\s*httponly/i.test(setCookie))) {
    out.push(
      f("security", "medium", "security.cookie-flags", "Cookie missing Secure/HttpOnly flags",
        "A Set-Cookie header was observed without both the Secure and HttpOnly flags.",
        "Add Secure and HttpOnly (and consider SameSite) to session cookies.", url,
        { note: "flags not both present in visible Set-Cookie header" }),
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// SEO
// ---------------------------------------------------------------------------
export function seoRules(ctx: PageContext): Finding[] {
  const out: Finding[] = [];
  const m = ctx.meta;
  const url = ctx.finalUrl;

  if (!m.title) {
    out.push(f("seo", "high", "seo.title-missing", "Missing page title",
      "The page has no <title> element.", "Add a unique, descriptive <title>.", url, { title: null }));
  } else {
    const len = m.title.length;
    if (len < 10) {
      out.push(f("seo", "low", "seo.title-short", "Very short page title",
        `The title is only ${len} characters.`, "Expand the title to ~30–60 descriptive characters.", url, { length: len }));
    } else if (len > 65) {
      out.push(f("seo", "low", "seo.title-long", "Overly long page title",
        `The title is ${len} characters and may be truncated in search results.`,
        "Shorten the title to about 60 characters.", url, { length: len }));
    }
  }

  if (!m.metaDescription) {
    out.push(f("seo", "medium", "seo.meta-description-missing", "Missing meta description",
      "The page has no meta description.", "Add a unique meta description of ~120–160 characters.", url, { metaDescription: null }));
  } else {
    const len = m.metaDescription.length;
    if (len < 50) {
      out.push(f("seo", "low", "seo.meta-description-short", "Short meta description",
        `The meta description is ${len} characters.`, "Aim for ~120–160 characters.", url, { length: len }));
    } else if (len > 170) {
      out.push(f("seo", "low", "seo.meta-description-long", "Long meta description",
        `The meta description is ${len} characters and may be truncated.`, "Trim to ~160 characters.", url, { length: len }));
    }
  }

  if (!m.canonical) {
    out.push(f("seo", "low", "seo.canonical-missing", "No canonical URL",
      "No rel=canonical link was found.", "Add a rel=canonical link to the preferred URL.", url, { canonical: null }));
  }

  if (m.h1Count === 0) {
    out.push(f("seo", "medium", "seo.h1-missing", "No H1 heading",
      "The page has no <h1> heading.", "Add a single, descriptive <h1>.", url, { h1Count: 0 }));
  } else if (m.h1Count > 1) {
    out.push(f("seo", "low", "seo.h1-multiple", "Multiple H1 headings",
      `The page has ${m.h1Count} <h1> elements.`, "Prefer a single <h1> per page.", url, { h1Count: m.h1Count }));
  }

  if (!m.htmlLang) {
    out.push(f("seo", "low", "seo.html-lang-missing", "Missing html lang attribute",
      "The <html> element has no lang attribute.", "Set <html lang> to the page language.", url, { htmlLang: null }));
  }

  if (m.robotsMeta && /noindex/.test(m.robotsMeta)) {
    out.push(f("seo", "high", "seo.noindex", "Page is set to noindex",
      "A robots meta tag requests that search engines do not index this page.",
      "Remove noindex if the page should appear in search results.", url, { robots: m.robotsMeta }));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Accessibility (deterministic subset; axe runs in the browser step)
// ---------------------------------------------------------------------------
export function accessibilityRules(ctx: PageContext): Finding[] {
  const out: Finding[] = [];
  const m = ctx.meta;
  const url = ctx.finalUrl;

  if (m.imageCount > 0 && m.imagesMissingAlt > 0) {
    const sev: Severity = m.imagesMissingAlt > m.imageCount / 2 ? "medium" : "low";
    out.push(f("accessibility", sev, "a11y.img-alt-missing", "Images without alt text",
      `${m.imagesMissingAlt} of ${m.imageCount} images have no alt attribute.`,
      "Add descriptive alt text (or alt=\"\" for decorative images).", url,
      { imagesMissingAlt: m.imagesMissingAlt, imageCount: m.imageCount }));
  }

  if (!m.htmlLang) {
    out.push(f("accessibility", "medium", "a11y.html-lang-missing", "No document language",
      "The page does not declare a language, which affects screen-reader pronunciation.",
      "Set a lang attribute on the <html> element.", url, { htmlLang: null }));
  }

  if (!m.hasViewportMeta) {
    out.push(f("accessibility", "low", "a11y.viewport-missing", "No responsive viewport meta",
      "No viewport meta tag was found; the page may not adapt to small screens.",
      "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.", url, {}));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Performance (lab-level, from the HTTP fetch — clearly not field data)
// ---------------------------------------------------------------------------
export function performanceRules(ctx: PageContext): Finding[] {
  const out: Finding[] = [];
  const url = ctx.finalUrl;

  if (ctx.responseMs > 2000) {
    out.push(f("performance", "high", "performance.slow-response", "Slow server response",
      `The server took ${ctx.responseMs} ms to respond (lab measurement).`,
      "Investigate server/TTFB performance and caching.", url, { responseMs: ctx.responseMs }));
  } else if (ctx.responseMs > 1000) {
    out.push(f("performance", "medium", "performance.moderate-response", "Moderate server response time",
      `The server took ${ctx.responseMs} ms to respond (lab measurement).`,
      "Consider caching and origin performance improvements.", url, { responseMs: ctx.responseMs }));
  }

  if (ctx.bytes > 3_000_000) {
    out.push(f("performance", "medium", "performance.large-page", "Large HTML payload",
      `The HTML document is ~${Math.round(ctx.bytes / 1024)} KB.`,
      "Reduce inlined content and defer non-critical resources.", url, { bytes: ctx.bytes }));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Reliability
// ---------------------------------------------------------------------------
export function reliabilityRules(ctx: PageContext): Finding[] {
  const out: Finding[] = [];
  const url = ctx.finalUrl;
  if (ctx.statusCode >= 500) {
    out.push(f("reliability", "critical", "reliability.server-error", "Server error response",
      `The page returned HTTP ${ctx.statusCode}.`, "Investigate the server error.", url, { statusCode: ctx.statusCode }));
  } else if (ctx.statusCode >= 400) {
    out.push(f("reliability", "high", "reliability.client-error", "Error response",
      `The page returned HTTP ${ctx.statusCode}.`, "Ensure the URL resolves to a valid page.", url, { statusCode: ctx.statusCode }));
  }
  return out;
}

/** Run every HTTP-level rule against a page. */
export function runAllRules(ctx: PageContext): Finding[] {
  return [
    ...reliabilityRules(ctx),
    ...securityRules(ctx),
    ...seoRules(ctx),
    ...accessibilityRules(ctx),
    ...performanceRules(ctx),
  ];
}

/** Build a lowercased header map from a Headers instance. */
export function headerMap(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}
