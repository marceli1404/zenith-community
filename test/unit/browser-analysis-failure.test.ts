import { describe, expect, it } from "vitest";
import { groupFindings } from "@shared/findings";
import { computeScores, isOverallScoreAssessed, scoreFromSnapshot } from "@shared/scoring";
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

    // The finding is still useful evidence, but the persisted audit must not
    // present that partial score as a completed assessment.
    expect(isOverallScoreAssessed(false, [finding])).toBe(false);
    expect(scoreFromSnapshot({
      overall: 0,
      overallAssessed: false,
      security: 0,
      accessibility: 0,
      performance: 0,
      seo: 0,
      categoriesAssessed: false,
      reliabilityDeduction: null,
    })).toEqual({
      overall: null,
      categories: { security: null, accessibility: null, performance: null, seo: null },
      reliabilityDeduction: null,
    });
  });
});
