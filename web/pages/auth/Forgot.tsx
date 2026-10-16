import { useState } from "react";
import { Link } from "react-router-dom";
import { AuthAlert, AuthLayout, AuthButton, AuthField, AuthInput, AuthSpinner } from "./AuthLayout";
import { authClient, useAuthConfig } from "../../lib/auth";

export default function Forgot() {
  const { config, loaded } = useAuthConfig();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
    } catch {
      /* Same confirmation either way, so the page never reveals which emails exist. */
    }
    setSent(true);
    setLoading(false);
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle={sent ? undefined : !loaded
        ? "Checking email delivery settings."
        : config?.emailEnabled
          ? "Enter your account email and we'll send you a link to choose a new password."
          : undefined}
      footer={
        <Link to="/login" className="auth-link">
          Back to log in
        </Link>
      }
    >
      {!loaded ? (
        <div className="auth-note" role="status">Checking email delivery settings…</div>
      ) : !config ? (
        <AuthAlert>We couldn't check whether password reset email is available. Try again later or contact the installation administrator.</AuthAlert>
      ) : !config.emailEnabled ? (
        <AuthAlert>Password reset email isn't configured for this installation. Contact its administrator for help.</AuthAlert>
      ) : sent ? (
        <div className="auth-form">
          <AuthAlert tone="success">
            If an account exists for <strong>{email.trim()}</strong>, a reset link is on its way. It can take a minute to arrive.
          </AuthAlert>
          <div className="auth-links">
            <button type="button" className="auth-link" onClick={() => setSent(false)}>
              Use a different email
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="auth-form">
          <AuthField label="Email" htmlFor="forgot-email">
            <AuthInput
              id="forgot-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              spellCheck={false}
              autoCapitalize="none"
              placeholder="you@company.com"
              autoFocus
            />
          </AuthField>
          <AuthButton type="submit" arrow disabled={loading}>
            {loading ? <AuthSpinner label="Sending" /> : "Send reset link"}
          </AuthButton>
        </form>
      )}
    </AuthLayout>
  );
}
