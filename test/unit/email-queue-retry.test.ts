import { describe, expect, it, vi } from "vitest";
import type { Bindings, EmailJob } from "../../src/env";
import worker from "../../src/index";

describe("email queue retry handling", () => {
  it("delays a duplicate delivery until the active lease can expire", async () => {
    const message = {
      body: {
        type: "email",
        template: "verify_email",
        to: "user@example.com",
        data: { url: "https://example.com/verify" },
        dedupeKey: "verify:user-1",
      } satisfies EmailJob,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const env = {
      DB: {
        prepare() {
          return {
            bind() {
              return {
                async run() { return { meta: { changes: 0 } }; },
                async first() { return { status: "processing" }; },
              };
            },
          };
        },
      },
    } as unknown as Bindings;

    await worker.queue({ queue: "zenith-community-email", messages: [message] } as unknown as MessageBatch<unknown>, env);

    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 65 });
  });
});
