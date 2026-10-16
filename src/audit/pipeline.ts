/**
 * Deep audit pipeline. Queue-driven, with explicit status transitions and
 * failure isolation: crawl and rule analysis always run; the browser step is
 * best-effort (its failure degrades gracefully). Results are persisted
 * atomically-ish via a D1 batch, then the completion email is enqueued
 * separately so an email failure can't fail the audit.
 */

import type { Bindings, AuditJob } from "../env";
import { first, newId, now, run } from "../db";
import { crawlSite } from "./crawler";
import { runBrowserAnalysis } from "./browser";
import { groupFindings, type Finding } from "@shared/findings";
import { computeScores, CURRENT_SCORING_VERSION } from "@shared/scoring";
import { getMaxAuditPages } from "@shared/entitlements";
import { resolveAccess } from "../lib/access";
import { enqueueEmail } from "../lib/email";
import { sanitizeAuditEvidence, sanitizeAuditUrl } from "@shared/audit-privacy";

interface JobRow {
  id: string;
  user_id: string;
  site_id: string | null;
  target_origin: string | null;
  status: string;
  attempts: number;
}

export async function processAuditJob(env: Bindings, job: AuditJob): Promise<void> {
  const row = await first<JobRow>(env.DB, `SELECT * FROM audit_jobs WHERE id = ?`, job.auditJobId);
  if (!row) return;
  if (row.status === "completed") return; // idempotent: already done

  // Queue delivery is at-least-once. Recover a result committed before a worker
  // interruption instead of crawling again and colliding with the unique job id.
  const savedResult = await first<{ id: string }>(
    env.DB,
    `SELECT id FROM audit_results WHERE audit_job_id = ?`,
    row.id,
  );
  if (savedResult) {
    await run(
      env.DB,
      `UPDATE audit_jobs SET status = 'completed', completed_at = COALESCE(completed_at, ?), failed_at = NULL, error_code = NULL WHERE id = ?`,
      now(),
      row.id,
    );
    return;
  }

  await run(
    env.DB,
    `UPDATE audit_jobs SET status = 'crawling', started_at = ?, attempts = attempts + 1 WHERE id = ?`,
    now(),
    row.id,
  );

  try {
    const origin = await resolveOrigin(env, row);
    if (!origin) throw new Error("no_target");

    const access = await resolveAccess(env.DB, row.user_id);
    const maxPages = getMaxAuditPages(access.plan);

    // 1) Crawl + HTTP-level rules.
    const crawl = await crawlSite(origin, { maxPages });
    const findings: Finding[] = [...crawl.findings, ...crawl.pages.flatMap((p) => p.findings)];
    if (crawl.robotsBlock) {
      const block = crawl.robotsBlock;
      const description = block.kind === "disallowed"
        ? "robots.txt disallows the crawler from requesting the homepage; no site pages were assessed."
        : `robots.txt${block.origin ? ` at ${block.origin}` : ""} could not be read${block.status ? ` (HTTP ${block.status})` : ""}, so the crawler did not request any site pages.`;
      findings.push({
        category: "reliability",
        severity: "info",
        ruleId: "reliability.robots-disallowed",
        title: "Audit not assessed because of robots.txt",
        description,
        pageUrl: origin,
        evidence: block,
        recommendation: "If you want this site assessed, permit the ZenithCommunityBot user agent in robots.txt, then run the audit again.",
      });
    }
    if (crawl.unsafePathBlock) {
      const block = crawl.unsafePathBlock;
      findings.push({
        category: "reliability",
        severity: "info",
        ruleId: "reliability.unsafe-redirect",
        title: "Audit not assessed because of an unsafe redirect",
        description: "The homepage redirects to a path the crawler excludes from requests. No site pages were assessed.",
        pageUrl: origin,
        evidence: { ...block },
        recommendation: "Redirect the homepage to a read-only page route, then run the audit again.",
      });
    }
    if (crawl.homepageFailure) {
      const failure = crawl.homepageFailure;
      const description = failure.kind === "http_error"
        ? `The homepage returned HTTP ${failure.status}; the audit could not assess the site.`
        : failure.kind === "partial_page"
          ? "The homepage returned partial content (HTTP 206); the audit could not assess the complete page."
        : failure.kind === "generic_error_page"
          ? `The homepage returned HTTP ${failure.status} with content matching a generic server-error screen; the audit could not assess the site.`
        : failure.kind === "empty_page"
          ? `The homepage returned HTTP ${failure.status} without page content; the audit could not assess the site.`
        : failure.kind === "not_html"
          ? "The homepage response was not an HTML document; the audit could not assess the site."
          : "The homepage could not be reached during the audit; the site could not be assessed.";
      findings.push({
        category: "reliability",
        severity: "critical",
        ruleId: "reliability.homepage-unavailable",
        title: "Homepage could not be assessed",
        description,
        pageUrl: origin,
        evidence: failure,
        recommendation: failure.kind === "generic_error_page"
          ? "Replace the generic error screen with the intended homepage, then run the audit again."
          : failure.kind === "empty_page"
          ? "Serve page content at the homepage, then run the audit again."
          : "Restore access to the homepage, then run the audit again.",
      });
    }

    // Browser checks cannot assess an unavailable or non-page homepage.
    let browser: Awaited<ReturnType<typeof runBrowserAnalysis>> = null;
    if (crawl.homepageFailure === null && crawl.robotsBlock === null && crawl.unsafePathBlock === null) {
      await run(env.DB, `UPDATE audit_jobs SET status = 'browser_analysis' WHERE id = ?`, row.id);
      const r2Prefix = `users/${row.user_id}/sites/${row.site_id ?? "adhoc"}/audits/${row.id}`;
      // Start the browser at the HTTP crawler's already validated final URL so
      // it does not repeat an unchecked homepage redirect chain.
      const browserOrigin = crawl.pages.find((page) => page.depth === 0)?.ctx.finalUrl ?? origin;
      browser = await runBrowserAnalysis(env, { origin: browserOrigin, r2KeyPrefix: r2Prefix, browserRequestAllowed: crawl.browserRequestAllowed });
      if (browser) findings.push(...browserFindings(browser, origin));
      else findings.push(browserAnalysisUnavailableFinding(origin));
    }

    for (const url of crawl.assessmentTruncatedUrls ?? []) {
      findings.push({
        category: "reliability",
        severity: "info",
        ruleId: "reliability.analysis-truncated",
        title: "Page content exceeded the analysis limit",
        description: "The response exceeded the scanner's 1.5 MB limit. The complete page was not checked, so the audit did not calculate a score.",
        pageUrl: url,
        evidence: { maxBytes: 1_500_000 },
        recommendation: "Reduce the response size or raise the scan limit in this Community installation, then run the audit again.",
      });
    }

    // 3) Score.
    await run(env.DB, `UPDATE audit_jobs SET status = 'scoring' WHERE id = ?`, row.id);
    const grouped = groupFindings(findings);
    const siteAssessed = crawl.homepageFailure === null
      && crawl.robotsBlock === null
      && crawl.unsafePathBlock === null
      && crawl.coverageIncomplete !== true
      && (crawl.assessmentTruncatedUrls?.length ?? 0) === 0;
    const browserHomepageFailure = browser !== null && !browserHomepageIsAssessable(browser);
    const homepageUnavailable = crawl.homepageFailure !== null || browserHomepageFailure;
    // A successful HTTP crawl is not a complete audit if the browser checks
    // could not run. Keep the result as the existing unassessed sentinel so
    // summary queries and report normalization do not present a partial score.
    const siteFullyAssessed = siteAssessed && browser !== null && !browserHomepageFailure;
    const scores = computeScores(grouped, { siteAvailable: siteFullyAssessed });

    // 4) Persist result, pages, and (raw) findings in one batch.
    const resultId = newId("res");
    const ts = now();
    const stmts: D1PreparedStatement[] = [];
    stmts.push(
      env.DB.prepare(
        `INSERT INTO audit_results
          (id, audit_job_id, site_id, overall_score, performance_score, accessibility_score, seo_score, security_score, categories_assessed,
           reliability_deduction, scoring_version, page_count, broken_link_count, screenshot_key, mobile_screenshot_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        resultId, row.id, row.site_id, scores.overall, scores.categories.performance ?? 0,
        scores.categories.accessibility ?? 0, scores.categories.seo ?? 0, scores.categories.security ?? 0,
        siteFullyAssessed ? 1 : 0, homepageUnavailable ? 0 : siteFullyAssessed ? scores.reliabilityDeduction : null, CURRENT_SCORING_VERSION,
        crawl.pages.length, crawl.brokenLinks,
        browserHomepageFailure ? null : browser?.desktopScreenshotKey ?? null,
        browserHomepageFailure ? null : browser?.mobileScreenshotKey ?? null,
        ts,
      ),
    );
    for (const p of crawl.pages) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO audit_pages
            (id, audit_result_id, url, status_code, response_ms, title, meta_description, canonical_url, h1_count, bytes, indexable, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          newId("pg"), resultId, sanitizeAuditUrl(p.ctx.finalUrl), p.ctx.statusCode, p.ctx.responseMs,
          p.ctx.meta.title, p.ctx.meta.metaDescription,
          p.ctx.meta.canonical ? sanitizeAuditUrl(p.ctx.meta.canonical, p.ctx.finalUrl) : null, p.ctx.meta.h1Count,
          p.ctx.bytes, p.ctx.meta.robotsMeta && /noindex/.test(p.ctx.meta.robotsMeta) ? 0 : 1, ts,
        ),
      );
    }
    // Store one representative finding row per (rule, page) sample.
    for (const g of grouped) {
      for (const sample of g.evidenceSamples) {
        stmts.push(
          env.DB.prepare(
            `INSERT INTO findings
              (id, audit_result_id, page_url, category, severity, rule_id, title, description, evidence_json, recommendation, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            newId("fnd"), resultId, sanitizeAuditUrl(sample.pageUrl), g.category, g.severity, g.ruleId,
            g.title, g.description, JSON.stringify(sanitizeAuditEvidence(sample.evidence, sample.pageUrl)), g.recommendation, ts,
          ),
        );
      }
    }
    await env.DB.batch(stmts);

    await run(env.DB, `UPDATE audit_jobs SET status = 'completed', completed_at = ? WHERE id = ?`, now(), row.id);

    // 5) Completion email (isolated; failure cannot fail the audit).
    const user = await first<{ email: string }>(env.DB, `SELECT email FROM "user" WHERE id = ?`, row.user_id);
    if (user) {
      await enqueueEmail(env, {
        type: "email",
        template: "audit_completed",
        to: user.email,
        data: { url: origin, siteName: origin, ...(siteFullyAssessed ? { score: scores.overall } : {}), auditId: row.id },
        dedupeKey: `audit:${row.id}`,
      });
    }
  } catch (err) {
    // Another delivery may have completed the atomic result batch while this
    // invocation was doing its own work. Treat the persisted result as success.
    const persistedResult = await first<{ id: string }>(
      env.DB,
      `SELECT id FROM audit_results WHERE audit_job_id = ?`,
      row.id,
    );
    if (persistedResult) {
      await run(
        env.DB,
        `UPDATE audit_jobs SET status = 'completed', completed_at = COALESCE(completed_at, ?), failed_at = NULL, error_code = NULL WHERE id = ?`,
        now(),
        row.id,
      );
      return;
    }

    const code = err instanceof Error ? err.message : "unknown";
    await run(
      env.DB,
      `UPDATE audit_jobs SET status = 'failed', error_code = ?, failed_at = ? WHERE id = ? AND status != 'completed'`,
      code.slice(0, 100),
      now(),
      row.id,
    );
    throw err; // let the queue retry per its policy
  }
}

