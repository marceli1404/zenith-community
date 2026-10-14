import { expect, test, type Page } from "@playwright/test";

const SITE_ID = "site_1";
const site = {
  id: SITE_ID,
  name: "Community Demo Site",
  url: "https://example.test",
  origin: "https://example.test",
  status: "verified",
  verificationToken: "zenith-verify=test",
  verificationMethod: "meta_tag",
  statusPageSlug: "community-demo",
  statusPageEnabled: false,
  verifiedAt: Date.UTC(2026, 8, 1),
  createdAt: Date.UTC(2026, 7, 1),
};

async function mockWorkspace(page: Page) {
  await page.route("**/api/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "usr_test", email: "owner@example.com" }, plan: "community", access: { source: "community" } }) }));
  await page.route("**/api/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authProviders: { google: false, github: false }, emailEnabled: true }) }));
  await page.route(`**/api/sites/${SITE_ID}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ site }) }));
  await page.route(`**/api/sites/${SITE_ID}/overview`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    health: { score: 82, auditId: "aud_1", at: Date.UTC(2026, 8, 20) },
    uptime30d: 99.8,
    highPriorityFindings: 2,
    recentAudits: [{ id: "aud_1", status: "completed", score: 82, at: Date.UTC(2026, 8, 20) }],
  }) }));
  await page.route(`**/api/sites/${SITE_ID}/detail`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    monitor: { enabled: 1, last_status_code: 200, last_response_ms: 210, last_ok: 1, last_checked_at: Date.now() },
    uptime: { d1: 100, d7: 99.9, d30: 99.8 },
    series: [],
    incidents: [],
    recentAudits: [{ id: "aud_1", status: "completed", queued_at: Date.UTC(2026, 8, 20), overall_score: 82 }],
  }) }));
  await page.route("**/api/**", (route) => {
    if (route.request().url().includes("/api/me") || route.request().url().includes("/api/config") || route.request().url().includes(`/api/sites/${SITE_ID}`)) return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

test("the site workspace links its Community overview, monitor and settings tabs", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto(`/app/sites/${SITE_ID}`);

  await expect(page.getByRole("heading", { name: site.name, level: 1 })).toBeVisible();
  await expect(page.getByText("82/100", { exact: true })).toBeVisible();
  await expect(page.getByText("99.8%", { exact: true })).toBeVisible();
  await expect(page.getByText("High-priority findings")).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Site sections" });

  await tabs.getByRole("link", { name: "Monitor", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/sites/${SITE_ID}/monitor$`));
  await expect(page.getByText("Monitoring", { exact: true })).toBeVisible();

  await tabs.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/sites/${SITE_ID}/settings$`));
  await expect(page.getByText("Public status page")).toBeVisible();
  await expect(page.getByText("Delete this site")).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Overview", exact: true })).toHaveCount(1);
});

test("a Community status-page setting request sends only the enabled state", async ({ page }) => {
  await mockWorkspace(page);
  let requestBody: unknown;
  await page.route(`**/api/sites/${SITE_ID}/status-page`, (route) => {
    requestBody = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.goto(`/app/sites/${SITE_ID}/settings`);
  await page.getByRole("button", { name: /turn on/i }).click();
  await expect.poll(() => requestBody).toEqual({ enabled: true });
});
