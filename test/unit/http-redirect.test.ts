import { afterEach, describe, expect, it, vi } from "vitest";
import { safeFetch } from "../../src/lib/http";
import { loadRobots } from "../../src/lib/robots";

describe("safeFetch redirect diagnostics", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects public IP literals before the Worker fetch call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetch("https://8.8.8.8/", { method: "HEAD" });

    expect(result).toMatchObject({
      ok: false,
      errorCode: "blocked_target",
      ssrfCode: "ip_literal_not_supported",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains when a redirect points to a public IP literal", async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://8.8.8.8/" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetch("https://example.com/", { method: "HEAD" });

    expect(result).toMatchObject({
      ok: false,
      errorCode: "blocked_redirect",
      ssrfCode: "ip_literal_not_supported",
    });
    if (!result.ok) expect(result.reason).toContain("cannot fetch URLs that use an IP address directly");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("checks a redirect policy before requesting the next hop", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/private" } }))
      .mockResolvedValueOnce(new Response("allowed"));
    vi.stubGlobal("fetch", fetchMock);
    const redirectPolicy = vi.fn(async () => ({
      allowed: false as const,
      code: "robots_disallowed",
      reason: "robots.txt disallows this path.",
    }));

    const result = await safeFetch("https://example.com/", { method: "GET", redirectPolicy });

    expect(result).toMatchObject({
      ok: false,
      errorCode: "redirect_policy",
      policyCode: "robots_disallowed",
      redirectUrl: "https://example.com/private",
    });
    expect(redirectPolicy).toHaveBeenCalledWith("https://example.com/private", expect.any(Number));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks a state-changing robots.txt redirect before requesting its destination", async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "/unsubscribe?token=secret" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadRobots("https://example.com");

    expect(result).toMatchObject({
      found: false,
      block: { kind: "unreachable", errorCode: "redirect_policy" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows redirects that pass the redirect policy", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/public" } }))
      .mockResolvedValueOnce(new Response("allowed"));
    vi.stubGlobal("fetch", fetchMock);
    const redirectPolicy = vi.fn(async () => ({ allowed: true as const }));

    const result = await safeFetch("https://example.com/", { method: "GET", redirectPolicy });

    expect(result).toMatchObject({ ok: true, finalUrl: "https://example.com/public", redirectCount: 1 });
    expect(redirectPolicy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not follow a 304 response even when it has a Location header", async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 304,
      headers: { location: "/different-page" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetch("https://example.com/", { readBody: true });

    expect(result).toMatchObject({
      ok: true,
      finalUrl: "https://example.com/",
      status: 304,
      redirectCount: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a locationless 302 response so callers can treat it as unverified", async () => {
    const fetchMock = vi.fn(async () => new Response("Sign in to continue", {
      status: 302,
      headers: { "content-type": "text/html" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetch("https://example.com/", { readBody: true });

    expect(result).toMatchObject({
      ok: true,
      finalUrl: "https://example.com/",
      status: 302,
      redirectCount: 0,
      body: "Sign in to continue",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { location: "/sign-in", expected: "http://example.com/sign-in" },
    { location: "https://example.com/sign-in", expected: "https://example.com/sign-in" },
  ])("returns the resolved redirect destination without following it", async ({ location, expected }) => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetch("http://example.com", { maxRedirects: 0, method: "HEAD" });

    expect(result).toMatchObject({
      ok: false,
      errorCode: "too_many_redirects",
      redirectUrl: expected,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
