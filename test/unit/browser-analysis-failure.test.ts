import { describe, expect, it } from "vitest";
import { groupFindings } from "@shared/findings";
import { computeScores } from "@shared/scoring";
import { browserAnalysisUnavailableFinding } from "../../src/audit/pipeline";

describe("browser analysis failure scoring", () => {
  it("records skipped browser checks as a reliability deduction", () => {
    const finding = browserAnalysisUnavailableFinding("https://example.com");
    const scores = computeScores(groupFindings([finding]));

    expect(finding).toMatchObject({
      category: "reliability",
      severity: "medium",
      ruleId: "reliability.browser-analysis-unavailable",
      title: "Browser checks could not run",
      pageUrl: "https://example.com",
    });
    expect(scores.overall).toBe(93);
    expect(scores.reliabilityDeduction).toBe(7);
  });
});
