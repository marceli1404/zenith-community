import { forwardRef, useLayoutEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Logo, ThemeToggle, ZenithMark } from "../../components/PublicChrome";
import { cx } from "../../components/ui";
import { IconArrowRight, IconCheck, IconEye, IconLock, IconPulse, IconShield } from "../../components/icons";
import { useDocumentTitle, useNoindex } from "../../lib/useTitle";

/**
 * Auth shell. A focused form column (with a Log in / Create account switch when
 * the page is one of those two) and, on wide screens, a Zenith panel that says
 * what you're signing in to. Same tokens, type and controls as the public site.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  tabs = false,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Show the Log in / Create account switch (login and signup only). */
  tabs?: boolean;
}) {
  useNoindex(); // auth screens should not be indexed (§ SEO / auth routes)
  useDocumentTitle(title);

  return (
    <div className="auth-shell">
      <div className="auth-shell__main">
        <header className="auth-bar">
          <Logo />
          <div className="auth-bar__actions">
            <Link to="/" className="auth-bar__back">
              Back to site
            </Link>
            <ThemeToggle />
          </div>
        </header>

        <main id="main" className="auth-main" tabIndex={-1}>
          <div className="auth-card">
            {tabs && <AuthTabs />}
            <h1 className="auth-heading">{title}</h1>
            {subtitle && <p className="auth-subtitle">{subtitle}</p>}
            <div className="auth-body">{children}</div>
            {footer && <div className="auth-footer">{footer}</div>}
          </div>
        </main>
      </div>

      <AuthShowcase />
    </div>
  );
}

/** Resolves once the *next* <AuthTabs/> to mount picks it up — see `useViewTransitionNav`. */
let pendingViewTransitionReady: (() => void) | null = null;

/**
 * Turns a tab click into a View Transition when the browser supports one.
 *
 * `<Link viewTransition>` (react-router's own opt-in) is a no-op here: this app
 * renders `<Route>`s under a plain `<BrowserRouter>`, and the view-transition
 * wiring in react-router-dom only runs for a data router built with
 * `createBrowserRouter`/`RouterProvider` (react-router-dom source, `useNavigate`
 * → `useNavigateUnstable` → `history.push`, which never touches
 * `document.startViewTransition`) — switching router styles is out of scope
 * here, so this wires the browser API up by hand instead.
 *
 * The tricky part is timing: `<BrowserRouter future={{ v7_startTransition: true }}>`
 * (main.tsx) commits every navigation inside `React.startTransition`, and
 * `flushSync` cannot force a transition-priority update to commit synchronously
 * — react-router's own data-router implementation hits the same problem and
 * solves it by starting the view transition with an *async* callback that
 * `navigate()`s and then awaits a promise, resolving that promise once the next
 * render has actually committed. This does the same thing, at a much smaller
 * scale: the callback navigates and waits for `pendingViewTransitionReady`,
 * which the *incoming* page's own `<AuthTabs/>` resolves from a layout effect —
 * by definition, once that fires, the whole new page (its sibling heading and
 * body included, since they commit in the same pass) is already in the DOM.
 */
function useViewTransitionNav() {
  const navigate = useNavigate();
  const location = useLocation();

  useLayoutEffect(() => {
    pendingViewTransitionReady?.();
    pendingViewTransitionReady = null;
  });

  return (to: string, state: unknown) => (event: MouseEvent<HTMLAnchorElement>) => {
    // Leave modified clicks (open in new tab, etc.) to the browser's own <a> handling.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    if (typeof document.startViewTransition !== "function") return; // let the plain <Link> navigate
    event.preventDefault();
    const replace = location.pathname === to;
    document.startViewTransition(
      () =>
        new Promise<void>((resolve) => {
          // The resolver is handed to the incoming <AuthTabs/>, but nothing
          // guarantees one mounts — a redirect, an error boundary, or simply a
          // second click overwriting this resolver. An unsettled promise leaves
          // the page frozen under the transition snapshot, so always settle.
          let timer: ReturnType<typeof setTimeout>;
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
          };
          timer = setTimeout(finish, 400);
          pendingViewTransitionReady = finish;
          navigate(to, { state, replace });
        }),
    );
  };
}

/** Log in / Create account switch. Real links (so each has its own URL, the
 *  browser back button behaves, and a browser or JS-off visit still navigates
 *  plainly), styled as a segmented control whose highlight slides to the
 *  current page. Any pending redirect travels with the switch. */
function AuthTabs() {
  const location = useLocation();
  const onSignup = location.pathname.startsWith("/signup");
  const state = location.state;
  const go = useViewTransitionNav();
  return (
    <nav className="auth-tabs" aria-label="Account" data-active={onSignup ? "signup" : "login"}>
      <span className="auth-tabs__indicator" aria-hidden="true" />
      <Link
        to="/login"
        state={state}
        className="auth-tabs__tab"
        aria-current={onSignup ? undefined : "page"}
        onClick={go("/login", state)}
      >
        Log in
      </Link>
      <Link
        to="/signup"
        state={state}
        className="auth-tabs__tab"
        aria-current={onSignup ? "page" : undefined}
        onClick={go("/signup", state)}
      >
        Create account
      </Link>
    </nav>
  );
}

