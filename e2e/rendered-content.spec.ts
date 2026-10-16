import { expect, test } from "@playwright/test";
import { hasRenderedPageContent } from "../src/audit/rendered-content";
import {
  GENERIC_ERROR_DEBUG_CONTEXT_PATTERN,
  GENERIC_ERROR_PAGE_SIGNATURES,
  hasGenericErrorPageContent,
} from "../src/shared/availability";

test("rendered-content detection accepts visible text in display:contents wrappers", async ({ page }) => {
  await page.setContent("<style>.wrapper{display:contents}</style><main class=wrapper>Site content</main>");
  expect(await page.evaluate(hasRenderedPageContent)).toBe(true);
});

test("rendered-content detection rejects CSS-hidden and clipped text", async ({ page }) => {
  await page.setContent(`<style>
    .display-hidden{display:none}
    .visibility-hidden{visibility:hidden}
    .opacity-hidden{opacity:0}
    .content-hidden{content-visibility:hidden}
    .clip-hidden{clip:rect(0,0,0,0);position:absolute}
    .path-hidden{clip-path:inset(50%)}
  </style>
  <main>
    <span class=display-hidden>Hidden one</span>
    <span class=visibility-hidden>Hidden two</span>
    <span class=opacity-hidden>Hidden three</span>
    <span class=content-hidden>Hidden four</span>
    <span class=clip-hidden>Hidden five</span>
    <span class=path-hidden>Hidden six</span>
  </main>`);
  expect(await page.evaluate(hasRenderedPageContent)).toBe(false);
});

test("rendered-content detection rejects empty controls and accessible labels alone", async ({ page }) => {
  await page.setContent('<button aria-label="Continue"></button><canvas width="100" height="100"></canvas>');
  expect(await page.evaluate(hasRenderedPageContent)).toBe(false);
});

test("rendered-content detection accepts a loaded image and rejects an unloaded image", async ({ page }) => {
  await page.setContent('<img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=">');
  await page.locator("img").evaluate((image) => image.decode());
  expect(await page.evaluate(hasRenderedPageContent)).toBe(true);

  await page.setContent('<img src="/missing-image.gif">');
  expect(await page.evaluate(hasRenderedPageContent)).toBe(false);
});

test("rendered-content detection leaves same-origin iframe content to the child-frame check", async ({ page }) => {
  await page.setContent('<iframe title="embedded content" srcdoc="&lt;main&gt;Embedded report&lt;/main&gt;"></iframe>');
  expect(await page.evaluate(hasRenderedPageContent)).toBe(false);
  const visibleChild = page.frames().find((frame) => frame !== page.mainFrame());
  expect(visibleChild).toBeDefined();
  expect(await visibleChild!.evaluate(hasRenderedPageContent)).toBe(true);

  await page.setContent('<iframe title="empty content" srcdoc=""></iframe>');
  expect(await page.evaluate(hasRenderedPageContent)).toBe(false);

  await page.setContent('<iframe hidden title="hidden content" srcdoc="&lt;main&gt;Embedded report&lt;/main&gt;"></iframe>');
  expect(await page.evaluate(hasRenderedPageContent)).toBe(false);

  await page.setContent('<iframe title="hidden text" srcdoc="&lt;style&gt;main{display:none}&lt;/style&gt;&lt;main&gt;Hidden report&lt;/main&gt;"></iframe>');
  expect(await page.evaluate(hasRenderedPageContent)).toBe(false);
  const hiddenChild = page.frames().find((frame) => frame !== page.mainFrame());
  expect(hiddenChild).toBeDefined();
  expect(await hiddenChild!.evaluate(hasRenderedPageContent)).toBe(false);
});

