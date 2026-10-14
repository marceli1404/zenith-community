import { expect, test, type Page, type Route } from "@playwright/test";

const account = {
  profile: { name: "Community User", email: "review@example.com", emailVerified: true, createdAt: Date.UTC(2026, 0, 12), twoFactorEnabled: false },
  connectedProviders: ["credential"],
  notificationPreferences: { downtime: true, recovery: true, auditFinished: true },
  sessions: [
    { id: "ses_current", expiresAt: Date.UTC(2026, 11, 10), createdAt: Date.UTC(2026, 8, 1), updatedAt: Date.UTC(2026, 8, 11), userAgent: "Mozilla/5.0 Chrome/140.0", current: true },
  ],
};

async function mockSettings(page: Page, onMutation?: (route: Route) => void) {
  await page.route("**/api/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "usr_test", email: account.profile.email }, plan: "community", access: { source: "community" } }) }));
  await page.route("**/api/config", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authProviders: { google: false, github: false }, emailEnabled: true }) }));
  await page.route("**/api/account/settings**", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(account) });
    onMutation?.(route);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/**", async (route) => {
    if (route.request().url().includes("/api/me") || route.request().url().includes("/api/config") || route.request().url().includes("/api/account/settings")) return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

test("Community account settings expose profile, notifications, security and data controls", async ({ page }) => {
  await mockSettings(page);
  await page.goto("/app/settings");

  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign-in security" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
  await expect(page.getByText("Billing", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Weekly digest", { exact: true })).toHaveCount(0);
});

test("profile and notification updates send Community settings payloads", async ({ page }) => {
  const mutations: Array<{ path: string; body: unknown }> = [];
  await mockSettings(page, (route) => mutations.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() }));
  await page.goto("/app/settings");

  await page.getByLabel("Name").fill("Marceli P");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect.poll(() => mutations).toContainEqual({ path: "/api/account/settings/profile", body: { name: "Marceli P" } });

  await page.getByLabel("Downtime alerts").uncheck();
  await expect.poll(() => mutations).toContainEqual({ path: "/api/account/settings/notifications", body: { downtime: false, recovery: true, auditFinished: true } });
});
