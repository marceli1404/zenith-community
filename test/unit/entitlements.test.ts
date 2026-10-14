import { describe, expect, it } from "vitest";
import {
  canAddSite,
  getAuditPriority,
  getMaxAuditPages,
  getMaxSiteCount,
  getUptimeInterval,
  hasCapability,
} from "@shared/entitlements";

describe("Community limits", () => {
  it("allows up to 50 monitored sites per instance", () => {
    expect(getMaxSiteCount("community")).toBe(50);
    expect(canAddSite("community", 49)).toBe(true);
    expect(canAddSite("community", 50)).toBe(false);
  });

  it("uses the Community audit and monitoring defaults", () => {
    expect(getUptimeInterval("community")).toBe(60);
    expect(getMaxAuditPages("community")).toBe(250);
    expect(getAuditPriority("community")).toBe(2);
  });

  it("includes PDF reports in every Community deployment", () => {
    expect(hasCapability("community", "monitor.pdfReports")).toBe(true);
  });
});
