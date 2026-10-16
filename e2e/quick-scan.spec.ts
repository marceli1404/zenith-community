import { expect, test } from "@playwright/test";

async function mockPublicConfig(page: import("@playwright/test").Page, config: Record<string, unknown>) {
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: null }),
  }));
  await page.route("**/api/config", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authProviders: { google: false, github: false }, emailEnabled: false, ...config }),
  }));
}

test("a failed homepage displays zero and leaves technical categories unassessed", async ({ page }) => {
  await mockPublicConfig(page, { environment: "preview", isProduction: false, turnstileSiteKey: "" });
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/scan", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        url: "https://unavailable.example/",
        finalUrl: "https://unavailable.example/",
        score: { overall: 0, categories: { security: null, accessibility: null, performance: null, seo: null }, reliabilityDeduction: 0 },
        topFindings: [{
          ruleId: "reliability.homepage-unavailable",
          category: "reliability",
          severity: "critical",
          title: "Homepage could not be assessed",
          description: "The homepage could not be reached because of a DNS or network error. The site could not be assessed.",
          recommendation: "Restore access to the homepage, then run the scan again.",
        }],
        additionalFindingCount: 0,
        robotsTxtFound: false,
        sitemapFound: false,
        brokenLinks: 0,
        checkedLinks: 0,
        httpsRedirects: false,
      }),
    });
  });

  await page.goto("/");
  await page.getByLabel("Website address").fill("https://unavailable.example/");
  await page.getByRole("button", { name: "Check site" }).click();

  await expect(page.getByRole("heading", { name: "https://unavailable.example/" })).toBeVisible();
  await expect(page.getByText("0/100 · Unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("Unassessed", { exact: true })).toHaveCount(4);
  await expect(page.getByRole("status").filter({ hasText: "Technical categories are unassessed." })).toBeVisible();
  await expect(page.getByText("Homepage could not be assessed; score set to 0")).toBeVisible();
  await expect(page.getByText("Not checked; homepage could not be assessed")).toBeVisible();
  await expect(page.getByText("Not checked", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Create an account to monitor this site" })).toBeVisible();
  expect(submitted).toMatchObject({ url: "https://unavailable.example/" });
});

test("a rate-limited homepage is not scored as a site outage", async ({ page }) => {
  await mockPublicConfig(page, { environment: "preview", isProduction: false, turnstileSiteKey: "" });
  await page.route("**/api/scan", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      url: "https://limited.example/",
      finalUrl: "https://limited.example/",
      score: { overall: null, categories: { security: null, accessibility: null, performance: null, seo: null }, reliabilityDeduction: null },
      topFindings: [{
        ruleId: "reliability.analysis-incomplete",
        category: "reliability",
        severity: "info",
        title: "Quick Scan was rate-limited",
        description: "The homepage returned HTTP 429 and limited the scanner, so it could not be assessed. This does not confirm whether visitors can access it.",
        recommendation: "Wait for the site's rate limit to reset, then run Quick Scan again.",
      }],
      additionalFindingCount: 0,
      robotsTxtFound: true,
      sitemapFound: null,
      brokenLinks: 0,
      checkedLinks: 0,
      httpsRedirects: null,
    }),
  }));

  await page.goto("/");
  await page.getByLabel("Website address").fill("https://limited.example/");
  await page.getByRole("button", { name: "Check site" }).click();

  await expect(page.locator(".lx-result__score")).toHaveText("Not assessed");
  await expect(page.locator(".lx-result__score")).not.toContainText("/100");
  await expect(page.getByRole("status")).toContainText("This does not confirm whether visitors can access it.");
  await expect(page.getByText("Not checked; site not assessed")).toBeVisible();
  await expect(page.getByText("Reliability impact: Not assessed")).toBeVisible();
});

test("a short generic server-error response cannot receive a high Quick Scan score", async ({ page }) => {
  await mockPublicConfig(page, { environment: "preview", isProduction: false, turnstileSiteKey: "" });
  await page.route("**/api/scan", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      url: "https://unavailable.example/",
      finalUrl: "https://unavailable.example/",
      score: { overall: 0, categories: { security: null, accessibility: null, performance: null, seo: null }, reliabilityDeduction: 0 },
      topFindings: [{
        ruleId: "reliability.homepage-unavailable",
        category: "reliability",
        severity: "critical",
        title: "Homepage response matches a server-error pattern",
        description: "The homepage returned HTTP 200, but its short HTML response matches a common server-error pattern. Quick Scan does not render the page; it treats this response as unavailable and sets the score to 0.",
        recommendation: "Restore the intended homepage response, then run Quick Scan again.",
      }],
      additionalFindingCount: 0,
      robotsTxtFound: false,
      sitemapFound: null,
      brokenLinks: 0,
      checkedLinks: 0,
      httpsRedirects: null,
    }),
  }));

  await page.goto("/");
  await page.getByLabel("Website address").fill("https://unavailable.example/");
  await page.getByRole("button", { name: "Check site" }).click();

  await expect(page.getByText("0/100 · Unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("Homepage response matches a server-error pattern")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Quick Scan does not render the page" })).toBeVisible();
  await expect(page.getByText("Unassessed", { exact: true })).toHaveCount(4);
});

