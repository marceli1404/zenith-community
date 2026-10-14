/**
 * Site management. Every route enforces ownership (a user can only touch their
 * own sites) and plan entitlements are checked server-side on creation. Adding a
 * site provisions a monitor at the plan's uptime interval.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../middleware";
import { requireAuth } from "../middleware";
import { all, first, newId, now, run } from "../db";
import { validatePublicTarget } from "@shared/ssrf";
import { normalizeOrigin } from "@shared/url";
import { canAddSite, getMaxSiteCount, getUptimeInterval } from "@shared/entitlements";
import { reliabilityScore } from "@shared/scoring";
import { safeFetch } from "../lib/http";

const sites = new Hono<AppEnv>();
sites.use("*", requireAuth);

interface SiteRow {
  id: string;
  user_id: string;
  name: string;
  url: string;
  normalized_origin: string;
  status: string;
  verification_method: string | null;
  verification_token: string;
  verified_at: number | null;
  status_page_slug: string | null;
  status_page_enabled: number;
  created_at: number;
  updated_at: number;
}

/** Load a site and assert ownership, or return null. */
async function ownedSite(c: import("hono").Context<AppEnv>, id: string): Promise<SiteRow | null> {
  const row = await first<SiteRow>(c.env.DB, `SELECT * FROM sites WHERE id = ?`, id);
  if (!row || row.user_id !== c.get("userId")) return null;
  return row;
}

sites.get("/", async (c) => {
  const day = 24 * 60 * 60 * 1000;
  // One query with correlated subqueries: latest audit score, current monitor
  // state, 24h uptime, and open-incident flag per site. Bounded by plan site
  // limits (≤50), so this stays cheap.
  const rows = await all<
    SiteRow & {
      latest_score: number | null;
      latest_audit_id: string | null;
      latest_audit_at: number | null;
      previous_score: number | null;
      security_score: number | null;
      accessibility_score: number | null;
      performance_score: number | null;
      seo_score: number | null;
      monitor_enabled: number | null;
      next_check_at: number | null;
      last_ok: number | null;
      last_checked_at: number | null;
      up_ok: number | null;
      up_total: number | null;
      open_incident: number;
    }
  >(
    c.env.DB,
    `SELECT s.*,
       latest.overall_score AS latest_score,
       latest.audit_job_id AS latest_audit_id, latest.created_at AS latest_audit_at,
       latest.security_score, latest.accessibility_score, latest.performance_score, latest.seo_score,
       (SELECT ar.overall_score FROM audit_results ar JOIN audit_jobs aj ON aj.id = ar.audit_job_id
        WHERE ar.site_id = s.id AND aj.user_id = s.user_id
        ORDER BY ar.created_at DESC, ar.id DESC LIMIT 1 OFFSET 1) AS previous_score,
       (SELECT m.enabled FROM monitors m WHERE m.site_id = s.id) AS monitor_enabled,
       (SELECT m.next_check_at FROM monitors m WHERE m.site_id = s.id) AS next_check_at,
       (SELECT m.last_ok FROM monitors m WHERE m.site_id = s.id) AS last_ok,
       (SELECT m.last_checked_at FROM monitors m WHERE m.site_id = s.id) AS last_checked_at,
       (SELECT SUM(uc.ok) FROM uptime_checks uc WHERE uc.site_id = s.id AND uc.checked_at >= ?) AS up_ok,
       (SELECT COUNT(*) FROM uptime_checks uc WHERE uc.site_id = s.id AND uc.checked_at >= ?) AS up_total,
       (SELECT COUNT(*) FROM incidents i WHERE i.site_id = s.id AND i.resolved_at IS NULL) AS open_incident
     FROM sites s LEFT JOIN audit_results latest ON latest.id = (
       SELECT ar.id FROM audit_results ar JOIN audit_jobs aj ON aj.id = ar.audit_job_id
       WHERE ar.site_id = s.id AND aj.user_id = s.user_id
       ORDER BY ar.created_at DESC, ar.id DESC LIMIT 1
     ) WHERE s.user_id = ? ORDER BY s.created_at DESC`,
    Date.now() - day,
    Date.now() - day,
    c.get("userId"),
  );

  // Sites beyond the current plan's site limit are paused by the scheduler
  // (see monitor.ts scheduleDueMonitors), oldest kept — never deleted. Mirror
  // that same ordering here so the UI can explain why a site isn't checking.
  const maxSites = getMaxSiteCount(c.get("plan"));
  const keptIds = new Set(
    [...rows]
      .sort((a, b) => a.created_at - b.created_at)
      .slice(0, maxSites)
      .map((r) => r.id),
  );

  return c.json({
    sites: rows.map((r) => ({
      ...publicSite(r),
      latestScore: r.latest_score,
      latestAuditId: r.latest_audit_id,
      latestAuditAt: r.latest_audit_at,
      previousScore: r.previous_score,
      latestCategoryScores: r.latest_audit_id ? {
        security: r.security_score,
        accessibility: r.accessibility_score,
        performance: r.performance_score,
        seo: r.seo_score,
      } : null,
      monitorEnabled: r.monitor_enabled === 1,
      nextCheckAt: r.next_check_at,
      lastOk: r.last_ok,
      lastCheckedAt: r.last_checked_at,
      uptime24h: r.up_total && r.up_total > 0 ? Math.round(((r.up_ok ?? 0) / r.up_total) * 100) : null,
      openIncident: r.open_incident > 0,
      monitoringPaused: !keptIds.has(r.id),
      monitoringPausedReason: keptIds.has(r.id) ? null : "Over the Community site limit",
    })),
  });
});

const createSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  url: z.string().min(1).max(2048),
});

sites.post("/", async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "A valid website URL is required." }, 400);

  const target = validatePublicTarget(parsed.data.url);
  if (!target.ok) return c.json({ error: target.reason, code: target.code }, 400);
  const origin = normalizeOrigin(target.url);
  if (!origin) return c.json({ error: "Could not parse that URL." }, 400);

  const userId = c.get("userId")!;
  const plan = c.get("plan");

  // Entitlement: max sites (enforced server-side, independent of the UI).
  const countRow = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM sites WHERE user_id = ?`,
    userId,
  );
  if (!canAddSite(plan, countRow?.n ?? 0)) {
    return c.json({ error: "You've reached the site limit for Community.", code: "plan_limit" }, 402);
  }

  // Prevent duplicates (unique index also enforces this).
  const dup = await first<{ id: string }>(
    c.env.DB,
    `SELECT id FROM sites WHERE user_id = ? AND normalized_origin = ?`,
    userId,
    origin,
  );
  if (dup) return c.json({ error: "You've already added this website." }, 409);

  const id = newId("site");
  const ts = now();
  const token = `zenith-verify=${newId()}`;
  await run(
    c.env.DB,
    `INSERT INTO sites (id, user_id, name, url, normalized_origin, status, verification_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'unverified', ?, ?, ?)`,
    id,
    userId,
    parsed.data.name ?? origin.replace(/^https?:\/\//, ""),
    target.url,
    origin,
    token,
    ts,
    ts,
  );

  // Provision a monitor at the Community interval (disabled until verified).
  await run(
    c.env.DB,
    `INSERT INTO monitors (id, site_id, enabled, interval_seconds, next_check_at, created_at, updated_at)
     VALUES (?, ?, 0, ?, ?, ?, ?)`,
    newId("mon"),
    id,
    getUptimeInterval(plan),
    ts + getUptimeInterval(plan) * 1000,
    ts,
    ts,
  );

  const row = await first<SiteRow>(c.env.DB, `SELECT * FROM sites WHERE id = ?`, id);
  return c.json({ site: publicSite(row!) }, 201);
});

sites.get("/:id", async (c) => {
  const site = await ownedSite(c, c.req.param("id"));
  if (!site) return c.json({ error: "Not found." }, 404);
  const paused = await isMonitoringPaused(c, site);
  return c.json({ site: { ...publicSite(site), monitoringPaused: paused, monitoringPausedReason: paused ? "Over the Community site limit" : null } });
});

sites.get("/:id/overview", async (c) => {
  const site = await ownedSite(c, c.req.param("id"));
  if (!site) return c.json({ error: "Not found." }, 404);

  const userId = c.get("userId")!;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const [latest, uptime, recentAudits] = await Promise.all([
    first<{ audit_id: string; result_id: string; score: number; created_at: number }>(
      c.env.DB,
      `SELECT aj.id AS audit_id, ar.id AS result_id, ar.overall_score AS score, ar.created_at
       FROM audit_results ar JOIN audit_jobs aj ON aj.id = ar.audit_job_id
       WHERE ar.site_id = ? AND aj.user_id = ?
       ORDER BY ar.created_at DESC, ar.id DESC LIMIT 1`,
      site.id,
      userId,
    ),
    first<{ ok: number | null; total: number }>(
      c.env.DB,
      `SELECT SUM(ok) AS ok, COUNT(*) AS total FROM uptime_checks WHERE site_id = ? AND checked_at >= ?`,
      site.id,
      cutoff,
    ),
    all<{ id: string; status: string; queued_at: number; overall_score: number | null }>(
      c.env.DB,
      `SELECT aj.id, aj.status, aj.queued_at, ar.overall_score
       FROM audit_jobs aj LEFT JOIN audit_results ar ON ar.audit_job_id = aj.id
       WHERE aj.site_id = ? AND aj.user_id = ? ORDER BY aj.queued_at DESC LIMIT 5`,
      site.id,
      userId,
    ),
  ]);

  const highPriority = latest
    ? await first<{ count: number }>(
        c.env.DB,
        `SELECT COUNT(*) AS count FROM findings WHERE audit_result_id = ? AND severity IN ('critical', 'high')`,
        latest.result_id,
      )
    : null;

  return c.json({
    health: latest ? { score: latest.score, auditId: latest.audit_id, at: latest.created_at } : null,
    uptime30d: uptime?.total ? Math.round(((uptime.ok ?? 0) / uptime.total) * 100) : null,
    highPriorityFindings: highPriority?.count ?? 0,
    recentAudits: recentAudits.map((audit) => ({
      id: audit.id,
      status: audit.status,
      score: audit.overall_score,
      at: audit.queued_at,
    })),
  });
});

/** Same "oldest kept, up to the Community site limit" rule as the list endpoint
 *  (monitor.ts scheduleDueMonitors) — a site past the limit is paused, never
 *  deleted, and this mirrors that ordering for the single-site view. */
async function isMonitoringPaused(c: import("hono").Context<AppEnv>, site: SiteRow): Promise<boolean> {
  const maxSites = getMaxSiteCount(c.get("plan"));
  const olderCount = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM sites WHERE user_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))`,
    site.user_id,
    site.created_at,
    site.created_at,
    site.id,
  );
  return (olderCount?.n ?? 0) >= maxSites;
}

