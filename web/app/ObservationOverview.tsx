import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, ArrowUpRight, Check, ChevronRight, Globe, Plus, RefreshCw, Search, ShieldAlert, ShieldCheck, ScanLine } from "../components/lucide";
import { useDashboardData, type DashboardState } from "../lib/useDashboardData";
import { relativeTime, scoreColor } from "../lib/format";
import { Button, LinkButton, Skeleton } from "../components/ui";
import { Chip, Notice, PageHeader, Panel, Segmented } from "./ConsoleKit";
import { ZenithMark } from "../components/PublicChrome";
import { MotionIcon } from "../components/MotionIcon";
import { HealthOrbit, type CategoryScores } from "./HealthOrbit";
import { siteStatus } from "@shared/site-status";

interface Site { id: string; name: string; origin: string; status: string; latestScore: number | null; homepageUnavailable?: boolean; lastOk: number | null; lastCheckedAt: number | null; uptime24h: number | null; openIncident: boolean; latestCategoryScores?: CategoryScores | null; latestAuditAt?: number | null; latestAuditId?: string | null; previousScore?: number | null; monitorEnabled?: boolean; nextCheckAt?: number | null; monitoringPaused?: boolean }
interface Audit { id: string; status: string; queued_at: number; completed_at?: number | null; overall_score: number | null; homepage_unavailable?: number; site_name: string | null; origin: string | null }
interface Incident { id: string; started_at: number; resolved_at: number | null; reason: string | null; site_name: string; site_id: string }
interface Attention { findings: { siteId: string; siteName: string; auditId: string; ruleId: string; title: string; severity: "critical" | "high"; occurrences: number; observedAt: number }[]; coverage: { totalSites: number; auditedSites: number }; totalFindings: number; truncated: boolean }
const ACTIVE = new Set(["queued", "crawling", "browser_analysis", "scoring"]);
const mean = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
function siteState(s: Site) {
  return siteStatus({
    status: s.status,
    openIncident: s.openIncident,
    monitorEnabled: s.monitorEnabled !== false && !s.monitoringPaused,
    monitorPaused: s.monitoringPaused,
    lastCheckedAt: s.lastCheckedAt,
    lastOk: s.lastOk,
    nextCheckAt: s.nextCheckAt,
  });
}
function Retry({ state, label }: { state: DashboardState<unknown>; label: string }) {
  return state.error ? <Notice action={<button type="button" onClick={state.refresh} disabled={state.refreshing}>Retry</button>}>{label} couldn't update.{state.data ? " Showing the last loaded data." : ""}</Notice> : null;
}

