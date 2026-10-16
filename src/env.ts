/** Runtime bindings and configuration for the self-hosted Community edition. */

import { z } from "zod";

export interface Bindings {
  DB: D1Database;
  REPORTS_BUCKET: R2Bucket;
  BROWSER: Fetcher;
  MONITOR_QUEUE: Queue<MonitorJob>;
  AUDIT_QUEUE: Queue<AuditJob>;
  EMAIL_QUEUE: Queue<EmailJob>;
  EMAIL?: SendEmail;
  ASSETS: Fetcher;
  PUBLIC_SCAN_LIMITER: RateLimiter;
  API_LIMITER?: RateLimiter;

  APP_NAME: string;
  APP_URL: string;
  ENVIRONMENT?: string;
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  TURNSTILE_SITE_KEY?: string;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface MonitorJob {
  type: "check";
  monitorId: string;
  siteId: string;
  /** Stable id across queue redelivery; generated when the cron job is enqueued. */
  checkId?: string;
}

export interface AuditJob {
  type: "audit";
  auditJobId: string;
}

export interface EmailJob {
  type: "email";
  template: string;
  to: string;
  data: Record<string, unknown>;
  dedupeKey?: string;
}

const configSchema = z.object({
  appName: z.string().trim().min(1).default("Zenith Community"),
  appUrl: z.string().url(),
  environment: z.enum(["development", "preview", "production"]).catch("development"),
  emailProvider: z.enum(["cloudflare", "resend"]).catch("cloudflare"),
  emailFrom: z.string().min(1).catch("alerts@example.com"),
  turnstileSiteKey: z.string().catch(""),
});

export type AppConfig = z.infer<typeof configSchema> & {
  isProduction: boolean;
  authProviders: { google: boolean; github: boolean };
  emailEnabled: boolean;
};

export function computeEmailEnabled(env: Bindings): boolean {
  const provider = (env.EMAIL_PROVIDER ?? "cloudflare").toLowerCase();
  const senderSet = !!env.EMAIL_FROM && env.EMAIL_FROM !== "alerts@example.com";
  if (provider === "resend") return !!env.RESEND_API_KEY && senderSet;
  return !!env.EMAIL && senderSet;
}

export function loadConfig(env: Bindings): AppConfig {
  const parsed = configSchema.parse({
    appName: env.APP_NAME,
    appUrl: env.APP_URL,
    environment: env.ENVIRONMENT,
    emailProvider: env.EMAIL_PROVIDER,
    emailFrom: env.EMAIL_FROM,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
  });
  return {
    ...parsed,
    isProduction: parsed.environment === "production",
    authProviders: {
      google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      github: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    },
    emailEnabled: computeEmailEnabled(env),
  };
}
