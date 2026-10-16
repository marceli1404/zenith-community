import { expect, test } from "@playwright/test";

test("Community landing explains the self-hosted product and links to signup", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /know when your website needs attention/i })).toBeVisible();
  await expect(page.getByText(/self-hosted edition/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /create a community account/i })).toHaveAttribute("href", "/signup");
});

test("public Community information routes render", async ({ page }) => {
  const pages = [
    ["/security", /what Zenith does/i],
    ["/methodology", /how Zenith scores/i],
    ["/contact", /contact the operator/i],
    ["/legal/privacy", /privacy information/i],
    ["/legal/terms", /terms information/i],
  ] as const;

  for (const [path, heading] of pages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
    if (path === "/methodology") {
      await expect(page.getByText(/If robots\.txt disallows the homepage or cannot be read safely, no site pages are checked and the audit is marked Not assessed/i)).toBeVisible();
    }
  }
});

test("login and signup routes render their forms", async ({ page }) => {
  const loginResponse = await page.goto("/login");
  expect(loginResponse?.status()).toBe(200);
  expect(loginResponse?.headers()["x-robots-tag"]).toBe("noindex");
  expect(await loginResponse?.text()).toContain("data-boot-frame");
  await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();

  const signupResponse = await page.goto("/signup");
  expect(signupResponse?.status()).toBe(200);
  expect(signupResponse?.headers()["x-robots-tag"]).toBe("noindex");
  expect(await signupResponse?.text()).toContain("data-boot-frame");
  await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
});

test("app and public status deep links receive the client shell from the Worker", async ({ page }) => {
  for (const [path, robots] of [["/app/sites/site-example", "noindex"], ["/status/public-example", null]] as const) {
    const response = await page.request.get(path, { headers: { "Sec-Fetch-Mode": "navigate" } });
    expect(response.status()).toBe(200);
    expect(response.headers()["x-robots-tag"] ?? null).toBe(robots);
    const html = await response.text();
    expect(html).toContain("data-boot-frame");
    expect(html).not.toContain("Know when your website needs attention.");
  }
});

test("new passwords must contain 15 to 128 characters", async ({ page }) => {
  let signUpRequests = 0;
  await page.route("**/api/auth/sign-up/email", (route) => {
    signUpRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/signup");
  await page.getByRole("textbox", { name: "Name" }).fill("Community User");
  await page.getByRole("textbox", { name: "Email" }).fill("user@example.test");
  const password = page.getByRole("textbox", { name: "Password" });
  await expect(password).toHaveAttribute("maxlength", "128");
  await password.fill("fourteen_chars");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use a password between 15 and 128 characters long.")).toBeVisible();
  expect(signUpRequests).toBe(0);
});

test("password reset uses the same minimum length", async ({ page }) => {
  let resetRequests = 0;
  await page.route("**/api/auth/reset-password", (route) => {
    resetRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/reset-password?token=fixture");
  await page.getByRole("textbox", { name: "New password" }).fill("fourteen_chars");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("Use a password between 15 and 128 characters long.")).toBeVisible();
  expect(resetRequests).toBe(0);
});

test("unknown routes show the not-found page", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist");
  expect(response?.status()).toBe(404);
  expect(await response?.text()).toContain("data-boot-frame");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/this page isn’t here/i);
});
