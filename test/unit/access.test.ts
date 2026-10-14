import { describe, expect, it } from "vitest";
import { resolveAccess } from "../../src/lib/access";

describe("Community account access", () => {
  it("grants the self-hosted Community edition without a subscription lookup", async () => {
    const db = { prepare: () => { throw new Error("Community access must not query billing tables"); } } as unknown as D1Database;

    await expect(resolveAccess(db, "user-1")).resolves.toEqual({
      plan: "community",
      source: "community",
    });
  });
});
