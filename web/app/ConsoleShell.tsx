import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { LayoutDashboard, Globe, FileText, Settings as SettingsIcon, Menu, X, LogOut, Search, ArrowUpRight } from "../components/lucide";
import { ZenithMark, ThemeToggle } from "../components/PublicChrome";
import { useAuth } from "../lib/auth";
import { ConsolePageFrame, consoleFrameFor } from "../components/LoadingFrames";
import { registerChunkLoader, warmRoute, type ChunkLoader } from "../lib/prefetch";
import { ConsoleSearch } from "./ConsoleSearch";
import { MotionIcon, type IconMotion } from "../components/MotionIcon";
import "./dashboard.css";

const pages = {
  overview: () => import("./Overview"),
  sites: () => import("./Sites"),
  siteWorkspace: () => import("./SiteWorkspace"),
  audits: () => import("./Audits"),
  audit: () => import("./AuditDetail"),
  incidents: () => import("./Incidents"),
  reports: () => import("./Reports"),
  settings: () => import("./Settings"),
};
const Overview = lazy(pages.overview);
const Sites = lazy(pages.sites);
const SiteWorkspace = lazy(pages.siteWorkspace);
const Audits = lazy(pages.audits);
const AuditDetail = lazy(pages.audit);
const Incidents = lazy(pages.incidents);
const Reports = lazy(pages.reports);
const Settings = lazy(pages.settings);

/** Console page code for lib/prefetch.ts, matched in the same order as <Routes>. */
const consoleChunkLoader: ChunkLoader = (pathname) => {
  const p = pathname.replace(/\/+$/, "");
  const table: Array<[RegExp, keyof typeof pages]> = [
    [/^\/app$/, "overview"], [/^\/app\/sites$/, "sites"], [/^\/app\/sites\/[^/]+(\/.*)?$/, "siteWorkspace"],
    [/^\/app\/audits$/, "audits"], [/^\/app\/audits\/[^/]+$/, "audit"], [/^\/app\/incidents$/, "incidents"],
    [/^\/app\/reports$/, "reports"], [/^\/app\/settings$/, "settings"],
  ];
  const hit = table.find(([re]) => re.test(p));
  return hit ? { key: `console-${hit[1]}`, load: pages[hit[1]] } : null;
};
registerChunkLoader(consoleChunkLoader);

/** Primary + account nav. Audits and Incidents keep working as deep links
 *  (reached from a site's Monitor tab) but no longer have their own nav item. */
export const CONSOLE_ROUTES = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, motion: "dashboard" as IconMotion, end: true },
  { to: "/app/sites", label: "Sites", icon: Globe, motion: "orbit" as IconMotion },
  { to: "/app/reports", label: "Reports", icon: FileText, motion: "document" as IconMotion },
  { to: "/app/settings", label: "Settings", icon: SettingsIcon, motion: "settings" as IconMotion },
];
const WORKSPACE_NAV_COUNT = 4;

function sectionFor(pathname: string) {
  if (pathname.startsWith("/app/audits")) return "Audits";
  if (pathname.startsWith("/app/incidents")) return "Incidents";
  return CONSOLE_ROUTES.find((r) => r.to !== "/app" && pathname.startsWith(r.to))?.label ?? "Dashboard";
}

function Identity() {
  return (
    <Link to="/app" className="console-identity" aria-label="Zenith overview">
      <ZenithMark size={28} />
      <span>Zenith</span>
    </Link>
  );
}

