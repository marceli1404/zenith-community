/** Self-service profile, data export, sessions and account deletion. */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../middleware";
import { requireAuth } from "../middleware";
import { all, first, now, run } from "../db";
import { parseEvidenceJson } from "@shared/reliability";
import { sanitizeAuditEvidence, sanitizeAuditUrl } from "@shared/audit-privacy";

const account = new Hono<AppEnv>();
account.use("*", requireAuth);

const profileSchema = z.object({ name: z.string().trim().min(1).max(80) });
const notificationsSchema = z.object({ downtime: z.boolean(), recovery: z.boolean(), auditFinished: z.boolean() });

account.get("/settings", async (c) => {
  const userId = c.get("userId")!;
  const [profile, sessions, preferences] = await Promise.all([
    first<{ name: string; email: string; emailVerified: number; createdAt: unknown; twoFactorEnabled: number }>(
      c.env.DB,
      `SELECT name, email, "emailVerified", "createdAt", "twoFactorEnabled" FROM "user" WHERE id = ?`,
      userId,
    ),
    all<{ id: string; expiresAt: number; createdAt: number; updatedAt: number; userAgent: string | null }>(
      c.env.DB,
      `SELECT id, "expiresAt", "createdAt", "updatedAt", "userAgent" FROM "session" WHERE "userId" = ? ORDER BY "updatedAt" DESC`,
      userId,
    ),
    first<{ downtime: number; recovery: number; audit_finished: number }>(
      c.env.DB,
      `SELECT downtime, recovery, audit_finished FROM notification_preferences WHERE user_id = ?`,
      userId,
    ),
  ]);
  if (!profile) return c.json({ error: "Account not found." }, 404);
  const providers = await all<{ providerId: string }>(c.env.DB, `SELECT DISTINCT "providerId" FROM "account" WHERE "userId" = ?`, userId);
  const allowedProviders = new Set(["credential", "google", "github"]);
  return c.json({
    profile: { ...profile, emailVerified: !!profile.emailVerified },
    connectedProviders: providers.map((row) => row.providerId).filter((provider) => allowedProviders.has(provider)),
    notificationPreferences: {
      downtime: preferences ? !!preferences.downtime : true,
      recovery: preferences ? !!preferences.recovery : true,
      auditFinished: preferences ? !!preferences.audit_finished : true,
    },
    sessions: sessions.filter((session) => session.expiresAt > now()).map((session) => ({ ...session, current: session.id === c.get("sessionId") })),
  });
});

account.patch("/settings/profile", async (c) => {
  const parsed = profileSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Enter a name between 1 and 80 characters." }, 400);
  await run(c.env.DB, `UPDATE "user" SET name = ?, "updatedAt" = ? WHERE id = ?`, parsed.data.name, now(), c.get("userId")!);
  return c.json({ ok: true, name: parsed.data.name });
});

account.patch("/settings/notifications", async (c) => {
  const parsed = notificationsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Notification preferences are invalid." }, 400);
  const value = parsed.data;
  await run(
    c.env.DB,
    `INSERT INTO notification_preferences (user_id, downtime, recovery, audit_finished)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET downtime = excluded.downtime, recovery = excluded.recovery, audit_finished = excluded.audit_finished`,
    c.get("userId")!, value.downtime ? 1 : 0, value.recovery ? 1 : 0, value.auditFinished ? 1 : 0,
  );
  return c.json({ ok: true, notificationPreferences: value });
});

account.delete("/sessions/others", async (c) => {
  const currentSessionId = c.get("sessionId");
  if (!currentSessionId) return c.json({ error: "Current session could not be identified." }, 409);
  const result = await run(c.env.DB, `DELETE FROM "session" WHERE "userId" = ? AND id <> ?`, c.get("userId")!, currentSessionId);
  return c.json({ ok: true, revoked: result.meta.changes ?? 0 });
});

account.delete("/sessions/:id", async (c) => {
  const sessionId = c.req.param("id");
  if (sessionId === c.get("sessionId")) return c.json({ error: "Use Sign out to end your current session." }, 400);
  const result = await run(c.env.DB, `DELETE FROM "session" WHERE id = ? AND "userId" = ?`, sessionId, c.get("userId")!);
  if (!result.meta.changes) return c.json({ error: "Session not found." }, 404);
  return c.json({ ok: true });
});

account.get("/export", async (c) => {
  const userId = c.get("userId")!;
  const [profile, sites, checks, incidents, audits, results, findings, preferences] = await Promise.all([
    first(c.env.DB, `SELECT id, name, email, "createdAt" FROM "user" WHERE id = ?`, userId),
    all<Record<string, unknown> & { url: string }>(c.env.DB, `SELECT * FROM sites WHERE user_id = ?`, userId),
    all(c.env.DB, `SELECT * FROM uptime_checks WHERE site_id IN (SELECT id FROM sites WHERE user_id = ?)`, userId),
    all(c.env.DB, `SELECT * FROM incidents WHERE site_id IN (SELECT id FROM sites WHERE user_id = ?)`, userId),
    all<Record<string, unknown> & { target_origin?: string | null }>(c.env.DB, `SELECT * FROM audit_jobs WHERE user_id = ?`, userId),
    all(c.env.DB, `SELECT * FROM audit_results WHERE audit_job_id IN (SELECT id FROM audit_jobs WHERE user_id = ?)`, userId),
    all<Record<string, unknown> & { page_url: string | null; evidence_json: string }>(c.env.DB, `SELECT * FROM findings WHERE audit_result_id IN (SELECT id FROM audit_results WHERE audit_job_id IN (SELECT id FROM audit_jobs WHERE user_id = ?))`, userId),
    all(c.env.DB, `SELECT * FROM notification_preferences WHERE user_id = ?`, userId),
  ]);
  const safeFindings = findings.map((row) => ({
    ...row,
    page_url: row.page_url ? sanitizeAuditUrl(row.page_url) : row.page_url,
    evidence_json: JSON.stringify(sanitizeAuditEvidence(parseEvidenceJson(row.evidence_json), row.page_url ?? "")),
  }));
  const safeSites = sites.map((row) => ({ ...row, url: typeof row.url === "string" ? sanitizeAuditUrl(row.url) : row.url }));
  const safeAudits = audits.map((row) => ({ ...row, target_origin: typeof row.target_origin === "string" ? sanitizeAuditUrl(row.target_origin) : row.target_origin }));
  return new Response(JSON.stringify({ exportedAt: now(), profile, sites: safeSites, checks, incidents, audits: safeAudits, results, findings: safeFindings, preferences }, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="zenith-community-export.json"', "cache-control": "no-store" },
  });
});

account.delete("/", async (c) => {
  const userId = c.get("userId")!;
  try {
    await deleteR2Prefix(c.env.REPORTS_BUCKET, `users/${userId}/`);
  } catch {
    return c.json({ error: "Your files could not be removed. The account is still intact; retry later." }, 503);
  }
  await run(c.env.DB, `DELETE FROM "user" WHERE id = ?`, userId);
  return c.json({ ok: true });
});

async function deleteR2Prefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    if (page.objects.length) await bucket.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export default account;
