/**
 * Uptime monitoring. The cron trigger runs every minute, finds due
 * monitors, enqueues one job each, and immediately advances next_check_at so an
 * overlapping tick can't double-enqueue. Queue workers perform the actual HTTP
 * check (never a browser), record the result, and drive the incident state
 * machine — sending exactly one downtime and one recovery notification.
 */

import type { Bindings, MonitorJob } from "./env";
import { all, first, newId, now, run } from "./db";
import { safeFetch } from "./lib/http";
import { applyCheck, type MonitorCounters } from "@shared/incidents";
import { enqueueEmail } from "./lib/email";
import { resolveAccess, type Access } from "./lib/access";
import { getMaxSiteCount, getUptimeInterval } from "@shared/entitlements";

const SCHEDULER_BATCH = 500;

interface DueMonitor {
  id: string;
  site_id: string;
  interval_seconds: number;
  user_id: string;
}

/**
 * Cron entrypoint: enqueue checks for all due, enabled monitors.
 *
 * Every enabled Community monitor uses the configured check interval. If an owner
 * reaches the self-hosted site limit, older sites keep being checked and newer
 * ones are paused, never deleted.
 *
 * Both the owner's access and their kept-site set are resolved at most once per
 * user per tick (accessCache / keptCache), even though a user can own several
 * due monitors in the same batch.
 */
export async function scheduleDueMonitors(env: Bindings): Promise<void> {
  const nowMs = now();
  const due = await all<DueMonitor>(
    env.DB,
    `SELECT m.id, m.site_id, m.interval_seconds, s.user_id FROM monitors m
     JOIN sites s ON s.id = m.site_id
     WHERE m.enabled = 1 AND m.next_check_at <= ?
     ORDER BY m.next_check_at ASC LIMIT ?`,
    nowMs,
    SCHEDULER_BATCH,
  );
  if (due.length === 0) return;

  const accessCache = new Map<string, Access>();
  const keptCache = new Map<string, Set<string>>();

  async function accessFor(userId: string): Promise<Access> {
    let access = accessCache.get(userId);
    if (!access) {
      access = await resolveAccess(env.DB, userId);
      accessCache.set(userId, access);
    }
    return access;
  }

  /** The site ids this user's current plan still monitors: the oldest maxSites. */
  async function keptSitesFor(userId: string, plan: Access["plan"]): Promise<Set<string>> {
    let kept = keptCache.get(userId);
    if (!kept) {
      const maxSites = getMaxSiteCount(plan);
      const owned = await all<{ id: string }>(
        env.DB,
        `SELECT id FROM sites WHERE user_id = ? ORDER BY created_at ASC LIMIT ?`,
        userId,
        maxSites,
      );
      kept = new Set(owned.map((s) => s.id));
      keptCache.set(userId, kept);
    }
    return kept;
  }

  const claims: Array<{ monitor: DueMonitor; nextCheckAt: number; enqueue: boolean }> = [];
  const updates: D1PreparedStatement[] = [];

  for (const m of due) {
    const access = await accessFor(m.user_id);
    // The owner's resolved access configuration sets the check interval.
    const effectiveInterval = getUptimeInterval(access.plan);
    // Advance next_check_at for every due monitor (even paused ones) so a
    // subsequent tick doesn't keep re-selecting them every minute.
    const kept = await keptSitesFor(m.user_id, access.plan);
    const nextCheckAt = nowMs + effectiveInterval * 1000;
    updates.push(
      env.DB.prepare(
        `UPDATE monitors SET next_check_at = ? WHERE id = ? AND enabled = 1 AND next_check_at <= ?`,
      ).bind(nextCheckAt, m.id, nowMs),
    );
    claims.push({ monitor: m, nextCheckAt, enqueue: kept.has(m.site_id) });
  }

  const claimResults = await env.DB.batch(updates);
  const toEnqueue = claims.flatMap(({ monitor, nextCheckAt, enqueue }, index) => {
    if (!enqueue || (claimResults[index]?.meta?.changes ?? 0) !== 1) return [];
    return [{ ...monitor, nextCheckAt, checkId: newId("chk") }];
  });

  // Enqueue the checks.
  await Promise.all(
    toEnqueue.map((m) =>
      env.MONITOR_QUEUE.send({ type: "check", monitorId: m.id, siteId: m.site_id, checkId: m.checkId }).catch(async (err) => {
        console.error("Failed to enqueue monitor check", m.id, err);
        // The due time was advanced before enqueue to prevent overlapping cron
        // ticks from duplicating work. If enqueue failed, make it eligible on
        // the next tick rather than silently skipping an entire check interval.
        try {
          await run(
            env.DB,
            `UPDATE monitors SET next_check_at = MIN(next_check_at, ?) WHERE id = ? AND next_check_at = ?`,
            nowMs,
            m.id,
            m.nextCheckAt,
          );
        } catch (resetError) {
          console.error("Failed to restore monitor check schedule", m.id, resetError);
        }
      }),
    ),
  );
}

