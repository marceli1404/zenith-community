/**
 * Email provider abstraction (§7). Business logic depends only on this module,
 * never on a specific provider. Sending is done from the EMAIL_QUEUE consumer so
 * a provider outage retries in isolation and can never turn a successful
 * monitoring check into a failure.
 */

import type { Bindings, EmailJob } from "../../env";
import { loadConfig } from "../../env";
import { renderTemplate } from "./templates";

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Resend transactional email via its HTTP API. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  constructor(private apiKey: string) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
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

  constructor(private binding: any) {}

  async send(message: EmailMessage): Promise<void> {
    if (!this.binding || typeof this.binding.send !== "function") {
      throw new Error(
        "Cloudflare Email binding is not configured. Set EMAIL_PROVIDER=resend or add a send_email binding.",
      );
    }
    // The Cloudflare email binding expects a MIME message. We construct a
    // minimal multipart message with both text and HTML parts.
    const mime = buildMime(message);
    await this.binding.send(mime);
  }
}

function buildMime(m: EmailMessage): string {
  const boundary = `bnd_${Math.random().toString(36).slice(2)}`;
  return [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${m.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    m.text,
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    m.html,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export function getEmailProvider(env: Bindings): EmailProvider {
  const provider = (env.EMAIL_PROVIDER ?? "cloudflare").toLowerCase();
  if (provider === "resend") {
    if (!env.RESEND_API_KEY) {
      throw new Error("EMAIL_PROVIDER=resend but RESEND_API_KEY is not set.");
    }
    return new ResendEmailProvider(env.RESEND_API_KEY);
  }

  return new CloudflareEmailProvider((env as any).EMAIL);
}

/** Enqueue an email for asynchronous, isolated delivery. */
export async function enqueueEmail(env: Bindings, job: EmailJob): Promise<void> {
  try {
    await env.EMAIL_QUEUE.send(job);
  } catch (err) {
    // Never let an email enqueue failure bubble into caller logic.
    console.error("Failed to enqueue email", job.template, err instanceof Error ? err.message : err);
  }
}

/** Called by the EMAIL_QUEUE consumer to actually render + send one email.
 *  Honours an optional dedupeKey so at-least-once redelivery never sends the
 *  same notification twice. */
export async function deliverEmail(env: Bindings, job: EmailJob): Promise<void> {
  if (job.dedupeKey) {
    const claim = await env.DB.prepare(
      `INSERT OR IGNORE INTO processed_jobs (key, created_at) VALUES (?, ?)`,
    )
      .bind(`email:${job.dedupeKey}`, Date.now())
      .run();
    if ((claim.meta?.changes ?? 0) === 0) return; // already sent
  }
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
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}
