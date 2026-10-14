import { describe, it, expect } from "vitest";
import { normalizeOrigin, canonicalizeUrl, isSameOrigin, isUnsafeCrawlPath } from "@shared/url";

describe("normalizeOrigin", () => {
  it("lowercases host, drops default ports and paths", () => {
    expect(normalizeOrigin("https://Example.com:443/path?x=1")).toBe("https://example.com");
    expect(normalizeOrigin("http://example.com:80")).toBe("http://example.com");
    expect(normalizeOrigin("example.com")).toBe("https://example.com");
    expect(normalizeOrigin("https://example.com./")).toBe("https://example.com");
  });
  it("keeps non-default ports", () => {
    expect(normalizeOrigin("https://example.com:8443")).toBe("https://example.com:8443");
  });
  it("rejects non-http schemes", () => {
    expect(normalizeOrigin("ftp://example.com")).toBeNull();
  });
});

describe("canonicalizeUrl", () => {
  it("strips fragments and tracking params, sorts, trims trailing slash", () => {
    expect(canonicalizeUrl("https://x.com/a/?utm_source=y&b=2&a=1#frag")).toBe(
      "https://x.com/a?a=1&b=2",
    );
  });
  it("resolves relative URLs against a base", () => {
    expect(canonicalizeUrl("/about", "https://x.com/home")).toBe("https://x.com/about");
  });
});

describe("isSameOrigin", () => {
  it("compares normalized origins", () => {
    expect(isSameOrigin("https://x.com/a", "https://X.com/b")).toBe(true);
    expect(isSameOrigin("https://x.com", "https://y.com")).toBe(false);
    expect(isSameOrigin("http://x.com", "https://x.com")).toBe(false);
  });
});

describe("isUnsafeCrawlPath", () => {
  it("flags state-changing routes", () => {
    expect(isUnsafeCrawlPath("/logout")).toBe(true);
    expect(isUnsafeCrawlPath("/account/delete")).toBe(true);
    expect(isUnsafeCrawlPath("/cart")).toBe(true);
    expect(isUnsafeCrawlPath("/wp-admin/")).toBe(true);
    expect(isUnsafeCrawlPath("/about")).toBe(false);
  });
});
