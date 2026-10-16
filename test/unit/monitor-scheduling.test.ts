import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  all: vi.fn(),
  first: vi.fn(),
  run: vi.fn(),
  newId: vi.fn(() => "generated-id"),
  now: vi.fn(() => 1_000),
  resolveAccess: vi.fn(async () => ({ plan: "community" as const })),
}));

vi.mock("../../src/db", () => mocks);
vi.mock("../../src/lib/access", () => ({ resolveAccess: mocks.resolveAccess }));

import type { Bindings } from "../../src/env";
import { scheduleDueMonitors } from "../../src/monitor";

describe("monitor check scheduling", () => {
  beforeEach(() => {
    mocks.all.mockReset();
    mocks.first.mockReset();
    mocks.run.mockReset();
    mocks.now.mockReturnValue(1_000);
    mocks.resolveAccess.mockReset();
    mocks.resolveAccess.mockResolvedValue({ plan: "community" });
  });

  it("enqueues only when the conditional monitor claim succeeds", async () => {
    const dueMonitor = { id: "monitor-1", site_id: "site-1", interval_seconds: 60, user_id: "user-1" };
    mocks.all.mockImplementation(async (_db, sql: string) => (
      sql.includes("FROM monitors m") ? [dueMonitor] : [{ id: "site-1" }]
    ));
    let claims = 0;
    const db = {
      prepare: vi.fn((sql: string) => ({ bind: vi.fn(() => ({ sql })) })),
      batch: vi.fn(async () => {
        claims += 1;
        return [{ meta: { changes: claims === 1 ? 1 : 0 } }];
      }),
    };
    const send = vi.fn().mockResolvedValue(undefined);
    const env = { DB: db, MONITOR_QUEUE: { send } } as unknown as Bindings;

    await Promise.all([scheduleDueMonitors(env), scheduleDueMonitors(env)]);

    expect(db.batch).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledOnce();
    expect(db.prepare.mock.calls.every(([sql]) => sql.includes("next_check_at <= ?"))).toBe(true);
  });

  it("makes a failed enqueue due again on the next cron tick", async () => {
    mocks.all
      .mockResolvedValueOnce([{ id: "monitor-1", site_id: "site-1", interval_seconds: 60, user_id: "user-1" }])
      .mockResolvedValueOnce([{ id: "site-1" }]);
    const db = {
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({})) })),
      batch: vi.fn(async () => [{ meta: { changes: 1 } }]),
    };
    const env = {
      DB: db,
      MONITOR_QUEUE: { send: vi.fn().mockRejectedValue(new Error("queue unavailable")) },
    } as unknown as Bindings;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await scheduleDueMonitors(env);

    expect(mocks.run).toHaveBeenCalledWith(
      db,
      "UPDATE monitors SET next_check_at = MIN(next_check_at, ?) WHERE id = ? AND next_check_at = ?",
      1_000,
      "monitor-1",
      61_000,
    );
    expect(env.MONITOR_QUEUE.send).toHaveBeenCalledWith({
      type: "check",
      monitorId: "monitor-1",
      siteId: "site-1",
      checkId: "generated-id",
    });
    error.mockRestore();
  });
});