const SHOWCASE_POINTS = [
  { Icon: IconPulse, title: "Uptime checks every minute", body: "Receive downtime and recovery emails when the operator enables delivery." },
  { Icon: IconShield, title: "Audits you can trace", body: "Review security, accessibility, SEO and performance findings with their evidence." },
  { Icon: IconCheck, title: "A clear next step for each finding", body: "Review a practical recommendation alongside the evidence." },
];

function AuthShowcase() {
  return (
    <aside className="auth-showcase" aria-label="About Zenith">
      <div className="auth-showcase__inner">
        <div className="auth-showcase__mark" aria-hidden="true">
          <span className="auth-showcase__ring auth-showcase__ring--outer" />
          <span className="auth-showcase__ring auth-showcase__ring--inner" />
          <ZenithMark size={56} />
        </div>

        <p className="auth-showcase__title">Know when your website needs attention.</p>

        <ul className="auth-showcase__points">
          {SHOWCASE_POINTS.map(({ Icon, title, body }) => (
            <li key={title}>
              <span className="auth-showcase__icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <span>
                <strong>{title}</strong>
                <span>{body}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="auth-showcase__sample" aria-hidden="true">
          <span className="auth-showcase__sample-label">Illustrative report</span>
          <span className="auth-showcase__sample-score lx-numeric">84</span>
          <span className="auth-showcase__sample-bars">
            {[72, 81, 93, 88].map((v, i) => (
              <span key={v} style={{ width: `${v}%`, animationDelay: `${700 + i * 90}ms` }} />
            ))}
          </span>
        </div>

        <p className="auth-showcase__note">
          <IconLock size={14} /> Zenith only reads public pages. It never signs in to or changes your site.
        </p>
      </div>
    </aside>
  );
}

/* ---- Shared auth form primitives ------------------------------------------- */

export function AuthField({
  label,
  hint,
  aside,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  /** Something that sits at the end of the label row, e.g. "Forgot password?". */
  aside?: ReactNode;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-field">
      <div className="auth-field__row">
        <label htmlFor={htmlFor} className="auth-field__label">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {hint && <p className="auth-field__hint">{hint}</p>}
    </div>
  );
}

export const AuthInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cx("lx-field auth-input", className)} {...props} />,
);
AuthInput.displayName = "AuthInput";

/** Password input with a show/hide control and a Caps Lock warning. */
export const AuthPasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(
  ({ className, onKeyUp, onBlur, id, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    const [caps, setCaps] = useState(false);
    return (
      <>
        <div className="auth-password">
          <input
            ref={ref}
            id={id}
            type={visible ? "text" : "password"}
            className={cx("lx-field auth-input auth-password__input", className)}
            onKeyUp={(e) => {
              setCaps(e.getModifierState?.("CapsLock") ?? false);
              onKeyUp?.(e);
            }}
            onBlur={(e) => {
              setCaps(false);
              onBlur?.(e);
            }}
            aria-describedby={caps && id ? `${id}-caps` : undefined}
            {...props}
          />
          <button
            type="button"
            className="auth-password__toggle"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            aria-controls={id}
          >
            <IconEye size={18} />
            <span className={visible ? "auth-password__slash is-on" : "auth-password__slash"} aria-hidden="true" />
          </button>
        </div>
        {caps && (
          <p id={id ? `${id}-caps` : undefined} className="auth-field__warn" role="status">
            Caps Lock is on.
          </p>
        )}
      </>
    );
  },
);
AuthPasswordInput.displayName = "AuthPasswordInput";

interface AuthButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  /** Adds the travelling arrow used by primary actions. */
  arrow?: boolean;
}
export const AuthButton = forwardRef<HTMLButtonElement, AuthButtonProps>(
  ({ variant = "primary", arrow = false, className, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cx(
        "lx-button auth-button",
        variant === "primary" ? "lx-button--primary" : "lx-button--secondary",
        arrow && variant === "primary" ? "auth-button--arrow" : undefined,
        className,
      )}
      {...props}
    >
      <span className="auth-button__label">{children}</span>
      {arrow && variant === "primary" && <IconArrowRight size={16} className="lx-button__icon" />}
    </button>
  ),
);
AuthButton.displayName = "AuthButton";

export function AuthSpinner({ label = "Loading" }: { label?: string }) {
  return <span className="lx-spinner" role="status" aria-label={label} />;
}

export function AuthAlert({ tone = "error", children }: { tone?: "error" | "success"; children: ReactNode }) {
  return (
    <div className={`auth-alert auth-alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function AuthDivider({ children }: { children: ReactNode }) {
  return (
    <div className="auth-divider">
      <span>{children}</span>
    </div>
  );
}
