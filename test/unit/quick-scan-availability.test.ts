import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/http", () => ({ safeFetch: vi.fn() }));
vi.mock("../../src/lib/html", () => ({
  extractPageMeta: vi.fn(async () => ({
    title: null,
    metaDescription: null,
    canonical: null,
    htmlLang: null,
    robotsMeta: null,
    h1Count: 0,
    imagesMissingAlt: 0,
    imageCount: 0,
    links: [],
    hasViewportMeta: false,
  })),
}));

import { quickScan } from "../../src/lib/scan";
import { safeFetch } from "../../src/lib/http";

const safeFetchMock = vi.mocked(safeFetch);

describe("quick scan homepage availability", () => {
  beforeEach(() => safeFetchMock.mockReset());

  it("scores an HTTP 404 homepage as zero and reports the outage", async () => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      finalUrl: "https://example.com/",
      status: 404,
      headers: new Headers({ "content-type": "text/html" }),
      responseMs: 20,
      redirectCount: 0,
      body: "<html><head><title>Not found</title></head><body>Missing</body></html>",
      contentLength: 80,
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score.overall).toBe(0);
    expect(result.topFindings).toContainEqual(expect.objectContaining({
      ruleId: "reliability.homepage-unavailable",
      title: "Homepage unavailable",
    }));
  });

  it("scores a network failure as zero and reports the homepage unavailable", async () => {
    safeFetchMock.mockResolvedValue({
      ok: false,
      errorCode: "dns_or_network",
      reason: "The site could not be reached.",
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score.overall).toBe(0);
    expect(result.topFindings).toContainEqual(expect.objectContaining({
      ruleId: "reliability.homepage-unavailable",
      title: "Homepage unavailable",
    }));
  });
});
