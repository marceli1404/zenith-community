import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  first: vi.fn(),
  run: vi.fn(),
  newId: vi.fn(() => "audit-1"),
  now: vi.fn(() => 123),
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
import audits from "../../src/routes/audits";

describe("audit queue dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockResolvedValue({ meta: { changes: 1 } });
  });

  it("marks the inserted job failed and returns a retryable error when queue send rejects", async () => {
    const send = vi.fn().mockRejectedValue(new Error("queue unavailable"));
    const app = new Hono();
    app.route("/api/audits", audits);

    const response = await app.request(
      "/api/audits",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      },
      { DB: {}, AUDIT_QUEUE: { send } } as never,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "The audit could not be queued. Please try again.",
      code: "queue_unavailable",
    });
    expect(send).toHaveBeenCalledWith({ type: "audit", auditJobId: "audit-1" });
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(mocks.run.mock.calls[0]?.[1]).toContain("INSERT INTO audit_jobs");
    expect(mocks.run.mock.calls[1]?.[1]).toContain("SET status = 'failed'");
    expect(mocks.run.mock.calls[1]?.[1]).toContain("WHERE id = ? AND status = 'queued'");
    expect(mocks.run.mock.calls[1]?.slice(2)).toEqual(["queue_dispatch_failed", 123, "audit-1"]);
  });

  it("rejects audit creation when the per-user rolling-minute limit is reached", async () => {
    mocks.run.mockResolvedValueOnce({ meta: { changes: 0 } });
    const send = vi.fn();
    const app = new Hono();
    app.route("/api/audits", audits);

    const response = await app.request(
      "/api/audits",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      },
      { DB: {}, AUDIT_QUEUE: { send } } as never,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({
      error: "You've requested several audits recently. Please wait a minute and try again.",
      code: "audit_rate_limited",
    });
    expect(send).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[0]?.[1]).toContain("WHERE (SELECT COUNT(*) FROM audit_jobs");
    expect(mocks.run.mock.calls[0]?.slice(2)).toEqual([
      "audit-1", "user-1", null, "https://example.com", 2, 123,
      "user-1", -59_877, 5,
    ]);
  });
});
