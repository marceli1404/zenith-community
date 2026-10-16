import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/env";

const { launchMock } = vi.hoisted(() => ({ launchMock: vi.fn() }));

vi.mock("@cloudflare/puppeteer", () => ({
  default: { launch: launchMock },
}));

import { renderPdf } from "../../src/report/pdf";

function makeBrowser(page: Record<string, unknown> = {}) {
  const pageMock = {
    setContent: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])),
    ...page,
  };
  const browser = {
    newPage: vi.fn().mockResolvedValue(pageMock),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { browser, page: pageMock };
}

const binding = {} as Bindings["BROWSER"];
const env = { BROWSER: binding } as Bindings;

describe("renderPdf", () => {
  beforeEach(() => {
    launchMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("launches the configured Browser Run binding and returns PDF bytes", async () => {
    const { browser, page } = makeBrowser();
    launchMock.mockResolvedValue(browser);

    const result = await renderPdf(env, "<html><body>Report</body></html>");

    expect(launchMock).toHaveBeenCalledWith(binding);
    expect(page.setContent).toHaveBeenCalledWith("<html><body>Report</body></html>", {
      waitUntil: "load",
      timeout: 20_000,
    });
    expect(page.pdf).toHaveBeenCalledWith({
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    expect(result).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("returns null when launch fails before a browser session exists", async () => {
    launchMock.mockRejectedValue(new Error("Browser Run unavailable"));

    await expect(renderPdf(env, "<html></html>")).resolves.toBeNull();
    expect(launchMock).toHaveBeenCalledWith(binding);
  });

  it("closes the browser and returns null when a page cannot be created", async () => {
    const { browser } = makeBrowser();
    browser.newPage.mockRejectedValue(new Error("Page creation failed"));
    launchMock.mockResolvedValue(browser);

    await expect(renderPdf(env, "<html></html>")).resolves.toBeNull();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("closes the browser and returns null when HTML loading fails", async () => {
    const { browser, page } = makeBrowser({
      setContent: vi.fn().mockRejectedValue(new Error("HTML load timed out")),
    });
    launchMock.mockResolvedValue(browser);

    await expect(renderPdf(env, "<html></html>")).resolves.toBeNull();
    expect(page.pdf).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("closes the browser and returns null when page rendering fails", async () => {
    const { browser } = makeBrowser({
      pdf: vi.fn().mockRejectedValue(new Error("PDF protocol failure")),
    });
    launchMock.mockResolvedValue(browser);

    await expect(renderPdf(env, "<html></html>")).resolves.toBeNull();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("keeps a completed PDF when session cleanup itself fails", async () => {
    const { browser } = makeBrowser();
    browser.close.mockRejectedValue(new Error("Session already closed"));
    launchMock.mockResolvedValue(browser);

    await expect(renderPdf(env, "<html></html>")).resolves.toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(browser.close).toHaveBeenCalledOnce();
  });
});
