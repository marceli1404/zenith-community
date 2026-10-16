import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  all: vi.fn(),
  first: vi.fn(),
  now: vi.fn(),
  run: vi.fn(),
  renderPdf: vi.fn(),
  generateReportHtml: vi.fn(),
}));

vi.mock("../../src/db", () => mocks);
vi.mock("../../src/report/pdf", () => ({ renderPdf: mocks.renderPdf }));
vi.mock("../../src/report/html", () => ({ generateReportHtml: mocks.generateReportHtml }));
vi.mock("../../src/middleware", () => ({
  requireAuth: async (c: { set: (name: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set("userId", "user-1");
    c.set("config", { appName: "Zenith Community" });
    await next();
  },
}));

import { Hono } from "hono";
import reports from "../../src/routes/reports";

function makeApp() {
  const app = new Hono();
  app.route("/api/reports", reports);
  return app;
}

function makeEnv(bucket: { put: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> }) {
  return { DB: {}, REPORTS_BUCKET: bucket } as never;
}

describe("PDF report generation route", () => {
  const bucket = { put: vi.fn(), get: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    bucket.put.mockResolvedValue(undefined);
    mocks.all.mockResolvedValue([]);
    mocks.now.mockReturnValue(Date.UTC(2026, 9, 16));
    mocks.run.mockResolvedValue(undefined);
    mocks.generateReportHtml.mockReturnValue("<html>report</html>");
    mocks.renderPdf.mockResolvedValue(null);
    mocks.first.mockImplementation(async (_db: unknown, sql: string) => {
      if (sql.includes("JOIN audit_jobs")) {
        return { screenshot_key: null, mobile_screenshot_key: null, report_key: null, user_id: "user-1" };
      }
      if (sql.includes("normalized_origin")) return { normalized_origin: "https://example.test" };
      return {
        overall_score: 85,
        performance_score: 80,
        accessibility_score: 90,
        seo_score: 80,
        security_score: 90,
        categories_assessed: 4,
        reliability_deduction: 0,
        page_count: 1,
        broken_link_count: 0,
        site_id: "site-1",
      };
    });
  });

  it("returns 502 and does not persist when PDF rendering fails", async () => {
    const response = await makeApp().request(
      "/api/reports/pdf/result-1/generate",
      { method: "POST" },
      makeEnv(bucket),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Report generation failed. Please try again." });
    expect(mocks.renderPdf).toHaveBeenCalledWith(expect.anything(), "<html>report</html>");
    expect(bucket.put).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("stores a completed PDF under the authenticated user's private key", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70]);
    mocks.renderPdf.mockResolvedValue(pdf);

    const response = await makeApp().request(
      "/api/reports/pdf/result-1/generate",
      { method: "POST" },
      makeEnv(bucket),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, resultId: "result-1" });
    expect(bucket.put).toHaveBeenCalledWith(
      "users/user-1/reports/result-1.pdf",
      pdf,
      { httpMetadata: { contentType: "application/pdf" } },
    );
    expect(mocks.run).toHaveBeenCalledWith(
      {},
      "UPDATE audit_results SET report_key = ? WHERE id = ?",
      "users/user-1/reports/result-1.pdf",
      "result-1",
    );
  });

  it("does not render when the audit result no longer exists", async () => {
    mocks.first.mockImplementation(async (_db: unknown, sql: string) => {
      if (sql.includes("JOIN audit_jobs")) {
        return { screenshot_key: null, mobile_screenshot_key: null, report_key: null, user_id: "user-1" };
      }
      return null;
    });

    const response = await makeApp().request(
      "/api/reports/pdf/result-1/generate",
      { method: "POST" },
      makeEnv(bucket),
    );

    expect(response.status).toBe(404);
    expect(mocks.renderPdf).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("does not render or persist a report owned by another user", async () => {
    mocks.first.mockResolvedValueOnce({
      screenshot_key: null,
      mobile_screenshot_key: null,
      report_key: null,
      user_id: "another-user",
    });

    const response = await makeApp().request(
      "/api/reports/pdf/result-1/generate",
      { method: "POST" },
      makeEnv(bucket),
    );

    expect(response.status).toBe(404);
    expect(mocks.renderPdf).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
