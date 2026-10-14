/** Self-hosted Community limits and capabilities. */

export type Plan = "community";
export type Capability = "monitor.pdfReports";

export const PLAN_LABEL: Readonly<Record<Plan, string>> = { community: "Community" };

/** Every Community deployment can generate PDF audit reports. */
export function hasCapability(_plan: Plan, capability: Capability): boolean {
  return capability === "monitor.pdfReports";
}

/** Conservative per-instance limits for the default self-hosted deployment. */
export function canAddSite(_plan: Plan, currentSiteCount: number): boolean {
  return currentSiteCount < 50;
}

export function getMaxSiteCount(_plan: Plan): number {
  return 50;
}

export function getUptimeInterval(_plan: Plan): number {
  return 60;
}

export function getMaxAuditPages(_plan: Plan): number {
  return 250;
}

export function getAuditPriority(_plan: Plan): number {
  return 2;
}
