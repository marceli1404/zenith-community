import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthAlert, AuthLayout, AuthButton, AuthField, AuthInput, AuthPasswordInput, AuthSpinner } from "./AuthLayout";
import { SocialButtons } from "./SocialButtons";
import { OtpForm } from "./OtpForm";
import { authClient, safePostAuthPath, useAuth, useAuthConfig } from "../../lib/auth";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@shared/password-policy";

export default function Signup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { config } = useAuthConfig();
  // See Login.tsx: carries a pending destination across
  // signup, whichever of email verification or straight-to-app path it takes.
  const location = useLocation();
  const from = safePostAuthPath((location.state as { from?: string } | null)?.from);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const tooLong = password.length > MAX_PASSWORD_LENGTH;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      setError(`Use a password between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters long.`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const trimmed = email.trim();
      const { error } = await authClient.signUp.email({ email: trimmed, password, name: name.trim() || trimmed.split("@")[0] || trimmed });
      if (error) {
        setError(error.message || "Could not create your account.");
        return;
      }
      await refresh();
      setDone(true);
    } catch {
      setError("We couldn't reach Zenith. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    // Email configured → verify the code the server just sent. Not configured →
    // no code can arrive, so continue straight to the app.
    if (config?.emailEnabled) {
      return (
        <AuthLayout title="Verify your email" subtitle="Enter the 6-digit code we just emailed you.">
          <OtpForm email={email.trim()} from={from} />
        </AuthLayout>
      );
    }
    return (
      <AuthLayout title="You're all set" subtitle="Your account is ready. Start by adding the first website you want to watch.">
        <AuthButton arrow onClick={() => navigate(from || "/app")}>Go to your dashboard</AuthButton>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      tabs
      title="Create your account"
      subtitle="Create an account for this Community installation."
      footer={
        <>
          By creating an account you agree to the <Link to="/legal/terms" className="auth-link">Terms</Link> and{" "}
          <Link to="/legal/privacy" className="auth-link">Privacy Policy</Link>.
        </>
      }
    >
      <SocialButtons from={from} />
      <form onSubmit={submit} className="auth-form">
        {error && <AuthAlert>{error}</AuthAlert>}
        <AuthField label="Name" htmlFor="signup-name" hint="Optional. Used in your emails.">
          <AuthInput id="signup-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </AuthField>
        <AuthField label="Email" htmlFor="signup-email">
          <AuthInput
            id="signup-email"
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
          htmlFor="signup-password"
          hint={
            <span className={password.length >= MIN_PASSWORD_LENGTH && !tooLong ? "auth-meter is-met" : tooShort || tooLong ? "auth-meter is-short" : "auth-meter"}>
              {MIN_PASSWORD_LENGTH}–{MAX_PASSWORD_LENGTH} characters{password.length > 0 ? ` (${Math.min(password.length, MAX_PASSWORD_LENGTH)}/${MAX_PASSWORD_LENGTH})` : ""}
            </span>
          }
        >
          <AuthPasswordInput
            id="signup-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            maxLength={MAX_PASSWORD_LENGTH}
            aria-invalid={tooShort || tooLong || undefined}
          />
        </AuthField>
        <AuthButton type="submit" arrow disabled={loading}>
          {loading ? <AuthSpinner label="Creating your account" /> : "Create account"}
        </AuthButton>
      </form>
    </AuthLayout>
  );
}
