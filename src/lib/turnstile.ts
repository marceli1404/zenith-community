/**
 * Cloudflare Turnstile server-side verification (Siteverify).
 *
 * Architecture (deliberate, per environment):
 *  - production: a real widget secret MUST be configured. If it is missing we
 *    FAIL CLOSED and surface a configuration error — production never silently
 *    degrades into "Turnstile disabled".
 *  - development/preview: if no secret is configured we allow the request (so
 *    local work stays convenient) and log a warning. This bypass is gated on
 *    ENVIRONMENT !== "production", so it cannot be reached in production.
 *
 * Turnstile is layered ON TOP of the independent server-side IP rate limiter;
 * both apply. Verification additionally checks the returned hostname (and the
 * action when the caller supplies one), so a token minted for another site or
 * another flow is rejected.
 */

import type { Bindings } from "../env";

export interface TurnstileResult {
  ok: boolean;
  /** Machine-readable reason (safe to log). */
  reason:
    | "ok"
    | "dev_bypass"
    | "not_configured_in_production"
    | "missing_token"
    | "rejected"
    | "hostname_mismatch"
    | "action_mismatch"
    | "verify_unavailable";
}

interface SiteverifyResponse {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
}

export function turnstileConfigured(env: Bindings): boolean {
  return typeof env.TURNSTILE_SECRET_KEY === "string" && env.TURNSTILE_SECRET_KEY.length > 0;
}

/** Hostnames a Turnstile token is allowed to have been issued for. Must cover
 *  every origin that actually serves the scan widget. Post domain-split the
 *  public scan lives on the Zenith app host (zenith.me.uk), so
 *  the token's hostname is that — not APP_URL's Labs-root host. */
function allowedHostnames(env: Bindings): string[] {
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(env.APP_URL).hostname);
  } catch {
    /* ignore malformed APP_URL */
  }
  hosts.add("localhost");
  hosts.add("127.0.0.1");
  hosts.add("localhost");
  return [...hosts];
}

export async function verifyTurnstile(
  env: Bindings,
  token: string | undefined,
  remoteIp?: string,
  expectedAction?: string,
): Promise<TurnstileResult> {
  const secret = env.TURNSTILE_SECRET_KEY;
  const isProduction = env.ENVIRONMENT === "production";

  if (!secret) {
    if (isProduction) {
      // Fail closed and make the misconfiguration loud.
      console.error(
        "CONFIG ERROR: TURNSTILE_SECRET_KEY is not set in production. Bot protection is unavailable; rejecting request. Set the secret with `wrangler secret put TURNSTILE_SECRET_KEY`.",
      );
      return { ok: false, reason: "not_configured_in_production" };
    }
    console.warn("Turnstile secret not set (non-production) — skipping verification.");
    return { ok: true, reason: "dev_bypass" };
  }

  if (!token) return { ok: false, reason: "missing_token" };

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (remoteIp) body.append("remoteip", remoteIp);

  let data: SiteverifyResponse;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    data = (await res.json()) as SiteverifyResponse;
  } catch (err) {
    // Siteverify unreachable/timed out. Fail closed — the IP rate limiter is
    // still the backstop, but we do not hand out free passes on outage.
    console.error("Turnstile siteverify unavailable", err instanceof Error ? err.message : err);
    return { ok: false, reason: "verify_unavailable" };
  }

  if (data.success !== true) {
    return { ok: false, reason: "rejected" };
  }

  // Bind the token to our hostnames (defeats tokens minted for another site).
  if (data.hostname && !allowedHostnames(env).includes(data.hostname)) {
    console.warn("Turnstile hostname mismatch", data.hostname);
    return { ok: false, reason: "hostname_mismatch" };
  }

  // Bind the token to the flow it was issued for, when the caller specifies one.
  if (expectedAction && data.action && data.action !== expectedAction) {
    console.warn("Turnstile action mismatch", data.action);
    return { ok: false, reason: "action_mismatch" };
  }

  return { ok: true, reason: "ok" };
}
