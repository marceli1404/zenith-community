import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  first: vi.fn(),
  run: vi.fn(),
  newId: vi.fn(() => "generated-id"),
  now: vi.fn(() => 123),
  crawlSite: vi.fn(),
  runBrowserAnalysis: vi.fn(),
  resolveAccess: vi.fn(async () => ({ plan: "community" as const })),
  enqueueEmail: vi.fn(),
}));

vi.mock("../../src/db", () => mocks);
vi.mock("../../src/audit/crawler", () => ({ crawlSite: mocks.crawlSite }));
vi.mock("../../src/audit/browser", () => ({ runBrowserAnalysis: mocks.runBrowserAnalysis }));
vi.mock("../../src/lib/access", () => ({ resolveAccess: mocks.resolveAccess }));
vi.mock("../../src/lib/email", () => ({ enqueueEmail: mocks.enqueueEmail }));

import type { AuditJob, Bindings } from "../../src/env";
import { processAuditJob } from "../../src/audit/pipeline";

const jobRow = {
  id: "job-1",
  user_id: "user-1",
  site_id: null,
  target_origin: "https://example.com",
  status: "failed",
  attempts: 1,
};

function testEnv(batch: () => Promise<unknown> = async () => undefined): Bindings {
  const db = {
    prepare: vi.fn(() => ({ bind: vi.fn(() => ({})) })),
    batch: vi.fn(batch),
  };
  return { DB: db } as unknown as Bindings;
}

