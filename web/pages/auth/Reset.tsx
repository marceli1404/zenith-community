import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthAlert, AuthLayout, AuthButton, AuthField, AuthPasswordInput, AuthSpinner } from "./AuthLayout";
import { authClient } from "../../lib/auth";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@shared/password-policy";

export default function Reset() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      setError(`Use a password between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters long.`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      if (error) {
        setError(error.message || "This reset link is invalid or has expired.");
        return;
      }
      // The login page shows a confirmation for ?reset=1.
      navigate("/login?reset=1", { replace: true });
    } catch {
      setError("We couldn't reach Zenith. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout
        title="This link doesn't work"
        subtitle="The password reset link is missing its token or has been cut short."
        footer={<Link to="/login" className="auth-link">Back to log in</Link>}
      >
        <Link to="/forgot-password" className="lx-button lx-button--primary auth-button">
          <span className="auth-button__label">Request a new link</span>
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="You'll use it to log in from now on."
      footer={<Link to="/login" className="auth-link">Back to log in</Link>}
    >
      <form onSubmit={submit} className="auth-form">
        {error && (
          <AuthAlert>
            {error} <Link to="/forgot-password" className="auth-link">Request a new link</Link>
          </AuthAlert>
        )}
        <AuthField label="New password" htmlFor="reset-password" hint={`${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters.`}>
          <AuthPasswordInput
            id="reset-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            autoFocus
            maxLength={MAX_PASSWORD_LENGTH}
          />
        </AuthField>
        <AuthButton type="submit" arrow disabled={loading}>
          {loading ? <AuthSpinner label="Updating" /> : "Update password"}
        </AuthButton>
      </form>
    </AuthLayout>
  );
}
