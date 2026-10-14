import { useState } from "react";
import { authClient, useAuthConfig, type SocialProvider } from "../../lib/auth";
import { AuthAlert, AuthDivider, AuthSpinner } from "./AuthLayout";

/** Official provider marks. Google's four-colour G and the GitHub mark are used
 *  as-is (no recolouring), per the design spec's provider-presentation rule. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
function GithubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.12-.31-.54-1.53.12-3.19 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.19.77.84 1.24 1.92 1.24 3.23 0 4.62-2.8 5.64-5.48 5.94.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.22.7.83.58C20.56 22.29 24 17.8 24 12.5 24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

const MARKS: Record<SocialProvider, { label: string; mark: () => React.ReactElement }> = {
  google: { label: "Google", mark: GoogleMark },
  github: { label: "GitHub", mark: GithubMark },
};

/**
 * OAuth sign-in buttons for every configured provider, side by side. While the
 * provider config loads, same-size placeholders hold the space so the form
 * doesn't jump; if no provider is configured the whole block (and its divider)
 * collapses and the email form stands alone.
 */
export function SocialButtons({ from }: { from?: string }) {
  const { config, loaded } = useAuthConfig();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabled = (Object.keys(MARKS) as SocialProvider[]).filter((p) => config?.authProviders[p]);

  if (!loaded) {
    return (
      <div className="auth-social" aria-hidden="true">
        <div className="auth-social__grid">
          <span className="auth-social__placeholder" />
          <span className="auth-social__placeholder" />
        </div>
        <AuthDivider>or with email</AuthDivider>
      </div>
    );
  }
  if (enabled.length === 0) return null;

  async function go(provider: SocialProvider) {
    setBusy(provider);
    setError(null);
    try {
      // Full-page OAuth redirect; React state doesn't survive that round trip,
      // so the pending destination (if any) travels as callbackURL instead.
      const { error: startError } = await authClient.signIn.social({
        provider,
        callbackURL: from || "/app",
        errorCallbackURL: "/login?error=oauth",
      });
      if (startError) throw startError;
    } catch {
      setError(`Couldn't start ${MARKS[provider].label} sign-in. Try again, or use your email.`);
      setBusy(null);
    }
  }

  return (
    <div className="auth-social">
      {error && <AuthAlert>{error}</AuthAlert>}
      <div className={enabled.length > 1 ? "auth-social__grid" : "auth-social__grid auth-social__grid--single"}>
        {enabled.map((p) => {
          const { label, mark: Mark } = MARKS[p];
          return (
            <button
              key={p}
              type="button"
              onClick={() => go(p)}
              disabled={busy !== null}
              className="lx-button lx-button--secondary auth-provider"
              aria-label={`Continue with ${label}`}
            >
              {busy === p ? <AuthSpinner label={`Opening ${label}`} /> : <Mark />}
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <AuthDivider>or with email</AuthDivider>
    </div>
  );
}
