import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings, EmailJob } from "../../src/env";
import { deliverEmail, enqueueEmail, flushEmailOutbox } from "../../src/lib/email";

interface OutboxRow {
  id: string;
  payload: string;
  createdAt: number;
  availableAt: number;
  expiresAt: number;
  attempts: number;
  leaseExpiresAt: number | null;
  leaseToken: string | null;
}

function memoryOutbox() {
  const rows = new Map<string, OutboxRow>();
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              if (sql.startsWith("DELETE FROM email_outbox WHERE expires_at")) {
                const before = rows.size;
                for (const [id, row] of rows) if (row.expiresAt <= Number(params[0])) rows.delete(id);
                return { meta: { changes: before - rows.size } };
              }
              if (sql.startsWith("INSERT INTO email_outbox")) {
                if (rows.size >= Number(params[5])) return { meta: { changes: 0 } };
                const [id, payload, createdAt, availableAt, expiresAt] = params as [string, string, number, number, number];
                rows.set(id, { id, payload, createdAt, availableAt, expiresAt, attempts: 0, leaseExpiresAt: null, leaseToken: null });
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE email_outbox SET lease_token")) {
                const [leaseToken, leaseExpiresAt, id, availableAt, expiresAt, now] = params as [string, number, string, number, number, number];
                const row = rows.get(id);
                if (!row || row.availableAt > availableAt || row.expiresAt <= expiresAt || (row.leaseExpiresAt !== null && row.leaseExpiresAt > now)) {
                  return { meta: { changes: 0 } };
                }
                row.leaseToken = leaseToken;
                row.leaseExpiresAt = leaseExpiresAt;
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE email_outbox SET attempts")) {
                const [attempts, availableAt, id, leaseToken] = params as [number, number, string, string];
                const row = rows.get(id);
                if (!row || row.leaseToken !== leaseToken) return { meta: { changes: 0 } };
                row.attempts = attempts;
                row.availableAt = availableAt;
                row.leaseToken = null;
                row.leaseExpiresAt = null;
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("DELETE FROM email_outbox WHERE id")) {
                const [id, leaseToken] = params as [string, string];
                const row = rows.get(id);
                if (!row || row.leaseToken !== leaseToken) return { meta: { changes: 0 } };
                rows.delete(id);
                return { meta: { changes: 1 } };
              }
              throw new Error(`Unexpected SQL: ${sql}`);
            },
            async first<T>() {
              const [id, leaseToken] = params as [string, string];
              const row = rows.get(id);
              return (row && row.leaseToken === leaseToken
                ? { payload: row.payload, expires_at: row.expiresAt, attempts: row.attempts }
                : null) as T | null;
            },
            async all<T>() {
              const [availableAt, expiresAt, now, limit] = params as [number, number, number, number];
              const results = [...rows.values()]
                .filter((row) => row.availableAt <= availableAt && row.expiresAt > expiresAt && (row.leaseExpiresAt === null || row.leaseExpiresAt <= now))
                .sort((a, b) => a.createdAt - b.createdAt)
                .slice(0, limit)
                .map(({ id }) => ({ id }));
              return { results: results as T[] };
            },
          };
        },
      };
    },
  };
  return {
    db,
    rows,
    makeDue(id: string) {
      const row = rows.get(id);
      if (row) row.availableAt = 0;
    },
    expire(id: string) {
      const row = rows.get(id);
      if (row) row.expiresAt = 0;
    },
  };
}

function testJob(): EmailJob {
  return {
    type: "email",
    template: "verify_otp",
    to: "person@example.com",
    data: { otp: "123456", otpType: "sign-in" },
  };
}

function testEnv(db: ReturnType<typeof memoryOutbox>["db"], send: ReturnType<typeof vi.fn>): Bindings {
  return {
    DB: db,
    EMAIL_QUEUE: { send },
    EMAIL: { send: vi.fn() },
    EMAIL_FROM: "robot@example.com",
    APP_URL: "https://example.com",
  } as unknown as Bindings;
}

describe("email outbox recovery", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps queue-send failures durable and retries them from the scheduled worker", async () => {
    const store = memoryOutbox();
    const send = vi.fn().mockRejectedValueOnce(new Error("Queue unavailable")).mockResolvedValue(undefined);
    const env = testEnv(store.db, send);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await enqueueEmail(env, testJob());

    expect(send).toHaveBeenCalledTimes(1);
    expect(store.rows.size).toBe(1);
    const [id, pending] = [...store.rows.entries()][0]!;
    const durableJob = JSON.parse(pending.payload) as EmailJob;
    expect(durableJob.dedupeKey).toBe(`email-outbox:${id}`);
    expect(durableJob.expiresAt).toBeGreaterThan(Date.now());
    expect(log.mock.calls.flat().join(" ")).not.toContain("123456");

    store.makeDue(id);
    await flushEmailOutbox(env);

    expect(send).toHaveBeenCalledTimes(2);
    expect(store.rows.size).toBe(0);
  });

  it("expires queued verification codes instead of sending stale ones", async () => {
    const store = memoryOutbox();
    const send = vi.fn().mockResolvedValue(undefined);
    const env = testEnv(store.db, send);
    await enqueueEmail(env, testJob());
    const id = [...store.rows.keys()][0]!;
    store.expire(id);

    await flushEmailOutbox(env);

    expect(send).toHaveBeenCalledTimes(1);
    expect(store.rows.size).toBe(0);
  });

  it("does not deliver an auth message after its expiry", async () => {
    const store = memoryOutbox();
    const send = vi.fn();
    const env = testEnv(store.db, send);

    await expect(deliverEmail(env, { ...testJob(), expiresAt: 0 })).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
    expect(store.rows.size).toBe(0);
  });
});