async function resolveOrigin(env: Bindings, row: JobRow): Promise<string | null> {
  if (row.target_origin) return row.target_origin;
  if (row.site_id) {
    const s = await first<{ normalized_origin: string }>(
      env.DB,
      `SELECT normalized_origin FROM sites WHERE id = ?`,
      row.site_id,
    );
    return s?.normalized_origin ?? null;
  }
  return null;
}

function browserFindings(
  b: NonNullable<Awaited<ReturnType<typeof runBrowserAnalysis>>>,
  origin: string,
): Finding[] {
  const out: Finding[] = [];
  if (!browserHomepageIsAssessable(b)) {
    out.push(browserHomepageFailureFinding(origin, b.mainDocumentStatus, b.hasRenderedContent, b.hasGenericErrorPage));
  }
  if (b.consoleErrors.length > 0) {
    out.push({
      category: "reliability",
      severity: "low",
      ruleId: "reliability.console-errors",
      title: "JavaScript console errors",
      description: `The page logged ${b.consoleErrors.length} console error(s) when rendered in a browser.`,
      pageUrl: origin,
      evidence: { errors: b.consoleErrors.slice(0, 5) },
      recommendation: "Investigate and resolve the console errors.",
    });
  }
  if (b.perf.loadEventMs && b.perf.loadEventMs > 4000) {
    out.push({
      category: "performance",
      severity: "medium",
      ruleId: "performance.slow-load",
      title: "Slow page load (lab)",
      description: `The load event fired at ~${b.perf.loadEventMs} ms in a lab browser render.`,
      pageUrl: origin,
      evidence: { loadEventMs: b.perf.loadEventMs, resourceCount: b.perf.resourceCount },
      recommendation: "Defer non-critical resources and optimise the critical path.",
    });
  }
  return out;
}

