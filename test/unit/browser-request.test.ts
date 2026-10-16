import { describe, expect, it } from "vitest";
import { checkBrowserRequest } from "../../src/audit/browser-request";

describe("browser request policy", () => {
  it("allows safe GET and HEAD requests to public targets", () => {
    expect(checkBrowserRequest("https://example.com/page", "GET")).toEqual({
      allowed: true,
      url: "https://example.com/page",
    });
    expect(checkBrowserRequest("https://example.com/page", "HEAD").allowed).toBe(true);
  });

  it("blocks methods that can change target state", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(checkBrowserRequest("https://example.com/page", method)).toEqual({
        allowed: false,
        reason: "method_not_allowed",
      });
    }
  });

  it("blocks private targets and known unsafe paths, including encoded paths", () => {
    expect(checkBrowserRequest("http://127.0.0.1/admin", "GET")).toEqual({
      allowed: false,
      reason: "blocked_target",
    });
    expect(checkBrowserRequest("https://example.com/account%252Fdelete", "GET")).toEqual({
      allowed: false,
      reason: "unsafe_path",
    });
    expect(checkBrowserRequest("https://example.com/page?action=delete", "GET")).toEqual({
      allowed: false,
      reason: "unsafe_path",
    });
    expect(checkBrowserRequest("https://example.com/%", "GET")).toEqual({
      allowed: false,
      reason: "unsafe_path",
    });
  });
});
