import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/http", () => ({ safeFetch: vi.fn() }));
vi.mock("../../src/lib/robots", () => ({
  loadRobots: vi.fn(),
  isDisallowed: vi.fn((rules: Array<{ allow: boolean; path: string }>, path: string) =>
    rules.some((rule) => !rule.allow && path.startsWith(rule.path))),
}));
vi.mock("../../src/lib/html", () => ({
  hasMeaningfulHtmlContent: vi.fn(() => true),
  hasUnverifiedMediaContent: vi.fn(() => false),
  isGenericErrorHtmlDocument: vi.fn(() => false),
  isHtmlDocument: vi.fn(() => true),
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
import { loadRobots } from "../../src/lib/robots";
import { extractPageMeta, hasMeaningfulHtmlContent, hasUnverifiedMediaContent, isGenericErrorHtmlDocument, isHtmlDocument } from "../../src/lib/html";

const safeFetchMock = vi.mocked(safeFetch);

describe("quick scan homepage availability", () => {
  beforeEach(() => {
    safeFetchMock.mockReset();
    vi.mocked(loadRobots).mockReset().mockResolvedValue({ rules: [], block: null, found: true });
    vi.mocked(hasMeaningfulHtmlContent).mockReturnValue(true);
    vi.mocked(hasUnverifiedMediaContent).mockReturnValue(false);
    vi.mocked(isGenericErrorHtmlDocument).mockReturnValue(false);
    vi.mocked(isHtmlDocument).mockReturnValue(true);
    vi.mocked(extractPageMeta).mockClear();
  });

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
      title: "Homepage could not be assessed",
      description: "The homepage returned HTTP 404; the site could not be assessed.",
      recommendation: "Configure the homepage to return a successful page response, then run the scan again.",
    }));
  });

  it("does not score a homepage after its response body is truncated", async () => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      finalUrl: "https://example.com/",
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      responseMs: 20,
      redirectCount: 0,
      body: "<html><body>Valid content in the returned prefix</body></html>",
      bodyTruncated: true,
      contentLength: 2_000_000,
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score.overall).toBeNull();
    expect(result.score.categories).toEqual({ security: null, accessibility: null, performance: null, seo: null });
    expect(result.topFindings).toContainEqual(expect.objectContaining({
      ruleId: "reliability.analysis-truncated",
      title: "Quick Scan could not fully assess the homepage",
    }));
    expect(extractPageMeta).not.toHaveBeenCalled();
  });

  it("does not score a partial HTTP 206 homepage response as a complete page", async () => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      finalUrl: "https://example.com/",
      status: 206,
      headers: new Headers({ "content-type": "text/html", "content-range": "bytes 0-49/100" }),
      responseMs: 20,
      redirectCount: 0,
      body: "<html><body>Partial</body></html>",
      contentLength: 32,
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score.overall).toBe(0);
    expect(result.score.categories).toEqual({ security: null, accessibility: null, performance: null, seo: null });
    expect(result.topFindings).toContainEqual(expect.objectContaining({
      ruleId: "reliability.homepage-unavailable",
      description: "The homepage returned partial content (HTTP 206); the complete page could not be assessed.",
    }));
    expect(extractPageMeta).not.toHaveBeenCalled();
  });

  it("does not assess a locationless redirect response as homepage HTML", async () => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      finalUrl: "https://example.com/",
      status: 302,
      headers: new Headers({ "content-type": "text/html" }),
      responseMs: 20,
      redirectCount: 0,
      body: "<html><body>Sign in to continue</body></html>",
      contentLength: 45,
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score.overall).toBe(0);
    expect(result.topFindings).toContainEqual(expect.objectContaining({
      ruleId: "reliability.homepage-unavailable",
      description: "The homepage returned HTTP 302; the site could not be assessed.",
      recommendation: "Configure the homepage to return a successful page response, then run the scan again.",
    }));
    expect(extractPageMeta).not.toHaveBeenCalled();
  });

  it("does not report an unresolved sitemap redirect as a confirmed missing sitemap", async () => {
    safeFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "http://example.com") {
        return { ok: true, finalUrl: url, status: 200, headers: new Headers(), responseMs: 20, redirectCount: 0 };
      }
      if (url.endsWith("/sitemap.xml")) {
        return { ok: true, finalUrl: url, status: 302, headers: new Headers(), responseMs: 20, redirectCount: 0 };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        responseMs: 20,
        redirectCount: 0,
        body: "<html><body>Example</body></html>",
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sitemapFound).toBeNull();
    expect(result.topFindings).not.toContainEqual(expect.objectContaining({ ruleId: "seo.sitemap-missing" }));
  });

  it("scores a network failure as zero and reports the homepage could not be assessed", async () => {
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
      title: "Homepage could not be assessed",
      description: "The homepage could not be reached because of a DNS or network error. The site could not be assessed.",
      recommendation: "Restore access to the homepage, then run the scan again.",
    }));
  });

  it("does not request a homepage that robots.txt disallows", async () => {
    vi.mocked(loadRobots).mockResolvedValue({ rules: [{ allow: false, path: "/" }], block: null, found: true });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score.overall).toBeNull();
    expect(result.score.categories).toEqual({ security: null, accessibility: null, performance: null, seo: null });
    expect(result.sitemapFound).toBeNull();
    expect(result.topFindings[0]).toMatchObject({
      ruleId: "reliability.robots-disallowed",
      severity: "info",
    });
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("does not request a state-changing URL supplied as the scan target", async () => {
    const result = await quickScan("https://example.com/unsubscribe?token=secret", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toBe("https://example.com/unsubscribe");
    expect(result.finalUrl).toBe("https://example.com/unsubscribe");
    expect(result.score.overall).toBeNull();
    expect(result.topFindings[0]).toMatchObject({
      ruleId: "reliability.unsafe-path",
      severity: "info",
    });
    expect(safeFetchMock).not.toHaveBeenCalled();
    expect(loadRobots).not.toHaveBeenCalled();
  });

  it("does not request an unsafe submitted path", async () => {
    const result = await quickScan("https://example.com/unsubscribe?token=secret", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score.overall).toBeNull();
    expect(result.score.categories).toEqual({ security: null, accessibility: null, performance: null, seo: null });
    expect(result.sitemapFound).toBeNull();
    expect(result.topFindings[0]).toMatchObject({
      ruleId: "reliability.unsafe-path",
      severity: "info",
      description: expect.stringContaining("No site pages were assessed."),
    });
    expect(loadRobots).not.toHaveBeenCalled();
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("skips tokenized unsubscribe links during the bounded link check", async () => {
    const action = "https://example.com/unsubscribe?token=secret";
    const about = "https://example.com/about";
    vi.mocked(extractPageMeta).mockResolvedValue({
      title: "Example",
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: [action, about],
      hasViewportMeta: false,
    });
    safeFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        responseMs: 20,
        redirectCount: 0,
        body: "<html><body>Example</body></html>",
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checkedLinks).toBe(1);
    expect(safeFetchMock.mock.calls.map(([input]) => String(input))).not.toContain(action);
    expect(safeFetchMock.mock.calls.map(([input]) => String(input))).toContain(about);
  });

  it("skips robots-disallowed links and applies the policy to HEAD and GET redirect checks", async () => {
    const blocked = "https://example.com/private";
    const about = "https://example.com/about";
    vi.mocked(loadRobots).mockResolvedValue({
      rules: [{ allow: false, path: "/private" }],
      block: null,
      found: true,
    });
    vi.mocked(extractPageMeta).mockResolvedValue({
      title: "Example",
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: [blocked, about],
      hasViewportMeta: false,
    });
    safeFetchMock.mockImplementation(async (input, options) => {
      const url = String(input);
      if (url === about && options?.method === "HEAD") {
        return {
          ok: true,
          finalUrl: url,
          status: 405,
          headers: new Headers(),
          responseMs: 20,
          redirectCount: 0,
        };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        responseMs: 20,
        redirectCount: 0,
        body: "<html><body>Example</body></html>",
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checkedLinks).toBe(1);
    expect(safeFetchMock.mock.calls.map(([input]) => String(input))).not.toContain(blocked);
    const aboutCalls = safeFetchMock.mock.calls.filter(([input]) => String(input) === about);
    expect(aboutCalls.map(([, options]) => options?.method)).toEqual(["HEAD", "GET"]);
    for (const [, options] of aboutCalls) {
      expect(options?.redirectPolicy).toBeDefined();
      await expect(options?.redirectPolicy?.(blocked, 6000)).resolves.toEqual({
        allowed: false,
        code: "robots_disallowed",
        reason: "robots.txt disallows the redirect destination.",
      });
    }
  });

  it("does not request a sitemap that robots.txt disallows", async () => {
    vi.mocked(loadRobots).mockResolvedValue({
      rules: [{ allow: false, path: "/sitemap.xml" }],
      block: null,
      found: true,
    });
    safeFetchMock.mockImplementation(async (input, _options) => ({
      ok: true,
      finalUrl: String(input),
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      responseMs: 20,
      redirectCount: 0,
      body: "<html><body>Example</body></html>",
    }));

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sitemapFound).toBeNull();
    expect(result.topFindings.map((finding) => finding.ruleId)).not.toContain("seo.sitemap-missing");
    expect(safeFetchMock.mock.calls.map(([input]) => String(input))).not.toContain("https://example.com/sitemap.xml");
  });

  it("checks sitemap redirects against robots and unsafe-path policy", async () => {
    safeFetchMock.mockImplementation(async (input, _options) => ({
      ok: true,
      finalUrl: String(input),
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      responseMs: 20,
      redirectCount: 0,
      body: "<html><body>Example</body></html>",
    }));

    await quickScan("https://example.com/", "Zenith");

    const sitemapCall = safeFetchMock.mock.calls.find(([input]) => String(input) === "https://example.com/sitemap.xml");
    expect(sitemapCall?.[1]?.redirectPolicy).toBeDefined();
    await expect(sitemapCall?.[1]?.redirectPolicy?.("https://example.com/unsubscribe?token=secret", 6000)).resolves.toMatchObject({
      allowed: false,
      code: "unsafe_crawl_path",
    });
  });

  it("does not score a sitemap whose redirect is blocked by crawl policy", async () => {
    safeFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://example.com/sitemap.xml") {
        return {
          ok: false,
          errorCode: "redirect_policy",
          reason: "robots.txt disallows the redirect destination.",
          redirectUrl: "https://example.com/private",
          policyCode: "robots_disallowed",
        };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        responseMs: 20,
        redirectCount: 0,
        body: "<html><body>Example</body></html>",
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sitemapFound).toBeNull();
    expect(result.topFindings.map((finding) => finding.ruleId)).not.toContain("seo.sitemap-missing");
  });

  it("does not score a link whose redirect is blocked by crawl policy", async () => {
    const link = "https://example.com/redirect";
    vi.mocked(extractPageMeta).mockResolvedValue({
      title: "Example",
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: [link],
      hasViewportMeta: false,
    });
    safeFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === link) {
        return {
          ok: false,
          errorCode: "redirect_policy",
          reason: "robots.txt disallows the redirect destination.",
          redirectUrl: "https://example.com/private",
          policyCode: "robots_disallowed",
        };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        responseMs: 20,
        redirectCount: 0,
        body: "<html><body>Example</body></html>",
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checkedLinks).toBe(0);
    expect(result.brokenLinks).toBe(0);
    expect(result.score.reliabilityDeduction).toBe(0);
    expect(result.topFindings).not.toContainEqual(expect.objectContaining({ ruleId: "reliability.broken-link" }));
  });

  it("does not treat an HTTP-to-HTTP redirect as an HTTPS redirect", async () => {
    safeFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://example.com/") {
        return {
          ok: true,
          finalUrl: url,
          status: 200,
          headers: new Headers({ "content-type": "text/html" }),
          responseMs: 20,
          redirectCount: 0,
          body: "<html><body>Example</body></html>",
        };
      }
      if (url === "http://example.com") {
        return {
          ok: false,
          errorCode: "too_many_redirects",
          reason: "Redirect limit reached.",
          redirectUrl: "http://example.com/sign-in",
        };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers(),
        responseMs: 20,
        redirectCount: 0,
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.httpsRedirects).toBe(false);
    expect(result.topFindings).toContainEqual(expect.objectContaining({
      ruleId: "security.no-http-redirect",
      severity: "medium",
    }));
  });

  it("scores an HTTP homepage that does not redirect to HTTPS", async () => {
    safeFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "http://example.com/") {
        return {
          ok: true,
          finalUrl: url,
          status: 200,
          headers: new Headers({ "content-type": "text/html" }),
          responseMs: 20,
          redirectCount: 0,
          body: "<html><body>Example</body></html>",
        };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers(),
        responseMs: 20,
        redirectCount: 0,
      };
    });

    const result = await quickScan("http://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.httpsRedirects).toBe(false);
    expect(result.topFindings).toContainEqual(expect.objectContaining({
      ruleId: "security.no-http-redirect",
      severity: "medium",
    }));
  });

  it("leaves the HTTPS redirect check unverified when the HTTP endpoint is unreachable", async () => {
    safeFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://example.com/") {
        return {
          ok: true,
          finalUrl: url,
          status: 200,
          headers: new Headers({ "content-type": "text/html" }),
          responseMs: 20,
          redirectCount: 0,
          body: "<html><body>Example</body></html>",
        };
      }
      if (url === "http://example.com") {
        return { ok: false, errorCode: "dns_or_network", reason: "The site could not be reached." };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers(),
        responseMs: 20,
        redirectCount: 0,
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.httpsRedirects).toBeNull();
    expect(result.topFindings).not.toContainEqual(expect.objectContaining({ ruleId: "security.no-http-redirect" }));
  });

  it.each([302, 304])("leaves the HTTPS redirect check unverified for locationless HTTP %i", async (status) => {
    safeFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://example.com/") {
        return {
          ok: true,
          finalUrl: url,
          status: 200,
          headers: new Headers({ "content-type": "text/html" }),
          responseMs: 20,
          redirectCount: 0,
          body: "<html><body>Example</body></html>",
        };
      }
      if (url === "http://example.com") {
        return {
          ok: true,
          finalUrl: url,
          status,
          headers: new Headers(),
          responseMs: 20,
          redirectCount: 0,
        };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers(),
        responseMs: 20,
        redirectCount: 0,
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.httpsRedirects).toBeNull();
    expect(result.topFindings).not.toContainEqual(expect.objectContaining({ ruleId: "security.no-http-redirect" }));
  });

  it.each([404, 500, 503])("leaves the HTTPS redirect check unverified for HTTP %i", async (status) => {
    safeFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://example.com/") {
        return {
          ok: true,
          finalUrl: url,
          status: 200,
          headers: new Headers({ "content-type": "text/html" }),
          responseMs: 20,
          redirectCount: 0,
          body: "<html><body>Example</body></html>",
        };
      }
      if (url === "http://example.com") {
        return {
          ok: true,
          finalUrl: url,
          status,
          headers: new Headers(),
          responseMs: 20,
          redirectCount: 0,
        };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers(),
        responseMs: 20,
        redirectCount: 0,
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.httpsRedirects).toBeNull();
    expect(result.score.reliabilityDeduction).toBe(0);
    expect(result.topFindings).not.toContainEqual(expect.objectContaining({ ruleId: "security.no-http-redirect" }));
  });

  it("recognizes a redirect whose destination uses HTTPS", async () => {
    safeFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://example.com/") {
        return {
          ok: true,
          finalUrl: url,
          status: 200,
          headers: new Headers({ "content-type": "text/html" }),
          responseMs: 20,
          redirectCount: 0,
          body: "<html><body>Example</body></html>",
        };
      }
      if (url === "http://example.com") {
        return {
          ok: false,
          errorCode: "too_many_redirects",
          reason: "Redirect limit reached.",
          redirectUrl: "https://example.com/sign-in",
        };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers(),
        responseMs: 20,
        redirectCount: 0,
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.httpsRedirects).toBe(true);
    expect(result.topFindings).not.toContainEqual(expect.objectContaining({ ruleId: "security.no-http-redirect" }));
  });

  it("rejects a 200 non-HTML homepage without scanning it", async () => {
    vi.mocked(isHtmlDocument).mockReturnValue(false);
    safeFetchMock.mockResolvedValue({
      ok: true,
      finalUrl: "https://example.com/",
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      responseMs: 20,
      redirectCount: 0,
      body: "{}",
      contentLength: 2,
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score.overall).toBe(0);
    expect(result.sitemapFound).toBeNull();
    expect(result.score.categories).toEqual({ security: null, accessibility: null, performance: null, seo: null });
    expect(result.topFindings[0]?.ruleId).toBe("reliability.homepage-unavailable");
    expect(result.topFindings[0]?.description).toBe("The homepage returned application/json instead of an HTML page; the site could not be assessed.");
    expect(result.topFindings[0]?.recommendation).toBe("Serve an HTML page at the homepage, then run the scan again.");
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not score a markup-only HTML shell with no page content", async () => {
    vi.mocked(hasMeaningfulHtmlContent).mockReturnValue(false);
    safeFetchMock.mockResolvedValue({
      ok: true,
      finalUrl: "https://example.com/",
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      responseMs: 20,
      redirectCount: 0,
      body: "<!doctype html><html><head><title>Example</title><meta name=description content=site></head><body><div id=root></div><script>hydrate()</script></body></html>",
      contentLength: 148,
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score.overall).toBe(0);
    expect(result.score.categories).toEqual({ security: null, accessibility: null, performance: null, seo: null });
    expect(result.topFindings[0]).toMatchObject({
      ruleId: "reliability.homepage-unavailable",
      description: "The homepage returned HTTP 200 without page content; the site could not be assessed.",
    });
    expect(extractPageMeta).not.toHaveBeenCalled();
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not assign a score when media-only content cannot be verified without rendering", async () => {
    vi.mocked(hasMeaningfulHtmlContent).mockReturnValue(false);
    vi.mocked(hasUnverifiedMediaContent).mockReturnValue(true);
    safeFetchMock.mockResolvedValue({
      ok: true,
      finalUrl: "https://example.com/",
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      responseMs: 20,
      redirectCount: 0,
      body: '<html><body><img src="/unverified.webp"></body></html>',
      contentLength: 64,
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score.overall).toBeNull();
    expect(result.score.categories).toEqual({ security: null, accessibility: null, performance: null, seo: null });
    expect(result.topFindings[0]).toMatchObject({
      ruleId: "reliability.content-unverified",
      title: "Quick scan could not verify page content",
      description: expect.stringContaining("No score was calculated."),
    });
    expect(extractPageMeta).not.toHaveBeenCalled();
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("scores a short generic error page returned with HTTP 200 as unavailable", async () => {
    vi.mocked(isGenericErrorHtmlDocument).mockReturnValue(true);
    safeFetchMock.mockResolvedValue({
      ok: true,
      finalUrl: "https://example.com/",
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      responseMs: 20,
      redirectCount: 0,
      body: "<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>",
      contentLength: 96,
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score.overall).toBe(0);
    expect(result.score.categories).toEqual({ security: null, accessibility: null, performance: null, seo: null });
    expect(result.topFindings[0]).toMatchObject({
      ruleId: "reliability.homepage-unavailable",
      title: "Homepage response matches a server-error pattern",
      description: expect.stringContaining("sets the score to 0"),
    });
    expect(extractPageMeta).not.toHaveBeenCalled();
  });

  it("scores a long HTTP 200 outage page as unavailable when its title is generic", async () => {
    const actualHtml = await vi.importActual<typeof import("../../src/lib/html")>("../../src/lib/html");
    vi.mocked(isGenericErrorHtmlDocument).mockImplementation(actualHtml.isGenericErrorHtmlDocument);
    const body = `<html><head><title>Internal Server Error</title></head><body><h1>Internal Server Error</h1><pre>${"Traceback (most recent call last): File /srv/app.py, line 42. ".repeat(12)}</pre></body></html>`;
    safeFetchMock.mockResolvedValue({
      ok: true,
      finalUrl: "https://example.com/",
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      responseMs: 20,
      redirectCount: 0,
      body,
      contentLength: body.length,
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score.overall).toBe(0);
    expect(result.score.categories).toEqual({ security: null, accessibility: null, performance: null, seo: null });
    expect(result.topFindings[0]).toMatchObject({
      ruleId: "reliability.homepage-unavailable",
      title: "Homepage response matches a server-error pattern",
    });
    expect(extractPageMeta).not.toHaveBeenCalled();
  });

  it.each([
    { status: 200, description: "The homepage returned HTTP 200 without page content; the site could not be assessed." },
    { status: 204, description: "The homepage returned HTTP 204 without page content; the site could not be assessed." },
    { status: 205, description: "The homepage returned HTTP 205 without page content; the site could not be assessed." },
    { status: 304, description: "The homepage returned HTTP 304 without page content; the site could not be assessed." },
  ])("scores an empty HTTP $status homepage as zero", async ({ status, description }) => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      finalUrl: "https://example.com/",
      status,
      headers: new Headers({ "content-type": "text/html" }),
      responseMs: 20,
      redirectCount: 0,
      body: "",
      contentLength: 0,
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score.overall).toBe(0);
    expect(result.score.categories).toEqual({ security: null, accessibility: null, performance: null, seo: null });
    expect(result.topFindings[0]).toMatchObject({
      ruleId: "reliability.homepage-unavailable",
      title: "Homepage could not be assessed",
      description,
      recommendation: "Serve page content at the homepage, then run the scan again.",
    });
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("charges for up to five distinct broken link targets", async () => {
    const links = Array.from({ length: 8 }, (_, index) => `https://example.com/broken/${index}`);
    vi.mocked(extractPageMeta).mockResolvedValue({
      title: "Example",
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links,
      hasViewportMeta: false,
    });
    safeFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://example.com/") {
        return {
          ok: true,
          finalUrl: url,
          status: 200,
          headers: new Headers({ "content-type": "text/html" }),
          responseMs: 20,
          redirectCount: 0,
          body: "<html><head><title>Example</title></head><body></body></html>",
          contentLength: 60,
        };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 404,
        headers: new Headers({ "content-type": "text/plain" }),
        responseMs: 20,
        redirectCount: 0,
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checkedLinks).toBe(8);
    expect(result.brokenLinks).toBe(8);
    expect(result.score.reliabilityDeduction).toBe(75);
    expect(result.topFindings).toContainEqual(expect.objectContaining({
      ruleId: "reliability.broken-link",
      severity: "high",
    }));
  });

  it.each([
    { status: 404, severity: "high", deduction: 15 },
    { status: 503, severity: "critical", deduction: 25 },
  ])("scores linked HTTP $status as $severity reliability", async ({ status, severity, deduction }) => {
    const link = "https://example.com/failed";
    vi.mocked(extractPageMeta).mockResolvedValue({
      title: "Example",
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: [link],
      hasViewportMeta: false,
    });
    safeFetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === link) {
        return {
          ok: true,
          finalUrl: url,
          status,
          headers: new Headers(),
          responseMs: 20,
          redirectCount: 0,
        };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        responseMs: 20,
        redirectCount: 0,
        body: url === "https://example.com/" ? "<html><body>Example</body></html>" : undefined,
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brokenLinks).toBe(1);
    expect(result.score.reliabilityDeduction).toBe(deduction);
    expect(result.topFindings).toContainEqual(expect.objectContaining({
      ruleId: "reliability.broken-link",
      severity,
    }));
  });

  it.each([403, 404, 405, 500])("confirms a non-success HEAD response (%i) with GET", async (headStatus) => {
    const link = "https://example.com/about";
    vi.mocked(extractPageMeta).mockResolvedValue({
      title: "Example",
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: [link],
      hasViewportMeta: false,
    });
    safeFetchMock.mockImplementation(async (input, options) => {
      const url = String(input);
      if (url === link && options?.method === "HEAD") {
        return {
          ok: true,
          finalUrl: url,
          status: headStatus,
          headers: new Headers(),
          responseMs: 20,
          redirectCount: 0,
        };
      }
      if (url === link && options?.method === "GET") {
        return {
          ok: true,
          finalUrl: url,
          status: 200,
          headers: new Headers({ "content-type": "text/html" }),
          responseMs: 20,
          redirectCount: 0,
        };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        responseMs: 20,
        redirectCount: 0,
        body: url === "https://example.com/" ? "<html><body>Example</body></html>" : undefined,
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checkedLinks).toBe(1);
    expect(result.brokenLinks).toBe(0);
    expect(result.score.reliabilityDeduction).toBe(0);
    expect(safeFetchMock).toHaveBeenCalledWith(link, expect.objectContaining({ method: "HEAD" }));
    expect(safeFetchMock).toHaveBeenCalledWith(link, expect.objectContaining({ method: "GET" }));
  });

  it.each(["dns_or_network", "tls", "timeout"] as const)("confirms a HEAD %s transport failure with GET", async (errorCode) => {
    const link = "https://example.com/about";
    vi.mocked(extractPageMeta).mockResolvedValue({
      title: "Example",
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: [link],
      hasViewportMeta: false,
    });
    safeFetchMock.mockImplementation(async (input, options) => {
      const url = String(input);
      if (url === link && options?.method === "HEAD") {
        return { ok: false, errorCode, reason: "HEAD transport failure" };
      }
      if (url === link && options?.method === "GET") {
        return {
          ok: true,
          finalUrl: url,
          status: 200,
          headers: new Headers({ "content-type": "text/html" }),
          responseMs: 20,
          redirectCount: 0,
        };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        responseMs: 20,
        redirectCount: 0,
        body: url === "https://example.com/" ? "<html><body>Example</body></html>" : undefined,
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checkedLinks).toBe(1);
    expect(result.brokenLinks).toBe(0);
    expect(result.score.reliabilityDeduction).toBe(0);
    const linkMethods = safeFetchMock.mock.calls
      .filter(([input]) => String(input) === link)
      .map(([, options]) => options?.method);
    expect(linkMethods).toEqual(["HEAD", "GET"]);
  });

  it("does not retry a linked resource after a redirect safety block", async () => {
    const link = "https://example.com/about";
    vi.mocked(extractPageMeta).mockResolvedValue({
      title: "Example",
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: [link],
      hasViewportMeta: false,
    });
    safeFetchMock.mockImplementation(async (input, options) => {
      const url = String(input);
      if (url === link && options?.method === "HEAD") {
        return { ok: false, errorCode: "blocked_redirect", reason: "Redirect blocked by safety policy." };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        responseMs: 20,
        redirectCount: 0,
        body: url === "https://example.com/" ? "<html><body>Example</body></html>" : undefined,
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checkedLinks).toBe(1);
    expect(safeFetchMock.mock.calls
      .filter(([input]) => String(input) === link)
      .map(([, options]) => options?.method)).toEqual(["HEAD"]);
  });

  it("does not retry a linked resource after its HEAD request is rate limited", async () => {
    const link = "https://example.com/about";
    vi.mocked(extractPageMeta).mockResolvedValue({
      title: "Example",
      metaDescription: null,
      canonical: null,
      htmlLang: null,
      robotsMeta: null,
      h1Count: 0,
      imagesMissingAlt: 0,
      imageCount: 0,
      links: [link],
      hasViewportMeta: false,
    });
    safeFetchMock.mockImplementation(async (input, options) => {
      const url = String(input);
      if (url === link) {
        return {
          ok: true,
          finalUrl: url,
          status: options?.method === "HEAD" ? 429 : 200,
          headers: new Headers(),
          responseMs: 20,
          redirectCount: 0,
        };
      }
      return {
        ok: true,
        finalUrl: url,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        responseMs: 20,
        redirectCount: 0,
        body: url === "https://example.com/" ? "<html><body>Example</body></html>" : undefined,
      };
    });

    const result = await quickScan("https://example.com/", "Zenith");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checkedLinks).toBe(1);
    expect(result.brokenLinks).toBe(1);
    expect(safeFetchMock).toHaveBeenCalledWith(link, expect.objectContaining({ method: "HEAD" }));
    expect(safeFetchMock).not.toHaveBeenCalledWith(link, expect.objectContaining({ method: "GET" }));
  });
});