test("a robots-blocked homepage is not assessed or assigned a score", async ({ page }) => {
  await mockPublicConfig(page, { environment: "preview", isProduction: false, turnstileSiteKey: "" });
  await page.route("**/api/scan", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      url: "https://private.example/",
      finalUrl: "https://private.example/",
      score: { overall: null, categories: { security: null, accessibility: null, performance: null, seo: null }, reliabilityDeduction: null },
      topFindings: [{
        ruleId: "reliability.robots-disallowed",
        category: "reliability",
        severity: "info",
        title: "Scan not assessed because of robots.txt",
        description: "robots.txt disallows the scanner from requesting /; no site pages were assessed.",
        recommendation: "Permit the crawler if you want this site assessed.",
      }],
      additionalFindingCount: 0,
      robotsTxtFound: true,
      sitemapFound: false,
      brokenLinks: 0,
      checkedLinks: 0,
      httpsRedirects: null,
    }),
  }));

  await page.goto("/");
  await page.getByLabel("Website address").fill("https://private.example/");
  await page.getByRole("button", { name: "Check site" }).click();

  await expect(page.getByLabel("Overall score not assessed")).toBeVisible();
  await expect(page.getByText("Unassessed", { exact: true })).toHaveCount(4);
  await expect(page.getByRole("status").filter({ hasText: "No score was calculated; technical categories are unassessed." })).toBeVisible();
  await expect(page.getByText("Checked; scan blocked by robots policy")).toBeVisible();
  await expect(page.getByText("Not checked; site not assessed")).toBeVisible();
  await expect(page.locator(".lx-result__score")).toHaveText("Not assessed");
  await expect(page.locator(".lx-result__score")).not.toContainText("/100");
});

test("an incomplete link scan withholds the overall score and explains the coverage limit", async ({ page }) => {
  await mockPublicConfig(page, { environment: "preview", isProduction: false, turnstileSiteKey: "" });
  await page.route("**/api/scan", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      url: "https://many-links.example/",
      finalUrl: "https://many-links.example/",
      score: { overall: null, categories: { security: 100, accessibility: 100, performance: 100, seo: 100 }, reliabilityDeduction: 0 },
      topFindings: [],
      additionalFindingCount: 0,
      robotsTxtFound: true,
      sitemapFound: true,
      brokenLinks: 0,
      checkedLinks: 8,
      linkCoverage: { discovered: 9, discoveryTruncated: true, checked: 8, limit: 8, omittedByLimit: 1, blockedByUnsafePath: 0, blockedByRobots: 0, blockedBySafety: 0, rateLimited: 0, complete: false },
      httpsRedirects: true,
    }),
  }));

  await page.goto("/");
  await page.getByLabel("Website address").fill("https://many-links.example/");
  await page.getByRole("button", { name: "Check site" }).click();

  await expect(page.getByLabel("Overall score not fully assessed")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Quick Scan checked 8 of at least 9 discovered same-origin links" })).toContainText("scan limit left at least 1 unchecked");
  await expect(page.getByRole("status").filter({ hasText: "Quick Scan checked 8 of at least 9 discovered same-origin links" })).toContainText("category scores below cover the homepage only");
  await expect(page.getByText("100/100", { exact: true })).toHaveCount(4);
  await expect(page.locator(".lx-result__score")).not.toContainText("/100");
  await expect(page.getByText("Redirect detected", { exact: true })).toBeVisible();
});

test("a rate-limited link is shown as unverified and withholds the overall score", async ({ page }) => {
  await mockPublicConfig(page, { environment: "preview", isProduction: false, turnstileSiteKey: "" });
  await page.route("**/api/scan", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      url: "https://limited.example/",
      finalUrl: "https://limited.example/",
      score: { overall: null, categories: { security: 100, accessibility: 100, performance: 100, seo: 100 }, reliabilityDeduction: 0 },
      topFindings: [{ ruleId: "reliability.link-coverage-incomplete", category: "reliability", severity: "info", title: "Quick Scan did not check every discovered link", description: "A link was rate limited, so Quick Scan withheld the overall score.", recommendation: "Try again later." }],
      additionalFindingCount: 0,
      robotsTxtFound: true,
      sitemapFound: true,
      brokenLinks: 0,
      checkedLinks: 0,
      linkCoverage: { discovered: 1, discoveryTruncated: false, checked: 0, limit: 8, omittedByLimit: 0, blockedByUnsafePath: 0, blockedByRobots: 0, blockedBySafety: 0, rateLimited: 1, complete: false },
      httpsRedirects: true,
    }),
  }));

  await page.goto("/");
  await page.getByLabel("Website address").fill("https://limited.example/");
  await page.getByRole("button", { name: "Check site" }).click();

  await expect(page.getByLabel("Overall score not fully assessed")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Rate limits prevented confirming 1 link.");
  await expect(page.locator(".lx-scan-facts").getByText("0 found among 0 checked")).toBeVisible();
});

