import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "../components/lucide";
import { cx } from "../components/ui";

/**
 * The console's layout vocabulary. Every page is a PageHeader followed by
 * Panels, so type sizes, spacing and shapes stay the same from screen to screen.
 * Styles live in dashboard.css under the `cn-` prefix.
 */

export function PageHeader({
  title,
  description,
  back,
  actions,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="cn-header">
      {back && (
        <Link to={back.to} className="cn-back">
          <ArrowLeft size={16} /> {back.label}
        </Link>
      )}
      <div className="cn-header__row">
        <div className="cn-header__text">
          <h1>{title}</h1>
          {description && <p>{description}</p>}
          {meta && <div className="cn-header__meta">{meta}</div>}
        </div>
        {actions && <div className="cn-header__actions">{actions}</div>}
      </div>
    </header>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  flush,
  as: Tag = "section",
  id,
  tone,
  ...rest
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Body runs edge to edge (tables and lists draw their own row padding). */
  flush?: boolean;
  as?: "section" | "div" | "aside";
  id?: string;
  tone?: "accent" | "danger";
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <Tag
      id={id}
      className={cx("cn-panel", flush && "cn-panel--flush", tone && `cn-panel--${tone}`, className)}
      aria-labelledby={title && headingId && !rest["aria-label"] ? headingId : rest["aria-labelledby"]}
      aria-label={rest["aria-label"]}
    >
      {(title || actions) && (
        <div className="cn-panel__head">
          <div className="cn-panel__title">
            {title && <h2 id={headingId}>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="cn-panel__actions">{actions}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cx("cn-stats", className)}>{children}</dl>;
}

export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "good" | "warn" | "bad" | "muted" }) {
  return (
    <div className="cn-stat">
      <dt>{label}</dt>
      <dd className={tone ? `is-${tone}` : undefined}>{value}</dd>
      {hint && <dd className="cn-stat__hint">{hint}</dd>}
    </div>
  );
}

/** A row of pill toggles. Pressed state is exposed with aria-pressed. */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cx("cn-segmented", className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ tone = "muted", children, dot }: { tone?: "good" | "warn" | "bad" | "muted" | "accent"; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`cn-chip is-${tone}`}>
      {dot && <i aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Notice({ tone = "warn", children, action, role = "status" }: { tone?: "warn" | "bad" | "accent"; children: ReactNode; action?: ReactNode; role?: "status" | "alert" }) {
  return (
    <div className={`cn-notice is-${tone}`} role={role}>
      <span>{children}</span>
      {action}
    </div>
  );
}
