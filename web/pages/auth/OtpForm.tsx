import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authClient, useAuth } from "../../lib/auth";
import { AuthAlert, AuthButton, AuthField, AuthInput, AuthSpinner } from "./AuthLayout";

const RESEND_WAIT = 30;

/** Numeric email-verification code entry. Shown after signup when email
 *  delivery is configured. Verifies the 6-digit code and, on success, continues
 *  to the app. Resend is rate-limited in the UI with a visible countdown. */
export function OtpForm({ email, from }: { email: string; from?: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [wait, setWait] = useState(RESEND_WAIT);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const { error } = await authClient.emailOtp.verifyEmail({ email, otp: code.trim() });
      if (error) {
        setError(error.message || "That code didn't match. Check it and try again.");
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

  async function resend() {
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
      if (error) {
        setError(error.message || "Could not resend the code.");
        return;
      }
      setNotice("A new code is on its way.");
      setWait(RESEND_WAIT);
    } catch {
      setError("We couldn't reach Zenith. Check your connection and try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <form onSubmit={verify} className="auth-form">
      <p className="auth-note">
        Sent to <strong>{email}</strong>
      </p>
      {error && <AuthAlert>{error}</AuthAlert>}
      {notice && <AuthAlert tone="success">{notice}</AuthAlert>}
      <AuthField label="Verification code" htmlFor="otp-code">
        <AuthInput
          id="otp-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          placeholder="123456"
          className="auth-input--code"
          autoFocus
        />
      </AuthField>
      <AuthButton type="submit" arrow disabled={loading || code.length !== 6}>
        {loading ? <AuthSpinner label="Verifying" /> : "Verify email"}
      </AuthButton>
      <div className="auth-links">
        <button type="button" onClick={resend} disabled={resending || wait > 0} className="auth-link">
          {resending ? "Sending a new code" : wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
        </button>
      </div>
    </form>
  );
}