sites.delete("/:id", async (c) => {
  const site = await ownedSite(c, c.req.param("id"));
  if (!site) return c.json({ error: "Not found." }, 404);
  // Cascades remove monitors, checks, incidents, audits, findings.
  await run(c.env.DB, `DELETE FROM sites WHERE id = ?`, site.id);
  return c.json({ ok: true });
});

const verifySchema = z.object({
  method: z.enum(["dns_txt", "well_known", "meta_tag"]),
});

sites.post("/:id/verify", async (c) => {
  const site = await ownedSite(c, c.req.param("id"));
  if (!site) return c.json({ error: "Not found." }, 404);
  const parsed = verifySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "A verification method is required." }, 400);

  const token = site.verification_token;
  const verified = await runVerification(parsed.data.method, site.normalized_origin, token);
  if (!verified) {
    return c.json({ ok: false, error: "We couldn't find the verification token yet." }, 422);
  }

  const ts = now();
  await run(
    c.env.DB,
    `UPDATE sites SET status = 'verified', verification_method = ?, verified_at = ?, updated_at = ? WHERE id = ?`,
    parsed.data.method,
    ts,
    ts,
    site.id,
  );
  // Enable monitoring now that ownership is proven.
  await run(c.env.DB, `UPDATE monitors SET enabled = 1, updated_at = ? WHERE site_id = ?`, ts, site.id);

  return c.json({ ok: true });
});

