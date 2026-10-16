import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/http", () => ({
  USER_AGENT: "ZenithCommunityBot/1.0",
  safeFetch: vi.fn(),
}));
vi.mock("../../src/lib/html", () => ({
  extractPageMeta: vi.fn(async (_body: string, url: string) => ({
    title: null,
    metaDescription: null,
    canonical: null,
    htmlLang: null,
    robotsMeta: null,
    h1Count: 0,
    imagesMissingAlt: 0,
    imageCount: 0,
    links: new URL(url).pathname === "/" ? ["https://example.com/broken"] : [],
    hasViewportMeta: false,
  })),
  isGenericErrorHtmlDocument: vi.fn((body: string | null | undefined) => /internal server error/i.test(body ?? "")),
  isHtmlDocument: vi.fn((contentType: string | null) => contentType?.includes("text/html") ?? false),
}));

import { crawlSite } from "../../src/audit/crawler";
import { safeFetch } from "../../src/lib/http";
import { extractPageMeta, isGenericErrorHtmlDocument } from "../../src/lib/html";

const fetchMock = vi.mocked(safeFetch);
const html = (url: string) => ({
  ok: true as const,
  finalUrl: url,
  status: 200,
  headers: new Headers({ "content-type": "text/html" }),
  responseMs: 10,
  redirectCount: 0,
  body: "<html></html>",
  contentLength: 13,
});

