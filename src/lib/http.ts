/**
 * SSRF-safe HTTP client. Every outbound request to a user-supplied target goes
 * through here. It:
 *   - validates the initial target with validatePublicTarget();
 *   - follows redirects MANUALLY, re-validating every hop (never blindly
 *     following a Location into a private target);
 *   - enforces a wall-clock timeout;
 *   - bounds the number of redirects and the number of bytes read.
 *
 * Residual risk: DNS rebinding (a public name that resolves to a private IP)
 * cannot be fully closed at the application layer on Workers because fetch does
 * not expose the resolved address. We minimise exposure by validating every hop
 * and keeping requests to standard ports/methods. This is documented in
 * docs/SECURITY.md.
 */

import { validatePublicTarget, type SsrfRejectCode } from "@shared/ssrf";

export const USER_AGENT = "ZenithCommunityBot/1.0";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SafeFetchOptions {
  method?: "GET" | "HEAD" | "POST" | "PUT";
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  /** Read and return the body text (bounded by maxBytes). Default false. */
  readBody?: boolean;
  /** Optional request body for outbound POST/PUT calls. Never used for GET/HEAD. */
  body?: string;
  /** Optional per-hop policy, called after target validation but before fetching a redirect. */
  redirectPolicy?: (url: string, remainingMs: number) => Promise<RedirectPolicyDecision>;
}

export type RedirectPolicyDecision =
  | { allowed: true }
  | { allowed: false; code: string; reason: string };

export interface SafeFetchResult {
  ok: true;
  finalUrl: string;
  status: number;
  headers: Headers;
  responseMs: number;
  redirectCount: number;
  /** Present only when readBody was requested. Bounded to maxBytes. */
  body?: string;
  bodyTruncated?: boolean;
  contentLength?: number;
}

export interface SafeFetchError {
  ok: false;
  errorCode: SafeFetchErrorCode;
  reason: string;
  /** Present when the failure was an SSRF rejection. */
  ssrfCode?: SsrfRejectCode;
  /** Resolved target when redirect handling stops before following the redirect. */
  redirectUrl?: string;
  /** Machine-readable reason when an optional redirect policy blocks a hop. */
  policyCode?: string;
}

export type SafeFetchErrorCode =
  | "blocked_target"
  | "blocked_redirect"
  | "redirect_policy"
  | "too_many_redirects"
  | "timeout"
  | "dns_or_network"
  | "tls"
  | "aborted";

export type SafeFetchOutcome = SafeFetchResult | SafeFetchError;

const DEFAULTS = {
  method: "GET" as const,
  timeoutMs: 10_000,
  maxRedirects: 5,
  maxBytes: 2_000_000, // 2 MB cap; we never need the whole of huge responses
  readBody: false,
};

