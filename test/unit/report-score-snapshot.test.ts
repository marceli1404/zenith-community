import { describe, expect, it } from "vitest";
import { scoreFromSnapshot } from "@shared/scoring";
import { generateReportHtml } from "../../src/report/html";

describe("saved audit score in PDF report HTML", () => {
  it("shows the persisted score and explains when legacy reliability impact is unknown", () => {
    const html = generateReportHtml({
      appName: "Zenith",
      siteOrigin: "https://example.test",
      createdAt: Date.UTC(2026, 9, 15),
      scores: scoreFromSnapshot({
        overall: 42,
        security: 88,
        accessibility: 91,
        performance: 75,
        seo: 100,
        categoriesAssessed: true,
        reliabilityDeduction: null,
      }),
      pageCount: 4,
      brokenLinkCount: 1,
      grouped: [],
    });

    expect(html).toContain(">42</div>");
    expect(html).toContain("Reliability impact was not recorded for this saved audit.");
    expect(html).toContain("score shown is the saved result.");
  });

  it("marks an audit that assessed no pages as unassessed", () => {
    const html = generateReportHtml({
      appName: "Zenith",
      siteOrigin: "https://example.test",
      createdAt: Date.UTC(2026, 9, 15),
      scores: scoreFromSnapshot({
        overall: 0,
        overallAssessed: false,
        security: 0,
        accessibility: 0,
        performance: 0,
        seo: 0,
        categoriesAssessed: false,
        reliabilityDeduction: null,
      }),
      pageCount: 0,
      brokenLinkCount: 0,
      grouped: [],
    });

    expect(html).toContain("Audit score not assessed");
    expect(html).toContain("Not assessed");
    expect(html).toContain("No score calculated");
    expect(html).toContain("Category results are unassessed because the audit could not complete all required checks.");
    expect(html).not.toContain("Overall score / 100");
  });

  it("explains that a homepage outage forces the score to zero", () => {
    const html = generateReportHtml({
      appName: "Zenith",
      siteOrigin: "https://example.test",
      createdAt: Date.UTC(2026, 9, 15),
      scores: scoreFromSnapshot({
        overall: 0,
        security: 0,
        accessibility: 0,
        performance: 0,
        seo: 0,
        categoriesAssessed: false,
        homepageUnavailable: true,
        reliabilityDeduction: null,
      }),
      pageCount: 0,
      brokenLinkCount: 0,
      grouped: [{
        ruleId: "reliability.homepage-unavailable",
        category: "reliability",
        severity: "critical",
        title: "Homepage could not be assessed",
        description: "The homepage returned HTTP 503.",
        recommendation: "Restore the homepage.",
        affectedUrls: ["https://example.test/"],
        evidenceSamples: [{
          pageUrl: "https://example.test/",
          evidence: { kind: "request_failed", errorCode: "timeout" },
        }],
      }],
    });

    expect(html).toContain("The homepage could not be fully assessed, so the overall score was set to 0 and technical categories were not assessed. See the finding for the observed response.");
    expect(html).toContain("When an overall score is calculated, reliability findings reduce it per affected URL, up to five URLs per rule; a homepage outage instead sets the score to 0.");
    expect(html).toContain("<h2>Homepage could not be assessed</h2>");
    expect(html).not.toContain("Reliability impact was not recorded");
    expect(html).toContain("Observed:</strong> The request timed out before the homepage responded. (<code>timeout</code>)");
    expect(html).not.toContain("The overall score blends security, accessibility, SEO and performance equally.");
    expect(html).not.toContain("Reliability findings deducted 0 points");
  });
});
