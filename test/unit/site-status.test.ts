import { describe, it, expect } from "vitest";
import { siteStatus, type SiteStatusInput } from "@shared/site-status";

const BASE: SiteStatusInput = {
  status: "verified",
  openIncident: false,
  monitorEnabled: true,
  lastCheckedAt: 1_000,
  lastOk: 1,
  nextCheckAt: null,
};

describe("siteStatus", () => {
  it("prioritises an active incident over everything else", () => {
    expect(siteStatus({ ...BASE, openIncident: true, lastOk: 0 })).toEqual({ text: "Active incident", kind: "bad" });
  });

  it("flags an unverified site regardless of check data", () => {
    expect(siteStatus({ ...BASE, status: "pending" })).toEqual({ text: "Awaiting verification", kind: "warn" });
  });

  it("flags monitoring disabled", () => {
    expect(siteStatus({ ...BASE, monitorEnabled: false })).toEqual({ text: "Monitoring disabled", kind: "quiet" });
  });

  it("reports not checked when there is no check timestamp", () => {
    expect(siteStatus({ ...BASE, lastCheckedAt: null, lastOk: null })).toEqual({ text: "Not checked", kind: "quiet" });
  });

  it("reports not checked when lastOk is null even if a timestamp exists", () => {
    expect(siteStatus({ ...BASE, lastOk: null })).toEqual({ text: "Not checked", kind: "quiet" });
  });

  it("reports a failed check for numeric lastOk = 0", () => {
    expect(siteStatus({ ...BASE, lastOk: 0 })).toEqual({ text: "Check failed", kind: "bad" });
  });

  it("reports a failed check for boolean lastOk = false", () => {
    expect(siteStatus({ ...BASE, lastOk: false })).toEqual({ text: "Check failed", kind: "bad" });
  });

  it("treats numeric lastOk = 1 and boolean true the same way", () => {
    const now = 10_000;
    expect(siteStatus({ ...BASE, lastOk: 1 }, now)).toEqual({ text: "Operational", kind: "good" });
    expect(siteStatus({ ...BASE, lastOk: true }, now)).toEqual({ text: "Operational", kind: "good" });
  });

  it("reports overdue once past the grace period after nextCheckAt", () => {
    const now = 1_000_000;
    expect(siteStatus({ ...BASE, nextCheckAt: now - 120_001 }, now)).toEqual({ text: "Check overdue", kind: "warn" });
  });

  it("is not overdue within the grace period", () => {
    const now = 1_000_000;
    expect(siteStatus({ ...BASE, nextCheckAt: now - 119_000 }, now)).toEqual({ text: "Operational", kind: "good" });
  });

  it("reports operational when there is no nextCheckAt to compare against", () => {
    expect(siteStatus({ ...BASE, nextCheckAt: undefined })).toEqual({ text: "Operational", kind: "good" });
  });
});
