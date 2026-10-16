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
    expect(sanitizeAuditUrl("https://example.test/monkey/author/accessibility"))
      .toBe("https://example.test/monkey/author/accessibility");
  });

  it("preserves ordinary hyphenated routes and lowercase year slugs", () => {
    expect(sanitizeAuditUrl("https://example.test/key-value/code-examples/docs2026"))
      .toBe("https://example.test/key-value/code-examples/docs2026");
  });

  it("redacts structured separated tokens and generic credential routes", () => {
    expect(sanitizeAuditUrl("https://example.test/abcd-1234-efgh"))
      .toBe("https://example.test/[redacted]");
    expect(sanitizeAuditUrl("https://example.test/AB-1234-CD"))
      .toBe("https://example.test/[redacted]");
    expect(sanitizeAuditUrl("https://example.test/api-key/AbCd1234"))
      .toBe("https://example.test/[redacted]/[redacted]");
  });

  it("redacts path segments containing encoded separators", () => {
    expect(sanitizeAuditUrl("https://example.test/account%2FAb12Cd34%2Fsettings"))
      .toBe("https://example.test/[redacted]");
    expect(sanitizeAuditUrl("https://example.test/safe%252FAb12Cd34"))
      .toBe("https://example.test/[redacted]");
    expect(sanitizeAuditUrl("https://example.test/safe%252Ftoken%252FAb12Cd34"))
      .toBe("https://example.test/[redacted]");
    expect(sanitizeAuditUrl("https://example.test/safe%2525252FAb12Cd34"))
      .toBe("https://example.test/[redacted]");
  });

  it("preserves safe percent-encoded path text", () => {
    expect(sanitizeAuditUrl("https://example.test/100%25"))
      .toBe("https://example.test/100%25");
    expect(sanitizeAuditUrl("https://example.test/price%2525-off"))
      .toBe("https://example.test/price%2525-off");
    expect(sanitizeAuditUrl("https://example.test/%E2%9C%93%20guide"))
      .toBe("https://example.test/%E2%9C%93%20guide");
  });

  it("hides shorter standalone mixed letter and digit tokens in paths", () => {
    expect(sanitizeAuditUrl("https://example.test/Ab12Cd34Ef56Gh78"))
      .toBe("https://example.test/[redacted]");
    expect(sanitizeAuditUrl("https://example.test/a1b2c3d4"))
      .toBe("https://example.test/[redacted]");
    expect(sanitizeAuditUrl("https://example.test/ABCDEFGH12345678"))
      .toBe("https://example.test/[redacted]");
    expect(sanitizeAuditUrl("https://example.test/abcdefghi1"))
      .toBe("https://example.test/[redacted]");
    expect(sanitizeAuditUrl("https://example.test/Ab12_Cd34"))
      .toBe("https://example.test/[redacted]");
    expect(sanitizeAuditUrl("https://example.test/ab12-cd34"))
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
    expect(sanitizeAuditEvidence({ message: "See [/reset/Ab12Cd34?token=private] for details." }, "https://example.test/"))
      .toEqual({ message: "See [/[redacted]/[redacted]] for details." });
  });
});
