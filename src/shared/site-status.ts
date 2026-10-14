/**
 * Single source of truth for a site's monitoring status text and tone.
 *
 * Before this helper, the dashboard (ObservationOverview) and the sites list
 * (Sites) disagreed for the same site: Sites required `lastOk === 1` exactly,
 * while the dashboard treated anything other than `0` as ok — so a site with
 * `lastOk: null` (never actually checked) read "Unknown" on the dashboard and
 * "Operational" on the sites list. Both surfaces should call this instead of
 * deriving their own text.
 */

export type SiteStatusKind = "good" | "warn" | "bad" | "quiet";

export interface SiteStatusResult {
  text: string;
  kind: SiteStatusKind;
}

export interface SiteStatusInput {
  /** "verified" once ownership is confirmed; anything else is pre-verification. */
  status: string;
  openIncident: boolean;
  /** Absent is treated the same as enabled — only an explicit `false` disables it. */
  monitorEnabled?: boolean;
  lastCheckedAt: number | null;
  /** Accepts either representation: the API has returned this as a SQLite
   *  0/1 integer in some places and a boolean in others. */
  lastOk: number | boolean | null;
  nextCheckAt?: number | null;
}

/** How long past `nextCheckAt` a check can run before we call it overdue,
 *  rather than just "about to run". */
const CHECK_OVERDUE_GRACE_MS = 120_000;

export function siteStatus(site: SiteStatusInput, now: number = Date.now()): SiteStatusResult {
  if (site.openIncident) return { text: "Active incident", kind: "bad" };
  if (site.status !== "verified") return { text: "Awaiting verification", kind: "warn" };
  if (site.monitorEnabled === false) return { text: "Monitoring disabled", kind: "quiet" };
  if (site.lastCheckedAt == null || site.lastOk == null) return { text: "Not checked", kind: "quiet" };

  const ok = typeof site.lastOk === "boolean" ? site.lastOk : site.lastOk !== 0;
  if (!ok) return { text: "Check failed", kind: "bad" };

  if (site.nextCheckAt != null && now > site.nextCheckAt + CHECK_OVERDUE_GRACE_MS) {
    return { text: "Check overdue", kind: "warn" };
  }
  return { text: "Operational", kind: "good" };
}