describe("crawler availability and linked-page failures", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(isGenericErrorHtmlDocument).mockReset().mockImplementation((body) => /internal server error/i.test(body ?? ""));
  });

  it("does not request a disallowed homepage", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "User-agent: *\nDisallow: /" };
      }
      return html(url);
    });

    const result = await crawlSite("https://example.com");

    expect(result.robotsBlock).toEqual({ kind: "disallowed", path: "/" });
    expect(result.homepageFailure).toBeNull();
    expect(result.pages).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/robots\.txt$/);
  });

  it("assumes complete disallow when robots.txt is unreachable", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) return { ok: false, errorCode: "dns_or_network", reason: "unreachable" };
      return html(url);
    });

    const result = await crawlSite("https://example.com");

    expect(result.robotsBlock).toEqual({ kind: "unreachable", errorCode: "dns_or_network" });
    expect(result.pages).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("assumes complete disallow after a robots.txt server error", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      return url.endsWith("robots.txt") ? { ...html(url), status: 503 } : html(url);
    });

    const result = await crawlSite("https://example.com");

    expect(result.robotsBlock).toEqual({ kind: "unreachable", status: 503 });
    expect(result.pages).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("may crawl when robots.txt returns an unavailable 4xx response", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      return url.endsWith("robots.txt") ? { ...html(url), status: 404 } : html(url);
    });

    const result = await crawlSite("https://example.com");

    expect(result.robotsBlock).toBeNull();
    expect(result.pages).toHaveLength(2);
  });

  it("marks a 200 non-HTML homepage could not be assessed and does not add a page", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      return url.endsWith("robots.txt")
        ? { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "" }
        : { ...html(url), headers: new Headers({ "content-type": "application/json" }), body: "{}" };
    });

    const result = await crawlSite("https://example.com");

    expect(result.homepageFailure).toEqual({ kind: "not_html", contentType: "application/json" });
    expect(result.pages).toHaveLength(0);
    expect(result.findings).toHaveLength(0);
  });

  it("does not assess a locationless redirect response as homepage HTML", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "" };
      }
      return {
        ...html(url),
        status: 302,
        body: "<html><body>Sign in to continue</body></html>",
        contentLength: 45,
      };
    });

    const result = await crawlSite("https://example.com");

    expect(result.homepageFailure).toEqual({ kind: "http_error", status: 302 });
    expect(result.pages).toHaveLength(0);
  });

  it("marks a rate-limited homepage as unassessed rather than unavailable", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "" };
      }
      return { ...html(url), status: 429, body: "", contentLength: 0 };
    });

    const result = await crawlSite("https://example.com");

    expect(result.homepageFailure).toEqual({ kind: "rate_limited", status: 429 });
    expect(result.pages).toHaveLength(0);
    expect(result.coverageIncomplete).toBe(false);
  });

  it("marks a partial HTTP 206 homepage response unavailable", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "" };
      }
      return { ...html(url), status: 206, body: "<html><body>Partial</body></html>" };
    });

    const result = await crawlSite("https://example.com");

    expect(result.homepageFailure).toEqual({ kind: "partial_page", status: 206 });
    expect(result.pages).toHaveLength(0);
  });

  it("marks a generic HTTP 200 server-error homepage unavailable before browser analysis", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "" };
      }
      return {
        ...html(url),
        body: "<html><head><title>Internal Server Error</title></head><body>Internal Server Error</body></html>",
      };
    });

    const result = await crawlSite("https://example.com");

    expect(result.homepageFailure).toEqual({ kind: "generic_error_page", status: 200 });
    expect(result.pages).toHaveLength(0);
    expect(result.assessmentTruncatedUrls).toEqual([]);
  });

  it("does not assess a long HTTP 200 outage page with a generic H1 and traceback", async () => {
    const actualHtml = await vi.importActual<typeof import("../../src/lib/html")>("../../src/lib/html");
    vi.mocked(isGenericErrorHtmlDocument).mockImplementation(actualHtml.isGenericErrorHtmlDocument);
    const body = `<html><head><title>Service diagnostics</title></head><body><h1>503 Service Unavailable</h1><pre>${"Traceback (most recent call last): File /srv/app.py, line 42. ".repeat(12)}</pre></body></html>`;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "" };
      }
      return { ...html(url), body };
    });

    const result = await crawlSite("https://example.com");

    expect(result.homepageFailure).toEqual({ kind: "generic_error_page", status: 200 });
    expect(result.pages).toHaveLength(0);
  });

  it("omits pages whose response bodies exceeded the analysis limit", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "" };
      }
      return { ...html(url), bodyTruncated: true, contentLength: 2_000_000 };
    });

    const result = await crawlSite("https://example.com");

    expect(result.homepageFailure).toBeNull();
    expect(result.pages).toHaveLength(0);
    expect(result.assessmentTruncatedUrls).toEqual(["https://example.com"]);
  });

  it("records HTTP errors from linked pages as reliability findings", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "" };
      if (url.endsWith("/broken")) return { ...html(url), status: 503 };
      return html(url);
    });

    const result = await crawlSite("https://example.com");

    expect(result.homepageFailure).toBeNull();
    expect(result.brokenLinks).toBe(1);
    expect(result.findings).toContainEqual(expect.objectContaining({
      ruleId: "reliability.broken-page",
      severity: "critical",
      pageUrl: "https://example.com/broken",
    }));
    expect(result.coverageIncomplete).toBe(false);
  });

  it("does not calculate an overall score when a linked page cannot be reached", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "" };
      if (url.endsWith("/broken")) return { ok: false, errorCode: "dns_or_network", reason: "Network failure" };
      return html(url);
    });

    const result = await crawlSite("https://example.com");

    expect(result.brokenLinks).toBe(1);
    expect(result.coverageIncomplete).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({
      ruleId: "reliability.analysis-incomplete",
      title: "Linked page could not be assessed",
      pageUrl: "https://example.com/broken",
    }));
  });

  it("does not count a rate-limited linked page as broken and withholds the score", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "" };
      if (url.endsWith("/broken")) return { ...html(url), status: 429, body: "", contentLength: 0 };
      return html(url);
    });

    const result = await crawlSite("https://example.com");

    expect(result.homepageFailure).toBeNull();
    expect(result.brokenLinks).toBe(0);
    expect(result.coverageIncomplete).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({
      ruleId: "reliability.analysis-incomplete",
      title: "Linked page was rate-limited",
      severity: "info",
      pageUrl: "https://example.com/broken",
    }));
    expect(result.findings).not.toContainEqual(expect.objectContaining({
      ruleId: "reliability.broken-page",
      pageUrl: "https://example.com/broken",
    }));
  });

  it("does not calculate an overall score when a linked page returns partial content", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "" };
      if (url.endsWith("/broken")) return { ...html(url), status: 206 };
      return html(url);
    });

    const result = await crawlSite("https://example.com");

    expect(result.brokenLinks).toBe(1);
    expect(result.coverageIncomplete).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({
      ruleId: "reliability.analysis-incomplete",
      title: "Linked page returned partial content",
      pageUrl: "https://example.com/broken",
    }));
  });

  it.each([
    { status: 200, body: "" },
    { status: 200, body: "   " },
    { status: 204, body: "" },
    { status: 205, body: "" },
    { status: 304, body: "" },
  ])("marks an empty HTTP $status homepage could not be assessed", async ({ status, body }) => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "" };
      }
      return { ...html(url), status, body, contentLength: body.length };
    });

    const result = await crawlSite("https://example.com");

    expect(result.homepageFailure).toEqual({ kind: "empty_page", status });
    expect(result.pages).toHaveLength(0);
  });

  it("counts empty HTML linked pages as reliability findings", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "" };
      }
      if (url.endsWith("/broken")) return { ...html(url), body: "", contentLength: 0 };
      return html(url);
    });

    const result = await crawlSite("https://example.com");

    expect(result.homepageFailure).toBeNull();
    expect(result.brokenLinks).toBe(1);
    expect(result.findings).toContainEqual(expect.objectContaining({
      ruleId: "reliability.empty-page",
      severity: "medium",
      pageUrl: "https://example.com/broken",
    }));
  });

  it("combines matching robots groups and honors a more specific Allow rule", async () => {
    vi.mocked(extractPageMeta).mockImplementation(async (body, _url) => ({
      title: null,
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: body.includes("robots-test")
        ? [
            "https://example.com/private/blocked",
            "https://example.com/private/public",
            "https://example.com/reports/brief.pdf",
            "https://example.com/reports/brief.pdfx",
          ]
        : [],
      hasViewportMeta: false,
    }));
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return {
          ...html(url),
          headers: new Headers({ "content-type": "text/plain" }),
          body: "User-agent: Zenith\nUser-agent: OtherBot\nDisallow: /private\nDisallow: /*.pdf$\nUser-agent: CommunityBot\nAllow: /private/public",
        };
      }
      return { ...html(url), body: "robots-test" };
    });

    const result = await crawlSite("https://example.com");

    expect(result.pages.map((page) => page.ctx.finalUrl)).toContain("https://example.com/private/public");
    expect(result.pages.map((page) => page.ctx.finalUrl)).toContain("https://example.com/reports/brief.pdfx");
    expect(result.pages.map((page) => page.ctx.finalUrl)).not.toContain("https://example.com/private/blocked");
    expect(result.pages.map((page) => page.ctx.finalUrl)).not.toContain("https://example.com/reports/brief.pdf");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/private/blocked"))).toBe(false);
  });

  it("matches robots.txt rules against the full path and query", async () => {
    vi.mocked(extractPageMeta).mockImplementation(async (body, _url) => ({
      title: null,
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: body.includes("robots-query-test") ? ["https://example.com/private?token=secret"] : [],
      hasViewportMeta: false,
    }));
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "User-agent: *\nDisallow: /private?token=secret" };
      }
      return { ...html(url), body: "robots-query-test" };
    });

    const result = await crawlSite("https://example.com");

    expect(result.pages).toHaveLength(1);
    expect(result.coverageIncomplete).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId === "reliability.analysis-incomplete")).toBe(true);
    const incompleteFinding = result.findings.find((finding) => finding.ruleId === "reliability.analysis-incomplete");
    expect(incompleteFinding?.pageUrl).toBe("https://example.com/private");
    expect(JSON.stringify(incompleteFinding?.evidence)).not.toContain("token=secret");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/private?token=secret"))).toBe(false);
  });

  it("normalizes percent-encoded unreserved path octets before robots matching", async () => {
    vi.mocked(extractPageMeta).mockImplementation(async (body) => ({
      title: null,
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: body.includes("robots-encoded-test")
        ? ["https://example.com/%70rivate/%7Emember", "https://example.com/caf%C3%A9"]
        : [],
      hasViewportMeta: false,
    }));
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "User-agent: *\nDisallow: /private/~member\nDisallow: /café" };
      }
      return { ...html(url), body: "robots-encoded-test" };
    });

    const result = await crawlSite("https://example.com");

    expect(result.pages).toHaveLength(1);
    expect(result.coverageIncomplete).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/%70rivate/%7Emember"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/caf%C3%A9"))).toBe(false);
  });

  it("does not score a crawl that stops at its page limit with discovered pages waiting", async () => {
    vi.mocked(extractPageMeta).mockImplementation(async (body) => ({
      title: null,
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: body.includes("page-limit-test") ? ["https://example.com/one", "https://example.com/two"] : [],
      hasViewportMeta: false,
    }));
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "User-agent: *\nDisallow:" };
      }
      return { ...html(url), body: "page-limit-test" };
    });

    const result = await crawlSite("https://example.com", { maxPages: 1 });

    expect(result.pages).toHaveLength(1);
    expect(result.coverageIncomplete).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId === "reliability.analysis-incomplete" && finding.title === "Crawl page limit reached")).toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain("https://example.com/one");
  });

  it("does not score when linked pages remain beyond the configured crawl depth", async () => {
    vi.mocked(extractPageMeta).mockImplementation(async () => ({
      title: null,
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: ["https://example.com/deeper"],
      hasViewportMeta: false,
    }));
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "User-agent: *\nDisallow:" };
      }
      return html(url);
    });

    const result = await crawlSite("https://example.com", { maxDepth: 0 });

    expect(result.pages).toHaveLength(1);
    expect(result.coverageIncomplete).toBe(true);
    expect(result.findings.some((finding) => finding.title === "Linked page is beyond the crawl depth limit")).toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain("https://example.com/deeper");
  });

  it("does not score when same-origin link discovery exceeds its parser limit", async () => {
    vi.mocked(extractPageMeta).mockImplementation(async () => ({
      title: null,
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: [],
      sameOriginLinksTruncated: true,
      hasViewportMeta: false,
    }));
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "User-agent: *\nDisallow:" };
      }
      return html(url);
    });

    const result = await crawlSite("https://example.com");

    expect(result.pages).toHaveLength(1);
    expect(result.coverageIncomplete).toBe(true);
    expect(result.findings.some((finding) => finding.title === "Page link discovery limit reached")).toBe(true);
  });

  it("blocks an unsafe homepage redirect before requesting the state-changing route", async () => {
    const requested: string[] = [];
    fetchMock.mockImplementation(async (input, options) => {
      const url = String(input ?? "");
      requested.push(url);
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "" };
      }
      if (url === "https://example.com" || url === "https://example.com/") {
        const redirectUrl = "https://example.com/logout";
        const decision = await options?.redirectPolicy?.(redirectUrl, 12_000);
        if (decision && !decision.allowed) {
          return {
            ok: false as const,
            errorCode: "redirect_policy" as const,
            policyCode: decision.code,
            reason: decision.reason,
            redirectUrl,
          };
        }
      }
      return html(url);
    });

    const result = await crawlSite("https://example.com");

    expect(requested).not.toContain("https://example.com/logout");
    expect(result.unsafePathBlock).toEqual({
      kind: "unsafe_path",
      path: "/logout",
      origin: "https://example.com",
    });
    expect(result.robotsBlock).toBeNull();
    expect(result.homepageFailure).toBeNull();
    expect(result.pages).toHaveLength(0);
  });

  it("skips a linked page that redirects to an unsafe route without counting it as broken", async () => {
    const requested: string[] = [];
    fetchMock.mockImplementation(async (input, options) => {
      const url = String(input ?? "");
      requested.push(url);
      if (url.endsWith("robots.txt")) {
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body: "" };
      }
      if (url === "https://example.com/broken") {
        const redirectUrl = "https://example.com/logout";
        const decision = await options?.redirectPolicy?.(redirectUrl, 12_000);
        if (decision && !decision.allowed) {
          return {
            ok: false as const,
            errorCode: "redirect_policy" as const,
            policyCode: decision.code,
            reason: decision.reason,
            redirectUrl,
          };
        }
      }
      return html(url);
    });

    const result = await crawlSite("https://example.com");

    expect(requested).not.toContain("https://example.com/logout");
    expect(result.unsafePathBlock).toBeNull();
    expect(result.homepageFailure).toBeNull();
    expect(result.brokenLinks).toBe(0);
    expect(result.pages).toHaveLength(1);
  });

  it("marks a linked page as incomplete when its redirect destination is blocked by robots.txt", async () => {
    const requested: string[] = [];
    vi.mocked(extractPageMeta).mockImplementation(async (body) => ({
      title: null,
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: body.includes("redirect-coverage-test") ? ["https://example.com/linked"] : [],
      hasViewportMeta: false,
    }));
    fetchMock.mockImplementation(async (input, options) => {
      const url = String(input ?? "");
      requested.push(url);
      if (url.endsWith("/robots.txt")) {
        const body = url.startsWith("https://destination.example/")
          ? "User-agent: *\nDisallow: /private"
          : "User-agent: *\nDisallow:";
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body };
      }
      if (url === "https://example.com/linked") {
        const redirectUrl = "https://destination.example/private?token=secret";
        const decision = await options?.redirectPolicy?.(redirectUrl, 12_000);
        if (decision && !decision.allowed) {
          return {
            ok: false as const,
            errorCode: "redirect_policy" as const,
            policyCode: decision.code,
            reason: decision.reason,
            redirectUrl,
          };
        }
      }
      return { ...html(url), body: "redirect-coverage-test" };
    });

    const result = await crawlSite("https://example.com");

    expect(result.coverageIncomplete).toBe(true);
    expect(result.brokenLinks).toBe(0);
    expect(result.findings.some((finding) => finding.ruleId === "reliability.analysis-incomplete"
      && finding.pageUrl === "https://example.com/linked")).toBe(true);
    const incompleteFinding = result.findings.find((finding) => finding.ruleId === "reliability.analysis-incomplete");
    expect(JSON.stringify(incompleteFinding?.evidence)).not.toContain("token=secret");
    expect(requested).toContain("https://destination.example/robots.txt");
    expect(requested).not.toContain("https://destination.example/private");
  });

  it("checks a cross-origin redirect host's robots rules before requesting its page", async () => {
    const requested: string[] = [];
    fetchMock.mockImplementation(async (input, options) => {
      const url = String(input ?? "");
      requested.push(url);
      if (url.endsWith("/robots.txt")) {
        const body = url.startsWith("https://destination.example/")
          ? "User-agent: *\nDisallow: /private"
          : "User-agent: *\nDisallow:";
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body };
      }
      if (url === "https://example.com" || url === "https://example.com/") {
        const redirectUrl = "https://destination.example/private";
        const decision = await options?.redirectPolicy?.(redirectUrl, 12_000);
        if (decision && !decision.allowed) {
          return {
            ok: false as const,
            errorCode: "redirect_policy" as const,
            policyCode: decision.code,
            reason: decision.reason,
            redirectUrl,
          };
        }
      }
      return html(url);
    });

    const result = await crawlSite("https://example.com");

    expect(result.robotsBlock).toEqual({ kind: "disallowed", path: "/private", origin: "https://destination.example" });
    expect(result.homepageFailure).toBeNull();
    expect(result.pages).toHaveLength(0);
    expect(requested).toContain("https://destination.example/robots.txt");
    expect(requested).not.toContain("https://destination.example/private");
  });

  it("keeps an empty product-specific group separate from the wildcard group", async () => {
    vi.mocked(extractPageMeta).mockImplementation(async (body, _url) => ({
      title: null,
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: body.includes("robots-group-test") ? ["https://example.com/private"] : [],
      hasViewportMeta: false,
    }));
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      if (url.endsWith("robots.txt")) {
        return {
          ...html(url),
          headers: new Headers({ "content-type": "text/plain" }),
          body: "User-agent: ZenithCommunityBot\nDisallow:\nUser-agent: *\nDisallow: /private",
        };
      }
      return { ...html(url), body: "robots-group-test" };
    });

    const result = await crawlSite("https://example.com");

    expect(result.pages.map((page) => page.ctx.finalUrl)).toContain("https://example.com/private");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/private"))).toBe(true);
  });

  it("provides a cached robots check for browser navigation and subresources", async () => {
    const requested: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      const url = String(input ?? "");
      requested.push(url);
      if (url.endsWith("/robots.txt")) {
        const body = url.startsWith("https://destination.example/")
          ? "User-agent: *\nDisallow: /assets"
          : "User-agent: *\nDisallow: /private";
        return { ...html(url), headers: new Headers({ "content-type": "text/plain" }), body };
      }
      return html(url);
    });

    const result = await crawlSite("https://example.com");

    await expect(result.browserRequestAllowed("https://example.com/")).resolves.toBe(true);
    await expect(result.browserRequestAllowed("https://example.com/private?token=1")).resolves.toBe(false);
    await expect(result.browserRequestAllowed("https://destination.example/assets/app.js")).resolves.toBe(false);
    await expect(result.browserRequestAllowed("https://destination.example/public.js")).resolves.toBe(true);
    expect(requested.filter((url) => url.endsWith("/robots.txt"))).toEqual([
      "https://example.com/robots.txt",
      "https://destination.example/robots.txt",
    ]);
    expect(requested.some((url) => url.includes("/private?token=1"))).toBe(false);
    expect(requested.some((url) => url.includes("/assets/app.js"))).toBe(false);
  });

});
