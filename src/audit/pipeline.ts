/**
 * Deep audit pipeline (§21). Queue-driven, with explicit status transitions and
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
import { computeScores } from "@shared/scoring";
import { getMaxAuditPages } from "@shared/entitlements";
import { resolveAccess } from "../lib/access";
import { enqueueEmail } from "../lib/email";

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
    const findings: Finding[] = crawl.pages.flatMap((p) => p.findings);
    if (crawl.homepageFailure) {
      const failure = crawl.homepageFailure;
      const description = failure.kind === "http_error"
        ? `The homepage returned HTTP ${failure.status}; the audit could not assess the site.`
        : "The homepage could not be reached during the audit; the site could not be assessed.";
      findings.push({
        category: "reliability",
        severity: "critical",
        ruleId: "reliability.homepage-unavailable",
        title: "Homepage unavailable",
        description,
        pageUrl: origin,
        evidence: failure,
        recommendation: "Restore access to the homepage, then run the audit again.",
      });
    }

    // 2) Browser analysis on the homepage (best-effort).
    await run(env.DB, `UPDATE audit_jobs SET status = 'browser_analysis' WHERE id = ?`, row.id);
    const r2Prefix = `users/${row.user_id}/sites/${row.site_id ?? "adhoc"}/audits/${row.id}`;
    const browser = await runBrowserAnalysis(env, { origin, r2KeyPrefix: r2Prefix });
    if (browser) findings.push(...browserFindings(browser, origin));

    // 3) Score.
    await run(env.DB, `UPDATE audit_jobs SET status = 'scoring' WHERE id = ?`, row.id);
    const grouped = groupFindings(findings);
    const scores = computeScores(grouped, { siteAvailable: crawl.homepageFailure === null });

    // 4) Persist result, pages, and (raw) findings in one batch.
    const resultId = newId("res");
    const ts = now();
    const stmts: D1PreparedStatement[] = [];
    stmts.push(
      env.DB.prepare(
        `INSERT INTO audit_results
          (id, audit_job_id, site_id, overall_score, performance_score, accessibility_score, seo_score, security_score,
           page_count, broken_link_count, screenshot_key, mobile_screenshot_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        resultId, row.id, row.site_id, scores.overall, scores.categories.performance,
        scores.categories.accessibility, scores.categories.seo, scores.categories.security,
        crawl.pages.length, crawl.brokenLinks,
        browser?.desktopScreenshotKey ?? null, browser?.mobileScreenshotKey ?? null, ts,
      ),
    );
    for (const p of crawl.pages) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO audit_pages
            (id, audit_result_id, url, status_code, response_ms, title, meta_description, canonical_url, h1_count, bytes, indexable, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          newId("pg"), resultId, p.ctx.finalUrl, p.ctx.statusCode, p.ctx.responseMs,
          p.ctx.meta.title, p.ctx.meta.metaDescription, p.ctx.meta.canonical, p.ctx.meta.h1Count,
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
            newId("fnd"), resultId, sample.pageUrl, g.category, g.severity, g.ruleId,
            g.title, g.description, JSON.stringify(sample.evidence), g.recommendation, ts,
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
        data: { url: origin, siteName: origin, score: scores.overall, auditId: row.id },
        dedupeKey: `audit:${row.id}`,
      });
    }
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown";
    await run(
      env.DB,
      `UPDATE audit_jobs SET status = 'failed', error_code = ?, failed_at = ? WHERE id = ?`,
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
