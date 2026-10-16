import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  all: vi.fn(),
  batch: vi.fn(),
  first: vi.fn(),
  newId: vi.fn((prefix?: string) => prefix ? `${prefix}-id` : "verify-id"),
  now: vi.fn(() => 123),
  run: vi.fn(),
}));

vi.mock("../../src/db", () => mocks);
vi.mock("../../src/middleware", () => ({
  requireAuth: async (c: { set: (name: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set("userId", "user-1");
    c.set("plan", "community");
    await next();
  },
}));

import { Hono } from "hono";
import sites from "../../src/routes/sites";

const siteRow = {
  id: "site-id",
  user_id: "user-1",
  name: "example.com",
  url: "https://example.com/",
  normalized_origin: "https://example.com",
  status: "unverified",
  verification_method: null,
  verification_token: "verify=verify-id",
  verified_at: null,
  status_page_slug: null,
  status_page_enabled: 0,
  created_at: 123,
  updated_at: 123,
};

function testDb() {
  return {
    prepare: vi.fn((sql: string) => ({
      sql,
      bind: vi.fn((...params: unknown[]) => ({ sql, params })),
    })),
  };
}

describe("site and monitor provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.batch.mockResolvedValue(undefined);
  });

  it("creates the site and its monitor in one transactional D1 batch", async () => {
    mocks.first
      .mockResolvedValueOnce({ n: 0 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...siteRow, url: "https://example.com/reset/Ab12Cd34Ef56Gh78?token=private" });
    const db = testDb();
    const app = new Hono();
    app.route("/api/sites", sites);

    const response = await app.request(
      "/api/sites",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      },
      { DB: db } as never,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ site: { url: "https://example.com/[redacted]/[redacted]" } });
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    const statements = mocks.batch.mock.calls[0]?.[1] as Array<{ sql: string }>;
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toContain("INSERT INTO sites");
    expect((statements[0] as { params: unknown[] }).params[3]).toBe("https://example.com");
    expect(statements[1]?.sql).toContain("INSERT INTO monitors");
    expect(mocks.first).toHaveBeenCalledTimes(3);
  });

  it("does not look up or return a site when the atomic provisioning batch fails", async () => {
    mocks.first.mockResolvedValueOnce({ n: 0 }).mockResolvedValueOnce(null);
    mocks.batch.mockRejectedValue(new Error("monitor insert failed"));
    const db = testDb();
    const app = new Hono();
    app.route("/api/sites", sites);

    const response = await app.request(
      "/api/sites",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      },
      { DB: db } as never,
    );

    expect(response.status).toBe(500);
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.batch.mock.calls[0]?.[1]).toHaveLength(2);
    expect(mocks.first).toHaveBeenCalledTimes(2);
  });
});
