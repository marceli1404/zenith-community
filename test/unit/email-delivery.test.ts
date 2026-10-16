import { describe, expect, it, vi } from "vitest";
import type { Bindings, EmailJob } from "../../src/env";
import { deliverEmail, enqueueEmail } from "../../src/lib/email";

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

  it("releases a dedupe claim after provider failure so a queue retry can send", async () => {
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
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    };
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(undefined);
    const env = {
      DB: db,
      APP_URL: "https://example.com",
      EMAIL_FROM: "alerts@example.com",
      EMAIL: { send },
    } as unknown as Bindings;
    const job: EmailJob = {
      type: "email",
      template: "verify_email",
      to: "user@example.com",
      data: { url: "https://example.com/verify" },
      dedupeKey: "verify:user-1",
    };

    await expect(deliverEmail(env, job)).rejects.toThrow("provider unavailable");
    expect(statements.map(({ sql }) => sql)).toEqual([
      "INSERT OR IGNORE INTO processed_jobs (key, created_at) VALUES (?, ?)",
      "DELETE FROM processed_jobs WHERE key = ?",
    ]);

    await expect(deliverEmail(env, job)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      to: "user@example.com",
      from: "alerts@example.com",
      subject: "Verify your Zenith Community email",
      text: expect.stringContaining("https://example.com/verify"),
    }));
    expect(send.mock.calls[1]?.[0]).toHaveProperty("html");
    expect(send.mock.calls[1]?.[0]).not.toHaveProperty("raw");
  });
});
