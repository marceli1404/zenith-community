import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { EmptyIllustration, type EmptyKind } from "./Observation";
import { Link } from "react-router-dom";
import { X } from "./lucide";
import { scoreColor } from "../lib/format";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

// Controls are pills everywhere (tokens.css shape rule). Heights keep a 40px+
// hit area; `sm` is for dense rows only.
const buttonBase =
  "lx-press inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none";
const variants: Record<ButtonVariant, string> = {
  primary: "bg-[hsl(var(--accent-fill))] text-accent-fg hover:bg-accent-2 shadow-[var(--highlight)]",
  secondary: "bg-surface text-text border border-border hover:bg-surface-2 hover:border-[hsl(var(--text)/0.24)]",
  ghost: "text-muted hover:text-text hover:bg-surface-2",
  danger: "bg-bad text-white hover:opacity-90",
};
const sizes: Record<ButtonSize, string> = {
  sm: "text-[0.8125rem] min-h-9 px-4",
  md: "text-[0.9375rem] min-h-11 px-5",
  lg: "text-base min-h-12 px-7",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className, ...props }, ref) => (
    <button ref={ref} className={cx(buttonBase, variants[variant], sizes[size], className)} {...props} />
  ),
);
Button.displayName = "Button";

export function LinkButton({
  to,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  to: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={cx(buttonBase, variants[variant], sizes[size], className)}>
      {children}
    </Link>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "bg-surface border border-border rounded-[var(--radius-lg)] shadow-[var(--highlight)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cx(
        "w-full min-h-11 bg-bg border border-border rounded-full px-5 text-[0.9375rem] text-text placeholder:text-subtle focus:border-accent outline-none transition-colors",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function Badge({
  children,
  color,
  className,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border",
        className,
      )}
      style={color ? { color, borderColor: color, background: `color-mix(in srgb, ${color} 12%, transparent)` } : undefined}
    >
      {children}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-text">{label}</span>
      {children}
      {hint && <span className="block text-xs text-subtle">{hint}</span>}
    </label>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx("inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin", className)}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("bg-surface-2 rounded-[var(--radius)] animate-pulse", className)} />;
}

