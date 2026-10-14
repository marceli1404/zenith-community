import { Link } from "react-router-dom";
import { AuthLayout } from "./AuthLayout";
import { IconMail } from "../../components/icons";

export default function Verify() {
  return (
    <AuthLayout
      title="Check your email"
      subtitle="We've sent you a verification link. Open it to confirm your email address, then come back here."
      footer={
        <>
          Wrong account? <Link to="/login" className="auth-link">Log in with a different one</Link>
        </>
      }
    >
      <div className="auth-form">
        <div className="auth-verify-icon" aria-hidden="true">
          <IconMail size={26} />
        </div>
        <Link to="/app" className="lx-button lx-button--primary auth-button">
          <span className="auth-button__label">Continue to dashboard</span>
        </Link>
      </div>
    </AuthLayout>
  );
}
