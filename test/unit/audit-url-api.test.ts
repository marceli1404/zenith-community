import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ all: vi.fn(), first: vi.fn() }));

vi.mock("../../src/db", () => ({ ...mocks, run: vi.fn(), batch: vi.fn(), newId: vi.fn(), now: vi.fn() }));
vi.mock("../../src/middleware", () => ({
  requireAuth: async (c: { set: (name: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set("userId", "user-1");
    await next();
  },
  clientIp: () => "127.0.0.1",
}));

import { Hono } from "hono";
import audits from "../../src/routes/audits";
import dashboard from "../../src/routes/dashboard";

describe("audit detail URL privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.first.mockImplementation(async (_db: unknown, sql: string) => {
      if (sql.includes("FROM audit_jobs")) return {
        id: "job-1", user_id: "user-1", status: "completed", queued_at: 1, completed_at: 2,
        error_code: null, site_id: null, target_origin: "https://example.test/verify/Ab12Cd34?token=private",
      };
      return {
        id: "result-1", overall_score: 80, performance_score: 80, accessibility_score: 80,
        seo_score: 80, security_score: 80, categories_assessed: 4, reliability_deduction: 0,
        page_count: 1, broken_link_count: 0, site_id: null,
      };
    });
    mocks.all.mockResolvedValue([{
      page_url: "https://example.test/reset/Ab12Cd34Ef56Gh78?token=private",
      category: "security", severity: "medium", rule_id: "security.example", title: "Example finding",
      description: "Example description", evidence_json: JSON.stringify({ finalUrl: "https://example.test/invite/secret?key=private" }),
      recommendation: "Example recommendation",
    }]);
  });

  it("redacts legacy page URLs and evidence before returning audit findings", async () => {
    const app = new Hono();
    app.route("/api/audits", audits);

    const response = await app.request("/api/audits/job-1", {}, { DB: {} } as never);
    const body = await response.json() as { job: { target_origin: string }; findings: Array<{ affectedUrls: string[]; evidence: unknown[] }> };

    expect(body.job.target_origin).toBe("https://example.test/[redacted]/[redacted]");
    expect(body.findings[0]?.affectedUrls).toContain("https://example.test/[redacted]/[redacted]");
    expect(JSON.stringify(body)).not.toContain("token=private");
    expect(JSON.stringify(body)).not.toContain("Ab12Cd34Ef56Gh78");
  });

  it("redacts legacy target URLs in dashboard audit summaries", async () => {
    mocks.first
      .mockResolvedValueOnce({ total: 1, verified: 1 })
      .mockResolvedValueOnce({ n: 0 })
      .mockResolvedValueOnce({ ok: 1, total: 1 })
      .mockResolvedValueOnce({ avg: 80 });
    mocks.all
      .mockResolvedValueOnce([{ id: "job-1", target_origin: "https://example.test/verify/Ab12Cd34?token=private" }])
      .mockResolvedValueOnce([]);
    const app = new Hono();
    app.route("/api/dashboard", dashboard);

    const response = await app.request("/api/dashboard/overview", {}, { DB: {} } as never);
    const body = await response.json() as { recentAudits: Array<{ target_origin: string }> };

    expect(body.recentAudits[0]?.target_origin).toBe("https://example.test/[redacted]/[redacted]");
    expect(JSON.stringify(body)).not.toContain("token=private");
  });
});
