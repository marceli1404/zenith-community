import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ all: vi.fn(), first: vi.fn(), now: vi.fn(() => 456) }));

vi.mock("../../src/db", () => ({ ...mocks, run: vi.fn() }));
vi.mock("../../src/middleware", () => ({
  requireAuth: async (c: { set: (name: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set("userId", "user-1");
    await next();
  },
}));

import { Hono } from "hono";
import account from "../../src/routes/account";

describe("account export URL privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.first.mockResolvedValue({ id: "user-1", name: "Test", email: "test@example.test", createdAt: 1 });
    mocks.all.mockImplementation(async (_db: unknown, sql: string) => {
      if (sql.includes("SELECT * FROM sites")) return [{ id: "site-1", url: "https://example.test/verify/Ab12Cd34Ef56Gh78?token=private" }];
      if (sql.includes("FROM findings")) return [{ page_url: "https://example.test/reset/secret?token=private", evidence_json: JSON.stringify({ href: "/invite/secret?token=private" }) }];
      if (sql.includes("FROM audit_jobs")) return [{ id: "job-1", target_origin: "https://example.test/verify/Ab12Cd34?secret=private" }];
      return [];
    });
  });

  it("redacts site and legacy finding URLs in the exported JSON", async () => {
    const app = new Hono();
    app.route("/api/account", account);

    const response = await app.request("/api/account/export", {}, { DB: {} } as never);
    const body = await response.json() as { sites: Array<{ url: string }>; audits: Array<{ target_origin: string }>; findings: Array<{ page_url: string; evidence_json: string }> };

    expect(body.sites[0]?.url).toBe("https://example.test/[redacted]/[redacted]");
    expect(body.audits[0]?.target_origin).toBe("https://example.test/[redacted]/[redacted]");
    expect(body.findings[0]?.page_url).toBe("https://example.test/[redacted]/[redacted]");
    expect(body.findings[0]?.evidence_json).toContain("https://example.test/[redacted]/[redacted]");
    expect(JSON.stringify(body)).not.toContain("token=private");
  });
});
