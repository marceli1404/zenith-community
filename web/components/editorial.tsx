import { useEffect, useId, useRef, useState, type ElementType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { IconArrowRight, IconArrowUpRight, IconCheck, IconPlus } from "./icons";

/*
 * Editorial component library. Every component reads design tokens through the
 * `lx-*` classes in styles/editorial.css — no inline colours, no ad-hoc spacing.
 */

function cls(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ---- Layout ---------------------------------------------------------------- */

type Tone = "ivory" | "stone" | "olive" | "paper";
type Texture = "paper" | "linen" | "travertine" | "ceramic" | "none";

export function Section({
  id,
  tone = "ivory",
  texture = "none",
  rhythm = "default",
  labelledBy,
  className,
  children,
}: {
  id?: string;
  tone?: Tone;
  texture?: Texture;
  /** Vertical padding pattern — sections deliberately vary their rhythm. */
  rhythm?: "default" | "tight" | "open" | "flush";
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      data-reveal="section"
      className={cls("lx-section", `lx-tone-${tone}`, `lx-rhythm-${rhythm}`, texture !== "none" && `tx-${texture}`, className)}
    >
      {children}
    </section>
  );
}

export function Container({ children, className, width = "wide" }: { children: ReactNode; className?: string; width?: "wide" | "reading" }) {
  return <div className={cls("lx-container", width === "reading" && "lx-container--reading", className)}>{children}</div>;
}

/** "02 — The check library". Numbering makes the page read like an issue. */
export function SectionLabel({ number, children, className }: { number?: string; children: ReactNode; className?: string }) {
  return (
    <p className={cls("lx-label", className)}>
      {number && <span className="lx-label__number lx-numeric">{number}</span>}
      <span>{children}</span>
    </p>
  );
}

export function Heading({
  as: Tag = "h2",
  size = "section",
  id,
  className,
  children,
}: {
  as?: ElementType;
  size?: "hero" | "section" | "title";
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag id={id} className={cls("lx-heading", `lx-heading--${size}`, className)}>
      {children}
    </Tag>
  );
}

/* ---- Actions --------------------------------------------------------------- */

type ButtonTone = "primary" | "secondary";

export function ButtonLink({ to, tone = "primary", children, className, onClick }: { to: string; tone?: ButtonTone; children: ReactNode; className?: string; onClick?: () => void }) {
  const external = /^(https?:|mailto:)/.test(to) || to.startsWith("#") || to.startsWith("/#");
  const body = (
    <>
      <span>{children}</span>
      <IconArrowRight size={16} className="lx-button__icon" />
    </>
  );
  const className_ = cls("lx-button", `lx-button--${tone}`, className);
  return external ? (
    <a href={to} className={className_} onClick={onClick}>{body}</a>
  ) : (
    <Link to={to} className={className_} onClick={onClick}>{body}</Link>
  );
}

/** Secondary calls to action are text, not a second button. */
export function TextLink({ to, children, className, external }: { to: string; children: ReactNode; className?: string; external?: boolean }) {
  const Icon = external ? IconArrowUpRight : IconArrowRight;
  const inner = (
    <>
      <span className="lx-textlink__text">{children}</span>
      <Icon size={16} className="lx-textlink__icon" />
    </>
  );
  return to.startsWith("/") && !to.startsWith("/#") && !external ? (
    <Link to={to} className={cls("lx-textlink", className)}>{inner}</Link>
  ) : (
    <a href={to} className={cls("lx-textlink", className)} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{inner}</a>
  );
}

/* ---- Content blocks -------------------------------------------------------- */

export function QuoteBlock({ children, cite, className }: { children: ReactNode; cite?: ReactNode; className?: string }) {
  return (
    <figure className={cls("lx-quote", className)}>
      <blockquote className="lx-quote__text">{children}</blockquote>
      {cite && <figcaption className="lx-quote__cite">{cite}</figcaption>}
    </figure>
  );
}

/** A number that earns its place: value, what it measures, and where it comes from. */
export function StatBlock({ value, unit, label, note }: { value: string; unit?: string; label: string; note?: string }) {
  return (
    <div className="lx-stat">
      <p className="lx-stat__value">
        <span className="lx-numeric">{value}</span>
        {unit && <span className="lx-stat__unit">{unit}</span>}
      </p>
      <p className="lx-stat__label">{label}</p>
      {note && <p className="lx-stat__note">{note}</p>}
    </div>
  );
}

export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cls("lx-caption", className)}>{children}</p>;
}

export function Chip({ pressed, onClick, children, count }: { pressed: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button type="button" className="lx-chip" aria-pressed={pressed} onClick={onClick}>
      <span>{children}</span>
      {typeof count === "number" && <span className="lx-chip__count lx-numeric">{count}</span>}
    </button>
  );
}

