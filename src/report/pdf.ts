/**
 * Render report HTML to a PDF using Browser Rendering. The HTML is fully
 * self-contained (no external requests), so no network policy concerns apply —
 * but we still set a short timeout and always close the browser.
 */

import puppeteer from "@cloudflare/puppeteer";
import type { Bindings } from "../env";

export async function renderPdf(env: Bindings, html: string): Promise<Uint8Array | null> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
    const pdf = (await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    })) as unknown as Uint8Array;
    return pdf;
  } catch (err) {
    console.error("PDF render failed", err instanceof Error ? err.message : err);
    return null;
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}
