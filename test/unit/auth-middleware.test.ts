import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

vi.mock("../../src/auth", () => ({
  getAuth: () => ({ api: { getSession } }),
}));

import { withAuth, type AppEnv } from "../../src/middleware";

describe("API session resolution", () => {
  beforeEach(() => getSession.mockReset().mockResolvedValue(null));

  it("bypasses Better Auth's cookie cache for authoritative D1 session checks", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", withAuth);
    app.get("/", (c) => c.text("ok"));

    const response = await app.request("/", {}, { APP_URL: "https://community.example" } as AppEnv["Bindings"]);

    expect(response.status).toBe(200);
    expect(getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: { disableCookieCache: true },
    });
  });
});