describe("audit queue idempotency", () => {
  beforeEach(() => {
    mocks.first.mockReset();
    mocks.run.mockReset();
    mocks.crawlSite.mockReset();
    mocks.runBrowserAnalysis.mockReset();
    mocks.enqueueEmail.mockReset();
  });

  it("recovers a saved result before starting another crawl", async () => {
    mocks.first
      .mockResolvedValueOnce(jobRow)
      .mockResolvedValueOnce({ id: "result-1" });
    const env = testEnv();

    await processAuditJob(env, { type: "audit", auditJobId: "job-1" } as AuditJob);

    expect(mocks.crawlSite).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[0]?.[1]).toContain("status = 'completed'");
  });

  it("treats a concurrently committed result as success after a duplicate insert", async () => {
    mocks.first
      .mockResolvedValueOnce(jobRow)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "result-1" });
    mocks.crawlSite.mockResolvedValue({
      pages: [], findings: [], brokenLinks: 0, homepageFailure: null, robotsBlock: null, unsafePathBlock: null,
    });
    mocks.runBrowserAnalysis.mockResolvedValue(null);
    const env = testEnv(async () => { throw new Error("UNIQUE constraint failed"); });

    await processAuditJob(env, { type: "audit", auditJobId: "job-1" } as AuditJob);

    expect(mocks.crawlSite).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls.some(([, sql]) => String(sql).includes("status = 'failed'"))).toBe(false);
    expect(mocks.run.mock.calls.at(-1)?.[1]).toContain("status = 'completed'");
  });

  it("saves robots-blocked audits as unassessed without launching browser checks", async () => {
    mocks.first
      .mockResolvedValueOnce(jobRow)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.crawlSite.mockResolvedValue({
      pages: [],
      findings: [],
      brokenLinks: 0,
      homepageFailure: null,
      robotsBlock: { kind: "disallowed", path: "/" },
      unsafePathBlock: null,
    });
    const env = testEnv();

    await processAuditJob(env, { type: "audit", auditJobId: "job-1" } as AuditJob);

    expect(mocks.runBrowserAnalysis).not.toHaveBeenCalled();
    expect(mocks.run.mock.calls.at(-1)?.[1]).toContain("status = 'completed'");
  });

  it("treats a generic HTTP 200 server-error homepage as unavailable", async () => {
    mocks.first.mockResolvedValueOnce(jobRow).mockResolvedValueOnce(null);
    mocks.crawlSite.mockResolvedValue({
      pages: [],
      findings: [],
      brokenLinks: 0,
      assessmentTruncatedUrls: [],
      homepageFailure: { kind: "generic_error_page", status: 200 },
      robotsBlock: null,
      unsafePathBlock: null,
    });
    const prepared: Array<{ sql: string; params: unknown[] }> = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return { bind: (...params: unknown[]) => { prepared.push({ sql, params }); return { sql, params }; } };
        },
        batch: vi.fn(async () => []),
      },
    } as unknown as Bindings;

    await processAuditJob(env, { type: "audit", auditJobId: "job-1" } as AuditJob);

    const resultInsert = prepared.find((statement) => statement.sql.includes("INSERT INTO audit_results"));
    expect(mocks.runBrowserAnalysis).not.toHaveBeenCalled();
    expect(resultInsert?.params[3]).toBe(0);
    expect(resultInsert?.params[8]).toBe(0);
    expect(prepared.some((statement) => statement.sql.includes("INSERT INTO findings")
      && statement.params[5] === "reliability.homepage-unavailable")).toBe(true);
  });

  it("does not publish an overall score when any crawled response was truncated", async () => {
    mocks.first.mockResolvedValueOnce(jobRow).mockResolvedValueOnce(null);
    mocks.crawlSite.mockResolvedValue({
      pages: [],
      findings: [],
      brokenLinks: 0,
      assessmentTruncatedUrls: ["https://example.com/large"],
      homepageFailure: null,
      robotsBlock: null,
      unsafePathBlock: null,
    });
    mocks.runBrowserAnalysis.mockResolvedValue(null);
    const prepared: Array<{ sql: string; params: unknown[] }> = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return { bind: (...params: unknown[]) => { prepared.push({ sql, params }); return { sql, params }; } };
        },
        batch: vi.fn(async () => []),
      },
    } as unknown as Bindings;

    await processAuditJob(env, { type: "audit", auditJobId: "job-1" } as AuditJob);

    const resultInsert = prepared.find((statement) => statement.sql.includes("INSERT INTO audit_results"));
    expect(resultInsert?.params[3]).toBe(0);
    expect(resultInsert?.params[8]).toBe(0);
    expect(resultInsert?.params[9]).toBeNull();
    expect(prepared.some((statement) => statement.sql.includes("INSERT INTO findings")
      && statement.params[5] === "reliability.analysis-truncated")).toBe(true);
  });

  it("persists unsafe-redirect audits as unassessed without browser analysis", async () => {
    mocks.first
      .mockResolvedValueOnce(jobRow)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.crawlSite.mockResolvedValue({
      pages: [],
      findings: [],
      brokenLinks: 0,
      homepageFailure: null,
      robotsBlock: null,
      unsafePathBlock: { kind: "unsafe_path", path: "/logout", origin: "https://example.com" },
    });
    mocks.runBrowserAnalysis.mockResolvedValue(null);
    const prepared: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return { bind: (...params: unknown[]) => { prepared.push({ sql, params }); return { sql, params }; } };
      },
      batch: vi.fn(async () => []),
    };
    const env = { DB: db } as unknown as Bindings;

    await processAuditJob(env, { type: "audit", auditJobId: "job-1" } as AuditJob);

    const resultInsert = prepared.find((statement) => statement.sql.includes("INSERT INTO audit_results"));
    expect(resultInsert?.params[8]).toBe(0);
    expect(resultInsert?.params[9]).toBeNull();
    expect(mocks.runBrowserAnalysis).not.toHaveBeenCalled();
  });

  it("persists a homepage transport failure as a strict zero with its diagnosis evidence", async () => {
    mocks.first
      .mockResolvedValueOnce(jobRow)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.crawlSite.mockResolvedValue({
      pages: [],
      findings: [],
      brokenLinks: 1,
      homepageFailure: { kind: "request_failed", errorCode: "timeout" },
      robotsBlock: null,
      unsafePathBlock: null,
    });
    const prepared: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return { bind: (...params: unknown[]) => { prepared.push({ sql, params }); return { sql, params }; } };
      },
      batch: vi.fn(async () => []),
    };
    const env = { DB: db } as unknown as Bindings;

    await processAuditJob(env, { type: "audit", auditJobId: "job-1" } as AuditJob);

    const resultInsert = prepared.find((statement) => statement.sql.includes("INSERT INTO audit_results"));
    expect(resultInsert?.params[3]).toBe(0);
    expect(resultInsert?.params[8]).toBe(0);
    expect(resultInsert?.params[9]).toBe(0);

    const homepageFinding = prepared.find((statement) => statement.sql.includes("INSERT INTO findings"));
    expect(homepageFinding?.params[5]).toBe("reliability.homepage-unavailable");
    expect(JSON.parse(String(homepageFinding?.params[8]))).toEqual({ kind: "request_failed", errorCode: "timeout" });
    expect(mocks.runBrowserAnalysis).not.toHaveBeenCalled();
  });

  it.each([
    ["HTTP 204", 204, false, false, "browser_empty_response"],
    ["HTTP 205", 205, false, false, "browser_empty_response"],
    ["HTTP 206", 206, false, false, "browser_partial_content"],
    ["HTTP 304 with cached page", 304, true, false, "browser_not_modified"],
    ["HTTP 503", 503, false, false, "browser_http_error"],
    ["empty HTTP 200", 200, false, false, "browser_empty_render"],
    ["HTTP 200 generic error page", 200, true, true, "browser_generic_error_page"],
    ["missing main response", null, false, false, "browser_response_missing"],
  ] as const)("marks a browser-observed incomplete homepage response (%s) as unavailable and unassessed", async (_label, status, hasRenderedContent, hasGenericErrorPage, kind) => {
    mocks.first
      .mockResolvedValueOnce(jobRow)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.crawlSite.mockResolvedValue({
      pages: [{
        ctx: {
          url: "https://example.com/",
          finalUrl: "https://example.com/",
          statusCode: 200,
          responseMs: 10,
          bytes: 13,
          headers: {},
          meta: { title: "Example", metaDescription: null, canonical: null, htmlLang: null, robotsMeta: null, h1Count: 0, imagesMissingAlt: 0, imageCount: 0, links: [], hasViewportMeta: false },
        },
        findings: [],
        depth: 0,
      }],
      findings: [],
      brokenLinks: 0,
      homepageFailure: null,
      robotsBlock: null,
      unsafePathBlock: null,
    });
    mocks.runBrowserAnalysis.mockResolvedValue({
      mainDocumentStatus: status,
      hasRenderedContent,
      hasGenericErrorPage,
      desktopScreenshotKey: null,
      mobileScreenshotKey: null,
      renderedTitle: null,
      consoleErrors: [],
      perf: { domContentLoadedMs: null, loadEventMs: null, resourceCount: null, transferredBytes: null },
    });
    const prepared: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return { bind: (...params: unknown[]) => { prepared.push({ sql, params }); return { sql, params }; } };
      },
      batch: vi.fn(async () => []),
    };
    const env = { DB: db } as unknown as Bindings;

    await processAuditJob(env, { type: "audit", auditJobId: "job-1" } as AuditJob);

    const resultInsert = prepared.find((statement) => statement.sql.includes("INSERT INTO audit_results"));
    expect(resultInsert?.params[3]).toBe(0);
    expect(resultInsert?.params.slice(4, 8)).toEqual([0, 0, 0, 0]);
    expect(resultInsert?.params[8]).toBe(0);
    expect(resultInsert?.params[9]).toBe(0);
    expect(resultInsert?.params[13]).toBeNull();
    expect(resultInsert?.params[14]).toBeNull();

    const homepageFinding = prepared.find((statement) =>
      statement.sql.includes("INSERT INTO findings") && statement.params[5] === "reliability.homepage-unavailable");
    expect(homepageFinding?.params[3]).toBe("reliability");
    expect(homepageFinding?.params[4]).toBe("critical");
    expect(homepageFinding?.params[6]).toBe("Homepage could not be assessed");
    expect(JSON.parse(String(homepageFinding?.params[8]))).toEqual({
      kind,
      hasRenderedContent,
      ...(hasGenericErrorPage ? { hasGenericErrorPage: true } : {}),
      ...(status === null ? {} : { status }),
    });
    if (hasGenericErrorPage) {
      expect(homepageFinding?.params[9]).toBe("Replace the generic server-error page with the intended homepage, then run the audit again.");
    }
  });

  it("keeps a rendered HTTP 200 homepage assessed", async () => {
    mocks.first
      .mockResolvedValueOnce(jobRow)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.crawlSite.mockResolvedValue({
      pages: [{
        ctx: {
          url: "https://example.com/",
          finalUrl: "https://example.com/",
          statusCode: 200,
          responseMs: 10,
          bytes: 13,
          headers: {},
          meta: { title: "Example", metaDescription: null, canonical: null, htmlLang: null, robotsMeta: null, h1Count: 1, imagesMissingAlt: 0, imageCount: 0, links: [], hasViewportMeta: true },
        },
        findings: [],
        depth: 0,
      }],
      findings: [],
      brokenLinks: 0,
      homepageFailure: null,
      robotsBlock: null,
      unsafePathBlock: null,
    });
    mocks.runBrowserAnalysis.mockResolvedValue({
      mainDocumentStatus: 200,
      hasRenderedContent: true,
      hasGenericErrorPage: false,
      desktopScreenshotKey: "desktop.webp",
      mobileScreenshotKey: "mobile.webp",
      renderedTitle: "Example",
      consoleErrors: [],
      perf: { domContentLoadedMs: 100, loadEventMs: 200, resourceCount: 1, transferredBytes: 100 },
    });
    const prepared: Array<{ sql: string; params: unknown[] }> = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return { bind: (...params: unknown[]) => { prepared.push({ sql, params }); return { sql, params }; } };
        },
        batch: vi.fn(async () => []),
      },
    } as unknown as Bindings;

    await processAuditJob(env, { type: "audit", auditJobId: "job-1" } as AuditJob);

    const resultInsert = prepared.find((statement) => statement.sql.includes("INSERT INTO audit_results"));
    expect(resultInsert?.params[3]).toBeGreaterThan(0);
    expect(resultInsert?.params[8]).toBe(1);
    expect(prepared.some((statement) => statement.sql.includes("INSERT INTO findings") && statement.params[5] === "reliability.homepage-unavailable")).toBe(false);
  });

  it("starts browser analysis at the HTTP crawler's validated homepage redirect target", async () => {
    mocks.first
      .mockResolvedValueOnce(jobRow)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.crawlSite.mockResolvedValue({
      pages: [{
        ctx: {
          url: "http://example.com",
          finalUrl: "https://www.example.com/",
          statusCode: 200,
          responseMs: 10,
          bytes: 13,
          headers: {},
          meta: { title: null, metaDescription: null, canonical: null, htmlLang: null, robotsMeta: null, h1Count: 0, imagesMissingAlt: 0, imageCount: 0, links: [], hasViewportMeta: false },
        },
        findings: [],
        depth: 0,
      }],
      findings: [],
      brokenLinks: 0,
      homepageFailure: null,
      robotsBlock: null,
      unsafePathBlock: null,
    });
    mocks.runBrowserAnalysis.mockResolvedValue(null);
    const env = testEnv();

    await processAuditJob(env, { type: "audit", auditJobId: "job-1" } as AuditJob);

    expect(mocks.runBrowserAnalysis).toHaveBeenCalledWith(env, expect.objectContaining({
      origin: "https://www.example.com/",
    }));
  });

  it("persists a browser-analysis failure as unassessed instead of a high partial score", async () => {
    mocks.first
      .mockResolvedValueOnce(jobRow)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.crawlSite.mockResolvedValue({
      pages: [{
        ctx: {
          url: "https://example.com/",
          finalUrl: "https://example.com/",
          statusCode: 200,
          responseMs: 10,
          bytes: 13,
          headers: {},
          meta: { title: "Example", metaDescription: null, canonical: null, htmlLang: null, robotsMeta: null, h1Count: 1, imagesMissingAlt: 0, imageCount: 0, links: [], hasViewportMeta: true },
        },
        findings: [],
        depth: 0,
      }],
      findings: [],
      brokenLinks: 0,
      homepageFailure: null,
      robotsBlock: null,
      unsafePathBlock: null,
    });
    mocks.runBrowserAnalysis.mockResolvedValue(null);
    const prepared: Array<{ sql: string; params: unknown[] }> = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return { bind: (...params: unknown[]) => { prepared.push({ sql, params }); return { sql, params }; } };
        },
        batch: vi.fn(async () => []),
      },
    } as unknown as Bindings;

    await processAuditJob(env, { type: "audit", auditJobId: "job-1" } as AuditJob);

    const resultInsert = prepared.find((statement) => statement.sql.includes("INSERT INTO audit_results"));
    expect(resultInsert?.params[3]).toBe(0); // unassessed sentinel; read paths display null
    expect(resultInsert?.params.slice(4, 8)).toEqual([0, 0, 0, 0]);
    expect(resultInsert?.params[8]).toBe(0);
    expect(resultInsert?.params[9]).toBeNull();
    expect(prepared.some((statement) => statement.sql.includes("INSERT INTO findings")
      && statement.params[5] === "reliability.browser-analysis-unavailable")).toBe(true);
  });
});
