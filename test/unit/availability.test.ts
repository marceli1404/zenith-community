import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GENERIC_ERROR_DEBUG_CONTEXT_PATTERN,
  GENERIC_ERROR_PAGE_SIGNATURES,
  hasGenericErrorPageContent,
} from "../../src/shared/availability";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hasGenericErrorPageContent", () => {
  function setPage(title: string, heading: string, body: string) {
    vi.stubGlobal("document", {
      title,
      body: { innerText: body },
      querySelectorAll: () => [{ innerText: heading }],
    });
  }

  it("detects a generic error title even when the page body is long", () => {
    setPage("Internal Server Error", "Internal Server Error", `Trace details. ${"Additional diagnostic information. ".repeat(20)}`);

    expect(hasGenericErrorPageContent({
      signatures: [...GENERIC_ERROR_PAGE_SIGNATURES],
      debugContextPattern: GENERIC_ERROR_DEBUG_CONTEXT_PATTERN,
    })).toBe(true);
  });

  it("uses debug output to corroborate a generic H1 on a long page", () => {
    setPage(
      "Service diagnostics",
      "503 Service Unavailable",
      `Traceback (most recent call last): ${"File /srv/app.py, line 42, in handler. ".repeat(12)}`,
    );

    expect(hasGenericErrorPageContent({
      signatures: [...GENERIC_ERROR_PAGE_SIGNATURES],
      debugContextPattern: GENERIC_ERROR_DEBUG_CONTEXT_PATTERN,
    })).toBe(true);
  });

  it("does not classify a long article with a generic-sounding H1 as an outage", () => {
    setPage(
      "Gateway guide",
      "502 Bad Gateway",
      `A gateway response is generated when an upstream service fails. ${"Detailed troubleshooting context follows. ".repeat(12)}`,
    );

    expect(hasGenericErrorPageContent({
      signatures: [...GENERIC_ERROR_PAGE_SIGNATURES],
      debugContextPattern: GENERIC_ERROR_DEBUG_CONTEXT_PATTERN,
    })).toBe(false);
  });
});
