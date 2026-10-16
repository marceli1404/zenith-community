import { describe, expect, it } from "vitest";
import { scoreLabel } from "../../web/lib/format";

describe("scoreLabel", () => {
  it("matches the published score bands at every boundary", () => {
    expect(scoreLabel(90)).toBe("Excellent");
    expect(scoreLabel(89)).toBe("Fair");
    expect(scoreLabel(70)).toBe("Fair");
    expect(scoreLabel(69)).toBe("Needs attention");
    expect(scoreLabel(40)).toBe("Needs attention");
    expect(scoreLabel(39)).toBe("Poor");
  });
});