export default function ObservationOverview() {
  const sites = useDashboardData<{ sites: Site[] }>("/api/sites");
  const audits = useDashboardData<{ audits: Audit[] }>("/api/audits", { shouldPoll: (d) => d.audits.some((a) => ACTIVE.has(a.status)) });
  const incidents = useDashboardData<{ incidents: Incident[] }>("/api/dashboard/incidents");
  const attention = useDashboardData<Attention>("/api/dashboard/attention");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("attention");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState("");
  const [, tick] = useState(0);
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => { const clock = setInterval(() => { if (!document.hidden) tick((n) => n + 1); }, 30_000); const update = () => setOffline(!navigator.onLine); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { clearInterval(clock); window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  const auditSignature = audits.data?.audits.map((a) => `${a.id}:${a.status}`).join("|");
  const lastSignature = useRef<string | undefined>(undefined);
  useEffect(() => { if (auditSignature !== undefined) { if (lastSignature.current !== undefined && lastSignature.current !== auditSignature) { sites.refresh(); attention.refresh(); } lastSignature.current = auditSignature; } }, [auditSignature, sites, attention]);
  const allSites = sites.data?.sites ?? [];
  const auditedSites = allSites.filter((s) => s.latestAuditId != null);
  const assessedSites = allSites.filter((s) => s.latestScore !== null);
  const unavailableSites = allSites.filter((s) => s.homepageUnavailable).length;
  const score = mean(assessedSites.map((s) => s.latestScore!));
  const categorySites = assessedSites.filter((s) => s.latestCategoryScores && Object.values(s.latestCategoryScores).every((value) => typeof value === "number"));
  const categories = categorySites.length === assessedSites.length && categorySites.length ? Object.fromEntries((["security", "accessibility", "performance", "seo"] as const).map((key) => [key, mean(categorySites.map((s) => s.latestCategoryScores![key]))])) as CategoryScores : null;
  const openIncidents = incidents.data?.incidents.filter((i) => i.resolved_at === null) ?? [];
  const running = audits.data?.audits.find((a) => ACTIVE.has(a.status));
  const unverified = allSites.find((s) => s.status !== "verified");
  const monitored = allSites.filter((s) => s.status === "verified" && s.monitorEnabled !== false && !s.monitoringPaused);
  const pausedCount = allSites.filter((site) => site.monitoringPaused).length;
  const monitoringNote = pausedCount
    ? ` Monitoring is paused for ${pausedCount === 1 ? "one site" : `${pausedCount} sites`} because the current site limit has been reached.`
    : monitored.length > 0 ? "" : " Monitoring is not switched on yet.";
  const empty = sites.data !== null && allSites.length === 0;
  const primary = openIncidents.length && openIncidents[0] ? { label: "View incident", to: `/app/incidents#${openIncidents[0].id}` } : running ? { label: "View progress", to: `/app/audits/${running.id}` } : unverified && monitored.length === 0 ? { label: "Verify site", to: "/app/sites" } : { label: auditedSites.length ? "Run audit" : "Run first audit", to: "/app/audits" };
  const refreshing = [sites, audits, incidents, attention].some((s) => s.refreshing && s.data !== null);
  const refresh = () => { sites.refresh(); audits.refresh(); incidents.refresh(); attention.refresh(); };

  const items = [
    ...openIncidents.map((i) => ({ id: i.id, title: i.reason || "Website unavailable", meta: `${i.site_name} · Started ${relativeTime(i.started_at)}`, level: "Incident", kind: "bad", to: `/app/incidents#${i.id}` })),
    ...(attention.data?.findings ?? []).map((f) => ({ id: `${f.siteId}:${f.ruleId}`, title: f.title, meta: `${f.siteName} · ${f.occurrences} occurrence${f.occurrences === 1 ? "" : "s"}`, level: f.severity, kind: "bad", to: `/app/audits/${f.auditId}` })),
    ...allSites.filter((s) => s.lastOk === 0 && !s.openIncident).map((s) => ({ id: `check-${s.id}`, title: "Latest check failed", meta: `${s.name} · ${relativeTime(s.lastCheckedAt)}`, level: "Check", kind: "warn", to: `/app/sites/${s.id}` })),
    ...(audits.data?.audits.filter((a) => a.status === "failed").slice(0, 1) ?? []).map((a) => ({ id: a.id, title: "Audit couldn't complete", meta: `${a.site_name || a.origin || "Audit"} · ${relativeTime(a.queued_at)}`, level: "Audit", kind: "warn", to: `/app/audits/${a.id}` })),
  ];
  const needsSetup = !items.length && unverified;
  const needsAttention = (s: Site) => {
    const state = siteState(s);
    return state.kind === "bad" || state.kind === "warn" || state.text === "Monitoring disabled";
  };
  const visibleSites = allSites.filter((s) => `${s.name} ${s.origin}`.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || needsAttention(s))).sort((a, b) => sort === "score" ? (a.latestScore ?? 101) - (b.latestScore ?? 101) : sort === "name" ? a.name.localeCompare(b.name) : Number(needsAttention(b)) - Number(needsAttention(a)) || a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(visibleSites.length / 10));
  const currentPage = Math.min(page, pages - 1);
  const historySite = allSites.find((s) => s.id === selected) ?? allSites[0];
  const activity = [
    ...(audits.data?.audits ?? []).map((a) => ({ id: `audit-${a.id}`, at: a.completed_at || a.queued_at, label: a.homepage_unavailable === 1 ? "Homepage could not be assessed" : a.status === "completed" ? "Audit completed" : a.status === "failed" ? "Audit failed" : ACTIVE.has(a.status) ? "Audit in progress" : a.status, site: a.site_name || a.origin || "Audit", value: a.overall_score, to: `/app/audits/${a.id}`, kind: "audit" })),
    ...(incidents.data?.incidents ?? []).flatMap((i) => [{ id: `incident-${i.id}`, at: i.started_at, label: "Incident opened", site: i.site_name, value: null, to: `/app/incidents#${i.id}`, kind: "incident" }, ...(i.resolved_at ? [{ id: `recovery-${i.id}`, at: i.resolved_at, label: "Monitoring recovered", site: i.site_name, value: null, to: `/app/incidents#${i.id}`, kind: "recovery" }] : [])]),
  ].sort((a, b) => b.at - a.at).slice(0, 6);

  return <div className="cn-page observation-overview">
    <PageHeader
      title="Overview"
      description={sites.data ? `${allSites.length} ${allSites.length === 1 ? "site" : "sites"}, ${monitored.length} monitored` : "Your website health workspace"}
      actions={<>
        <span className="sr-only" role="status">{refreshing ? "Updating overview" : ""}</span>
        <button type="button" className="console-icon-button" onClick={refresh} aria-label="Refresh overview" title="Refresh" disabled={refreshing}><MotionIcon icon={RefreshCw} motion="refresh" size={17} active={refreshing} /></button>
        {!empty && sites.data && <LinkButton to={primary.to}>{primary.label}<MotionIcon icon={ArrowUpRight} motion="arrow" size={16} /></LinkButton>}
      </>}
    />
    {offline && <Notice>Connection lost. Showing the last loaded data.</Notice>}
    <Retry state={sites} label="Sites" />
    {empty ? (
      <Panel className="console-first-site" aria-label="Get started">
        <div className="first-site-art" aria-hidden="true"><ZenithMark size={96} /></div>
        <div>
          <h2>A clearer picture of your website starts here.</h2>
          <p>Add a site to bring its performance, accessibility, security and search health into view. Verify ownership to enable uptime monitoring.</p>
          <LinkButton to="/app/sites" size="lg"><Plus size={18} /> Add your first site</LinkButton>
          <ul className="first-site-steps">
            <li><Globe aria-hidden="true" /> Add the address of a site you run</li>
            <li><ShieldCheck aria-hidden="true" /> Verify ownership with a meta tag, file or DNS record</li>
            <li><ScanLine aria-hidden="true" /> Run an audit to set its health baseline</li>
          </ul>
        </div>
      </Panel>
    ) : <>
      <div className="cn-grid-2 cn-grid-2--wide-left">
        <Panel id="health" title="Current health" description="Latest audit results across every site.">
          {sites.data ? <HealthOrbit score={score} categories={categories} audited={auditedSites.length} scored={assessedSites.length} total={allSites.length} unavailable={unavailableSites} /> : sites.unloaded ? <p className="cn-muted">Health is unavailable until sites load.</p> : <Skeleton className="h-52" />}
        </Panel>
        <Panel id="attention" title="Needs attention" description="Incidents and serious findings, most urgent first.">
          <Retry state={incidents} label="Incidents" />
          <Retry state={attention} label="Findings" />
          {items.length > 0 ? <>
            <div className="attention-summary"><strong>{items.length}{attention.data?.truncated ? "+" : ""}</strong><span>{items.length === 1 ? "item to look at" : "items to look at"}</span></div>
            <ul className="console-attention-list">
              {items.slice(0, 4).map((item) => (
                <li key={item.id}>
                  <Link to={item.to}>
                    <span className={`attention-icon signal-${item.kind}`} aria-hidden="true"><AlertTriangle size={17} /></span>
                    <span><strong>{item.title}</strong><em><b className={`signal-${item.kind}`}>{item.level}</b>, {item.meta}</em></span>
                    <ChevronRight size={18} />
                  </Link>
                </li>
              ))}
            </ul>
            <Link className="cn-link" to={openIncidents.length ? "/app/incidents" : "/app/audits"}>Review {openIncidents.length ? "incidents" : "audits"} <ArrowRight size={15} /></Link>
          </> : needsSetup ? (
            <div className="attention-setup"><ShieldAlert /><h3>Connect the first signal</h3><p>Verify {unverified.name} to switch on monitoring. No uptime has been observed yet.</p><Link className="cn-link" to="/app/sites">Verify ownership <ArrowRight size={15} /></Link></div>
          ) : !incidents.data || !attention.data ? (
            <p className="cn-muted">{incidents.unloaded || attention.unloaded ? "Some observations are unavailable. Review the loaded sites below." : "Checking the latest observations."}</p>
          ) : (
            <div className="attention-clear"><Check /><h3>{pausedCount ? `Monitoring paused for ${pausedCount === 1 ? "one site" : `${pausedCount} sites`}` : "Nothing needs attention"}</h3><p>{auditedSites.length ? "No active incidents, and no critical or high findings in the latest audits." : "No active incidents. Run an audit to see what could improve."}{monitoringNote}</p></div>
          )}
        </Panel>
      </div>

      {running && (
        <Link to={`/app/audits/${running.id}`} className="console-running">
          <span className="measurement-sweep" aria-hidden="true" />
          <span className="console-running__icon"><MotionIcon icon={ScanLine} motion="scan" size={19} active /></span>
          <span><strong>Auditing {running.site_name || running.origin || "your website"}</strong><small>{({ queued: "Waiting in the audit queue", crawling: "Reading website pages", browser_analysis: "Analysing pages in the browser", scoring: "Calculating scores" })[running.status as "queued"]}</small></span>
          <span>View progress <MotionIcon icon={ArrowRight} motion="arrow" size={15} /></span>
        </Link>
      )}

      <Panel id="sites-heading" flush title={<>Your sites <span className="cn-count">{allSites.length}</span></>} description="Audit health and monitoring, side by side." actions={<Link className="cn-link" to="/app/sites">Manage sites <MotionIcon icon={ArrowUpRight} motion="arrow" size={15} /></Link>}>
        <div className="cn-toolbar">
          <label className="cn-search"><Search size={16} /><input aria-label="Search your sites" placeholder="Find a site" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} /></label>
          <Segmented label="Filter sites" value={filter} onChange={(v) => { setFilter(v); setPage(0); }} options={[{ value: "all", label: "All sites" }, { value: "attention", label: "Needs attention" }]} />
          <select className="cn-select cn-toolbar__end" aria-label="Sort sites" value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}><option value="attention">Attention first</option><option value="score">Lowest score</option><option value="name">Name</option></select>
        </div>
        <div className="cn-table cn-table--sites">
          <div className="cn-table__head" aria-hidden="true"><span>Website</span><span>Audit score</span><span>Monitoring</span><span>Uptime, 24h</span><span className="cn-col-checked">Last check</span><span /></div>
          {visibleSites.slice(currentPage * 10, (currentPage + 1) * 10).map((s) => {
            const status = siteState(s);
            return (
              <Link key={s.id} to={`/app/sites/${s.id}`} className="cn-table__row">
                <span className="cn-primary-cell">
                  <span className="cn-monogram" aria-hidden="true">{s.name.charAt(0).toUpperCase()}</span>
                  <span>
                    <strong>{s.name}</strong>
                    <small>{s.latestAuditAt ? `Audited ${relativeTime(s.latestAuditAt)}` : s.origin.replace(/^https?:\/\//, "")}</small>
                    {s.monitoringPaused && <small className="cn-muted site-item__badges"><Chip tone="warn">Monitoring paused</Chip></small>}
                  </span>
                </span>
                <span>{s.homepageUnavailable ? <span className="cn-score cn-score--none" aria-label="Homepage could not be assessed, score 0">0 · Homepage could not be assessed</span> : s.latestScore !== null ? <span className="cn-score" style={{ color: scoreColor(s.latestScore) }}>{s.latestScore}{s.previousScore != null && s.latestScore !== s.previousScore && <small className={s.latestScore > s.previousScore ? "signal-good" : "signal-bad"}>{s.latestScore > s.previousScore ? "+" : ""}{s.latestScore - s.previousScore}</small>}</span> : <span className="cn-score cn-score--none">{s.latestAuditId ? "Not assessed" : "Not audited"}</span>}</span>
                <span className={`ov-site-status signal-${status.kind}`}><i aria-hidden="true" />{status.text}</span>
                <span className="cn-value"><span className="cn-cell-label">24h uptime </span>{s.lastCheckedAt && s.uptime24h !== null ? `${s.uptime24h}%` : <span className="cn-muted">No checks</span>}</span>
                <span className="cn-value cn-muted cn-col-checked">{s.lastCheckedAt ? relativeTime(s.lastCheckedAt) : "Never"}</span>
                <ChevronRight size={18} className="cn-row-arrow" />
              </Link>
            );
          })}
          {!sites.data && !sites.unloaded && <div className="cn-empty-row"><Skeleton className="h-24" /></div>}
          {sites.data && !visibleSites.length && <p className="cn-empty-row">No sites match this view.</p>}
        </div>
        {pages > 1 && <div className="cn-table__foot"><span>Page {currentPage + 1} of {pages}</span><Button variant="secondary" size="sm" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>Next</Button></div>}
      </Panel>


      <div className="cn-grid-2 cn-grid-2--wide-left">
        <Panel id="history" title="Audit history" description="Score at each completed audit." actions={allSites.length > 0 && <select className="cn-select" aria-label="Site for audit history" value={historySite?.id ?? ""} onChange={(e) => setSelected(e.target.value)}>{allSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}>
          {historySite ? <History key={historySite.id} site={historySite} /> : <p className="cn-muted">History appears after your first audit.</p>}
        </Panel>
        <Panel id="activity" title="Recent activity" description="Audits and monitoring events as they happen.">
          <Retry state={audits} label="Audits" />
          <ul className="ov-activity">
            {activity.map((a) => (
              <li key={a.id}>
                <Link to={a.to}>
                  <span className={`activity-symbol ${a.kind === "recovery" ? "signal-good" : a.kind === "incident" ? "signal-bad" : "signal-accent"}`} aria-hidden="true">{a.kind === "audit" ? <ScanLine size={17} /> : a.kind === "recovery" ? <Check size={17} /> : <AlertTriangle size={17} />}</span>
                  <span><strong>{a.label}</strong><small>{a.site}</small></span>
                  <span className="activity-value">{a.value !== null && <b>{a.value}</b>}<time dateTime={new Date(a.at).toISOString()}>{relativeTime(a.at)}</time></span>
                </Link>
              </li>
            ))}
          </ul>
          {!activity.length && <p className="cn-muted">{audits.data && incidents.data ? "New audits and monitoring events will appear here." : "Activity hasn't loaded yet."}</p>}
        </Panel>
      </div>
    </>}
  </div>;
}

function History({ site }: { site: Site }) {
  const state = useDashboardData<{ recentAudits: { id: string; queued_at: number; overall_score: number | null; homepage_unavailable?: number; status: string }[] }>(`/api/sites/${site.id}/detail`);
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<string | null>(null);
  const completedAudits = (state.data?.recentAudits ?? []).filter((a) => a.status === "completed" && a.queued_at >= Date.now() - days * 86400_000);
  const points = completedAudits.filter((a) => a.overall_score !== null).sort((a, b) => a.queued_at - b.queued_at);
  const start = points[0]?.queued_at ?? 0;
  const end = points.at(-1)?.queued_at ?? start;
  const x = (time: number) => (points.length === 1 ? 300 : 40 + ((time - start) / Math.max(end - start, 1)) * 540);
  const y = (score: number) => 160 - score * 1.4;
  const focus = points.find((a) => a.id === selected) ?? points.at(-1);
  const prior = focus ? points[points.indexOf(focus) - 1] : null;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.queued_at)},${y(p.overall_score!)}`).join(" ");
  const change = focus && prior ? focus.overall_score! - prior.overall_score! : null;
  const baseline = points.length === 1 ? points[0]?.overall_score ?? null : null;
  return <>
    <div className="ov-history-controls">
      <Segmented label="History window" value={days} onChange={setDays} options={[7, 30, 90].map((n) => ({ value: n, label: `${n} days` }))} />
    </div>
    <Retry state={state} label="History" />
    {!state.data ? state.unloaded ? <p className="cn-muted">Audit history is unavailable.</p> : <Skeleton className="h-48" /> : !points.length ? (
      <div className="console-history-empty"><ScanLine size={24} /><p>{completedAudits.length ? "Completed audits in this window have no scores to chart. Open the site to review its audit reports and see which checks could not be completed." : "No completed audits in this window."}</p><Link className="cn-link" to={`/app/sites/${site.id}`}>Open site <ArrowRight size={15} /></Link></div>
    ) : <>
      <div className="console-chart-readout">
        <strong>{focus?.homepage_unavailable === 1 ? <>0<small>/ 100 · Homepage could not be assessed</small></> : <>{focus?.overall_score}<small>/ 100</small></>}</strong>
        <span>{focus && new Date(focus.queued_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{change !== null && <small className={change > 0 ? "signal-good" : change < 0 ? "signal-bad" : "cn-muted"}>{change > 0 ? "+" : ""}{change} from the previous audit</small>}</span>
      </div>
      <svg className="console-history-chart" viewBox="0 0 600 196" aria-label={`Audit scores for ${site.name}. A data table follows.`}>
        <defs><linearGradient id="history-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="hsl(var(--accent))" stopOpacity="0.22" /><stop offset="1" stopColor="hsl(var(--accent))" stopOpacity="0" /></linearGradient></defs>
        {[0, 50, 100].map((n) => <g key={n}><line x1="40" x2="580" y1={y(n)} y2={y(n)} /><text x="0" y={y(n) + 4}>{n}</text></g>)}
        {baseline !== null && <>
          {/* One audit is a baseline, not a trend: say so instead of drawing an empty chart. */}
          <line className="history-baseline" x1="40" x2="580" y1={y(baseline)} y2={y(baseline)} />
          <text className="history-note" x="310" y={baseline > 80 ? y(baseline) + 24 : y(baseline) - 14} textAnchor="middle">Baseline. The trend line starts after the next audit.</text>
        </>}
        {points.length > 1 && <path className="history-area" d={`${line} L${x(end)},${y(0)} L${x(start)},${y(0)} Z`} />}
        {points.length > 1 && <path key={`${site.id}-${days}-${points.map((p) => p.id).join()}`} className="history-line" pathLength="100" d={line} />}
        {points.map((p) => <circle key={p.id} className={`history-point${focus?.id === p.id ? " is-selected" : ""}`} cx={x(p.queued_at)} cy={y(p.overall_score!)} r={focus?.id === p.id ? 6 : 4} tabIndex={0} role="img" aria-label={`${new Date(p.queued_at).toLocaleString()}: ${p.homepage_unavailable === 1 ? "homepage could not be assessed, score 0" : `score ${p.overall_score}`}`} onFocus={() => setSelected(p.id)} onMouseEnter={() => setSelected(p.id)}><title>{new Date(p.queued_at).toLocaleString()}: {p.homepage_unavailable === 1 ? "Homepage could not be assessed · 0/100" : p.overall_score}</title></circle>)}
        <text x="40" y="192">{new Date(start).toLocaleDateString()}</text>
        <text x="580" y="192" textAnchor="end">{points.length > 1 ? new Date(end).toLocaleDateString() : "One audit"}</text>
      </svg>
      <details className="console-chart-data"><summary>View data <span>Latest {state.data.recentAudits.length} audits for this site</span></summary><table><caption className="sr-only">Audit scores for {site.name}</caption><thead><tr><th>Audit date</th><th>Score</th></tr></thead><tbody>{points.map((p) => <tr key={p.id}><td><Link to={`/app/audits/${p.id}`}>{new Date(p.queued_at).toLocaleString()}</Link></td><td>{p.homepage_unavailable === 1 ? "0 · Homepage could not be assessed" : p.overall_score}</td></tr>)}</tbody></table></details>
    </>}
  </>;
}
