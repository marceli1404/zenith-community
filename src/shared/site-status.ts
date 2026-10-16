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
  /** The scheduler paused this enabled monitor to enforce the current site limit. */
  monitorPaused?: boolean;
  lastCheckedAt: number | null;
  /** Accepts either representation: the API has returned this as a SQLite
   *  0/1 integer in some places and a boolean in others. */
  lastOk: number | boolean | null;
  nextCheckAt?: number | null;
}

export type PublicStatusState = "operational" | "degraded" | "down" | "unknown";
type SiteStatusCondition = "incident" | "unverified" | "paused" | "disabled" | "unchecked" | "failed" | "overdue" | "operational";

/** How long past `nextCheckAt` a check can run before we call it overdue,
 *  rather than just "about to run". */
const CHECK_OVERDUE_GRACE_MS = 120_000;

function getSiteStatusCondition(site: SiteStatusInput, now: number): SiteStatusCondition {
  if (site.openIncident) return "incident";
  if (site.status !== "verified") return "unverified";
  if (site.monitorPaused) return "paused";
  if (site.monitorEnabled === false) return "disabled";
  if (site.lastCheckedAt == null || site.lastOk == null) return "unchecked";

  const ok = typeof site.lastOk === "boolean" ? site.lastOk : site.lastOk !== 0;
  if (!ok) return "failed";

  if (site.nextCheckAt != null && now > site.nextCheckAt + CHECK_OVERDUE_GRACE_MS) {
    return "overdue";
  }
  return "operational";
}

export function siteStatus(site: SiteStatusInput, now: number = Date.now()): SiteStatusResult {
  switch (getSiteStatusCondition(site, now)) {
    case "incident": return { text: "Active incident", kind: "bad" };
    case "unverified": return { text: "Awaiting verification", kind: "warn" };
    case "paused": return { text: "Monitoring paused", kind: "warn" };
    case "disabled": return { text: "Monitoring disabled", kind: "quiet" };
    case "unchecked": return { text: "Not checked", kind: "quiet" };
    case "failed": return { text: "Check failed", kind: "bad" };
    case "overdue": return { text: "Check overdue", kind: "warn" };
    case "operational": return { text: "Operational", kind: "good" };
  }
}

/** Convert the shared monitoring condition to the smaller public-status vocabulary. */
export function publicStatusState(site: SiteStatusInput, now: number = Date.now()): PublicStatusState {
  switch (getSiteStatusCondition(site, now)) {
    case "incident": return "down";
    case "failed": return "degraded";
    case "operational": return "operational";
    case "paused":
    case "unverified":
    case "disabled":
    case "unchecked":
    case "overdue":
      return "unknown";
  }
}
