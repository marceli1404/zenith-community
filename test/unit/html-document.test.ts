import { describe, it, expect } from "vitest";
import { isHtmlDocument } from "../../src/lib/html";

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
