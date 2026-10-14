/**
 * Authenticated access to R2-stored assets (screenshots, PDF reports). Access is
 * NEVER granted merely because the caller knows the object key — ownership is
 * verified in D1 first (§53).
 */

import { Hono } from "hono";
import type { AppEnv } from "../middleware";
import { requireAuth } from "../middleware";
import { all, first, now, run } from "../db";
import { groupFindings, type Finding } from "@shared/findings";
import { computeScores } from "@shared/scoring";
import { generateReportHtml } from "../report/html";
import { renderPdf } from "../report/pdf";

const reports = new Hono<AppEnv>();
reports.use("*", requireAuth);

interface AssetRow {
  screenshot_key: string | null;
  mobile_screenshot_key: string | null;
  report_key: string | null;
  user_id: string | null;
}

async function ownedAsset(c: import("hono").Context<AppEnv>, auditResultId: string): Promise<AssetRow | null> {
  // Join through audit_results -> audit_jobs -> user to verify ownership.
  const row = await first<AssetRow>(
    c.env.DB,
    `SELECT ar.screenshot_key, ar.mobile_screenshot_key, ar.report_key, aj.user_id
     FROM audit_results ar
     JOIN audit_jobs aj ON aj.id = ar.audit_job_id
     WHERE ar.id = ?`,
    auditResultId,
  );
  if (!row || row.user_id !== c.get("userId")) return null;
  return row;
}

reports.get("/screenshot/:auditResultId", async (c) => {
  const asset = await ownedAsset(c, c.req.param("auditResultId"));
  if (!asset) return c.json({ error: "Not found." }, 404);
  const variant = c.req.query("variant") === "mobile" ? "mobile" : "desktop";
  const key = variant === "mobile" ? asset.mobile_screenshot_key : asset.screenshot_key;
  if (!key) return c.json({ error: "No screenshot available." }, 404);

  const object = await c.env.REPORTS_BUCKET.get(key);
  if (!object) return c.json({ error: "Not found." }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "image/webp",
      "cache-control": "private, max-age=3600",
    },
  });
});

/** Generate or regenerate the user's PDF report and store it privately in R2. */
reports.post("/pdf/:auditResultId/generate", async (c) => {
  const resultId = c.req.param("auditResultId");
  const asset = await ownedAsset(c, resultId);
  if (!asset) return c.json({ error: "Not found." }, 404);

  const userId = c.get("userId")!;

  const result = await first<{
    overall_score: number; performance_score: number; accessibility_score: number;
    seo_score: number; security_score: number; page_count: number; broken_link_count: number;
    site_id: string | null;
  }>(c.env.DB, `SELECT * FROM audit_results WHERE id = ?`, resultId);
  if (!result) return c.json({ error: "Not found." }, 404);

  const findingRows = await all<{
    page_url: string | null; category: Finding["category"]; severity: Finding["severity"];
    rule_id: string; title: string; description: string; evidence_json: string; recommendation: string;
  }>(c.env.DB, `SELECT * FROM findings WHERE audit_result_id = ?`, resultId);
  const findings: Finding[] = findingRows.map((r) => ({
    ruleId: r.rule_id, category: r.category, severity: r.severity, title: r.title,
    description: r.description, pageUrl: r.page_url ?? "", evidence: {}, recommendation: r.recommendation,
  }));
  const grouped = groupFindings(findings);
  const scores = computeScores(grouped);

  const origin = result.site_id
    ? (await first<{ normalized_origin: string }>(c.env.DB, `SELECT normalized_origin FROM sites WHERE id = ?`, result.site_id))?.normalized_origin ?? "your website"
    : "your website";

  const html = generateReportHtml({
    appName: c.get("config").appName,
    siteOrigin: origin,
    createdAt: now(),
    scores,
    pageCount: result.page_count,
    brokenLinkCount: result.broken_link_count,
    grouped,
  });

  const pdf = await renderPdf(c.env, html);
  if (!pdf) return c.json({ error: "Report generation failed. Please try again." }, 502);

  const key = `users/${userId}/reports/${resultId}.pdf`;
  await c.env.REPORTS_BUCKET.put(key, pdf, { httpMetadata: { contentType: "application/pdf" } });
  await run(c.env.DB, `UPDATE audit_results SET report_key = ? WHERE id = ?`, key, resultId);

  return c.json({ ok: true, resultId });
});

reports.get("/pdf/:auditResultId", async (c) => {
  const asset = await ownedAsset(c, c.req.param("auditResultId"));
  if (!asset) return c.json({ error: "Not found." }, 404);
  if (!asset.report_key) {
    return c.json({ error: "The PDF report has not been generated yet.", code: "not_generated" }, 404);
  }
  const object = await c.env.REPORTS_BUCKET.get(asset.report_key);
  if (!object) return c.json({ error: "Not found." }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="zenith-community-report.pdf"`,
      "cache-control": "private, no-store",
    },
  });
});

export default reports;
