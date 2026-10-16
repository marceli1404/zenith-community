import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  first: vi.fn(),
  newId: vi.fn(() => "generated-id"),
  safeFetch: vi.fn(),
  now: vi.fn(() => 2_000),
}));

vi.mock("../../src/db", () => ({ ...mocks, all: vi.fn(), run: vi.fn() }));
vi.mock("../../src/lib/http", () => ({ safeFetch: mocks.safeFetch }));

import type { Bindings, MonitorJob } from "../../src/env";
import { processMonitorCheck } from "../../src/monitor";

describe("monitor queue idempotency", () => {
  beforeEach(() => {
    mocks.first.mockReset();
    mocks.safeFetch.mockReset();
    mocks.now.mockReturnValue(2_000);
  });

  it("does not fetch or apply counters again after the check row committed", async () => {
    mocks.first.mockResolvedValueOnce({ id: "check-1" });
    const db = { batch: vi.fn() };
    const env = { DB: db } as unknown as Bindings;

    await processMonitorCheck(env, {
      type: "check",
      monitorId: "monitor-1",
      siteId: "site-1",
      checkId: "check-1",
    } as MonitorJob);

    expect(mocks.first).toHaveBeenCalledOnce();
    expect(mocks.safeFetch).not.toHaveBeenCalled();
    expect(db.batch).not.toHaveBeenCalled();
  });

  it("records a locationless redirect response as a failed monitor check", async () => {
    mocks.first
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "site-1", user_id: "user-1", normalized_origin: "https://example.com", name: "Example" })
      .mockResolvedValueOnce({
        id: "monitor-1", site_id: "site-1", interval_seconds: 60,
        consecutive_failures: 1, consecutive_successes: 0, last_checked_at: 1_000,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.safeFetch.mockResolvedValue({
      ok: true,
      finalUrl: "https://example.com/",
      status: 302,
      headers: new Headers(),
      responseMs: 50,
      redirectCount: 0,
    });
    const prepared: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return { bind: (...params: unknown[]) => { prepared.push({ sql, params }); return { sql, params }; } };
      },
      batch: vi.fn(async () => [
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
      ]),
    };
    const env = { DB: db } as unknown as Bindings;

    await processMonitorCheck(env, {
      type: "check", monitorId: "monitor-1", siteId: "site-1", checkId: "check-2",
    } as MonitorJob);

    expect(db.batch).toHaveBeenCalledOnce();
    expect(prepared).toHaveLength(3);
    expect(prepared[0]?.sql).toContain("last_check_id = ?");
    expect(prepared[0]?.sql).toContain("consecutive_failures = ?");
    expect(prepared[0]?.params[3]).toBe(302);
    expect(prepared[0]?.params[5]).toBe(0);
    expect(prepared[1]?.sql).toContain("INSERT INTO uptime_checks");
    expect(prepared[1]?.params[0]).toBe("check-2");
    expect(prepared[1]?.params[3]).toBe(0);
    expect(prepared[1]?.params[4]).toBe(302);
    expect(prepared[2]?.sql).toContain("INSERT INTO incidents");
  });
});
