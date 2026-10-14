import { describe, it, expect } from "vitest";
import { computeScores, scoreCategory, reliabilityScore } from "@shared/scoring";
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
  it("ignores reliability findings in the audit blend", () => {
    const s = computeScores([g("reliability", "critical")]);
    expect(s.overall).toBe(100);
  });
  it("scores an unavailable homepage as zero while retaining category scores", () => {
    const unavailable = g("reliability", "critical", "reliability.homepage-unavailable");
    const byFetchFailure = computeScores([], { siteAvailable: false });
    const byFinding = computeScores([unavailable]);

    expect(byFetchFailure.overall).toBe(0);
    expect(byFinding.overall).toBe(0);
    expect(byFinding.categories).toEqual({ security: 100, accessibility: 100, performance: 100, seo: 100 });
  });
});

describe("reliabilityScore", () => {
  it("computes uptime percentage", () => {
    expect(reliabilityScore(99, 100)).toBe(99);
    expect(reliabilityScore(0, 0)).toBe(100);
    expect(reliabilityScore(1, 2)).toBe(50);
  });
});
