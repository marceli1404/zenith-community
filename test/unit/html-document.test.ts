import { describe, it, expect } from "vitest";
import { hasMeaningfulHtmlContent, hasUnverifiedMediaContent, isGenericErrorHtmlDocument, isHtmlDocument, prioritizePageLinks, resolveDocumentBaseHref, resolveHttpUrl } from "../../src/lib/html";

describe("isHtmlDocument", () => {
  it("accepts HTML content types", () => {
    expect(isHtmlDocument("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlDocument("TEXT/HTML")).toBe(true);
    expect(isHtmlDocument("application/xhtml+xml")).toBe(true);
  });

  it("rejects linked files that are not pages", () => {
    expect(isHtmlDocument("text/plain; charset=utf-8", "Contact: mailto:security@example.com")).toBe(false);
    expect(isHtmlDocument("application/pdf")).toBe(false);
    expect(isHtmlDocument("application/xml", "<?xml version=\"1.0\"?><urlset/>")).toBe(false);
    expect(isHtmlDocument("application/json", "{}")).toBe(false);
  });

  it("sniffs the body when there is no content type", () => {
    expect(isHtmlDocument(null, "  <!DOCTYPE html><html><head>")).toBe(true);
    expect(isHtmlDocument("", "<html lang=\"en\">")).toBe(true);
    expect(isHtmlDocument(undefined, "User-agent: *\nDisallow:")).toBe(false);
    expect(isHtmlDocument(null, null)).toBe(false);
  });
});

describe("hasMeaningfulHtmlContent", () => {
  it("rejects documents containing only metadata, scripts, styles, comments and an empty app root", () => {
    expect(hasMeaningfulHtmlContent(`<!doctype html><html><head>
      <title>Example</title><meta name="description" content="A site">
    </head><body><div id="root"></div><script>hydrate()</script><style>.hero{height:100vh}</style><!-- loading --></body></html>`)).toBe(false);
  });

  it("accepts body text but does not treat an unverified media URL as loaded content", () => {
    expect(hasMeaningfulHtmlContent("<html><head><title>Example</title></head><body><h1>Welcome</h1></body></html>")).toBe(true);
    expect(hasMeaningfulHtmlContent('<html><body><img src="/missing.webp"></body></html>')).toBe(false);
    expect(hasUnverifiedMediaContent('<html><body><img src="/missing.webp"></body></html>')).toBe(true);
    expect(hasUnverifiedMediaContent('<html><body><img src=""></body></html>')).toBe(false);
  });

  it("does not count whitespace and empty markup as page content", () => {
    expect(hasMeaningfulHtmlContent("<html><body><main> &nbsp; &#8203; </main><button></button><canvas></canvas></body></html>")).toBe(false);
  });

  it.each([
    "<html><body><script>throw new Error('loading failed')",
    "<html><body><style>.error::after { content: 'not loaded' }",
    "<html><body><template>Application failed to load",
  ])("does not mistake an unclosed raw-text element for page text: %s", (html) => {
    expect(hasMeaningfulHtmlContent(html)).toBe(false);
  });

  it("does not count text in common stylesheet-hidden utility classes", () => {
    expect(hasMeaningfulHtmlContent('<html><body><main class="hidden">Loading failed</main></body></html>')).toBe(false);
    expect(hasMeaningfulHtmlContent('<html><body><main class="visually-hidden">Loading failed</main></body></html>')).toBe(false);
  });

  it("handles self-closing syntax on non-void hidden elements as HTML does", () => {
    expect(hasMeaningfulHtmlContent("<html><body><div hidden/>Internal error</body></html>")).toBe(false);
  });

  it("does not treat invisible named character references as visible copy", () => {
    expect(hasMeaningfulHtmlContent("<html><body>&Tab;&NewLine;&shy;&ZeroWidthSpace;&NoBreak;</body></html>")).toBe(false);
  });

  it("removes comments before finding the body boundary", () => {
    expect(hasMeaningfulHtmlContent("<html><body><!-- </body> --><main>Welcome</main></body></html>")).toBe(true);
  });
});

describe("isGenericErrorHtmlDocument", () => {
  it.each([
    "<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>",
    "<html><body><h1>Internal Server Error</h1><p>Please try again later.</p></body></html>",
    "<html><body><h1>Welcome to nginx!</h1></body></html>",
    "<html><body><h1>This site can't be reached</h1></body></html>",
  ])("recognizes a compact generic error screen: %s", (html) => {
    expect(isGenericErrorHtmlDocument(html)).toBe(true);
  });

  it("does not classify normal pages or longer articles that discuss errors", () => {
    expect(isGenericErrorHtmlDocument("<html><head><title>Example</title></head><body><main>Welcome to our site. Read our latest updates.</main></body></html>")).toBe(false);
    expect(isGenericErrorHtmlDocument("<html><body><h1>What 502 Bad Gateway means</h1><p>A gateway sits between services.</p></body></html>")).toBe(false);
    const longHeadingArticle = `A gateway response is generated when an upstream service fails. ${"Detailed troubleshooting context follows. ".repeat(12)}`;
    expect(isGenericErrorHtmlDocument(`<html><head><title>Gateway guide</title></head><body><h1>502 Bad Gateway</h1><p>${longHeadingArticle}</p></body></html>`)).toBe(false);
    const article = `The 502 Bad Gateway status means a proxy received an invalid response from an upstream server. ${"More troubleshooting details follow. ".repeat(18)}`;
    expect(isGenericErrorHtmlDocument(`<html><body><main>${article}</main></body></html>`)).toBe(false);
  });

  it("recognizes long server error pages from an exact title or a generic heading with debug output", () => {
    const traceback = `Traceback (most recent call last):\n${"  File \\\"/srv/app.py\\\", line 42, in handle_request\n  raise RuntimeError('origin unavailable')\n".repeat(8)}`;
    const longBody = `${traceback} ${"Diagnostic output follows. ".repeat(12)}`;

    expect(isGenericErrorHtmlDocument(`<html><head><title>Internal Server Error</title></head><body><h1>Internal Server Error</h1><pre>${longBody}</pre></body></html>`)).toBe(true);
    expect(isGenericErrorHtmlDocument(`<html><head><title>Service diagnostics</title></head><body><h1>503 Service Unavailable</h1><pre>${longBody}</pre></body></html>`)).toBe(true);
  });

  it("does not use a generic error phrase found only in a comment as the page title", () => {
    expect(isGenericErrorHtmlDocument("<html><head><!-- <title>502 Bad Gateway</title> --><title>Gateway Guide</title></head><body><h1>What 502 Bad Gateway means</h1></body></html>")).toBe(false);
  });
});

describe("hasUnverifiedMediaContent", () => {
  it.each([
    '<video controls><source src="/movie.mp4" type="video/mp4"></video>',
    "<audio controls><source src='/sound.mp3'></audio>",
    '<img srcset="/small.webp 1x, /large.webp 2x" alt="" />',
  ])("recognizes media that Quick Scan cannot confirm loaded: %s", (html) => {
    expect(hasUnverifiedMediaContent(html)).toBe(true);
  });
});

describe("resolveHttpUrl", () => {
  it("resolves relative and absolute HTTP(S) URLs", () => {
    expect(resolveHttpUrl("/about", "https://example.com/home")).toBe("https://example.com/about");
    expect(resolveHttpUrl("HTTP://Other.Example/path", "https://example.com/")).toBe("http://other.example/path");
    expect(resolveHttpUrl("https://other.example/path", "https://example.com/")).toBe("https://other.example/path");
  });

  it("rejects non-HTTP schemes regardless of case", () => {
    for (const href of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "DATA:text/html,hello",
      "vbscript:msgbox(1)",
      "VbScRiPt:msgbox(1)",
      "mailto:security@example.com",
      "tel:+15555555555",
      "ftp://example.com/file",
      "blob:https://example.com/id",
    ]) {
      expect(resolveHttpUrl(href, "https://example.com/")).toBeNull();
    }
  });

  it("ignores empty and fragment-only links", () => {
    expect(resolveHttpUrl("  ", "https://example.com/")).toBeNull();
    expect(resolveHttpUrl("#details", "https://example.com/")).toBeNull();
  });
});

describe("document base and prioritized crawl links", () => {
  it("resolves relative document bases and falls back for unsupported or absent bases", () => {
    expect(resolveDocumentBaseHref("/app/", "https://example.com/index.html")).toBe("https://example.com/app/");
    expect(resolveDocumentBaseHref("https://cdn.example/app/", "https://example.com/index.html")).toBe("https://cdn.example/app/");
    expect(resolveDocumentBaseHref("javascript:void(0)", "https://example.com/index.html")).toBe("https://example.com/index.html");
    expect(resolveDocumentBaseHref(null, "https://example.com/index.html")).toBe("https://example.com/index.html");
  });

  it("prioritizes same-origin pages so external anchors cannot use the whole crawl-link budget", () => {
    const internal = ["https://example.com/app/broken"];
    const external = Array.from({ length: 250 }, (_, i) => `https://external.example/${i}`);
    const links = prioritizePageLinks(internal, external);

    expect(links).toHaveLength(250);
    expect(links[0]).toBe(internal[0]);
    expect(links).not.toContain("https://external.example/249");
  });
});