export async function safeFetch(
  input: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchOutcome> {
  const opts = { ...DEFAULTS, ...options };

  const initial = validatePublicTarget(input);
  if (!initial.ok) {
    return { ok: false, errorCode: "blocked_target", reason: initial.reason, ssrfCode: initial.code };
  }

  let currentUrl = initial.url;
  let redirectCount = 0;
  let headers: Record<string, string> = { ...opts.headers };
  const startedAt = Date.now();

  while (true) {
    const controller = new AbortController();
    const remaining = opts.timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) return { ok: false, errorCode: "timeout", reason: "Request timed out." };
    const timer = setTimeout(() => controller.abort(), remaining);

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: opts.method,
        redirect: "manual",
        signal: controller.signal,
        body: (opts.method === "POST" || opts.method === "PUT") ? opts.body : undefined,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...headers,
        },
      });
    } catch (err) {
      clearTimeout(timer);
      return classifyFetchError(err);
    }

    try {
      // Manual redirect handling with per-hop validation. Other 3xx responses
      // (for example 300, 304, or 305) are not redirects to follow.
      if (REDIRECT_STATUSES.has(res.status) && res.headers.has("location")) {
        // A publish (POST/PUT) carries a body and credentials: never replay it
        // somewhere else. The destination must be configured with its final URL.
        if (opts.method === "POST" || opts.method === "PUT") {
          try {
            await res.body?.cancel();
          } catch {
            /* ignore */
          }
          return { ok: false, errorCode: "blocked_redirect", reason: "The server redirected the request. Use the destination's final address." };
        }
        redirectCount += 1;
        const location = res.headers.get("location")!;
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          try {
            await res.body?.cancel();
          } catch {
            /* ignore */
          }
          return { ok: false, errorCode: "blocked_redirect", reason: "Invalid redirect target." };
        }
        if (redirectCount > opts.maxRedirects) {
          try {
            await res.body?.cancel();
          } catch {
            /* ignore */
          }
          return {
            ok: false,
            errorCode: "too_many_redirects",
            reason: "Too many redirects.",
            redirectUrl: nextUrl,
          };
        }
        const check = validatePublicTarget(nextUrl);
        if (!check.ok) {
          try {
            await res.body?.cancel();
          } catch {
            /* ignore */
          }
          return {
            ok: false,
            errorCode: "blocked_redirect",
            reason: `Redirect target could not be scanned: ${check.reason}`,
            ssrfCode: check.code,
          };
        }
        if (opts.redirectPolicy) {
          const policyRemainingMs = opts.timeoutMs - (Date.now() - startedAt);
          if (policyRemainingMs <= 0) {
            try {
              await res.body?.cancel();
            } catch {
              /* ignore */
            }
            return { ok: false, errorCode: "timeout", reason: "Request timed out." };
          }
          let decision: RedirectPolicyDecision;
          try {
            decision = await opts.redirectPolicy(check.url, policyRemainingMs);
          } catch {
            decision = {
              allowed: false,
              code: "policy_check_failed",
              reason: "The redirect target could not be checked against the crawl policy.",
            };
          }
          if (!decision.allowed) {
            try {
              await res.body?.cancel();
            } catch {
              /* ignore */
            }
            return {
              ok: false,
              errorCode: "redirect_policy",
              reason: decision.reason,
              redirectUrl: check.url,
              policyCode: decision.code,
            };
          }
        }
        // Credentials are for the origin they were configured for, not wherever
        // it redirects to.
        if (new URL(check.url).origin !== new URL(currentUrl).origin) {
          headers = Object.fromEntries(
            Object.entries(headers).filter(([name]) => !["authorization", "cookie", "proxy-authorization"].includes(name.toLowerCase())),
          );
        }
        currentUrl = check.url;
        // Drain the redirect body to free the connection.
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
        continue;
      }

      const responseMs = Date.now() - startedAt;
      const result: SafeFetchResult = {
        ok: true,
        finalUrl: currentUrl,
        status: res.status,
        headers: res.headers,
        responseMs,
        redirectCount,
        contentLength: numberOrUndefined(res.headers.get("content-length")),
      };

      if (opts.readBody && res.body) {
        const { text, truncated } = await readBounded(res, opts.maxBytes);
        result.body = text;
        result.bodyTruncated = truncated;
      } else {
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
      }
      return result;
    } catch (err) {
      return classifyFetchError(err);
    } finally {
      // Keep the deadline active until a requested response body has been read.
      clearTimeout(timer);
    }
  }
}

async function readBounded(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
          truncated = true;
          break;
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(merged), truncated };
}

function classifyFetchError(err: unknown): SafeFetchError {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && err.name === "AbortError") {
    return { ok: false, errorCode: "timeout", reason: "Request timed out." };
  }
  if (/certificate|tls|ssl/i.test(message)) {
    return { ok: false, errorCode: "tls", reason: "TLS/certificate error." };
  }
  return { ok: false, errorCode: "dns_or_network", reason: "The site could not be reached." };
}

function numberOrUndefined(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
