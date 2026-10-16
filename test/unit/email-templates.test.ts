import { describe, expect, it } from "vitest";
import { renderTemplate } from "../../src/lib/email/templates";

describe("email template escaping", () => {
  it("keeps a user-controlled site name as text in HTML emails", () => {
    const rendered = renderTemplate("site_down", {
      appName: "Zenith Community",
      appUrl: "https://example.com",
      data: { siteName: '<img src=x onerror="alert(1)">' },
    });

    expect(rendered.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(rendered.html).not.toContain('<img src=x onerror="alert(1)">');
  });
});
