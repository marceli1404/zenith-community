import { describe, expect, it, vi } from "vitest";
import type { Bindings, EmailJob } from "../../src/env";
import { deliverEmail, enqueueEmail, ResendEmailProvider } from "../../src/lib/email";

interface DeliveryRow {
  status: "processing" | "sent";
  createdAt: number;
  leaseExpiresAt: number | null;
  leaseToken: string | null;
}

function memoryDb(initial: DeliveryRow | null = null) {
  let row = initial ? { ...initial } : null;
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const statement = { sql, params: [] as unknown[] };
      return {
        bind(...params: unknown[]) {
          statement.params = params;
          return {
            async run() {
              statements.push(statement);
              if (sql.startsWith("INSERT OR IGNORE")) {
                if (row) return { meta: { changes: 0 } };
                row = {
                  status: "processing",
                  createdAt: Number(params[1]),
                  leaseExpiresAt: Number(params[2]),
                  leaseToken: String(params[3]),
                };
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE processed_jobs SET created_at")) {
                const [createdAt, leaseExpiresAt, leaseToken, , now] = params as [number, number, string, string, number];
                if (row?.status === "processing" && (row.leaseExpiresAt ?? Infinity) <= now) {
                  row = { status: "processing", createdAt, leaseExpiresAt, leaseToken };
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (sql.includes("SET status = 'sent'")) {
                if (row?.status === "processing" && row.leaseToken === params[1]) {
                  row = { ...row, status: "sent", leaseExpiresAt: null, leaseToken: null };
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (sql.includes("SET lease_expires_at = ?")) {
                if (row?.status === "processing" && row.leaseToken === params[2]) {
                  row = { ...row, leaseExpiresAt: Number(params[0]) };
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              throw new Error(`Unexpected SQL: ${sql}`);
            },
            async first<T>() {
              statements.push(statement);
              return (row ? { status: row.status } : null) as T | null;
            },
          };
        },
      };
    },
  };
  return {
    db,
    statements,
    getRow: () => row,
    expireLease: () => { if (row) row.leaseExpiresAt = 0; },
  };
}

function testJob(): EmailJob {
  return {
    type: "email",
    template: "verify_email",
    to: "user@example.com",
    data: { url: "https://example.com/verify" },
    dedupeKey: "verify:user-1",
  };
}

function testEnv(db: ReturnType<typeof memoryDb>["db"], send: ReturnType<typeof vi.fn>): Bindings {
  return {
    DB: db,
    APP_URL: "https://example.com",
    EMAIL_FROM: "alerts@example.com",
    EMAIL: { send },
  } as unknown as Bindings;
}

describe("email delivery deduplication", () => {
  it("does not queue mail when email delivery is not configured", async () => {
    const send = vi.fn();
    await enqueueEmail({ EMAIL_QUEUE: { send } } as unknown as Bindings, {
      type: "email",
      template: "audit_completed",
      to: "user@example.com",
      data: {},
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("recovers a stranded pre-send claim after its lease expires", async () => {
    const store = memoryDb({ status: "processing", createdAt: 1, leaseExpiresAt: 0, leaseToken: "stranded" });
    const send = vi.fn().mockResolvedValue(undefined);

    await deliverEmail(testEnv(store.db, send), testJob());

    expect(send).toHaveBeenCalledTimes(1);
    expect(store.getRow()).toMatchObject({ status: "sent", leaseExpiresAt: null, leaseToken: null });
    expect(store.statements.some(({ sql }) => sql.startsWith("UPDATE processed_jobs SET created_at"))).toBe(true);
  });

  it("acknowledges a duplicate only after the prior delivery is marked sent", async () => {
    const store = memoryDb({ status: "sent", createdAt: 1, leaseExpiresAt: null, leaseToken: null });
    const send = vi.fn();

    await expect(deliverEmail(testEnv(store.db, send), testJob())).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
    expect(store.getRow()?.status).toBe("sent");
  });

  it("retries a duplicate while another worker holds a live lease", async () => {
    const store = memoryDb();
    let finishSend!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => { finishSend = resolve; }));
    const env = testEnv(store.db, send);

    const active = deliverEmail(env, testJob());
    await Promise.resolve();
    await expect(deliverEmail(env, testJob())).rejects.toThrow("already in progress");
    expect(send).toHaveBeenCalledTimes(1);
    finishSend();
    await active;
    expect(store.getRow()?.status).toBe("sent");
  });

  it("releases the lease after a provider error so the queue retry can send", async () => {
    const store = memoryDb();
    const send = vi.fn().mockRejectedValueOnce(new Error("provider unavailable")).mockResolvedValueOnce(undefined);
    const env = testEnv(store.db, send);

    await expect(deliverEmail(env, testJob())).rejects.toThrow("provider unavailable");
    expect(store.getRow()).toMatchObject({ status: "processing" });
    expect(store.getRow()!.leaseExpiresAt).toBeLessThanOrEqual(Date.now());

    await expect(deliverEmail(env, testJob())).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
    expect(store.getRow()?.status).toBe("sent");
    expect(send.mock.calls[1]?.[0]).toMatchObject({
      to: "user@example.com",
      from: "alerts@example.com",
      subject: "Verify your Zenith Community email",
      text: expect.stringContaining("https://example.com/verify"),
    });
  });

  it("passes the stable D1 dedupe key to Resend as an idempotency key", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    try {
      await new ResendEmailProvider("test-key").send({
        to: "user@example.com",
        from: "alerts@example.com",
        subject: "Test",
        html: "<p>Test</p>",
        text: "Test",
      }, "email:verify:user-1");
      expect(fetch).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
        headers: expect.objectContaining({ "idempotency-key": "email:verify:user-1" }),
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fences an old worker from marking a newer lease sent", async () => {
    const store = memoryDb();
    const finishes: Array<() => void> = [];
    const send = vi.fn(() => new Promise<void>((resolve) => { finishes.push(resolve); }));
    const env = testEnv(store.db, send);

    const oldWorker = deliverEmail(env, testJob());
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const oldToken = store.getRow()?.leaseToken;
    store.expireLease();
    const newWorker = deliverEmail(env, testJob());
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(store.getRow()?.leaseToken).not.toBe(oldToken);

    finishes[0]!();
    await expect(oldWorker).rejects.toThrow("already in progress");
    expect(store.getRow()?.leaseToken).not.toBe(oldToken);
    finishes[1]!();
    await newWorker;
    expect(store.getRow()?.status).toBe("sent");
  });

  it("does not let an old failed worker release a newer worker's lease", async () => {
    const store = memoryDb();
    const finishes: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
    const send = vi.fn(() => new Promise<void>((resolve, reject) => { finishes.push({ resolve, reject }); }));
    const env = testEnv(store.db, send);

    const oldWorker = deliverEmail(env, testJob());
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const oldToken = store.getRow()?.leaseToken;
    store.expireLease();
    const newWorker = deliverEmail(env, testJob());
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    const newLease = store.getRow();
    expect(newLease?.leaseToken).not.toBe(oldToken);

    finishes[0]!.reject(new Error("old worker failed"));
    await expect(oldWorker).rejects.toThrow("old worker failed");
    expect(store.getRow()).toEqual(newLease);
    finishes[1]!.resolve();
    await newWorker;
    expect(store.getRow()?.status).toBe("sent");
  });

  it("renews a live lease while provider delivery is still pending", async () => {
    vi.useFakeTimers();
    const store = memoryDb();
    let finishSend!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => { finishSend = resolve; }));
    try {
      const active = deliverEmail(testEnv(store.db, send), testJob());
      await Promise.resolve();
      const initialExpiry = store.getRow()?.leaseExpiresAt ?? 0;
      await vi.advanceTimersByTimeAsync(80_000);
      expect(store.getRow()?.leaseExpiresAt).toBeGreaterThan(initialExpiry);
      expect(store.getRow()?.leaseExpiresAt).toBeGreaterThan(Date.now());
      await expect(deliverEmail(testEnv(store.db, send), testJob())).rejects.toThrow("already in progress");
      expect(send).toHaveBeenCalledTimes(1);
      finishSend();
      await active;
      expect(store.getRow()?.status).toBe("sent");
    } finally {
      vi.useRealTimers();
    }
  });
});
