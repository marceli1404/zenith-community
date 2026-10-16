import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("an unavailable homepage shows a zero score and unassessed categories", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { id: "usr_test", email: "owner@example.com" }, plan: "community", access: { source: "community" } }),
  }));
  await page.route("**/api/config", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authProviders: { google: false, github: false }, emailEnabled: false }),
  }));
  await page.route("**/api/audits/aud_unavailable", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      job: { id: "aud_unavailable", status: "completed", error_code: null, site_id: null },
      result: {
        id: "result_unavailable",
        scores: { overall: 0, categories: { security: null, accessibility: null, performance: null, seo: null }, reliabilityDeduction: 0 },
        pageCount: 0,
        brokenLinkCount: 1,
      },
      findings: [{
        ruleId: "reliability.homepage-unavailable",
        category: "reliability",
        severity: "critical",
        title: "Homepage could not be assessed",
        description: "The homepage returned HTTP 503.",
        recommendation: "Restore the homepage before running another audit.",
        affectedUrls: ["https://example.test/"],
        occurrences: 1,
        evidenceSamples: [{
          pageUrl: "https://example.test/",
          evidence: { kind: "request_failed", errorCode: "timeout" },
        }],
      }],
    }),
  }));

  await page.goto("/app/audits/aud_unavailable");

  await expect(page.getByRole("heading", { name: "Audit report" })).toBeVisible();
  await expect(page.getByText("0", { exact: true })).toBeVisible();
  await expect(page.getByText("Unassessed", { exact: true })).toHaveCount(4);
  await expect(page.getByRole("region", { name: "Audit summary" }).getByText("Homepage could not be assessed", { exact: true })).toBeVisible();
  await expect(page.getByText("Homepage could not be assessed; overall score set to 0. Category scores were not assessed.")).toBeVisible();
  await expect(page.getByText("Reliability impact was not recorded for this saved audit.")).toHaveCount(0);
  await expect(page.getByText("The request timed out before the homepage responded.")).toBeVisible();

  const jsonDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON" }).click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonPath = await jsonDownload.path();
  expect(jsonPath).not.toBeNull();
  const json = JSON.parse(await readFile(jsonPath!, "utf8"));
  expect(json.scores).toEqual({
    overall: 0,
    categories: { security: null, accessibility: null, performance: null, seo: null },
    reliabilityDeduction: 0,
  });
  expect(json.findings[0].diagnosis).toEqual({
    code: "timeout",
    summary: "The request timed out before the homepage responded.",
  });

  const markdownDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const markdownDownload = await markdownDownloadPromise;
  const markdownPath = await markdownDownload.path();
  expect(markdownPath).not.toBeNull();
  const markdown = await readFile(markdownPath!, "utf8");
  expect(markdown).toContain("- **Overall score:** 0 (Homepage could not be assessed)");
  expect(markdown).toContain("- **security:** Unassessed");
  expect(markdown).toContain("**Observed:** The request timed out before the homepage responded. (timeout)");
});

