import type { MouseEvent } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../lib/theme";
import { ZenithMark } from "./ZenithMark";

export { ZenithMark };

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={className ? `lx-logo ${className}` : "lx-logo"} aria-label="Zenith Community home">
      <span className="lx-logo__mark"><ZenithMark size={22} /></span>
      <span className="lx-logo__word">Zenith</span>
    </Link>
  );
}

export function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return <button type="button" className="lx-iconbutton" aria-label={`Switch to ${next} theme`} onClick={() => setTheme(next)}>{next === "dark" ? "☾" : "☀"}</button>;
}

export function PublicNav() {
  return (
    <header className="lx-nav">
      <div className="lx-container lx-nav__inner">
        <Logo />
        <nav aria-label="Main navigation" className="lx-nav__links">
          <Link className="lx-nav__link" to="/methodology">Methodology</Link>
          <Link className="lx-nav__link" to="/security">Security</Link>
          <Link className="lx-nav__link" to="/legal/privacy">Privacy</Link>
        </nav>
        <div className="lx-nav__actions">
          <Link className="lx-nav__link lx-nav__login" to="/login">Log in</Link>
          <Link to="/signup" className="lx-button lx-button--primary"><span>Create account</span></Link>
          <ThemeToggle />
          <details className="lx-nav__menu">
            <summary className="lx-iconbutton lx-nav__toggle" aria-label="Toggle navigation">
              <span className="lx-burger" aria-hidden="true" />
            </summary>
            <div className="lx-menu">
              <nav className="lx-menu__links" aria-label="Mobile navigation">
                <div className="lx-menu__group">
                  <p className="lx-menu__heading">Product</p>
                  <Link className="lx-menu__link" to="/methodology" onClick={closeMobileMenu}>Methodology</Link>
                  <Link className="lx-menu__link" to="/security" onClick={closeMobileMenu}>Security</Link>
                  <Link className="lx-menu__link" to="/contact" onClick={closeMobileMenu}>Contact</Link>
                </div>
                <div className="lx-menu__group">
                  <p className="lx-menu__heading">Account</p>
                  <Link className="lx-menu__link" to="/login" onClick={closeMobileMenu}>Log in</Link>
                  <Link className="lx-menu__link" to="/signup" onClick={closeMobileMenu}>Create account</Link>
                </div>
              </nav>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

function closeMobileMenu(event: MouseEvent<HTMLAnchorElement>) {
  const menu = event.currentTarget.closest("details");
  if (menu) menu.open = false;
}

export function Footer() {
  return (
    <footer className="lx-footer">
      <div className="lx-container lx-footer__columns">
        <div className="lx-footer__brand">
          <Logo />
          <p className="lx-caption">Self-hosted website monitoring and audits.</p>
        </div>
        <nav className="lx-footer__col" aria-label="Product information">
          <p className="lx-footer__heading">Product</p>
          <ul><li><Link to="/methodology">How scoring works</Link></li><li><Link to="/security">Security</Link></li><li><Link to="/contact">Contact</Link></li></ul>
        </nav>
        <nav className="lx-footer__col" aria-label="Legal information">
          <p className="lx-footer__heading">Legal</p>
          <ul><li><Link to="/legal/privacy">Privacy</Link></li><li><Link to="/legal/terms">Terms</Link></li></ul>
        </nav>
      </div>
      <div className="lx-container lx-footer__legal"><span>© {__BUILD_YEAR__} Zenith Community.</span><span>Monitoring checks are not a penetration test or compliance certificate.</span></div>
    </footer>
  );
}

export function PublicPage({ children }: { children: React.ReactNode }) {
  return <div className="lx-site"><PublicNav /><main id="main" className="lx-main" tabIndex={-1}>{children}</main><Footer /></div>;
}
