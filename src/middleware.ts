/**
 * Hono middleware: config loading, security headers, authentication, and plan
 * resolution. Authorization is enforced per-route; this only establishes who the
 * caller is and what plan they have.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { Bindings, AppConfig } from "./env";
import { loadConfig } from "./env";
import { getAuth } from "./auth";
import { resolveAccess, type Access } from "./lib/access";
import type { Plan } from "@shared/entitlements";

export interface Variables {
  config: AppConfig;
  userId?: string;
  userEmail?: string;
  sessionId?: string;
  plan: Plan;
  access: Access;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };
export type Ctx = Context<AppEnv>;

/** Community capabilities are available to signed-out previews and accounts. */
function communityAccess(): Access {
  return { plan: "community", source: "community" };
}

/** Load typed config once per request. */
export const withConfig: MiddlewareHandler<AppEnv> = async (c, next) => {
  const config = loadConfig(c.env);
  c.set("config", config);
  c.set("plan", "community");
  c.set("access", communityAccess());
  await next();
};

/** Apply baseline security headers without replacing a stricter route-specific CSP. */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("X-Frame-Options", "DENY");
  h.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  // Restrictive Worker policy; the public scan uses Turnstile when configured.
  if (!h.has("Content-Security-Policy")) {
    h.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' https://challenges.cloudflare.com 'sha256-gMFxjGDHSHfU9H1G4PpYauNI6M04ney4uoHual7FuVo='; " +
        "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; " +
        "connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; " +
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    );
  }
  if (c.get("config")?.isProduction) {
    h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  // Private API responses must not be cached by shared caches.
  if (c.req.path.startsWith("/api/") && !c.req.path.startsWith("/api/auth/")) {
    h.set("Cache-Control", "no-store");
  }
};

/** Resolve the current session and the user's derived access (best-effort). */
export const withAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  try {
    const auth = getAuth(c.env, c.req.url);
    // This is a stateful D1 deployment: bypass Better Auth's signed cookie cache
    // so revoked or deleted sessions stop authorizing API calls immediately.
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
      query: { disableCookieCache: true },
    });
    if (session?.user) {
      c.set("userId", session.user.id);
      c.set("userEmail", session.user.email);
      c.set("sessionId", session.session.id);
      const access = await resolveAccess(c.env.DB, session.user.id);
      c.set("plan", access.plan);
      c.set("access", access);
    }
  } catch (err) {
    console.error("Auth resolution failed", err instanceof Error ? err.message : err);
  }
  await next();
};

/** Reject unauthenticated requests. Use on all private API routes. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("userId")) {
    return c.json({ error: "Authentication required." }, 401);
  }
  await next();
};

/**
 * Same-origin guard for state-changing requests as defense-in-depth for CSRF.
 * Better Auth sets SameSite cookies, but we additionally reject cross-origin
 * mutations by comparing the Origin header's host to the request host. Safe
 * (GET/HEAD) methods and requests with no Origin (same-origin navigations) pass.
 * Auth is mounted outside this guard.
 */
export const sameOriginGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    await next();
    return;
  }
  const origin = c.req.header("origin");
  if (origin) {
    const host = c.req.header("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!originHost || originHost !== host) {
      return c.json({ error: "Cross-origin request blocked." }, 403);
    }
  }
  await next();
};

/** Extract the caller's IP for rate limiting / Turnstile. */
export function clientIp(c: Ctx): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "0.0.0.0";
}
