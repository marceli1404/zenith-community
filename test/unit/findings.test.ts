import { describe, it, expect } from "vitest";
import { groupFindings, Finding } from "@shared/findings";

function f(ruleId: string, pageUrl: string, severity: Finding["severity"] = "medium"): Finding {
  return {
    ruleId,
    category: "seo",
    severity,
    title: "Missing meta description",
    description: "The page has no meta description.",
    pageUrl,
    evidence: { metaDescription: null },
    recommendation: "Add a unique meta description.",
  };
}

describe("groupFindings", () => {
  it("collapses the same rule across many pages into one grouped finding", () => {
    const findings = Array.from({ length: 200 }, (_, i) =>
      f("seo.meta-description-missing", `https://x/page-${i}`),
    );
    const grouped = groupFindings(findings);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.occurrences).toBe(200);
    // affected URLs are bounded but recorded
    expect(grouped[0]!.affectedUrls.length).toBeGreaterThan(1);
    expect(grouped[0]!.affectedUrls.length).toBeLessThanOrEqual(100);
    // evidence samples are bounded
    expect(grouped[0]!.evidenceSamples.length).toBeLessThanOrEqual(5);
  });

  it("keeps distinct rules separate and sorts by severity", () => {
    const grouped = groupFindings([
      f("seo.a", "https://x/1", "low"),
      f("seo.b", "https://x/1", "critical"),
      f("seo.c", "https://x/1", "high"),
    ]);
    expect(grouped.map((x) => x.ruleId)).toEqual(["seo.b", "seo.c", "seo.a"]);
  });

  it("promotes to the highest severity seen for a rule", () => {
    const grouped = groupFindings([
      f("seo.x", "https://x/1", "low"),
      f("seo.x", "https://x/2", "critical"),
    ]);
    expect(grouped[0]!.severity).toBe("critical");
    expect(grouped[0]!.occurrences).toBe(2);
  });

  it("does not double-count the same page", () => {
    const grouped = groupFindings([f("seo.x", "https://x/1"), f("seo.x", "https://x/1")]);
    expect(grouped[0]!.affectedUrls).toEqual(["https://x/1"]);
    expect(grouped[0]!.occurrences).toBe(2);
  });
});