export default function ConsoleShell() {
  const { user, signOut } = useAuth();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const location = useLocation();
  const section = sectionFor(location.pathname);
  const initial = (user?.email?.[0] ?? "A").toUpperCase();
  const shortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘ K" : "Ctrl K";

  useEffect(() => { setMenu(false); }, [location.pathname]);
  // Warm every console page once the browser is idle, so moving between them
  // never waits on code. Pages are small; this runs once per session.
  useEffect(() => {
    const warmAll = () => ["/app", "/app/sites", "/app/sites/x", "/app/audits", "/app/audits/x", "/app/incidents", "/app/reports", "/app/settings"].forEach((p) => warmRoute(p));
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const id = idle ? idle(warmAll) : window.setTimeout(warmAll, 1500);
    return () => { if (!idle) window.clearTimeout(id); };
  }, []);
  useEffect(() => {
    if (menu) dialog.current?.showModal(); else dialog.current?.close();
  }, [menu]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearch((v) => !v); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const link = ({ to, label, icon, motion, end }: (typeof CONSOLE_ROUTES)[number]) => (
    <NavLink key={to} to={to} end={end} title={label} onClick={() => setMenu(false)} className={({ isActive }) => (isActive ? "is-current" : "")}>
      <MotionIcon icon={icon} motion={motion} />
      <span>{label}</span>
    </NavLink>
  );

  const navigation = (
    <>
      <nav aria-label="Main navigation" className="console-navigation">
        <p className="console-nav-label">Workspace</p>
        {CONSOLE_ROUTES.slice(0, WORKSPACE_NAV_COUNT).map(link)}
      </nav>
      <nav aria-label="Account navigation" className="console-navigation">
        <p className="console-nav-label">Account</p>
        {CONSOLE_ROUTES.slice(WORKSPACE_NAV_COUNT).map(link)}
      </nav>
      <div className="console-account">
        <div className="console-account-card">
          <span className="console-account-avatar" aria-hidden="true">{initial}</span>
          <span className="console-account-text">
            <strong title={user?.email}>{user?.email}</strong>
            <small>Community edition</small>
          </span>
          <button type="button" onClick={signOut} title="Sign out" aria-label="Sign out" className="console-signout">
            <MotionIcon icon={LogOut} motion="logout" size={17} />
          </button>
        </div>

      </div>
    </>
  );

  return (
    <div className="scope-app">
      <a className="console-skip" href="#console-main">Skip to content</a>
      <aside className="console-sidebar">
        <div className="console-brand"><Identity /></div>
        {navigation}
      </aside>
      <dialog
        ref={dialog}
        className="console-drawer"
        onCancel={() => setMenu(false)}
        onClose={() => setMenu(false)}
        onClick={(e) => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX > r.right) setMenu(false); } }}
      >
        <div className="console-brand">
          <Identity />
          <button type="button" className="console-icon-button" onClick={() => setMenu(false)} aria-label="Close menu"><MotionIcon icon={X} motion="alert" size={20} /></button>
        </div>
        {navigation}
      </dialog>
      <div className="console-workspace">
        <header className="console-topbar">
          <button type="button" className="console-icon-button console-menu-trigger" aria-label="Open menu" aria-expanded={menu} onClick={() => setMenu(true)}><MotionIcon icon={Menu} motion="dashboard" size={20} /></button>
          <div className="console-mobile-brand"><Identity /></div>
          <div className="console-breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><strong>{section}</strong></div>
          <div className="console-top-actions">
            <button type="button" className="console-search-trigger" onClick={() => setSearch(true)}>
              <MotionIcon icon={Search} motion="search" size={16} />
              <span>Search</span>
              <kbd>{shortcut}</kbd>
              <span className="sr-only">sites, audits and pages</span>
            </button>
            <ThemeToggle />
            <Link to="/app/settings" className="console-avatar" aria-label="Account settings" title={user?.email}>{initial}</Link>
          </div>
        </header>
        <main id="console-main" className="console-main" tabIndex={-1}>
          <Suspense fallback={<ConsolePageFrame kind={consoleFrameFor(location.pathname)} />}>
            <div key={location.pathname} className="console-route-view">
              <Routes>
                <Route index element={<Overview />} />
                <Route path="sites" element={<Sites />} />
                <Route path="sites/:id/*" element={<SiteWorkspace />} />
                <Route path="audits" element={<Audits />} />
                <Route path="audits/:id" element={<AuditDetail />} />
                <Route path="incidents" element={<Incidents />} />
                <Route path="reports" element={<Reports />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<div className="console-empty"><h1>Page not found</h1><p>This part of the console doesn't exist.</p><Link to="/app" className="cn-link">Return to Overview <MotionIcon icon={ArrowUpRight} motion="arrow" size={16} /></Link></div>} />
              </Routes>
            </div>
          </Suspense>
        </main>
        <footer className="console-footer">
          <span><ZenithMark size={14} /> Zenith</span>
          <span className="console-footer__links">
            <Link to="/methodology">How scoring works</Link>
            <Link to="/contact">Support</Link>
          </span>
        </footer>
      </div>
      <ConsoleSearch open={search} onClose={() => setSearch(false)} routes={CONSOLE_ROUTES} />
    </div>
  );
}