function browserHomepageIsAssessable(
  browser: NonNullable<Awaited<ReturnType<typeof runBrowserAnalysis>>>,
): boolean {
  const status = browser.mainDocumentStatus;
  return status !== null
    && status >= 200
    && status < 300
    && ![204, 205, 206].includes(status)
    && !browser.hasGenericErrorPage
    && browser.hasRenderedContent;
}

function browserHomepageFailureFinding(
  origin: string,
  status: number | null,
  hasRenderedContent: boolean,
  hasGenericErrorPage: boolean,
): Finding {
  const responseIssue = status === null
    ? "the browser did not receive a main-document response"
    : hasGenericErrorPage
      ? `the browser rendered a generic error page for HTTP ${status}`
    : status === 304
      ? "the browser received HTTP 304 without a complete page response"
    : status === 206
      ? "the browser received partial content (HTTP 206)"
      : status === 204 || status === 205
        ? `the browser received HTTP ${status} without page content`
        : !hasRenderedContent && status >= 200 && status < 300
          ? `the browser received HTTP ${status}, but rendered no homepage content`
          : `the browser received HTTP ${status}`;
  const kind = status === null
    ? "browser_response_missing"
    : hasGenericErrorPage
      ? "browser_generic_error_page"
    : status >= 400
      ? "browser_http_error"
      : status === 304
        ? "browser_not_modified"
      : status === 206
        ? "browser_partial_content"
        : status === 204 || status === 205
          ? "browser_empty_response"
        : !hasRenderedContent && status >= 200 && status < 300
          ? "browser_empty_render"
          : !hasRenderedContent
          ? "browser_empty_response"
          : "browser_http_error";
  return {
    category: "reliability",
    severity: "critical",
    ruleId: "reliability.homepage-unavailable",
    title: "Homepage could not be assessed",
    description: `The HTTP crawler retrieved the homepage, but ${responseIssue}. Technical scores were not assessed because the browser could not confirm that the intended homepage was available.`,
    pageUrl: origin,
    evidence: {
      kind,
      hasRenderedContent,
      ...(hasGenericErrorPage ? { hasGenericErrorPage: true } : {}),
      ...(status === null ? {} : { status }),
    },
    recommendation: hasGenericErrorPage
      ? "Replace the generic server-error page with the intended homepage, then run the audit again."
      : "Make sure the homepage returns a successful response and renders visible content in the browser, then run the audit again.",
  };
}

export function browserAnalysisUnavailableFinding(origin: string): Finding {
  return {
    category: "reliability",
    severity: "medium",
    ruleId: "reliability.browser-analysis-unavailable",
    title: "Browser checks could not run",
    description: "The site responded to the HTTP crawl, but its browser checks did not finish. JavaScript behavior and browser measurements are unassessed.",
    pageUrl: origin,
    evidence: { analysis: "browser-rendering" },
    recommendation: "Check browser rendering in this installation, then run the audit again.",
  };
}