test("a truncated homepage is shown as not assessed without a numeric score", async ({ page }) => {
  await mockPublicConfig(page, { environment: "preview", isProduction: false, turnstileSiteKey: "" });
  await page.route("**/api/scan", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      url: "https://large.example/",
      finalUrl: "https://large.example/",
      score: { overall: null, categories: { security: null, accessibility: null, performance: null, seo: null }, reliabilityDeduction: null },
      topFindings: [{
        ruleId: "reliability.analysis-truncated",
        category: "reliability",
        severity: "info",
        title: "Quick Scan could not fully assess the homepage",
        description: "The homepage response exceeded the 1.5 MB scan limit, so Quick Scan could not check all of its content. No score was calculated.",
        recommendation: "Reduce the homepage response size, then run Quick Scan again.",
      }],
      additionalFindingCount: 0,
      robotsTxtFound: false,
      sitemapFound: null,
      brokenLinks: 0,
      checkedLinks: 0,
      httpsRedirects: null,
    }),
  }));

  await page.goto("/");
  await page.getByLabel("Website address").fill("https://large.example/");
  await page.getByRole("button", { name: "Check site" }).click();

  await expect(page.getByLabel("Overall score not assessed")).toBeVisible();
  await expect(page.getByText("Unassessed", { exact: true })).toHaveCount(4);
  await expect(page.getByText("Quick Scan could not fully assess the homepage")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "No score was calculated; technical categories are unassessed." })).toBeVisible();
  await expect(page.locator(".lx-result__score")).toHaveText("Not assessed");
  await expect(page.locator(".lx-result__score")).not.toContainText("/100");
});

test("media-only homepage content is not assigned a score without browser verification", async ({ page }) => {
  await mockPublicConfig(page, { environment: "preview", isProduction: false, turnstileSiteKey: "" });
  await page.route("**/api/scan", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      url: "https://media.example/",
      finalUrl: "https://media.example/",
      score: { overall: null, categories: { security: null, accessibility: null, performance: null, seo: null }, reliabilityDeduction: null },
      topFindings: [{
        ruleId: "reliability.content-unverified",
        category: "reliability",
        severity: "info",
        title: "Quick scan could not verify page content",
        description: "The homepage returned media but no readable text. Quick Scan does not render the page, so it could not confirm whether the media loaded. No score was calculated.",
        recommendation: "Run a browser-rendered audit to check the page, or publish readable text on the homepage.",
      }],
      additionalFindingCount: 0,
      robotsTxtFound: true,
      sitemapFound: null,
      brokenLinks: 0,
      checkedLinks: 0,
      httpsRedirects: null,
    }),
  }));

  await page.goto("/");
  await page.getByLabel("Website address").fill("https://media.example/");
  await page.getByRole("button", { name: "Check site" }).click();

  await expect(page.getByLabel("Overall score not assessed")).toBeVisible();
  await expect(page.getByText("Unassessed", { exact: true })).toHaveCount(4);
  await expect(page.getByRole("status").filter({ hasText: "No score was calculated; technical categories are unassessed." })).toBeVisible();
  await expect(page.locator(".lx-result__score")).not.toContainText("/100");
});

test("a known state-changing URL is shown without a score", async ({ page }) => {
  await mockPublicConfig(page, { environment: "preview", isProduction: false, turnstileSiteKey: "" });
  await page.route("**/api/scan", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      url: "https://example.com/unsubscribe?token=secret",
      finalUrl: "https://example.com/unsubscribe?token=secret",
      score: { overall: null, categories: { security: null, accessibility: null, performance: null, seo: null }, reliabilityDeduction: null },
      topFindings: [{
        ruleId: "reliability.unsafe-path",
        category: "reliability",
        severity: "info",
        title: "Scan not assessed because the requested path is unsafe",
        description: "The requested path may change site state. No site pages were assessed.",
        recommendation: "Submit a read-only page URL, then run the scan again.",
      }],
      additionalFindingCount: 0,
      robotsTxtFound: false,
      sitemapFound: false,
      brokenLinks: 0,
      checkedLinks: 0,
      httpsRedirects: null,
    }),
  }));

  await page.goto("/");
  await page.getByLabel("Website address").fill("https://example.com/unsubscribe?token=secret");
  await page.getByRole("button", { name: "Check site" }).click();

  await expect(page.getByLabel("Overall score not assessed")).toBeVisible();
  await expect(page.getByText("Not checked", { exact: true })).toHaveCount(3);
});