export function EmptyState({
  title,
  description,
  action,
  kind,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  kind?: EmptyKind;
}) {
  return (
    <div className="text-center py-14 px-6">
      <EmptyIllustration kind={kind ?? (/incident/i.test(title) ? "incidents" : /report/i.test(title) ? "reports" : /audit/i.test(title) ? "audits" : "sites")} />
      <h3 className="text-lg font-semibold tracking-[-0.015em] text-text">{title}</h3>
      <p className="mt-2 text-[0.9375rem] text-muted max-w-md mx-auto leading-relaxed">{description}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

/** Number that eases to its target over `duration`, in step with the ring arc.
 *
 *  Entry counts up from zero the first time the ring is enabled (scrolled into
 *  view), so the numeral and the arc sweep together. After that it only moves
 *  for a genuine value change, never for an incidental re-render, and it always
 *  settles on the exact target.
 *
 *  A change that arrives mid-tween starts from the value currently on screen,
 *  not from the previous target — otherwise an interrupted update visibly jumps
 *  backwards before running again. Reduced motion goes straight to the target.
 *  One rAF chain per mounted ring, cancelled on unmount. */
function useCountTo(target: number, duration: number, enabled: boolean): number {
  // `shown` drives the render; `shownRef` mirrors it so an interrupting effect
  // can read the on-screen value synchronously without depending on it.
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  const enteredRef = useRef(false);

  const set = (value: number) => { shownRef.current = value; setShown(value); };

  useEffect(() => {
    if (!enabled) return;                       // hold at 0 until the ring is in view
    const from = enteredRef.current ? shownRef.current : 0;
    enteredRef.current = true;

    if (from === target || typeof window === "undefined" ||
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      set(target);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Same deceleration the arc uses, so digits and ring land together.
      const eased = 1 - Math.pow(1 - t, 3);
      set(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, enabled]);

  return enabled ? shown : target;
}

/** The Zenith Score ring — an eclipse-like gauge with a faint outer orbit and
 *  an orbital node at the arc's leading edge. Accessible text equivalent (§48).
 *
 *  Entry runs once, when the ring first scrolls into view: 900ms deceleration to
 *  the real score, with the numeral and the arc moving together. After that, the
 *  ring only re-animates when the score genuinely changes — it is keyed on the
 *  identity of the thing being scored, not on the score, so an incidental
 *  re-render never replays it. `previous` (a real prior score, when one exists)
 *  adds a subtle signed delta. The accessible name always states the target
 *  value, so assistive technology never hears intermediate numbers. */
export function ScoreRing({ score, size = 88, label, previous }: { score: number; size?: number; label?: string; previous?: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  // Decide the already-in-viewport case before the first paint. IntersectionObserver
  // delivers its first record asynchronously, so relying on it alone paints one
  // frame at the final score and then restarts the count-up from zero — a visible
  // flicker on every dashboard card that is on screen at mount.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const box = el.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) setVisible(true);
  }, []);
  useEffect(() => {
    if (visible || !ref.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { threshold: .2 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);
  const cxy = size / 2;
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, score));
  const color = scoreColor(score);
  // Orbital node position at the leading edge of the arc (starts at 12 o'clock).
  const angle = (-90 + (clamped / 100) * 360) * (Math.PI / 180);
  const nodeX = cxy + r * Math.cos(angle);
  const nodeY = cxy + r * Math.sin(angle);
  const shown = useCountTo(score, 900, visible);
  const delta = typeof previous === "number" && previous !== score ? score - previous : null;
  return (
    <div ref={ref} className={`score-signature ${visible ? "score-visible" : ""} inline-flex flex-col items-center`} style={{ "--score-start": c, "--node-start": `${-clamped * 3.6}deg` } as CSSProperties} role="img" aria-label={`${label ? label + " " : "Zenith "}score ${score} out of 100${delta !== null ? `, ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} from ${previous}` : ""}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* faint outer orbit */}
        <circle className="score-track" cx={cxy} cy={cxy} r={r + 4} fill="none" stroke="var(--color-accent)" strokeWidth={0.75} opacity={0.25} />
        {/* track */}
        <circle cx={cxy} cy={cxy} r={r} fill="none" stroke="var(--color-border)" strokeWidth={6} />
        {/* score arc */}
        <circle
          className="score-arc"
          cx={cxy}
          cy={cxy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (clamped / 100) * c}
          transform={`rotate(-90 ${cxy} ${cxy})`}
        />
        {/* orbital node */}
        {clamped > 0 && clamped < 100 && <g className="score-node"><circle cx={nodeX} cy={nodeY} r={2.4} fill={color} /></g>}
        <text x="50%" y="50%" textAnchor="middle" dy="0.35em" fontSize={size * 0.29} fontWeight={700} fill="var(--color-text)" style={{ fontVariantNumeric: "tabular-nums" }}>
          {shown}
        </text>
      </svg>
      {label && <span className="text-xs text-muted mt-1">{label}</span>}
      {delta !== null && (
        <span className="text-[11px] tabular-nums mt-0.5" style={{ color: delta > 0 ? "var(--color-good)" : "var(--color-bad)" }}>
          {delta > 0 ? "+" : "−"}{Math.abs(delta)}
        </span>
      )}
    </div>
  );
}

/** Accessible modal dialog: Escape to close, backdrop click to close, focus moved
 *  in on open, body scroll locked. Respects reduced-motion via CSS. */
export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = "42rem",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
        if (!items?.length) { e.preventDefault(); return; }
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previousFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="lx-modal-backdrop fixed inset-0 z-[100] grid place-items-center p-4 bg-[hsl(225_20%_3%/0.6)] backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="lx-modal w-full bg-surface border border-border rounded-[var(--radius-lg)] shadow-[var(--shadow-sheet)] outline-none max-h-[85vh] flex flex-col"
        style={{ maxWidth }}
      >
        <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-border">
          <h2 className="font-semibold text-text">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-text grid place-items-center w-10 h-10 rounded-full hover:bg-surface-2">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

/** Confirmation dialog for destructive actions — replaces native confirm().
 *  Clear title, specific consequence, Cancel + destructive CTA, focus + Escape
 *  handled by Modal. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  loading = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="26rem">
      <div className="text-sm text-muted leading-relaxed">{description}</div>
      <div className="flex justify-end gap-3 mt-6">
        <Button variant="secondary" onClick={onClose} disabled={loading}>{cancelLabel}</Button>
        <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} disabled={loading}>
          {loading ? <Spinner /> : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