test("a robots-blocked audit is not presented as a zero or poor score", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { id: "usr_test", email: "owner@example.com" }, plan: "community", access: { source: "community" } }),
  }));
  await page.route("**/api/config", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authProviders: { google: false, github: false }, emailEnabled: false }),
  }));
  await page.route("**/api/audits/aud_robots_blocked", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      job: { id: "aud_robots_blocked", status: "completed", error_code: null, site_id: null },
      result: {
        id: "result_robots_blocked",
        scores: { overall: null, categories: { security: null, accessibility: null, performance: null, seo: null }, reliabilityDeduction: null },
        pageCount: 0,
        brokenLinkCount: 0,
      },
      findings: [{
        ruleId: "reliability.robots-disallowed",
        category: "reliability",
        severity: "info",
        title: "Audit not assessed because of robots.txt",
        description: "robots.txt could not be read, so the crawler did not request any site pages.",
        recommendation: "Allow the ZenithCommunityBot user agent before running this audit again.",
        affectedUrls: ["https://example.test/"],
        occurrences: 1,
      }],
    }),
  }));

  await page.goto("/app/audits/aud_robots_blocked");

  await expect(page.getByText("Not assessed", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Zenith score not assessed" })).toBeVisible();
  await expect(page.getByText("0", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Audit not assessed because of robots.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("Unassessed", { exact: true })).toHaveCount(4);

  const jsonDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON" }).click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonPath = await jsonDownload.path();
  expect(jsonPath).not.toBeNull();
  const json = JSON.parse(await readFile(jsonPath!, "utf8"));
  expect(json.scores.overall).toBeNull();
  expect(Object.values(json.scores.categories)).toEqual([null, null, null, null]);

  const markdownDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const markdownDownload = await markdownDownloadPromise;
  const markdownPath = await markdownDownload.path();
  expect(markdownPath).not.toBeNull();
  const markdown = await readFile(markdownPath!, "utf8");
  expect(markdown).toContain("- **Overall score:** Not assessed");
  expect(markdown).toContain("- **security:** Unassessed");
});

test("score labels use the same fair band as the scoring rubric", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { id: "usr_test", email: "owner@example.com" }, plan: "community", access: { source: "community" } }),
  }));
  await page.route("**/api/config", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authProviders: { google: false, github: false }, emailEnabled: false }),
  }));
  await page.route("**/api/audits/aud_fair_score", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      job: { id: "aud_fair_score", status: "completed", error_code: null, site_id: null },
      result: {
        id: "result_fair_score",
        scores: { overall: 75, categories: { security: 75, accessibility: 75, performance: 75, seo: 75 }, reliabilityDeduction: 0 },
        pageCount: 1,
        brokenLinkCount: 0,
      },
      findings: [],
    }),
  }));

  await page.goto("/app/audits/aud_fair_score");

  await expect(page.getByText("Fair", { exact: true })).toBeVisible();
  await expect(page.getByText("Good", { exact: true })).toHaveCount(0);
});

test("browser analysis failure is visible and deducted from the score", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { id: "usr_test", email: "owner@example.com" }, plan: "community", access: { source: "community" } }),
  }));
  await page.route("**/api/config", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authProviders: { google: false, github: false }, emailEnabled: false }),
  }));
  await page.route("**/api/audits/aud_browser_unavailable", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      job: { id: "aud_browser_unavailable", status: "completed", error_code: null, site_id: null },
      result: {
        id: "result_browser_unavailable",
        scores: { overall: 93, categories: { security: 100, accessibility: 100, performance: 100, seo: 100 }, reliabilityDeduction: 7 },
        pageCount: 1,
        brokenLinkCount: 0,
      },
      findings: [{
        ruleId: "reliability.browser-analysis-unavailable",
        category: "reliability",
        severity: "medium",
        title: "Browser checks could not run",
        description: "The site responded to the HTTP crawl, but its browser checks did not finish. JavaScript behavior and browser measurements are unassessed.",
        recommendation: "Check browser rendering in this installation, then run the audit again.",
        affectedUrls: ["https://example.test/"],
        occurrences: 1,
      }],
    }),
  }));

  await page.goto("/app/audits/aud_browser_unavailable");

  await expect(page.getByText("Reliability findings deducted 7 points from the overall score.")).toBeVisible();
  await expect(page.getByText("Browser checks could not run", { exact: true })).toBeVisible();
  await expect(page.getByText("JavaScript behavior and browser measurements are unassessed.")).toBeVisible();
});

test("a saved legacy score stays visible when reliability impact was not recorded", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { id: "usr_test", email: "owner@example.com" }, plan: "community", access: { source: "community" } }),
  }));
  await page.route("**/api/config", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authProviders: { google: false, github: false }, emailEnabled: false }),
  }));
  await page.route("**/api/audits/aud_legacy", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      job: { id: "aud_legacy", status: "completed", error_code: null, site_id: null },
      result: {
        id: "result_legacy",
        scores: { overall: 42, categories: { security: 88, accessibility: 91, performance: 75, seo: 100 }, reliabilityDeduction: null },
        pageCount: 4,
        brokenLinkCount: 1,
      },
      findings: [],
    }),
  }));

  await page.goto("/app/audits/aud_legacy");

  await expect(page.getByText("Reliability impact was not recorded for this saved audit.")).toBeVisible();
  await expect(page.getByText("42", { exact: true })).toBeVisible();
});
