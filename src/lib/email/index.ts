/**
 * Email provider abstraction. Business logic depends only on this module,
 * never on a specific provider. Sending is done from the EMAIL_QUEUE consumer so
 * a provider outage retries in isolation and can never turn a successful
 * monitoring check into a failure.
 */

import type { Bindings, EmailJob } from "../../env";
import { computeEmailEnabled, loadConfig } from "../../env";
import { renderTemplate } from "./templates";

export class EmailDeliveryBusyError extends Error {
  constructor() {
    super("Email delivery is already in progress; retry this queue message.");
    this.name = "EmailDeliveryBusyError";
  }
}

const DELIVERY_LEASE_MS = 60_000;
const DELIVERY_LEASE_RENEW_MS = 20_000;

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage, idempotencyKey?: string): Promise<void>;
}

/** Resend transactional email via its HTTP API. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  constructor(private apiKey: string) {}

  async send(message: EmailMessage, idempotencyKey?: string): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend send failed: ${res.status} ${detail.slice(0, 200)}`);
    }
  }
}

/**
 * Cloudflare Email Service provider. Cloudflare sends via a Worker `send_email`
 * binding (verified sender/recipient). When the binding is not configured this
 * throws a clear error so the queue retries and operators can see the gap in the
 * DLQ, rather than silently dropping mail. See docs/DEPLOYMENT.md.
 */
export class CloudflareEmailProvider implements EmailProvider {
  readonly name = "cloudflare";

  constructor(private binding?: SendEmail) {}

  async send(message: EmailMessage): Promise<void> {
    if (!this.binding || typeof this.binding.send !== "function") {
      throw new Error(
        "Cloudflare Email binding is not configured. Set EMAIL_PROVIDER=resend or add a send_email binding.",
      );
    }
    await this.binding.send({
      to: message.to,
      from: message.from,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }
}

export function getEmailProvider(env: Bindings): EmailProvider {
  const provider = (env.EMAIL_PROVIDER ?? "cloudflare").toLowerCase();
  if (provider === "resend") {
    if (!env.RESEND_API_KEY) {
      throw new Error("EMAIL_PROVIDER=resend but RESEND_API_KEY is not set.");
    }
    return new ResendEmailProvider(env.RESEND_API_KEY);
  }

  return new CloudflareEmailProvider(env.EMAIL);
}

/** Enqueue an email for asynchronous, isolated delivery. */
export async function enqueueEmail(env: Bindings, job: EmailJob): Promise<void> {
  if (!computeEmailEnabled(env)) return;
  try {
    await env.EMAIL_QUEUE.send(job);
  } catch (err) {
    // Never let an email enqueue failure bubble into caller logic.
    console.error("Failed to enqueue email", job.template, err instanceof Error ? err.message : err);
  }
}

/** Called by the EMAIL_QUEUE consumer to actually render + send one email.
 * Dedupe claims are recoverable leases so a worker interruption before send
 * cannot permanently suppress a retry. Resend also receives the stable key to
 * suppress duplicate acceptance during its idempotency window. */
export async function deliverEmail(env: Bindings, job: EmailJob): Promise<void> {
  let claimedKey: string | null = null;
  const leaseToken = job.dedupeKey ? crypto.randomUUID() : null;
  const claimNow = Date.now();
  const leaseExpiresAt = claimNow + DELIVERY_LEASE_MS;
  if (job.dedupeKey) {
    claimedKey = `email:${job.dedupeKey}`;
    const claim = await env.DB.prepare(
      `INSERT OR IGNORE INTO processed_jobs (key, created_at, status, lease_expires_at, lease_token)
       VALUES (?, ?, 'processing', ?, ?)`,
    )
      .bind(claimedKey, claimNow, leaseExpiresAt, leaseToken)
      .run();
    if ((claim.meta?.changes ?? 0) === 0) {
      const reclaimed = await env.DB.prepare(
        `UPDATE processed_jobs SET created_at = ?, lease_expires_at = ?, lease_token = ?
         WHERE key = ? AND status = 'processing' AND lease_expires_at <= ?`,
      )
        .bind(claimNow, leaseExpiresAt, leaseToken, claimedKey, claimNow)
        .run();
      if ((reclaimed.meta?.changes ?? 0) === 0) {
        const existing = await env.DB.prepare(`SELECT status FROM processed_jobs WHERE key = ?`).bind(claimedKey).first<{ status: string }>();
        if (existing?.status === "sent") return; // already delivered
        throw new EmailDeliveryBusyError();
      }
    }
  }
  const stopHeartbeat = claimedKey && leaseToken ? startLeaseHeartbeat(env, claimedKey, leaseToken) : null;
  try {
    const config = loadConfig(env);
    const rendered = renderTemplate(job.template, {
      appName: config.appName,
      appUrl: config.appUrl,
      data: job.data,
    });
    const provider = getEmailProvider(env);
    await provider.send({
      to: job.to,
      from: config.emailFrom,
      subject: rendered.subject.replace(/[\r\n]+/g, " ").trim(),
      html: rendered.html,
      text: rendered.text,
    }, job.dedupeKey ? `email:${job.dedupeKey}` : undefined);
    if (claimedKey) {
      await stopHeartbeat?.();
      await env.DB.prepare(
        `UPDATE processed_jobs SET status = 'sent', lease_expires_at = NULL, lease_token = NULL
         WHERE key = ? AND status = 'processing' AND lease_token = ?`,
      ).bind(claimedKey, leaseToken).run().then((result) => {
        if ((result.meta?.changes ?? 0) !== 1) throw new EmailDeliveryBusyError();
      });
    }
  } catch (error) {
    await stopHeartbeat?.();
    // Queue retries can immediately reclaim this row. If this update fails, the
    // lease still expires on its own and the next retry can recover it.
    if (claimedKey && leaseToken) {
      await env.DB.prepare(`UPDATE processed_jobs SET lease_expires_at = ?
        WHERE key = ? AND status = 'processing' AND lease_token = ?`)
        .bind(Date.now(), claimedKey, leaseToken).run().catch(() => undefined);
    }
    throw error;
  }
}

function startLeaseHeartbeat(env: Bindings, key: string, leaseToken: string): () => Promise<void> {
  let stopped = false;
  let pending = Promise.resolve();
  const timer = setInterval(() => {
    pending = pending.then(async () => {
      if (stopped) return;
      try {
        const result = await env.DB.prepare(`UPDATE processed_jobs SET lease_expires_at = ?
          WHERE key = ? AND status = 'processing' AND lease_token = ?`)
          .bind(Date.now() + DELIVERY_LEASE_MS, key, leaseToken).run();
        if ((result.meta?.changes ?? 0) !== 1) stopped = true;
      } catch (error) {
        console.error("Email delivery lease renewal failed", error instanceof Error ? error.message : error);
      }
    });
  }, DELIVERY_LEASE_RENEW_MS);
  return async () => {
    stopped = true;
    clearInterval(timer);
    await pending;
  };
}