test("an unreachable HTTP endpoint is reported as unverified", async ({ page }) => {
  await mockPublicConfig(page, { environment: "preview", isProduction: false, turnstileSiteKey: "" });
  await page.route("**/api/scan", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      score: { overall: 97, categories: { security: 97, accessibility: 100, performance: 100, seo: 100 }, reliabilityDeduction: 0 },
      topFindings: [],
      additionalFindingCount: 0,
      robotsTxtFound: true,
      sitemapFound: true,
      brokenLinks: 0,
      checkedLinks: 4,
      httpsRedirects: null,
    }),
  }));

  await page.goto("/");
  await page.getByLabel("Website address").fill("https://example.com/");
  await page.getByRole("button", { name: "Check site" }).click();

  await expect(page.getByText("Not verified", { exact: true })).toBeVisible();
});

test("quick scan labels match the shared score bands at every boundary", async ({ page }) => {
  await mockPublicConfig(page, { environment: "preview", isProduction: false, turnstileSiteKey: "" });
  let currentScore = 0;
  await page.route("**/api/scan", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      score: { overall: currentScore, categories: { security: currentScore, accessibility: currentScore, performance: currentScore, seo: currentScore }, reliabilityDeduction: 0 },
      topFindings: [],
      additionalFindingCount: 0,
      robotsTxtFound: true,
      sitemapFound: true,
      brokenLinks: 0,
      checkedLinks: 4,
      httpsRedirects: true,
    }),
  }));

  await page.goto("/");
  for (const [score, label] of [[39, "Poor"], [40, "Needs attention"], [69, "Needs attention"], [70, "Fair"], [89, "Fair"], [90, "Excellent"], [100, "Excellent"]] as const) {
    currentScore = score;
    await page.getByLabel("Website address").fill(`https://example-${score}.com/`);
    await page.getByRole("button", { name: "Check site" }).click();
    await expect(page.getByText(`${score}/100 · ${label}`, { exact: true })).toBeVisible();
  }
});

test("a direct IP target explains that the scan requires a hostname", async ({ page }) => {
  await mockPublicConfig(page, { environment: "preview", isProduction: false, turnstileSiteKey: "" });
  await page.route("**/api/scan", (route) => route.fulfill({
    status: 400,
    contentType: "application/json",
    body: JSON.stringify({ error: "Cloudflare Workers cannot fetch URLs that use an IP address directly. Enter the site's hostname instead." }),
  }));

  await page.goto("/");
  await page.getByLabel("Website address").fill("https://8.8.8.8/");
  await page.getByRole("button", { name: "Check site" }).click();

  await expect(page.getByRole("alert")).toHaveText("Cloudflare Workers cannot fetch URLs that use an IP address directly. Enter the site's hostname instead.");
});

test("production quick scans stay disabled until a widget site key is configured", async ({ page }) => {
  await mockPublicConfig(page, { environment: "production", isProduction: true, turnstileSiteKey: "" });
  let scanRequests = 0;
  await page.route("**/api/scan", (route) => {
    scanRequests += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unconfigured" }) });
  });

  await page.goto("/");

  await expect(page.getByRole("button", { name: "Check site" })).toBeDisabled();
  await expect(page.getByText("Quick Scan is disabled because this installation has no Turnstile site key.")).toBeVisible();
  expect(scanRequests).toBe(0);
});

test("configured Turnstile uses the scan action and submits its one-time token", async ({ page }) => {
  await mockPublicConfig(page, { environment: "production", isProduction: true, turnstileSiteKey: "site-key-test" });
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js**", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: `window.turnstile = {
      render: (element, options) => { window.__turnstileAction = options.action; setTimeout(() => options.callback("single-use-test-token"), 0); return "test-widget"; },
      reset: () => {},
      remove: () => {}
    };`,
  }));
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/scan", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        url: "https://example.com/",
        finalUrl: "https://example.com/",
        score: { overall: 100, categories: { security: 100, accessibility: 100, performance: 100, seo: 100 }, reliabilityDeduction: 0 },
        topFindings: [],
        additionalFindingCount: 0,
        robotsTxtFound: true,
        sitemapFound: true,
        brokenLinks: 0,
        checkedLinks: 4,
        httpsRedirects: true,
      }),
    });
  });

  await page.goto("/");
  await page.getByLabel("Website address").fill("https://example.com/");
  await page.getByRole("button", { name: "Check site" }).click();

  await expect(page.getByRole("heading", { name: "https://example.com/" })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __turnstileAction?: string }).__turnstileAction)).toBe("scan");
  expect(submitted).toMatchObject({ url: "https://example.com/", turnstileToken: "single-use-test-token" });
});
