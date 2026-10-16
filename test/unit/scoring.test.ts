import { describe, it, expect } from "vitest";
import { computeScores, scoreCategory, reliabilityScore, scoreFromSnapshot, isOverallScoreAssessed, displayOverallScoreSql } from "@shared/scoring";
import { GroupedFinding } from "@shared/findings";

function g(
  category: GroupedFinding["category"],
  severity: GroupedFinding["severity"],
  ruleId = `${category}.${severity}`,
): GroupedFinding {
  return {
    ruleId,
    category,
    severity,
    title: "t",
    description: "d",
    recommendation: "r",
    affectedUrls: ["https://x/"],
    evidenceSamples: [],
    occurrences: 1,
  };
}

describe("scoreCategory", () => {
  it("starts at 100 and applies deductions", () => {
    expect(scoreCategory([])).toBe(100);
    expect(scoreCategory([g("seo", "critical")])).toBe(75);
    expect(scoreCategory([g("seo", "high")])).toBe(85);
    expect(scoreCategory([g("seo", "medium")])).toBe(93);
    expect(scoreCategory([g("seo", "low")])).toBe(97);
    expect(scoreCategory([g("seo", "info")])).toBe(100);
  });
  it("clamps at 0", () => {
    const many = Array.from({ length: 10 }, (_, i) => g("seo", "critical", `seo.r${i}`));
    expect(scoreCategory(many)).toBe(0);
  });
});

describe("computeScores", () => {
  it("blends four categories equally", () => {
    const s = computeScores([g("security", "critical"), g("seo", "high")]);
    expect(s.categories.security).toBe(75);
    expect(s.categories.seo).toBe(85);
    expect(s.categories.accessibility).toBe(100);
    expect(s.categories.performance).toBe(100);
    // (75 + 85 + 100 + 100) / 4 = 90
    expect(s.overall).toBe(90);
  });
  it("deducts reliability findings from the overall score", () => {
    const s = computeScores([g("reliability", "critical")]);
    expect(s.overall).toBe(75);
    expect(s.reliabilityDeduction).toBe(25);
  });
  it("charges repeated reliability failures per affected URL, with a per-rule cap", () => {
    const issue = { ...g("reliability", "high"), affectedUrls: Array.from({ length: 8 }, (_, i) => `https://x/${i}`) };
    const s = computeScores([issue]);
    expect(s.reliabilityDeduction).toBe(75);
    expect(s.overall).toBe(25);
  });
  it("scores an unavailable homepage as zero and marks category scores unassessed", () => {
    const unavailable = g("reliability", "critical", "reliability.homepage-unavailable");
    const byFetchFailure = computeScores([], { siteAvailable: false });
    const byFinding = computeScores([unavailable]);

    expect(byFetchFailure.overall).toBe(0);
    expect(byFinding.overall).toBe(0);
    expect(byFinding.categories).toEqual({ security: null, accessibility: null, performance: null, seo: null });
  });
});

describe("scoreFromSnapshot", () => {
  it("restores persisted values without recalculating from findings", () => {
    expect(scoreFromSnapshot({
      overall: 42,
      security: 88,
      accessibility: 91,
      performance: 75,
      seo: 100,
      categoriesAssessed: true,
      reliabilityDeduction: 25,
    })).toEqual({
      overall: 42,
      categories: { security: 88, accessibility: 91, performance: 75, seo: 100 },
      reliabilityDeduction: 25,
    });
  });

  it("keeps unavailable category data unassessed and marks unknown legacy impact", () => {
    expect(scoreFromSnapshot({
      overall: 0,
      security: 0,
      accessibility: 0,
      performance: 0,
      seo: 0,
      categoriesAssessed: false,
      reliabilityDeduction: null,
    })).toEqual({
      overall: 0,
      categories: { security: null, accessibility: null, performance: null, seo: null },
      reliabilityDeduction: null,
    });
  });

  it("does not treat a robots-blocked audit's storage sentinel as a real overall score", () => {
    const robotsFinding = g("reliability", "info", "reliability.robots-disallowed");
    expect(isOverallScoreAssessed(false, [robotsFinding])).toBe(false);
    expect(isOverallScoreAssessed(false, [g("reliability", "critical", "reliability.homepage-unavailable")])).toBe(true);
    expect(scoreFromSnapshot({
      overall: 0,
      overallAssessed: false,
      security: 0,
      accessibility: 0,
      performance: 0,
      seo: 0,
      categoriesAssessed: false,
      reliabilityDeduction: null,
    }).overall).toBeNull();
  });

  it("forces legacy homepage-outage snapshots to zero and keeps their categories unassessed", () => {
    expect(scoreFromSnapshot({
      overall: 80,
      security: 100,
      accessibility: 100,
      performance: 100,
      seo: 100,
      categoriesAssessed: true,
      homepageUnavailable: true,
      reliabilityDeduction: 0,
    })).toEqual({
      overall: 0,
      categories: { security: null, accessibility: null, performance: null, seo: null },
      reliabilityDeduction: 0,
    });
  });

  it("normalizes a legacy homepage outage with an unknown deduction to zero impact", () => {
    expect(scoreFromSnapshot({
      overall: 0,
      security: 0,
      accessibility: 0,
      performance: 0,
      seo: 0,
      categoriesAssessed: false,
      homepageUnavailable: true,
      reliabilityDeduction: null,
    })).toEqual({
      overall: 0,
      categories: { security: null, accessibility: null, performance: null, seo: null },
      reliabilityDeduction: 0,
    });
  });

  it("uses an assessed score in summaries only when categories or a measured homepage outage support it", () => {
    const sql = displayOverallScoreSql("ar");
    expect(sql).toContain("COALESCE(ar.categories_assessed, 0) <> 0");
    expect(sql).toContain("reliability.homepage-unavailable");
    expect(sql.indexOf("THEN 0")).toBeLessThan(sql.indexOf("THEN ar.overall_score"));
    expect(sql).toContain("ELSE NULL END");
    expect(() => displayOverallScoreSql("ar; DROP TABLE audit_results")).toThrow("Invalid audit-result SQL alias");
  });
});

describe("reliabilityScore", () => {
  it("computes uptime percentage", () => {
    expect(reliabilityScore(99, 100)).toBe(99);
    expect(reliabilityScore(0, 0)).toBeNull();
    expect(reliabilityScore(1, 2)).toBe(50);
  });
});