export function TimelineItem({ marker, title, meta, children, active }: { marker: string; title: string; meta?: string; children: ReactNode; active?: boolean }) {
  return (
    <li className={cls("lx-timeline__item", active && "is-active")}>
      <span className="lx-timeline__marker lx-numeric" aria-hidden="true">{marker}</span>
      <div className="lx-timeline__body">
        <p className="lx-timeline__title">
          {title}
          {meta && <span className="lx-timeline__meta lx-numeric">{meta}</span>}
        </p>
        <div className="lx-timeline__text">{children}</div>
      </div>
    </li>
  );
}

/* ---- Accordion ------------------------------------------------------------- */

export interface AccordionEntry {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  content: ReactNode;
}

/**
 * Disclosure list. Each row is a real <button aria-expanded> controlling a
 * region; height animates via grid-template-rows (0fr → 1fr) with a slight
 * spring ease, so there's no JS measuring and no layout jump.
 */
export function Accordion({ entries, single = false, className }: { entries: AccordionEntry[]; single?: boolean; className?: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const base = useId();
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(single ? [] : prev);
      if (prev.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className={cls("lx-accordion", className)}>
      {entries.map((e) => {
        const isOpen = open.has(e.id);
        const panelId = `${base}-${e.id}-panel`;
        const buttonId = `${base}-${e.id}-button`;
        return (
          <div key={e.id} className={cls("lx-accordion__item", isOpen && "is-open")}>
            <h3 className="lx-accordion__heading">
              <button id={buttonId} type="button" className="lx-accordion__trigger" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(e.id)}>
                <span className="lx-accordion__title">{e.title}</span>
                {e.meta && <span className="lx-accordion__meta">{e.meta}</span>}
                <IconPlus size={18} className="lx-accordion__icon" />
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              className="lx-accordion__panel"
              data-open={isOpen}
              // Collapsed panels stay in the DOM so height can animate, but must not
              // be focusable or announced: `inert` removes them from both.
              {...({ inert: isOpen ? undefined : "" } as Record<string, string | undefined>)}
            >
              <div className="lx-accordion__inner">
                <div className="lx-accordion__content">{e.content}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---- Horizontal gallery ---------------------------------------------------- */

/** Scroll-snap gallery with keyboard-reachable previous/next controls. */
export function Gallery({ label, children }: { label: string; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 280), behavior: "smooth" });
  };
  return (
    <div className="lx-gallery" role="region" aria-label={label}>
      <div className="lx-gallery__controls">
        <button type="button" className="lx-gallery__control" onClick={() => scroll(-1)} aria-label="Previous">
          <IconArrowRight size={18} style={{ transform: "scaleX(-1)" }} />
        </button>
        <button type="button" className="lx-gallery__control" onClick={() => scroll(1)} aria-label="Next">
          <IconArrowRight size={18} />
        </button>
      </div>
      <div ref={track} className="lx-gallery__track" tabIndex={0}>
        {children}
      </div>
    </div>
  );
}

/* ---- Page scaffolding -------------------------------------------------------- */

/**
 * Opening band for inner pages. The copy settles in a short stagger on load —
 * CSS only, so the prerendered HTML animates without waiting for hydration.
 */
export function PageHero({
  label,
  title,
  lead,
  children,
  aside,
  id = "page-title",
}: {
  label: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
  id?: string;
}) {
  return (
    <section className={cls("lx-pagehero tx-paper", aside ? "lx-pagehero--split" : undefined)} aria-labelledby={id}>
      <div className="lx-container lx-pagehero__grid">
        <div className="lx-pagehero__copy lx-enter">
          <p className="lx-label"><span>{label}</span></p>
          <h1 id={id} className="lx-heading lx-heading--page">{title}</h1>
          {lead && <p className="lx-pagehero__lead">{lead}</p>}
          {children && <div className="lx-pagehero__actions">{children}</div>}
        </div>
        {aside && <div className="lx-pagehero__aside lx-enter lx-enter--late">{aside}</div>}
      </div>
    </section>
  );
}

export interface DocEntry {
  id: string;
  title: string;
  content: ReactNode;
}

/**
 * Long-form document: a sticky contents rail whose marker slides to the section
 * being read, and numbered sections that reveal as they arrive.
 */
export function DocLayout({ entries, label = "On this page", numbered = false, after }: { entries: DocEntry[]; label?: string; numbered?: boolean; after?: ReactNode }) {
  const [active, setActive] = useState(entries[0]?.id);
  const rail = useRef<HTMLOListElement>(null);
  const [marker, setMarker] = useState<{ y: number; h: number } | null>(null);
  // Entries are usually rebuilt each render; observe by identity, not by array.
  const ids = entries.map((e) => e.id).join("|");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const order = ids.split("|");
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (records) => {
        for (const r of records) {
          if (r.isIntersecting) visible.add(r.target.id);
          else visible.delete(r.target.id);
        }
        const first = order.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { rootMargin: "-20% 0px -55% 0px" },
    );
    order.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [ids]);

  useEffect(() => {
    const link = rail.current?.querySelector<HTMLElement>(`[data-doc="${active}"]`);
    if (link) setMarker({ y: link.offsetTop, h: link.offsetHeight });
  }, [active]);

  return (
    <div className="lx-container lx-doc">
      <nav className="lx-doc__rail" aria-label={label}>
        <p className="lx-doc__rail-title">{label}</p>
        <ol ref={rail} className="lx-doc__toc">
          {entries.map((e, i) => (
            <li key={e.id}>
              <a href={`#${e.id}`} data-doc={e.id} className="lx-doc__toclink" aria-current={active === e.id ? "location" : undefined}>
                {numbered && <span className="lx-numeric">{String(i + 1).padStart(2, "0")}</span>}
                <span>{e.title}</span>
              </a>
            </li>
          ))}
        </ol>
        {/* data-runtime: measured after mount, so scripts/prerender.mjs keeps it out of
            the static HTML — markup the first client render lacks breaks hydration. */}
        {marker && <span aria-hidden="true" data-runtime="doc-marker" className="lx-doc__marker" style={{ transform: `translateY(${marker.y}px)`, height: marker.h }} />}
      </nav>
      <div className="lx-doc__body">
        {entries.map((e, i) => (
          <section key={e.id} id={e.id} className="lx-doc__section" aria-labelledby={`${e.id}-title`} data-reveal>
            {numbered && <span className="lx-doc__number lx-numeric" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>}
            <h2 id={`${e.id}-title`} className="lx-doc__title">{e.title}</h2>
            <div className="lx-prose">{e.content}</div>
          </section>
        ))}
        {after}
      </div>
    </div>
  );
}

export interface LinkIndexItem {
  to: string;
  title: string;
  body: ReactNode;
  meta?: ReactNode;
  external?: boolean;
}

/** Index of destinations: hairline rows, a title that underlines, an arrow that travels. */
export function LinkIndex({ items, columns = 3, reveal = true }: { items: LinkIndexItem[]; columns?: 2 | 3; reveal?: boolean }) {
  return (
    <ul className={cls("lx-linkindex", columns === 2 && "lx-linkindex--two")} data-reveal={reveal ? "stagger" : undefined}>
      {items.map((it) => {
        const external = it.external || !it.to.startsWith("/") || it.to.startsWith("/.");
        const inner = (
          <>
            {it.meta && <span className="lx-linkindex__meta">{it.meta}</span>}
            <span className="lx-linkindex__title">
              <span className="lx-linkindex__text">{it.title}</span>
              {external ? <IconArrowUpRight size={18} className="lx-linkindex__icon" /> : <IconArrowRight size={18} className="lx-linkindex__icon" />}
            </span>
            <span className="lx-linkindex__body">{it.body}</span>
          </>
        );
        return (
          <li key={it.to + it.title}>
            {external ? <a href={it.to} className="lx-linkindex__link">{inner}</a> : <Link to={it.to} className="lx-linkindex__link">{inner}</Link>}
          </li>
        );
      })}
    </ul>
  );
}

/** Definition rows for facts: term left, detail right. */
export function SpecList({ rows }: { rows: Array<[ReactNode, ReactNode]> }) {
  return (
    <dl className="lx-specs" data-reveal="stagger">
      {rows.map(([k, v], i) => (
        <div key={i} className="lx-specs__row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Callout({ tone = "note", title, children }: { tone?: "note" | "tip" | "warn"; title?: ReactNode; children: ReactNode }) {
  return (
    <aside className={cls("lx-callout", `lx-callout--${tone}`)}>
      {title && <p className="lx-callout__title">{title}</p>}
      <div className="lx-callout__body">{children}</div>
    </aside>
  );
}

/** Preformatted block with a copy control whose label morphs to confirm. */
export function CodeBlock({ code, label, tall = false }: { code: string; label: string; tall?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      /* clipboard unavailable: the text is still selectable */
    }
  };
  return (
    <div className="lx-code">
      <div className="lx-code__bar">
        <span className="lx-code__label">{label}</span>
        <button type="button" className="lx-code__copy" onClick={copy} data-copied={copied}>
          <span className="lx-code__copy-icon" aria-hidden="true"><IconCheck size={14} /></span>
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre tabIndex={0} role="region" aria-label={label} className={cls("lx-code__pre", tall && "lx-code__pre--tall")}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Closing call to action band at the foot of inner pages. */
export function EndCta({ title, body, children }: { title: ReactNode; body?: ReactNode; children: ReactNode }) {
  return (
    <Section tone="olive" rhythm="tight" className="lx-endcta">
      <Container className="lx-endcta__inner">
        <div>
          <h2 className="lx-heading lx-heading--section lx-endcta__title">{title}</h2>
          {body && <p className="lx-endcta__body">{body}</p>}
        </div>
        <div className="lx-endcta__actions">{children}</div>
      </Container>
    </Section>
  );
}
