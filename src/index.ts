/** Cloudflare Worker entry point for Zenith Community. */

import { Hono } from "hono";
import type { AuditJob, Bindings, EmailJob, MonitorJob } from "./env";
import { withConfig, securityHeaders, withAuth, sameOriginGuard, type AppEnv } from "./middleware";
import { getAuth } from "./auth";
import { scheduleDueMonitors, processMonitorCheck } from "./monitor";
import { processAuditJob } from "./audit/pipeline";
import { deliverEmail } from "./lib/email";
import { downsampleAndPrune } from "./maintenance";
import scan from "./routes/scan";
import sites from "./routes/sites";
import dashboard from "./routes/dashboard";
import audits from "./routes/audits";
import reports from "./routes/reports";
import statusPages from "./routes/status";
import account from "./routes/account";

const app = new Hono<AppEnv>();
app.use("*", withConfig);
app.use("*", securityHeaders);

app.get("/", (c) => serveAssetHtml(c, "/index.html"));
app.on(["GET", "POST"], "/api/auth/*", (c) => getAuth(c.env, c.req.url).handler(c.req.raw));

app.get("/api/config", (c) => {
  const cfg = c.get("config");
  return c.json({
    appName: cfg.appName,
    environment: cfg.environment,
    isProduction: cfg.isProduction,
    turnstileSiteKey: cfg.turnstileSiteKey,
    authProviders: cfg.authProviders,
    emailEnabled: cfg.emailEnabled,
  });
});

app.use("/api/*", sameOriginGuard);
app.use("/api/*", withAuth);
app.route("/api/scan", scan);
app.route("/api/sites", sites);
app.route("/api/dashboard", dashboard);
app.route("/api/audits", audits);
app.route("/api/reports", reports);
app.route("/api/status", statusPages);
app.route("/api/account", account);

app.get("/api/me", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ user: null });
  return c.json({
    user: { id: userId, email: c.get("userEmail") },
    plan: "community",
    access: { source: "community" },
  });
});

const SPA_ROUTES: RegExp[] = [
  /^\/app(\/|$)/,
  /^\/(login|signup|forgot-password|reset-password|verify-email)\/?$/,
  /^\/legal\/(privacy|terms)\/?$/,
  /^\/(security|methodology|contact)\/?$/,
  /^\/status\/[A-Za-z0-9._-]+\/?$/,
];
const PRIVATE_ROUTES = [
  /^\/app(\/|$)/,
  /^\/(login|signup|forgot-password|reset-password|verify-email)\/?$/,
];

app.notFound(async (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/")) return c.json({ error: "Not found." }, 404);
  const shell = await c.env.ASSETS.fetch(new Request(new URL("/_shell.html", c.req.url)));
  const body = await shell.text();
  const headers: Record<string, string> = PRIVATE_ROUTES.some((re) => re.test(path)) ? { "X-Robots-Tag": "noindex" } : {};
  return c.html(body, SPA_ROUTES.some((re) => re.test(path)) ? 200 : 404, headers);
});

app.onError((err, c) => {
  console.error("Unhandled error", err instanceof Error ? err.message : err);
  return c.json({ error: "Something went wrong." }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduleDueMonitors(env));
    if (new Date(event.scheduledTime).getUTCMinutes() === 3) ctx.waitUntil(downsampleAndPrune(env));
  },
  async queue(batch: MessageBatch, env: Bindings): Promise<void> {
    switch (batch.queue) {
      case "zenith-community-monitor":
        for (const message of batch.messages) {
          try { await processMonitorCheck(env, message.body as MonitorJob); message.ack(); }
          catch { message.retry(); }
        }
        break;
      case "zenith-community-audit":
        for (const message of batch.messages) {
          try { await processAuditJob(env, message.body as AuditJob); message.ack(); }
          catch { message.retry(); }
        }
        break;
      case "zenith-community-email":
        for (const message of batch.messages) {
          try { await deliverEmail(env, message.body as EmailJob); message.ack(); }
          catch { message.retry(); }
        }
        break;
      default:
        for (const message of batch.messages) message.ack();
    }
  },
};

async function serveAssetHtml(c: import("hono").Context<AppEnv>, path: string): Promise<Response> {
  const asset = await c.env.ASSETS.fetch(new Request(new URL(path, c.req.url)));
  const headers = new Headers(asset.headers);
  return new Response(await asset.text(), { status: asset.status, headers });
}
