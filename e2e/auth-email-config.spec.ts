import { expect, test } from "@playwright/test";

test("email-disabled installations hide password reset and explain why", async ({ page }) => {
  await page.route("**/api/config", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authProviders: { google: false, github: false }, emailEnabled: false }),
  }));

  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveCount(0);

  await page.goto("/forgot-password");
  await expect(page.getByText(/password reset email isn't configured/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send reset link" })).toHaveCount(0);
});

test("configured email delivery exposes the password reset path", async ({ page }) => {
  await page.route("**/api/config", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authProviders: { google: false, github: false }, emailEnabled: true }),
  }));

  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Forgot password?" })).toBeVisible();

  await page.goto("/forgot-password");
  await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
});
