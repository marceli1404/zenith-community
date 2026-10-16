/**
 * Better Auth configuration, wired to Cloudflare D1 via a Kysely dialect.
 *
 * The instance is constructed per-request-context because the D1 binding is only
 * available at request time, and memoised per binding so repeated requests in
 * the same isolate reuse it. Email verification and password reset dispatch go
 * through our EmailProvider abstraction (queued, non-blocking).
 *
 * Security: sessions are httpOnly cookies signed with BETTER_AUTH_SECRET;
 * Google OAuth is optional and only enabled when both credentials are present.
 */

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { emailOTP, twoFactor } from "better-auth/plugins";
import { computeEmailEnabled, isProductionEnvironment, type Bindings } from "./env";
import { enqueueEmail } from "./lib/email";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@shared/password-policy";

// Pin to Better Auth's base instance type. Inferring from buildAuth is not
// portable once plugins are added (the emailOTP schema drags in a non-nameable
// zod-internal type — TS2742). We only use the core surface server-side
// (handler + api.getSession), which the base type provides.
export type Auth = ReturnType<typeof betterAuth>;

const cache = new WeakMap<D1Database, Map<string, Auth>>();

export function getAuth(env: Bindings, requestUrl?: string): Auth {
  let baseURL = env.APP_URL;
  if (requestUrl) {
    try {
      const url = new URL(requestUrl);
      if (url.host.toLowerCase() === new URL(env.APP_URL).host.toLowerCase()) baseURL = url.origin;
    } catch {
      // Keep the configured canonical origin when the request URL is invalid.
    }
  }
  let byOrigin = cache.get(env.DB);
  if (!byOrigin) {
    byOrigin = new Map();
    cache.set(env.DB, byOrigin);
  }
  const existing = byOrigin.get(baseURL);
  if (existing) return existing;
  const auth = buildAuth(env, baseURL);
  byOrigin.set(baseURL, auth);
  return auth;
}

function buildAuth(env: Bindings, baseURL: string): Auth {
  const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  }
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    socialProviders.github = {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    };
  }

  // Email verification is by numeric OTP. Requiring it only makes sense when we
  // can actually deliver mail — otherwise a new user would be permanently locked
  // out. So it's gated on both production AND a deliverable email provider.
  const emailDeliverable = computeEmailEnabled(env);
  const isProduction = isProductionEnvironment(env);
  const requireVerification = isProduction && emailDeliverable;

  const auth = betterAuth({
    // Pass the raw D1 binding: Better Auth detects it (batch/exec/prepare) and
    // uses its built-in D1 dialect with transactions disabled, which D1's
    // serverless binding requires (manual BEGIN is rejected as SQLITE_AUTH).
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins: [...new Set([env.APP_URL, baseURL])],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: requireVerification,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      sendResetPassword: async ({ user, url }) => {
        await enqueueEmail(env, {
          type: "email",
          template: "password_reset",
          to: user.email,
          data: { url, name: user.name },
        });
      },
    },
    emailVerification: {
      // The numeric OTP (emailOTP plugin) is the primary signup verification, so
      // don't also auto-send a link on signup. The link path stays available for
      // any explicit link-based resend.
      sendOnSignUp: false,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await enqueueEmail(env, {
          type: "email",
          template: "verify_email",
          to: user.email,
          data: { url, name: user.name },
        });
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh daily
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    socialProviders,
    plugins: [
      // Numeric email verification codes (6-digit, 10-minute expiry). On signup a
      // code is sent; the user confirms it to verify. Also enables passwordless
      // email sign-in and code-based password reset. OTPs are stored in Better
      // Auth's existing `verification` table — no schema migration required.
      emailOTP({
        otpLength: 6,
        expiresIn: 60 * 10,
        sendVerificationOnSignUp: true,
        async sendVerificationOTP({ email, otp, type }) {
          await enqueueEmail(env, {
            type: "email",
            template: "verify_otp",
            to: email,
            data: { otp, otpType: type },
          });
        },
      }),
      // Optional TOTP two-factor (authenticator app + backup codes). Additive:
      // sign-in is unchanged for accounts that haven't enabled it. On enable,
      // subsequent sign-ins return a twoFactorRedirect the client resolves with
      // a code. Requires a password-based account.
      twoFactor({ issuer: "Zenith" }),
    ],
    advanced: {
      useSecureCookies: isProduction,
    },
  });

  // The plugin-augmented instance is a structural superset of the base type; the
  // cast drops only plugin-specific surface we don't call server-side.
  return auth as unknown as Auth;
}
