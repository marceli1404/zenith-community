/** Authenticated audit history and queueing for the Community edition. */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../middleware";
import { requireAuth } from "../middleware";
import { all, first, newId, now, run } from "../db";
import { validatePublicTarget } from "@shared/ssrf";
import { normalizeOrigin } from "@shared/url";
import { getAuditPriority } from "@shared/entitlements";
import { groupFindings, type Finding } from "@shared/findings";
import { computeScores } from "@shared/scoring";

const audits = new Hono<AppEnv>();
audits.use("*", requireAuth);

audits.get("/", async (c) => {
  const rows = await all(
    c.env.DB,
    `SELECT aj.id, aj.status, aj.queued_at, aj.completed_at, ar.id AS result_id, ar.overall_score,
            s.name AS site_name, s.normalized_origin AS origin
     FROM audit_jobs aj LEFT JOIN audit_results ar ON ar.audit_job_id = aj.id
     LEFT JOIN sites s ON s.id = aj.site_id
     WHERE aj.user_id = ? ORDER BY aj.queued_at DESC LIMIT 50`,
    c.get("userId"),
  );
  return c.json({ audits: rows });
});

const triggerSchema = z.object({ siteId: z.string().optional(), url: z.string().max(2048).optional() });
audits.post("/", async (c) => {
  const parsed = triggerSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || (!parsed.data.siteId && !parsed.data.url)) return c.json({ error: "Provide a siteId or a url to audit." }, 400);
  const userId = c.get("userId")!;
  let siteId: string | null = null;
  let origin: string;
  if (parsed.data.siteId) {
    const site = await first<{ id: string; normalized_origin: string; user_id: string }>(
      c.env.DB, `SELECT id, normalized_origin, user_id FROM sites WHERE id = ?`, parsed.data.siteId,
    );
    if (!site || site.user_id !== userId) return c.json({ error: "Not found." }, 404);
    siteId = site.id;
    origin = site.normalized_origin;
  } else {
    const target = validatePublicTarget(parsed.data.url!);
    if (!target.ok) return c.json({ error: target.reason, code: target.code }, 400);
    origin = normalizeOrigin(target.url)!;
  }

  const jobId = newId("aud");
  await run(
    c.env.DB,
    `INSERT INTO audit_jobs (id, user_id, site_id, target_origin, status, priority, queued_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
    jobId, userId, siteId, origin, getAuditPriority(c.get("plan")), now(),
  );
  await c.env.AUDIT_QUEUE.send({ type: "audit", auditJobId: jobId });
  return c.json({ ok: true, auditJobId: jobId, target: origin }, 202);
});

audits.get("/:id", async (c) => {
  const userId = c.get("userId")!;
  const job = await first<{
    id: string; user_id: string; status: string; queued_at: number; completed_at: number | null;
    error_code: string | null; site_id: string | null; target_origin: string | null;
  }>(c.env.DB, `SELECT * FROM audit_jobs WHERE id = ?`, c.req.param("id"));
  if (!job || job.user_id !== userId) return c.json({ error: "Not found." }, 404);
  const result = await first<{
    id: string; overall_score: number; performance_score: number; accessibility_score: number;
    seo_score: number; security_score: number; page_count: number; broken_link_count: number; site_id: string | null;
  }>(c.env.DB, `SELECT * FROM audit_results WHERE audit_job_id = ?`, job.id);
  if (!result) return c.json({ job, result: null });

  const rows = await all<{
    page_url: string | null; category: Finding["category"]; severity: Finding["severity"];
    rule_id: string; title: string; description: string; evidence_json: string; recommendation: string;
  }>(c.env.DB, `SELECT * FROM findings WHERE audit_result_id = ?`, result.id);
  const findings: Finding[] = rows.map((row) => ({
    ruleId: row.rule_id, category: row.category, severity: row.severity, title: row.title,
    description: row.description, pageUrl: row.page_url ?? "", evidence: safeParse(row.evidence_json),
    recommendation: row.recommendation,
  }));
  const grouped = groupFindings(findings);
  const scores = computeScores(grouped);
  return c.json({
    job,
    result: {
      id: result.id,
      scores,
      pageCount: result.page_count,
      brokenLinkCount: result.broken_link_count,
    },
    findings: grouped,
  });
});

function safeParse(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch { return {}; }
}

export default audits;