async function runVerification(method: string, origin: string, token: string): Promise<boolean> {
  if (method === "well_known") {
    // A site owner can publish this token at the documented Zenith path.
    for (const file of ["zenith-verification.txt"]) {
      const res = await safeFetch(`${origin}/.well-known/${file}`, {
        readBody: true,
        maxBytes: 4096,
        timeoutMs: 6000,
      });
      if (res.ok && res.status < 400 && (res.body ?? "").includes(token)) return true;
    }
    return false;
  }
  if (method === "meta_tag") {
    const res = await safeFetch(origin, { readBody: true, maxBytes: 500_000, timeoutMs: 8000 });
    return res.ok && (res.body ?? "").includes(token);
  }
  if (method === "dns_txt") {
    return await verifyDnsTxt(origin, token);
  }
  return false;
}

/** Verify a DNS TXT record at _zenith-verify.<host> via DNS-over-HTTPS. */
async function verifyDnsTxt(origin: string, token: string): Promise<boolean> {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  for (const name of [`_zenith-verify.${host}`]) {
    try {
      const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
        headers: { accept: "application/dns-json" },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { Answer?: Array<{ data: string }> };
      const records = (data.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, ""));
      if (records.some((r) => r.includes(token))) return true;
    } catch {
      /* try the next name */
    }
  }
  return false;
}

sites.get("/:id/detail", async (c) => {
  const site = await ownedSite(c, c.req.param("id"));
  if (!site) return c.json({ error: "Not found." }, 404);
  const nowMs = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const win = async (since: number) => {
    const r = await first<{ ok: number; total: number }>(
      c.env.DB,
      `SELECT SUM(ok) AS ok, COUNT(*) AS total FROM uptime_checks WHERE site_id = ? AND checked_at >= ?`,
      site.id,
      since,
    );
    return reliabilityScore(r?.ok ?? 0, r?.total ?? 0);
  };

  const [monitor, series, incidents, recentAudits, u24, u7, u30] = await Promise.all([
    first(c.env.DB, `SELECT enabled, interval_seconds, last_checked_at, last_status_code, last_response_ms, last_ok FROM monitors WHERE site_id = ?`, site.id),
    all(c.env.DB, `SELECT checked_at, ok, response_ms FROM uptime_checks WHERE site_id = ? ORDER BY checked_at DESC LIMIT 100`, site.id),
    all(c.env.DB, `SELECT id, started_at, resolved_at, reason FROM incidents WHERE site_id = ? ORDER BY started_at DESC LIMIT 20`, site.id),
    all(c.env.DB, `SELECT aj.id, aj.status, aj.queued_at, ar.overall_score FROM audit_jobs aj LEFT JOIN audit_results ar ON ar.audit_job_id = aj.id WHERE aj.site_id = ? ORDER BY aj.queued_at DESC LIMIT 10`, site.id),
    win(nowMs - day),
    win(nowMs - 7 * day),
    win(nowMs - 30 * day),
  ]);

  return c.json({
    site: publicSite(site),
    monitor,
    uptime: { d1: u24, d7: u7, d30: u30 },
    series: series.reverse(),
    incidents,
    recentAudits,
  });
});

const statusPageSchema = z.object({ enabled: z.boolean() });
sites.post("/:id/status-page", async (c) => {
  const site = await ownedSite(c, c.req.param("id"));
  if (!site) return c.json({ error: "Not found." }, 404);
  const parsed = statusPageSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid request." }, 400);

  let slug = site.status_page_slug;
  if (parsed.data.enabled && !slug) {
    slug = `${site.normalized_origin.replace(/^https?:\/\//, "").replace(/[^a-z0-9]/gi, "-").slice(0, 40)}-${newId().slice(0, 6)}`.toLowerCase();
  }
  await run(
    c.env.DB,
    `UPDATE sites SET status_page_enabled = ?, status_page_slug = ?, updated_at = ? WHERE id = ?`,
    parsed.data.enabled ? 1 : 0,
    slug,
    now(),
    site.id,
  );
  return c.json({ ok: true, slug, enabled: parsed.data.enabled });
});

function publicSite(row: SiteRow) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    origin: row.normalized_origin,
    status: row.status,
    verificationToken: row.verification_token,
    verificationMethod: row.verification_method,
    verifiedAt: row.verified_at,
    statusPageSlug: row.status_page_slug,
    statusPageEnabled: !!row.status_page_enabled,
    createdAt: row.created_at,
  };
}

export default sites;
