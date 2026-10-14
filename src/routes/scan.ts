/**
 * Public free quick-scan endpoint. Protected by Turnstile + server-side IP rate
 * limiting + SSRF validation. Available without an account.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../middleware";
import { clientIp } from "../middleware";
import { verifyTurnstile } from "../lib/turnstile";
import { quickScan } from "../lib/scan";
import { validatePublicTarget } from "@shared/ssrf";

const scan = new Hono<AppEnv>();

const bodySchema = z.object({
  url: z.string().min(1).max(2048),
  turnstileToken: z.string().optional(),
});

scan.post("/", async (c) => {
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "A website URL is required." }, 400);
  }
  const { url, turnstileToken } = parsed.data;

  // SSRF validation up front (before any rate-limit spend or network call).
  const target = validatePublicTarget(url);
  if (!target.ok) {
    return c.json({ error: target.reason, code: target.code }, 400);
  }

  // Bot protection (layered with the IP rate limiter below).
  const ip = clientIp(c);
  const verdict = await verifyTurnstile(c.env, turnstileToken, ip, "scan");
  if (!verdict.ok) {
    if (verdict.reason === "not_configured_in_production" || verdict.reason === "verify_unavailable") {
      // Our problem, not the visitor's — say so honestly and don't blame them.
      return c.json(
        { error: "Scanning is temporarily unavailable. Please try again shortly.", code: verdict.reason },
        503,
      );
    }
    return c.json({ error: "Verification failed. Please try again.", code: verdict.reason }, 403);
  }

  // Server-side rate limiting, keyed by IP.
  const limited = await c.env.PUBLIC_SCAN_LIMITER.limit({ key: `scan:${ip}` });
  if (!limited.success) {
    return c.json({ error: "You've run several scans recently. Please wait a minute and try again." }, 429);
  }

  const result = await quickScan(target.url, c.get("config").appName);
  if (!result.ok) {
    return c.json({ error: friendlyScanError(result.errorCode, result.reason) }, 422);
  }
  return c.json(result);
});

function friendlyScanError(code: string, reason: string): string {
  switch (code) {
    case "timeout":
      return "The site took too long to respond.";
    case "dns_or_network":
      return "We couldn't reach that website. Check the address and try again.";
    case "tls":
      return "The site's HTTPS certificate could not be validated.";
    case "blocked_redirect":
      return "The site redirected to an address we can't safely scan.";
    default:
      return reason || "The scan could not be completed.";
  }
}

export default scan;
