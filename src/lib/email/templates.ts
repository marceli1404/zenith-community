/**
 * Transactional email templates. Every template returns a subject plus HTML and
 * plain-text bodies. Copy is plain and reassuring; technical detail is available
 * but never alarming.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface Ctx {
  appName: string;
  appUrl: string;
  data: Record<string, unknown>;
}

const s = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const escapeHtml = (value: unknown): string => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]!));

function layout(appName: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1d23">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="font-weight:700;font-size:18px;margin-bottom:16px">${escapeHtml(appName)}</div>
    <div style="background:#fff;border:1px solid #e6e8eb;border-radius:12px;padding:24px;line-height:1.6">${bodyHtml}</div>
    <div style="color:#8a9099;font-size:12px;margin-top:16px">You are receiving this because you have a ${escapeHtml(appName)} account.</div>
  </div></body></html>`;
}

function button(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:#1a1d23;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${escapeHtml(label)}</a>`;
}

export const TEMPLATES: Record<string, (ctx: Ctx) => RenderedEmail> = {
  verify_email: ({ appName, data }) => {
    const url = s(data.url);
    return {
      subject: `Verify your ${appName} email`,
      html: layout(appName, `<p>Welcome to ${appName}. Please confirm your email address to finish setting up your account.</p><p>${button(url, "Verify email")}</p>`),
      text: `Welcome to ${appName}. Verify your email: ${url}`,
    };
  },
  verify_otp: ({ appName, data }) => {
    const otp = s(data.otp);
    // Better Auth OTP `type`: "email-verification" | "sign-in" | "forget-password".
    const type = s(data.otpType, "email-verification");
    const purpose =
      type === "sign-in" ? "sign in" : type === "forget-password" ? "reset your password" : "verify your email";
    const code = `<div style="font-size:30px;letter-spacing:8px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f4f5f7;border:1px solid #e6e8eb;border-radius:10px;padding:16px;text-align:center;margin:8px 0">${otp}</div>`;
    return {
      subject: `Your ${appName} code: ${otp}`,
      html: layout(
        appName,
        `<p>Use this code to ${escapeHtml(purpose)}. It expires in 10 minutes.</p>${code.replace(otp, escapeHtml(otp))}<p style="color:#8a9099;font-size:13px">If you didn't request this, you can safely ignore this email — no changes were made.</p>`,
      ),
      text: `Your ${appName} code to ${purpose} is ${otp}. It expires in 10 minutes. If you didn't request it, ignore this email.`,
    };
  },
  password_reset: ({ appName, data }) => {
    const url = s(data.url);
    return {
      subject: `Reset your ${appName} password`,
      html: layout(appName, `<p>We received a request to reset your password. If this was you, use the link below. It expires shortly.</p><p>${button(url, "Reset password")}</p><p style="color:#8a9099;font-size:13px">If you didn't request this, you can safely ignore this email.</p>`),
      text: `Reset your ${appName} password: ${url}`,
    };
  },
  welcome: ({ appName, appUrl }) => ({
    subject: `Welcome to ${appName}`,
    html: layout(appName, `<p>Your account is ready. Add your first website to start monitoring uptime and running health audits.</p><p>${button(appUrl + "/app", "Open dashboard")}</p>`),
    text: `Welcome to ${appName}. Open your dashboard: ${appUrl}/app`,
  }),
  site_down: ({ appName, appUrl, data }) => {
    const site = s(data.siteName, s(data.url));
    const code = data.statusCode ? ` (HTTP ${data.statusCode})` : "";
    return {
      subject: `${site} is down`,
      html: layout(appName, `<p><strong>${escapeHtml(site)}</strong> appears to be unavailable${escapeHtml(code)}.</p><p>We'll email you again as soon as it recovers.</p><p>${button(appUrl + "/app/incidents", "View incident")}</p>`),
      text: `${site} appears to be down${code}. View: ${appUrl}/app/incidents`,
    };
  },
  site_recovered: ({ appName, appUrl, data }) => {
    const site = s(data.siteName, s(data.url));
    const mins = data.downtimeMinutes ? ` after about ${data.downtimeMinutes} minutes` : "";
    return {
      subject: `${site} is back online`,
      html: layout(appName, `<p>Good news — <strong>${escapeHtml(site)}</strong> is responding normally again${escapeHtml(mins)}.</p><p>${button(appUrl + "/app/incidents", "View incident")}</p>`),
      text: `${site} has recovered${mins}. View: ${appUrl}/app/incidents`,
    };
  },
  audit_completed: ({ appName, appUrl, data }) => {
    const site = s(data.siteName, s(data.url));
    const score = data.score !== undefined
      ? ` Overall score: ${data.score}/100.`
      : " The audit finished without a calculated score. See the report for details.";
    const id = s(data.auditId);
    return {
      subject: `Your ${site} audit is ready`,
      html: layout(appName, `<p>Your website health audit for <strong>${escapeHtml(site)}</strong> has finished.${escapeHtml(score)}</p><p>${button(`${appUrl}/app/audits/${id}`, "View report")}</p>`),
      text: `Your audit for ${site} is ready.${score} View: ${appUrl}/app/audits/${id}`,
    };
  },
};

export function renderTemplate(
  template: string,
  ctx: Ctx,
): RenderedEmail {
  const fn = TEMPLATES[template];
  if (!fn) {
    return {
      subject: `${ctx.appName} notification`,
      html: layout(ctx.appName, `<p>You have a new notification.</p>`),
      text: `You have a new ${ctx.appName} notification.`,
    };
  }
  return fn(ctx);
}
