import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/env";
import { verifyTurnstile } from "../../src/lib/turnstile";

const baseEnv: Bindings = {
  APP_URL: "https://app.example.com",
  ENVIRONMENT: "production",
  TURNSTILE_SECRET_KEY: "test-secret",
} as Bindings;

function mockSuccessfulSiteverify(hostname?: string, action?: string) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, hostname, action }))));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Turnstile hostname validation", () => {
  it("rejects a localhost token in production", async () => {
    mockSuccessfulSiteverify("localhost");

    await expect(verifyTurnstile(baseEnv, "token")).resolves.toEqual({
      ok: false,
      reason: "hostname_mismatch",
    });
  });

  it("rejects a successful verification without a hostname", async () => {
    mockSuccessfulSiteverify();

    await expect(verifyTurnstile(baseEnv, "token")).resolves.toEqual({
      ok: false,
      reason: "hostname_mismatch",
    });
  });

  it("accepts the configured production hostname case-insensitively", async () => {
    mockSuccessfulSiteverify("APP.EXAMPLE.COM");

    await expect(verifyTurnstile(baseEnv, "token")).resolves.toEqual({
      ok: true,
      reason: "ok",
    });
  });

  it("rejects a successful token when the expected action is missing", async () => {
    mockSuccessfulSiteverify("app.example.com");

    await expect(verifyTurnstile(baseEnv, "token", undefined, "scan")).resolves.toEqual({
      ok: false,
      reason: "action_mismatch",
    });
  });

  it("rejects a token issued for a different action", async () => {
    mockSuccessfulSiteverify("app.example.com", "login");

    await expect(verifyTurnstile(baseEnv, "token", undefined, "scan")).resolves.toEqual({
      ok: false,
      reason: "action_mismatch",
    });
  });

  it("accepts a token issued for the expected action", async () => {
    mockSuccessfulSiteverify("app.example.com", "scan");

    await expect(verifyTurnstile(baseEnv, "token", undefined, "scan")).resolves.toEqual({
      ok: true,
      reason: "ok",
    });
  });

  it("fails closed when Siteverify returns a server error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: true, hostname: "app.example.com", action: "scan" }),
      { status: 503, headers: { "content-type": "application/json" } },
    )));

    await expect(verifyTurnstile(baseEnv, "token", undefined, "scan")).resolves.toEqual({
      ok: false,
      reason: "verify_unavailable",
    });
  });

  it("continues to allow localhost tokens outside production", async () => {
    mockSuccessfulSiteverify("localhost");

    await expect(verifyTurnstile({ ...baseEnv, ENVIRONMENT: "development" }, "token")).resolves.toEqual({
      ok: true,
      reason: "ok",
    });
  });

  it("keeps the timeout active while reading the Siteverify JSON body", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal as AbortSignal | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller;
          signal?.addEventListener("abort", () => {
            controller.error(new DOMException("The operation was aborted.", "AbortError"));
          }, { once: true });
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    }));

    const pending = verifyTurnstile(baseEnv, "token", undefined, "scan");
    try {
      await vi.advanceTimersByTimeAsync(8001);
      expect(signal?.aborted).toBe(true);
      await expect(pending).resolves.toEqual({ ok: false, reason: "verify_unavailable" });
    } finally {
      if (!signal?.aborted) {
        bodyController?.error(new DOMException("Test cleanup.", "AbortError"));
        await pending;
      }
      vi.useRealTimers();
    }
  });
});
