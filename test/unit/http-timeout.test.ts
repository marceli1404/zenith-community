import { afterEach, describe, expect, it, vi } from "vitest";
import { safeFetch } from "../../src/lib/http";

describe("safeFetch response body timeout", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a timeout when the response body stalls after headers", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("The operation was aborted.", "AbortError"));
          }, { once: true });
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    }));

    const result = await safeFetch("https://example.com/", { readBody: true, timeoutMs: 20 });

    expect(result).toMatchObject({ ok: false, errorCode: "timeout" });
  });
});