interface MonitorRow extends MonitorCounters {
  id: string;
  site_id: string;
  interval_seconds: number;
}

interface MonitorDbRow {
  id: string;
  site_id: string;
  interval_seconds: number;
  consecutive_failures: number;
  consecutive_successes: number;
  last_checked_at: number | null;
}

/** Queue worker: perform one uptime check and update state. */
export async function processMonitorCheck(env: Bindings, job: MonitorJob): Promise<void> {
  const checkId = job.checkId ?? newId("chk");
  // Queue delivery is at-least-once. A row is inserted only in the same atomic
  // D1 batch as the counter/incident updates, so its presence means the whole
  // check already committed and this redelivery can safely return.
  const savedCheck = await first<{ id: string }>(env.DB, `SELECT id FROM uptime_checks WHERE id = ?`, checkId);
  if (savedCheck) return;

  const site = await first<{ id: string; user_id: string; normalized_origin: string; name: string }>(
    env.DB,
    `SELECT id, user_id, normalized_origin, name FROM sites WHERE id = ?`,
    job.siteId,
  );
  const monRow = await first<MonitorDbRow>(
    env.DB,
    `SELECT id, site_id, interval_seconds, consecutive_failures, consecutive_successes, last_checked_at FROM monitors WHERE id = ?`,
    job.monitorId,
  );
  // Site or monitor may have been deleted between enqueue and processing.
  if (!site || !monRow) return;

  const openIncident = await first<{ id: string; started_at: number; initial_status_code: number | null }>(
    env.DB,
    `SELECT id, started_at, initial_status_code FROM incidents WHERE site_id = ? AND resolved_at IS NULL LIMIT 1`,
    site.id,
  );

  const res = await safeFetch(site.normalized_origin, {
    method: "GET",
    readBody: false,
    timeoutMs: 15_000,
    maxBytes: 64_000,
  });

  const checkedAt = now();
  const ok = res.ok && res.status >= 200 && res.status < 300;
  const statusCode = res.ok ? res.status : null;
  const responseMs = res.ok ? res.responseMs : null;
  const errorCode = res.ok ? null : res.errorCode;

  // Update monitor last-* and counters via the pure state machine.
  const counters: MonitorCounters = {
    consecutiveFailures: monRow.consecutive_failures,
    consecutiveSuccesses: monRow.consecutive_successes,
    hasOpenIncident: !!openIncident,
  };
  const { counters: next, action } = applyCheck(counters, { ok });

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE monitors SET consecutive_failures = ?, consecutive_successes = ?,
         last_checked_at = ?, last_status_code = ?, last_response_ms = ?, last_ok = ?, updated_at = ?, last_check_id = ?
       WHERE id = ? AND consecutive_failures = ? AND consecutive_successes = ? AND last_checked_at IS ?`,
    ).bind(
      next.consecutiveFailures,
      next.consecutiveSuccesses,
      checkedAt,
      statusCode,
      responseMs,
      ok ? 1 : 0,
      checkedAt,
      checkId,
      monRow.id,
      monRow.consecutive_failures,
      monRow.consecutive_successes,
      monRow.last_checked_at,
    ),
    env.DB.prepare(
      `INSERT INTO uptime_checks (id, site_id, checked_at, ok, status_code, response_ms, error_code)
       SELECT ?, ?, ?, ?, ?, ?, ? FROM monitors WHERE id = ? AND last_check_id = ?`,
    ).bind(checkId, site.id, checkedAt, ok ? 1 : 0, statusCode, responseMs, errorCode, monRow.id, checkId),
  ];
  let newIncidentId: string | null = null;
  if (action.type === "open_incident") {
    newIncidentId = newId("inc");
    statements.push(
      env.DB.prepare(
        `INSERT INTO incidents (id, site_id, started_at, reason, initial_status_code, last_status_code, notification_sent_at)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM uptime_checks WHERE id = ?)`,
      ).bind(newIncidentId, site.id, checkedAt, errorCode ?? `HTTP ${statusCode ?? "error"}`, statusCode, statusCode, checkedAt, checkId),
    );
  } else if (action.type === "resolve_incident" && openIncident) {
    statements.push(
      env.DB.prepare(
        `UPDATE incidents SET resolved_at = ?, last_status_code = ?, recovery_notification_sent_at = ?
         WHERE id = ? AND resolved_at IS NULL AND EXISTS (SELECT 1 FROM uptime_checks WHERE id = ?)`,
      ).bind(checkedAt, statusCode, checkedAt, openIncident.id, checkId),
    );
  }

  // D1 batches are atomic and sequential. A unique check id plus optimistic
  // state matching prevents redeliveries and overlapping checks from applying
  // a counter transition more than once.
  const results = await env.DB.batch(statements);
  if ((results[0]?.meta?.changes ?? 0) === 0) {
    const concurrentCheck = await first<{ id: string }>(env.DB, `SELECT id FROM uptime_checks WHERE id = ?`, checkId);
    if (concurrentCheck) return;
    const currentMonitor = await first<{ id: string }>(env.DB, `SELECT id FROM monitors WHERE id = ?`, monRow.id);
    if (currentMonitor) throw new Error("monitor_state_conflict");
    return;
  }

  if (action.type === "open_incident" && newIncidentId && (results[2]?.meta?.changes ?? 0) === 1) {
    await notify(env, site.user_id, "site_down", { siteName: site.name, url: site.normalized_origin, statusCode }, `down:${newIncidentId}`);
  } else if (action.type === "resolve_incident" && openIncident && (results[2]?.meta?.changes ?? 0) === 1) {
    const downtimeMinutes = Math.max(1, Math.round((checkedAt - openIncident.started_at) / 60000));
    await notify(env, site.user_id, "site_recovered", { siteName: site.name, url: site.normalized_origin, downtimeMinutes }, `up:${openIncident.id}`);
  }
}

async function notify(
  env: Bindings,
  userId: string,
  template: "site_down" | "site_recovered",
  data: Record<string, unknown>,
  dedupeKey: string,
): Promise<void> {
  // Respect notification preferences; default on when no row exists.
  const prefs = await first<{ downtime: number; recovery: number }>(
    env.DB,
    `SELECT downtime, recovery FROM notification_preferences WHERE user_id = ?`,
    userId,
  );
  if (template === "site_down" && prefs && !prefs.downtime) return;
  if (template === "site_recovered" && prefs && !prefs.recovery) return;

  const user = await first<{ email: string }>(env.DB, `SELECT email FROM "user" WHERE id = ?`, userId);
  if (!user) return;
  await enqueueEmail(env, { type: "email", template, to: user.email, data, dedupeKey });
}

export type { MonitorRow };
