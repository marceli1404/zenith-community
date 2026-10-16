/** Authenticated summaries for the Community dashboard. */

import { Hono } from "hono";
import type { AppEnv } from "../middleware";
import { requireAuth } from "../middleware";
import { all, first } from "../db";
import { displayOverallScoreSql, reliabilityScore } from "@shared/scoring";

const dashboard = new Hono<AppEnv>();
dashboard.use("*", requireAuth);

export const ATTENTION_SQL = `
  WITH observed AS (
    SELECT s.id AS site_id, s.name AS site_name, ar.id AS result_id, ar.audit_job_id, ar.created_at
    FROM sites s LEFT JOIN audit_results ar ON ar.id = (
      SELECT r.id FROM audit_results r JOIN audit_jobs j ON j.id = r.audit_job_id
      WHERE r.site_id = s.id AND j.user_id = s.user_id
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1
    ) WHERE s.user_id = ?
  ), grouped AS (
    SELECT o.site_id, o.site_name, o.audit_job_id, o.created_at, f.rule_id,
           MIN(f.title) AS title, COUNT(*) AS occurrences,
           MIN(CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END) AS severity_rank
    FROM observed o JOIN findings f ON f.audit_result_id = o.result_id
    GROUP BY o.site_id, o.site_name, o.audit_job_id, o.created_at, f.rule_id
    HAVING severity_rank < 2
  ), top_findings AS (
    SELECT * FROM grouped ORDER BY severity_rank, created_at DESC, site_id, rule_id LIMIT 20
  )
  SELECT coverage.*, t.* FROM (
    SELECT COUNT(*) AS total_sites, COUNT(result_id) AS audited_sites,
           (SELECT COUNT(*) FROM grouped) AS total_findings FROM observed
  ) coverage LEFT JOIN top_findings t ON 1 = 1
  ORDER BY t.severity_rank, t.created_at DESC, t.site_id, t.rule_id
`;

interface AttentionRow {
  total_sites: number;
  audited_sites: number;
  total_findings: number;
  site_id: string | null;
  site_name: string;
  audit_job_id: string;
  created_at: number;
  rule_id: string;
  title: string;
  occurrences: number;
  severity_rank: number;
}

dashboard.get("/attention", async (c) => {
  const rows = await all<AttentionRow>(c.env.DB, ATTENTION_SQL, c.get("userId")!);
  const findings = rows.filter((row) => row.site_id !== null).map((row) => ({
    siteId: row.site_id!, siteName: row.site_name, auditId: row.audit_job_id,
    ruleId: row.rule_id, title: row.title,
    severity: row.severity_rank === 0 ? "critical" as const : "high" as const,
    occurrences: row.occurrences, observedAt: row.created_at,
  }));
  const totalFindings = rows[0]?.total_findings ?? 0;
  return c.json({
    findings,
    coverage: { totalSites: rows[0]?.total_sites ?? 0, auditedSites: rows[0]?.audited_sites ?? 0 },
    totalFindings,
    truncated: totalFindings > findings.length,
  });
});

dashboard.get("/overview", async (c) => {
  const userId = c.get("userId")!;
  const day = 24 * 60 * 60 * 1000;
  const [siteCounts, openIncidents, uptime, health, recentAudits, recentIncidents] = await Promise.all([
    first<{ total: number; verified: number }>(
      c.env.DB,
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) AS verified FROM sites WHERE user_id = ?`,
      userId,
    ),
    first<{ n: number }>(c.env.DB,
      `SELECT COUNT(*) AS n FROM incidents i JOIN sites s ON s.id = i.site_id WHERE s.user_id = ? AND i.resolved_at IS NULL`, userId),
    first<{ ok: number; total: number }>(c.env.DB,
      `SELECT SUM(uc.ok) AS ok, COUNT(*) AS total FROM uptime_checks uc JOIN sites s ON s.id = uc.site_id WHERE s.user_id = ? AND uc.checked_at >= ?`, userId, Date.now() - day),
    first<{ avg: number | null }>(c.env.DB,
      `SELECT AVG(${displayOverallScoreSql("ar")}) AS avg FROM audit_results ar JOIN audit_jobs aj ON aj.id = ar.audit_job_id WHERE aj.user_id = ?`, userId),
    all(c.env.DB,
      `SELECT aj.id, aj.status, aj.queued_at, ${displayOverallScoreSql("ar")} AS overall_score, s.name AS site_name, aj.target_origin
       FROM audit_jobs aj LEFT JOIN audit_results ar ON ar.audit_job_id = aj.id LEFT JOIN sites s ON s.id = aj.site_id
       WHERE aj.user_id = ? ORDER BY aj.queued_at DESC LIMIT 5`, userId),
    all(c.env.DB,
      `SELECT i.id, i.started_at, i.resolved_at, i.reason, s.name AS site_name
       FROM incidents i JOIN sites s ON s.id = i.site_id WHERE s.user_id = ? ORDER BY i.started_at DESC LIMIT 5`, userId),
  ]);
  return c.json({
    sites: siteCounts?.total ?? 0,
    verifiedSites: siteCounts?.verified ?? 0,
    openIncidents: openIncidents?.n ?? 0,
    uptime24h: reliabilityScore(uptime?.ok ?? 0, uptime?.total ?? 0),
    avgHealthScore: health?.avg != null ? Math.round(health.avg) : null,
    recentAudits,
    recentIncidents,
  });
});

export default dashboard;