test("iframe visibility uses the same content-visibility and clipping checks as page content", async ({ page }) => {
  await page.setContent('<div style="content-visibility:hidden"><iframe srcdoc="Embedded report"></iframe></div>');
  expect(await page.locator("iframe").evaluate(hasRenderedPageContent)).toBe(false);

  await page.setContent('<div style="clip-path:inset(50%)"><iframe srcdoc="Embedded report"></iframe></div>');
  expect(await page.locator("iframe").evaluate(hasRenderedPageContent)).toBe(false);

  await page.setContent('<div style="overflow:hidden;width:0;height:0"><iframe style="width:200px;height:100px" srcdoc="Embedded report"></iframe></div>');
  expect(await page.locator("iframe").evaluate(hasRenderedPageContent)).toBe(false);
});

test("generic error-screen detection can classify a child frame's own error page", async ({ page }) => {
  await page.setContent('<iframe srcdoc="&lt;title&gt;502 Bad Gateway&lt;/title&gt;&lt;main&gt;&lt;h1&gt;502 Bad Gateway&lt;/h1&gt;&lt;/main&gt;"></iframe>');
  const childFrame = page.frames().find((frame) => frame !== page.mainFrame());
  expect(childFrame).toBeDefined();
  expect(await childFrame!.evaluate(hasGenericErrorPageContent, { signatures: [...GENERIC_ERROR_PAGE_SIGNATURES] })).toBe(true);
});

test("generic error-screen detection rejects short server failures without matching longer articles", async ({ page }) => {
  await page.setContent("<title>502 Bad Gateway</title><main><h1>502 Bad Gateway</h1></main>");
  expect(await page.evaluate(hasGenericErrorPageContent, { signatures: [...GENERIC_ERROR_PAGE_SIGNATURES] })).toBe(true);

  await page.setContent(`<title>Gateway troubleshooting</title><main>
    <h1>Understanding 502 Bad Gateway responses</h1>
    <p>${"This article explains reverse proxies and upstream errors. ".repeat(12)}</p>
  </main>`);
  expect(await page.evaluate(hasGenericErrorPageContent, { signatures: [...GENERIC_ERROR_PAGE_SIGNATURES] })).toBe(false);

  await page.setContent(`<title>Gateway troubleshooting</title><main>
    <h1>What 502 Bad Gateway means</h1>
    <p>A proxy exchanges requests between systems.</p>
  </main>`);
  expect(await page.evaluate(hasGenericErrorPageContent, { signatures: [...GENERIC_ERROR_PAGE_SIGNATURES] })).toBe(false);

  await page.setContent(`<title>Gateway guide</title><main>
    <h1>502 Bad Gateway</h1>
    <p>${"This guide explains proxies and upstream services. ".repeat(8)}</p>
  </main>`);
  expect(await page.evaluate(hasGenericErrorPageContent, { signatures: [...GENERIC_ERROR_PAGE_SIGNATURES] })).toBe(false);
});

test("generic error-screen detection catches long error pages without misclassifying articles", async ({ page }) => {
  const trace = `Traceback (most recent call last): ${"File /srv/app.py, line 42, in handler. ".repeat(12)}`;
  const debugPattern = GENERIC_ERROR_DEBUG_CONTEXT_PATTERN;
  const options = {
    signatures: [...GENERIC_ERROR_PAGE_SIGNATURES],
    debugContextPattern: debugPattern,
  };

  await page.setContent(`<title>Internal Server Error</title><main><h1>Internal Server Error</h1><pre>${trace}</pre></main>`);
  expect(await page.evaluate(hasGenericErrorPageContent, options)).toBe(true);

  await page.setContent(`<title>Service diagnostics</title><main><h1>503 Service Unavailable</h1><pre>${trace}</pre></main>`);
  expect(await page.evaluate(hasGenericErrorPageContent, options)).toBe(true);

  await page.setContent(`<title>Gateway guide</title><main><h1>502 Bad Gateway</h1><p>${"This guide explains proxies and upstream services. ".repeat(8)}</p></main>`);
  expect(await page.evaluate(hasGenericErrorPageContent, options)).toBe(false);
});
