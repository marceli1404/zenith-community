// Added for Zenith Community; see Git history for the changes.
import { describe, expect, it } from "vitest";
import {
  homepageFailureDiagnostic,
  homepageFailureDiagnosticForFinding,
  parseEvidenceJson,
} from "@shared/reliability";
import type { GroupedFinding } from "@shared/findings";

describe("homepage failure diagnostics", () => {
  it.each([
    ["timeout", "The request timed out before the homepage responded."],
    ["dns_or_network", "The hostname could not be resolved or the network connection failed."],
    ["tls", "The secure connection failed TLS or certificate validation."],
  ])("maps %s to a safe user-facing summary", (code, summary) => {
    expect(homepageFailureDiagnostic({ kind: "request_failed", errorCode: code })).toEqual({ code, summary });
  });

  it("does not expose raw error text or unknown diagnostic codes", () => {
    expect(homepageFailureDiagnostic({
      kind: "request_failed",
      errorCode: "secret-internal-error",
      reason: "private hostname 10.0.0.1",
    })).toBeNull();
    expect(homepageFailureDiagnostic({ kind: "http_error", status: 503 })).toBeNull();
    expect(homepageFailureDiagnostic(["timeout"])).toBeNull();
  });

  it("finds the diagnosis only on homepage-unavailable findings", () => {
    const finding = {
      ruleId: "reliability.homepage-unavailable",
      evidenceSamples: [
        { pageUrl: "https://example.test/", evidence: { kind: "request_failed", errorCode: "timeout" } },
      ],
    } as GroupedFinding;
    expect(homepageFailureDiagnosticForFinding(finding)?.code).toBe("timeout");
    expect(homepageFailureDiagnosticForFinding({ ...finding, ruleId: "reliability.broken-page" })).toBeNull();
  });

  it("parses only JSON objects from persisted finding evidence", () => {
    expect(parseEvidenceJson('{"kind":"request_failed","errorCode":"timeout"}')).toEqual({
      kind: "request_failed",
      errorCode: "timeout",
    });
    expect(parseEvidenceJson("not-json")).toEqual({});
    expect(parseEvidenceJson("[1,2]")).toEqual({});
  });
});
