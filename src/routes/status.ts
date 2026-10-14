/**
 * Public status pages (§34). Served without authentication by slug. Exposes ONLY
 * operational data (status, uptime, incident history, response times) — never
 * security findings, audit results, or account information. Owners can
 * disable a status page. Availability is controlled by the installation's
 * Community configuration.
 */

import { Hono } from "hono";
import type { AppEnv } from "../middleware";
import { all, first } from "../db";
import { reliabilityScore } from "@shared/scoring";

const status = new Hono<AppEnv>();

interface SiteRow {
  id: string;
  user_id: string;
  name: string;
  normalized_origin: string;
  status_page_enabled: number;
}

status.get("/:slug", async (c) => {
  const site = await first<SiteRow>(
    c.env.DB,
    `SELECT id, user_id, name, normalized_origin, status_page_enabled FROM sites WHERE status_page_slug = ?`,
    c.req.param("slug"),
  );
  if (!site || !site.status_page_enabled) {
    return c.json({ error: "Status page not found." }, 404);
  }
  const nowMs = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const [last24, last30, openIncident, recentIncidents, monitor] = await Promise.all([
    windowStats(c, site.id, nowMs - day),
    windowStats(c, site.id, nowMs - 30 * day),
    first<{ started_at: number; reason: string | null }>(
      c.env.DB,
      `SELECT started_at, reason FROM incidents WHERE site_id = ? AND resolved_at IS NULL LIMIT 1`,
      site.id,
    ),
    all<{ started_at: number; resolved_at: number | null; reason: string | null }>(
      c.env.DB,
      `SELECT started_at, resolved_at, reason FROM incidents WHERE site_id = ? ORDER BY started_at DESC LIMIT 10`,
      site.id,
    ),
    first<{ last_ok: number | null; last_response_ms: number | null }>(
      c.env.DB,
      `SELECT m.last_ok, m.last_response_ms FROM monitors m WHERE m.site_id = ?`,
      site.id,
    ),
  ]);

  const state = openIncident ? "down" : monitor?.last_ok === 0 ? "degraded" : "operational";

  return c.json({
    name: site.name,
    state,
    uptime24h: reliabilityScore(last24.ok, last24.total),
    uptime30d: reliabilityScore(last30.ok, last30.total),
    avgResponseMs: last24.avgMs,
    lastResponseMs: monitor?.last_response_ms ?? null,
    openSince: openIncident?.started_at ?? null,
    incidents: recentIncidents.map((i) => ({
      startedAt: i.started_at,
      resolvedAt: i.resolved_at,
      reason: i.reason,
    })),
    updatedAt: nowMs,
  });
});

async function windowStats(
  c: import("hono").Context<AppEnv>,
  siteId: string,
  since: number,
): Promise<{ ok: number; total: number; avgMs: number | null }> {
  const row = await first<{ ok: number; total: number; avg_ms: number | null }>(
    c.env.DB,
    `SELECT SUM(ok) AS ok, COUNT(*) AS total, AVG(response_ms) AS avg_ms
     FROM uptime_checks WHERE site_id = ? AND checked_at >= ?`,
    siteId,
    since,
  );
  return {
    ok: row?.ok ?? 0,
    total: row?.total ?? 0,
    avgMs: row?.avg_ms != null ? Math.round(row.avg_ms) : null,
  };
}

export default status;
