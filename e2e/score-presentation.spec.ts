import { expect, test } from "@playwright/test";

test("reports identify a completed audit with no assessed score", async ({ page }) => {
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
  await page.route("**/api/audits", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ audits: [{
      id: "aud_robots_blocked",
      status: "completed",
      queued_at: Date.now(),
      completed_at: Date.now(),
      result_id: "result_robots_blocked",
      overall_score: null,
      site_name: "Example site",
      origin: "https://example.test",
    }] }),
  }));

  await page.goto("/app/reports");

  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByText("Not assessed", { exact: true })).toBeVisible();
  await expect(page.getByText("0", { exact: true })).toHaveCount(0);
});

test("audit history and reports label a zero outage score as unavailable", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "usr_test", email: "owner@example.com" }, plan: "community", access: { source: "community" } }) }));
  await page.route("**/api/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authProviders: { google: false, github: false }, emailEnabled: false }) }));
  await page.route("**/api/audits", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ audits: [{ id: "aud_down", status: "completed", source: "manual", queued_at: Date.now(), completed_at: Date.now(), result_id: "result_down", overall_score: 0, homepage_unavailable: 1, site_name: "Down site", origin: "https://down.example" }] }),
  }));

  await page.goto("/app/audits");
  await expect(page.getByText("0 · Homepage could not be assessed", { exact: true })).toBeVisible();
  await page.goto("/app/reports");
  await expect(page.getByText("0 · Homepage could not be assessed", { exact: true })).toBeVisible();
});

test("dashboard separates unassessed audits from monitoring paused by the site limit", async ({ page }) => {
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
  await page.route("**/api/sites", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ sites: [{
      id: "site_test",
      name: "Example site",
      origin: "https://example.test",
      status: "verified",
      latestScore: null,
      latestAuditId: "aud_robots_blocked",
      lastOk: null,
      lastCheckedAt: null,
      uptime24h: null,
      openIncident: false,
      latestCategoryScores: null,
      monitorEnabled: false,
      nextCheckAt: null,
      monitoringPaused: true,
    }] }),
  }));
  await page.route("**/api/audits", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ audits: [{
      id: "aud_robots_blocked",
      status: "completed",
      queued_at: Date.now(),
      completed_at: Date.now(),
      overall_score: null,
      site_name: "Example site",
      origin: "https://example.test",
    }] }),
  }));
  await page.route("**/api/dashboard/incidents", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ incidents: [] }),
  }));
  await page.route("**/api/dashboard/attention", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ findings: [], coverage: { totalSites: 1, auditedSites: 1 }, totalFindings: 0, truncated: false }),
  }));

  await page.goto("/app");

  await expect(page.getByRole("img", { name: "1 of 1 sites audited; none had an assessed score." })).toBeVisible();
  await expect(page.getByText("Not assessed", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Monitoring paused for one site" })).toBeVisible();
  await expect(page.getByText("Monitoring is paused for one site because the current site limit has been reached.", { exact: false })).toBeVisible();
  await expect(page.getByText("No site pages were assessed in the latest audits.", { exact: true })).toBeVisible();
  await expect(page.getByText("0", { exact: true })).toHaveCount(0);
});

test("overview, site list and score history disclose homepage outages", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "usr_test", email: "owner@example.com" }, plan: "community", access: { source: "community" } }) }));
  await page.route("**/api/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authProviders: { google: false, github: false }, emailEnabled: false }) }));
  await page.route("**/api/sites", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sites: [{
    id: "site_down", name: "Down site", origin: "https://down.example", status: "verified", latestScore: 0, homepageUnavailable: true, latestAuditId: "aud_down", latestAuditAt: Date.now(), previousScore: 80, latestCategoryScores: null,
    uptime24h: null, lastOk: null, lastCheckedAt: null, openIncident: false, monitorEnabled: true, nextCheckAt: null, monitoringPaused: false,
  }] }) }));
  await page.route("**/api/audits", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ audits: [{ id: "aud_down", status: "completed", queued_at: Date.now(), completed_at: Date.now(), overall_score: 0, homepage_unavailable: 1, site_name: "Down site", origin: "https://down.example", source: "manual" }] }) }));
  await page.route("**/api/dashboard/incidents", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ incidents: [] }) }));
  await page.route("**/api/dashboard/attention", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ findings: [], coverage: { totalSites: 1, auditedSites: 1 }, totalFindings: 0, truncated: false }) }));
  await page.route("**/api/sites/site_down/detail", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ recentAudits: [{ id: "aud_down", status: "completed", queued_at: Date.now(), overall_score: 0, homepage_unavailable: 1 }] }) }));

  await page.goto("/app");
  await expect(page.getByRole("img", { name: /1 homepage is unavailable/ })).toBeVisible();
  await expect(page.getByText("0 · Homepage could not be assessed", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Homepage could not be assessed", { exact: true })).toBeVisible();
  await expect(page.getByText(/0\/ 100 · Homepage could not be assessed/)).toBeVisible();
  await expect(page.getByRole("img", { name: /homepage could not be assessed, score 0/ })).toBeVisible();

  await page.goto("/app/sites");
  await expect(page.getByText("0 · Homepage could not be assessed", { exact: true })).toBeVisible();
});
