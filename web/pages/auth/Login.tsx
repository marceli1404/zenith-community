import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AuthAlert, AuthLayout, AuthButton, AuthField, AuthInput, AuthPasswordInput, AuthSpinner } from "./AuthLayout";
import { SocialButtons } from "./SocialButtons";
import { authClient, safePostAuthPath, useAuth, useAuthConfig } from "../../lib/auth";

/** Messages for states that arrive in the URL: a failed OAuth round trip, or a
 *  completed password reset. */
const URL_MESSAGES: Record<string, { tone: "error" | "success"; text: string }> = {
  oauth: { tone: "error", text: "That sign-in didn't complete. Try again, or log in with your email." },
  reset: { tone: "success", text: "Your password has been updated. Log in with the new one." },
};

export default function Login() {
  const [params] = useSearchParams();
  const urlMessage = URL_MESSAGES[params.get("error") ?? ""] ?? (params.get("reset") ? URL_MESSAGES.reset : undefined);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Second factor: shown only when sign-in returns a twoFactorRedirect.
  const [needs2fa, setNeeds2fa] = useState(false);
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { config } = useAuthConfig();
  // Where to continue after a successful sign-in: set by RequireAuth when an
  // unauthenticated visit to a protected route bounced here.
  const location = useLocation();
  const from = safePostAuthPath((location.state as { from?: string } | null)?.from);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await authClient.signIn.email({ email: email.trim(), password });
      if (error) {
        setError(error.message || "Could not sign in. Check your email and password.");
        return;
      }
      if (data?.twoFactorRedirect) {
        setNeeds2fa(true);
        return;
      }
      await refresh();
      navigate(from || "/app");
    } catch {
      setError("We couldn't reach Zenith. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const trimmed = code.trim();
    try {
      const { error } = useBackup
        ? await authClient.twoFactor.verifyBackupCode({ code: trimmed })
        : await authClient.twoFactor.verifyTotp({ code: trimmed });
      if (error) {
        setError(error.message || "That code didn't match. Try again.");
        return;
      }
      await refresh();
      navigate(from || "/app");
    } catch {
      setError("We couldn't reach Zenith. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (needs2fa) {
    return (
      <AuthLayout
        title="Two-step sign-in"
        subtitle={useBackup ? "Enter one of your backup codes." : "Enter the 6-digit code from your authenticator app."}
      >
        <form onSubmit={verify} className="auth-form" noValidate>
          {error && <AuthAlert>{error}</AuthAlert>}
          <AuthField label={useBackup ? "Backup code" : "Authentication code"} htmlFor="login-code">
            <AuthInput
              id="login-code"
              value={code}
              onChange={(e) => setCode(useBackup ? e.target.value : e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode={useBackup ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoFocus
              maxLength={useBackup ? 12 : 6}
              placeholder={useBackup ? "xxxxx-xxxxx" : "123456"}
              className={useBackup ? undefined : "auth-input--code"}
            />
          </AuthField>
          <AuthButton type="submit" arrow disabled={loading || !code.trim()}>
            {loading ? <AuthSpinner label="Verifying" /> : "Verify and continue"}
          </AuthButton>
          <div className="auth-links">
            <button type="button" className="auth-link" onClick={() => { setUseBackup((b) => !b); setCode(""); setError(null); }}>
              {useBackup ? "Use your authenticator app" : "Use a backup code"}
            </button>
            <button type="button" className="auth-link" onClick={() => { setNeeds2fa(false); setCode(""); setError(null); setUseBackup(false); }}>
              Back to log in
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      tabs
      title="Welcome back"
      subtitle="Log in to check on your sites."
      footer={
        <>
          New to Zenith? <Link to="/signup" state={{ from }} className="auth-link">Create a Community account</Link>
        </>
      }
    >
      {urlMessage && <AuthAlert tone={urlMessage.tone}>{urlMessage.text}</AuthAlert>}
      <SocialButtons from={from} />
      <form onSubmit={submit} className="auth-form">
        {error && <AuthAlert>{error}</AuthAlert>}
        <AuthField label="Email" htmlFor="login-email">
          <AuthInput
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            spellCheck={false}
            autoCapitalize="none"
            placeholder="you@company.com"
          />
        </AuthField>
        <AuthField
          label="Password"
          htmlFor="login-password"
          aside={config?.emailEnabled && <Link to="/forgot-password" className="auth-link auth-link--quiet">Forgot password?</Link>}
        >
          <AuthPasswordInput
            id="login-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </AuthField>
        <AuthButton type="submit" arrow disabled={loading}>
          {loading ? <AuthSpinner label="Logging in" /> : "Log in"}
        </AuthButton>
      </form>
    </AuthLayout>
  );
}
