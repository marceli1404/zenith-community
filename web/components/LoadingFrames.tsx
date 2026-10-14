import { useEffect, useState } from "react";

/**
 * In-between frames. Shown while a route's code or its data loads, so a page
 * never goes blank. They share the inline `zf-` styles in index.html with the
 * boot frame that paints before the app mounts, so the first frame, a route
 * change and the loaded page all line up.
 */

function Mark() {
  return (
    <svg className="zf-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M5 25.5a11 11 0 0 1 22 0" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx="16" cy="14.5" r="3.4" fill="currentColor" />
    </svg>
  );
}

const B = ({ w, k = "" }: { w?: string; k?: string }) => <span className={`zf-b ${k} ${w ? `w${w}` : ""}`} />;

function Status({ label }: { label: string }) {
  return <p className="zf-sr" role="status">{label}</p>;
}

export function PublicFrame() {
  return (
    <div className="zf zf-public" style={{ display: "flex" }}>
      <Status label="Loading page" />
      <div className="zf-nav" aria-hidden="true"><Mark /><B w="20" /><span className="grow" /><B k="pill" /></div>
      <div className="zf-hero" aria-hidden="true">
        <B k="h1" w="60" /><B k="h1" w="40" /><B w="50" /><B w="40" />
        <div className="zf-panel"><B w="30" /><B w="75" /><B w="60" /></div>
      </div>
    </div>
  );
}

export function AuthFrame() {
  return (
    <div className="zf zf-auth" style={{ display: "flex" }}>
      <Status label="Loading" />
      <div className="zf-card" aria-hidden="true"><Mark /><B k="h2" w="60" /><B w="75" /><B k="field" /><B k="field" /><B k="field" /></div>
    </div>
  );
}

export type ConsoleFrameKind = "overview" | "list" | "detail" | "report" | "settings";

/** The console route a path belongs to, for picking a matching frame. */
export function consoleFrameFor(pathname: string): ConsoleFrameKind {
  const p = pathname.replace(/\/+$/, "");
  if (p === "/app" || p === "") return "overview";
  if (/^\/app\/(sites)\/[^/]+$/.test(p)) return "detail";
  if (/^\/app\/audits\/[^/]+$/.test(p)) return "report";
  if (p.startsWith("/app/settings")) return "settings";
  return "list";
}

const Rows = ({ n = 5 }: { n?: number }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      <div className="zf-row" key={i}><B k="dot" /><B w={i % 2 ? "40" : "50"} /></div>
    ))}
  </>
);

/** Page-shaped placeholder for the console's main column. */
export function ConsolePageFrame({ kind }: { kind: ConsoleFrameKind }) {
  const head = (
    <div className="zf-head">
      {kind === "detail" || kind === "report" ? <B w="20" /> : null}
      <B k="h2" w="30" />
      <B w="40" />
    </div>
  );
  let body;
  switch (kind) {
    case "overview":
      body = (
        <>
          <div className="zf-grid"><div className="zf-panel tall"><B w="30" /><B w="75" /><B w="60" /></div><div className="zf-panel tall"><B w="40" /><Rows n={3} /></div></div>
          <div className="zf-panel tall"><B w="20" /><Rows /></div>
        </>
      );
      break;
    case "detail":
      body = (
        <>
          <div className="zf-grid three"><div className="zf-panel short"><B w="40" /><B k="h2" w="60" /></div><div className="zf-panel short"><B w="40" /><B k="h2" w="50" /></div><div className="zf-panel short"><B w="40" /><B k="h2" w="50" /></div></div>
          <div className="zf-panel tall"><B w="30" /><B w="50" /></div>
        </>
      );
      break;
    case "report":
      body = (
        <>
          <div className="zf-panel"><B k="dot" /><B w="40" /><B w="75" /></div>
          <div className="zf-panel tall"><B w="20" /><Rows n={4} /></div>
        </>
      );
      break;
    case "settings":
      body = (
        <div className="zf-settings"><div className="zf-panel"><B w="75" /><B w="60" /><B w="75" /><B w="50" /></div><div className="zf-panel tall"><B k="h2" w="30" /><B w="50" /><Rows n={3} /></div></div>
      );
      break;
    default:
      body = <div className="zf-panel tall"><B w="30" /><B w="50" /><Rows /></div>;
  }
  return (
    <div className="zf-page">
      <Status label="Loading page" />
      <div aria-hidden="true" className="zf-page">{head}{body}</div>
    </div>
  );
}

/** Whole-console frame: sidebar, top bar and a page-shaped main column. */
export function AppFrame({ pathname }: { pathname: string }) {
  return (
    <div className="zf zf-app" style={{ display: "flex" }}>
      <div className="zf-side" aria-hidden="true"><Mark /><B w="60" /><B w="50" /><B w="60" /><B w="40" /><B w="50" /><span className="zf-b foot" /></div>
      <div className="zf-work"><div className="zf-top" aria-hidden="true" /><div className="zf-main"><ConsolePageFrame kind={consoleFrameFor(pathname)} /></div></div>
    </div>
  );
}

/**
 * A thin accent bar across the top while a navigation waits for code. Driven by
 * `zenith:route-loading` events from lib/prefetch.ts; it only appears if the
 * wait is longer than a blink, so instant navigations show nothing.
 */
export function RouteProgress() {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  useEffect(() => {
    let show = 0;
    let hide = 0;
    let pending = 0;
    const onEvent = (e: Event) => {
      const loading = (e as CustomEvent<boolean>).detail;
      if (loading) {
        pending += 1;
        window.clearTimeout(hide);
        if (pending === 1) show = window.setTimeout(() => setState("loading"), 120);
      } else {
        pending = Math.max(0, pending - 1);
        if (pending === 0) {
          window.clearTimeout(show);
          setState((s) => (s === "loading" ? "done" : "idle"));
          hide = window.setTimeout(() => setState("idle"), 340);
        }
      }
    };
    window.addEventListener("zenith:route-loading", onEvent);
    return () => {
      window.removeEventListener("zenith:route-loading", onEvent);
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);
  if (state === "idle") return null;
  return <div className={state === "done" ? "zf-progress done" : "zf-progress"} aria-hidden="true" />;
}

/** A single panel of placeholder rows, for a list whose data is still arriving. */
export function PanelFrame({ rows = 5, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div className="zf-panel tall">
      <p className="zf-sr" role="status">{label}</p>
      <div aria-hidden="true" style={{ display: "grid", gap: 14 }}>
        <B w="30" />
        <B w="50" />
        <Rows n={rows} />
      </div>
    </div>
  );
}
