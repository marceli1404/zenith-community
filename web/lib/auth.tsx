import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createAuthClient } from "better-auth/react";
import { emailOTPClient, twoFactorClient } from "better-auth/client/plugins";
import { api } from "./api";
import { hasCapability, type Capability, type Plan } from "@shared/entitlements";

export type SocialProvider = "google" | "github";

/** Better Auth's inferred client type isn't portable once the emailOTP plugin is
 *  added (it references better-auth's bundled zod internals — TS2742). We only
 *  call a small, stable slice of the API, so we pin an explicit facade type. The
 *  shapes match Better Auth's runtime (`{ data, error }` results). */
type AuthResult<T = unknown> = { data: T | null; error: { message?: string; code?: string } | null };
interface AuthClientFacade {
  signIn: {
    // On success for a 2FA-enabled account, data carries { twoFactorRedirect: true }
    // instead of a session; resolve it with twoFactor.verifyTotp/verifyBackupCode.
    email: (a: { email: string; password: string }) => Promise<AuthResult<{ twoFactorRedirect?: boolean }>>;
    social: (a: { provider: SocialProvider; callbackURL?: string; errorCallbackURL?: string }) => Promise<AuthResult>;
  };
  twoFactor: {
    enable: (a: { password: string }) => Promise<AuthResult<{ totpURI: string; backupCodes: string[] }>>;
    disable: (a: { password: string }) => Promise<AuthResult>;
    verifyTotp: (a: { code: string; trustDevice?: boolean }) => Promise<AuthResult>;
    verifyBackupCode: (a: { code: string }) => Promise<AuthResult>;
  };
  signUp: {
    email: (a: { email: string; password: string; name: string }) => Promise<AuthResult>;
  };
  signOut: () => Promise<AuthResult>;
  requestPasswordReset: (a: { email: string; redirectTo?: string }) => Promise<AuthResult>;
  resetPassword: (a: { newPassword: string; token: string }) => Promise<AuthResult>;
  emailOtp: {
    verifyEmail: (a: { email: string; otp: string }) => Promise<AuthResult>;
    sendVerificationOtp: (a: { email: string; type: "email-verification" | "sign-in" | "forget-password" }) => Promise<AuthResult>;
  };
}

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "",
  plugins: [emailOTPClient(), twoFactorClient()],
}) as unknown as AuthClientFacade;

export interface AuthConfig {
  authProviders: Record<SocialProvider, boolean>;
  emailEnabled: boolean;
}

let authConfigCache: AuthConfig | null = null;

/** Read capability flags from /api/config once so the UI only offers usable
 *  options (e.g. a provider button appears only when it's configured). */
export function useAuthConfig(): { config: AuthConfig | null; loaded: boolean } {
  const [config, setConfig] = useState<AuthConfig | null>(authConfigCache);
  const [loaded, setLoaded] = useState(authConfigCache !== null);
  useEffect(() => {
    if (authConfigCache) return;
    let alive = true;
    api
      .get<AuthConfig & { authProviders?: Record<string, boolean> }>("/api/config")
      .then((c) => {
        const shaped: AuthConfig = {
          authProviders: {
            google: !!c.authProviders?.google,
            github: !!c.authProviders?.github,
          },
          emailEnabled: !!c.emailEnabled,
        };
        authConfigCache = shaped;
        if (alive) {
          setConfig(shaped);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { config, loaded };
}

/** Only ever honor same-app relative paths as a post-auth redirect target.
 *  `from` is always produced by our own navigate()/Navigate calls (router
 *  state, never a URL param), so it can't be attacker-supplied via a shared
 *  link — this guard is defense in depth against a protocol-relative value
 *  ("//evil.com") slipping through and becoming an open redirect. */
export function safePostAuthPath(from: unknown): string | undefined {
  return typeof from === "string" && /^\/(?!\/)/.test(from) ? from : undefined;
}

/** Re-exported so existing call sites (`import type { Plan } from "../lib/auth"`)
 *  keep working from the one shared definition — see @shared/entitlements. */
export type { Plan };

export interface AccessState {
  source: "community";
}

const DEFAULT_ACCESS: AccessState = { source: "community" };

interface Me {
  user: { id: string; email: string } | null;
  plan: Plan;
  access?: AccessState;
  isAdmin?: boolean;
}

interface AuthCtx {
  user: Me["user"];
  plan: Plan;
  access: AccessState;
  isAdmin: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** UI-only: whether the current plan grants a capability. Server routes must
   *  always enforce this themselves — this is convenience for gating, never security. */
  can: (capability: Capability) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

const EMPTY_ME: Me = { user: null, plan: "community", access: DEFAULT_ACCESS, isAdmin: false };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me>(EMPTY_ME);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<Me>("/api/me");
      setMe({
        user: data.user,
        plan: data.plan ?? "community",
        access: data.access ?? DEFAULT_ACCESS,
        isAdmin: !!data.isAdmin,
      });
    } catch {
      setMe(EMPTY_ME);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await authClient.signOut();
    setMe(EMPTY_ME);
  }, []);

  const plan = me.plan;
  const can = useCallback((capability: Capability) => hasCapability(plan, capability), [plan]);

  return (
    <Ctx.Provider
      value={{
        user: me.user,
        plan: me.plan,
        access: me.access ?? DEFAULT_ACCESS,
        isAdmin: !!me.isAdmin,
        loading,
        refresh,
        signOut,
        can,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
