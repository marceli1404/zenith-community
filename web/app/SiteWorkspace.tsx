import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { ExternalLink, ScanLine } from "../components/lucide";
import { api, ApiError } from "../lib/api";
import { toast } from "../lib/toast";
import { Button, Spinner } from "../components/ui";
import { Chip, Notice, PageHeader } from "./ConsoleKit";
import { ConsolePageFrame } from "../components/LoadingFrames";
import SiteOverview from "./SiteOverview";
import SiteMonitor from "./SiteMonitor";
import SiteSettings from "./SiteSettings";
import "./site-surfaces.css";


export interface SiteSummary {
  id: string;
  name: string;
  url: string;
  origin: string;
  status: string;
  verificationToken: string;
  verificationMethod: string | null;
  statusPageSlug: string | null;
  statusPageEnabled: boolean;
  monitoringPaused?: boolean;
  monitoringPausedReason?: string | null;
}

const TABS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: ".", label: "Overview", end: true },
  { to: "monitor", label: "Monitor" },
  { to: "settings", label: "Settings" },
];

/**
 * The site workspace: one header (name, origin, verification, "Run audit")
 * and three URL-addressable tabs. `/app/sites/:id` alone is Overview, so every
 * existing deep link keeps working.
 */
export default function SiteWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const tabsRef = useRef<HTMLElement>(null);
  const [site, setSite] = useState<SiteSummary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [running, setRunning] = useState(false);

  // Keep the active tab in view when the strip scrolls off-screen on narrow
  // viewports (e.g. deep-linking straight into "Settings").
  useEffect(() => {
    const active = tabsRef.current?.querySelector<HTMLElement>("a.is-current");
    if (!active) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    active.scrollIntoView({ inline: "nearest", block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [location.pathname]);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ site: SiteSummary }>(`/api/sites/${id}`);
      setSite(res.site);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function runAudit() {
    setRunning(true);
    try {
      const res = await api.post<{ auditJobId: string }>("/api/audits", { siteId: id });
      toast.success("Audit started.");
      navigate(`/app/audits/${res.auditJobId}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not start the audit.");
    } finally {
      setRunning(false);
    }
  }

  if (!site) {
    return loadError ? (
      <div className="cn-page">
        <PageHeader back={{ to: "/app/sites", label: "Sites" }} title="Site couldn't be loaded" description="Try again to open this site's workspace." actions={<Button variant="secondary" onClick={load}>Retry</Button>} />
      </div>
    ) : (
      <ConsolePageFrame kind="detail" />
    );
  }

  const verified = site.status === "verified";

  return (
    <div className="cn-page site-console">
      <PageHeader
        back={{ to: "/app/sites", label: "Sites" }}
        title={site.name}
        meta={
          <>
            <Chip tone={verified ? "good" : "warn"} dot>
              {verified ? "Verified" : "Awaiting verification"}
            </Chip>
            <a href={site.origin} target="_blank" rel="noreferrer">
              {site.origin} <ExternalLink size={14} />
            </a>
          </>
        }
        actions={
          <Button onClick={runAudit} disabled={running}>
            {running ? <Spinner /> : <><ScanLine size={17} /> Run audit</>}
          </Button>
        }
      />

      {site.monitoringPaused && (
        <Notice tone="warn">
          Monitoring paused — {site.monitoringPausedReason ?? "the Community site limit has been reached"}.
        </Notice>
      )}

      <div className="site-workspace-tabs-wrap">
        <nav className="site-workspace-tabs" aria-label="Site sections" ref={tabsRef}>
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to === "." ? `/app/sites/${site.id}` : `/app/sites/${site.id}/${t.to}`}
              end={t.end}
              className={({ isActive }) => (isActive ? "is-current" : "")}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <Suspense fallback={<ConsolePageFrame kind="detail" />}>
        <Routes>
          <Route index element={<SiteOverview siteId={site.id} />} />
          <Route path="monitor" element={<SiteMonitor siteId={site.id} />} />
          <Route path="settings" element={<SiteSettings site={site} onChange={load} />} />
        </Routes>
      </Suspense>
    </div>
  );
}
