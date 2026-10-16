import { describe, expect, it } from "vitest";
import { sanitizeAuditEvidence, sanitizeAuditUrl } from "../../src/shared/audit-privacy";

describe("audit URL privacy", () => {
  it("drops query and fragment data and hides credential-like path segments", () => {
    expect(sanitizeAuditUrl("https://user:pass@example.test/reset-password/secret-token?email=a%40b.test&token=abc#fragment"))
      .toBe("https://example.test/[redacted]/[redacted]");
  });

  it("retains ordinary page paths while hiding opaque identifiers", () => {
    expect(sanitizeAuditUrl("https://example.test/docs/getting-started/123e4567-e89b-12d3-a456-426614174000?view=full"))
      .toBe("https://example.test/docs/getting-started/[redacted]");
  });

  it("hides shorter standalone mixed letter and digit tokens in paths", () => {
    expect(sanitizeAuditUrl("https://example.test/Ab12Cd34Ef56Gh78"))
      .toBe("https://example.test/[redacted]");
    expect(sanitizeAuditUrl("https://example.test/a1b2c3d4"))
      .toBe("https://example.test/[redacted]");
    expect(sanitizeAuditUrl("https://example.test/docs/guide-2026"))
      .toBe("https://example.test/docs/guide-2026");
  });

  it("hides shorter standalone mixed letter and digit tokens in paths", () => {
    expect(sanitizeAuditUrl("https://example.test/Ab12Cd34Ef56Gh78"))
      .toBe("https://example.test/[redacted]");
    expect(sanitizeAuditUrl("https://example.test/docs/guide-2026"))
      .toBe("https://example.test/docs/guide-2026");
  });

  it("sanitizes absolute URLs and URL fields inside nested evidence", () => {
    expect(sanitizeAuditEvidence({
      finalUrl: "https://example.test/account/confirm/ABCDEF1234567890?code=private",
      nested: [{ href: "/invite/one-time-code?email=private" }],
      paths: ["/reset/opaque-value?token=private"],
      message: "Redirected to https://example.test/reset/secret-value?token=private",
    }, "https://example.test/"))
      .toEqual({
        finalUrl: "https://example.test/account/[redacted]/[redacted]",
        nested: [{ href: "https://example.test/[redacted]/[redacted]" }],
        paths: ["https://example.test/[redacted]/[redacted]"],
        message: "Redirected to https://example.test/[redacted]/[redacted]",
      });
  });

  it("sanitizes relative credential URLs embedded in evidence prose", () => {
    expect(sanitizeAuditEvidence({ message: "Failed to load /reset/Ab12Cd34?token=private from the page." }, "https://example.test/"))
      .toEqual({ message: "Failed to load /[redacted]/[redacted] from the page." });
  });
});
