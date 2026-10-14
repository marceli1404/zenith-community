/** Roll and prune uptime history so raw checks stay bounded. */

import type { Bindings } from "./env";
import { now } from "./db";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export async function downsampleAndPrune(env: Bindings): Promise<void> {
  const nowMs = now();
  const rawCutoff = nowMs - 2 * DAY;
  const hourlyCutoff = nowMs - 14 * DAY;

  await env.DB.prepare(
    `INSERT OR IGNORE INTO uptime_hourly (site_id, bucket_start, checks, ok_checks, avg_response_ms, min_response_ms, max_response_ms)
     SELECT site_id, (checked_at / ${HOUR}) * ${HOUR}, COUNT(*), SUM(ok), AVG(response_ms), MIN(response_ms), MAX(response_ms)
     FROM uptime_checks WHERE checked_at < ? GROUP BY site_id, (checked_at / ${HOUR}) * ${HOUR}`,
  ).bind(rawCutoff).run();
  await env.DB.prepare(`DELETE FROM uptime_checks WHERE checked_at < ?`).bind(rawCutoff).run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO uptime_daily (site_id, bucket_start, checks, ok_checks, avg_response_ms, min_response_ms, max_response_ms)
     SELECT site_id, (bucket_start / ${DAY}) * ${DAY}, SUM(checks), SUM(ok_checks), AVG(avg_response_ms), MIN(min_response_ms), MAX(max_response_ms)
     FROM uptime_hourly WHERE bucket_start < ? GROUP BY site_id, (bucket_start / ${DAY}) * ${DAY}`,
  ).bind(hourlyCutoff).run();
  await env.DB.prepare(`DELETE FROM uptime_hourly WHERE bucket_start < ?`).bind(hourlyCutoff).run();
  await env.DB.prepare(`DELETE FROM uptime_daily WHERE bucket_start < ?`).bind(nowMs - 730 * DAY).run();
}
