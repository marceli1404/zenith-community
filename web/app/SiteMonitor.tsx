import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ResponseTrace, IncidentTrace, EmptyIllustration } from "../components/Observation";
import { ScanLine, ChevronRight } from "../components/lucide";
import { api } from "../lib/api";
import { relativeTime, scoreColor } from "../lib/format";
import { Chip, Notice, Panel, Stat, StatGrid } from "./ConsoleKit";
import { PanelFrame } from "../components/LoadingFrames";

interface Detail {
  monitor: { enabled: number; last_status_code: number | null; last_response_ms: number | null; last_ok: number | null; last_checked_at: number | null } | null;
  uptime: { d1: number | null; d7: number | null; d30: number | null };
  series: Array<{ checked_at: number; ok: number; response_ms: number | null }>;
  incidents: Array<{ id: string; started_at: number; resolved_at: number | null; reason: string | null }>;
  recentAudits: Array<{ id: string; status: string; queued_at: number; overall_score: number | null; homepage_unavailable?: number }>;
}

type Tab = "uptime" | "audits" | "incidents";
const TABS: Array<[Tab, string]> = [["uptime", "Uptime"], ["audits", "Audits"], ["incidents", "Incidents"]];

/** The Monitor tab for uptime, audit history and incidents. */
export default function SiteMonitor({ siteId }: { siteId: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<Tab>("uptime");

  const load = useCallback(async () => {
    try {
      setData(await api.get<Detail>(`/api/sites/${siteId}/detail`));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [siteId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return loadError ? (
      <Notice tone="bad" action={<button type="button" onClick={load}>Retry</button>}>Couldn't load monitoring data.</Notice>
    ) : (
      <PanelFrame label="Loading monitoring" />
    );
  }

  const checkedAt = data.monitor?.last_checked_at;
  const activeIncident = data.incidents.some((incident) => !incident.resolved_at);
  const monitorStatus = activeIncident ? "Active incident" : !data.monitor?.enabled ? "Monitoring off" : !checkedAt ? "Not checked yet" : data.monitor.last_ok === 1 ? "Operational" : data.monitor.last_ok === 0 ? "Check failed" : "Unknown";
  const tone = activeIncident || data.monitor?.last_ok === 0 ? "bad" : data.monitor?.last_ok === 1 ? "good" : "muted";
  const uptimeValue = (days: number, value: number | null) => (value !== null && checkedAt && checkedAt >= Date.now() - days * 86_400_000 ? `${value}%` : "No checks in this period");

  return (
    <div className="site-monitor">
      <StatGrid>
        <Stat label="Monitoring" value={monitorStatus} tone={tone === "muted" ? undefined : tone} hint={data.monitor?.last_response_ms != null ? `${data.monitor.last_response_ms} ms last response` : undefined} />
        <Stat label="Uptime, 24 hours" value={uptimeValue(1, data.uptime.d1)} />
        <Stat label="Uptime, 7 days" value={uptimeValue(7, data.uptime.d7)} />
        <Stat label="Uptime, 30 days" value={uptimeValue(30, data.uptime.d30)} />
      </StatGrid>

      <div className="site-tabs" role="tablist" aria-label="Monitor sections">
        {TABS.map(([t, label]) => (
          <button key={t} type="button" role="tab" id={`monitor-tab-${t}`} aria-selected={tab === t} aria-controls={`monitor-panel-${t}`} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>

      <div role="tabpanel" id={`monitor-panel-${tab}`} aria-labelledby={`monitor-tab-${tab}`} className="site-tabpanel">
        {tab === "uptime" && (
          <Panel title="Response time" description="Recent checks. Breaks in the line are failed checks.">
            {data.series.length === 0 ? (
              <div className="site-empty"><EmptyIllustration kind="audits" /><p>No monitoring checks have been recorded.</p></div>
            ) : (
              <ResponseTrace samples={data.series} />
            )}
          </Panel>
        )}

        {tab === "audits" && (
          <Panel flush title="Recent audits" description="Open an audit to review its findings and recommendations.">
            <div className="cn-table site-list">
              {data.recentAudits.length === 0 ? <p className="cn-empty-row">No audits yet. Run one to set this site's baseline.</p> : data.recentAudits.map((a) => (
                <Link key={a.id} to={`/app/audits/${a.id}`} className="cn-table__row">
                  <span className="cn-primary-cell"><span className="cn-monogram" aria-hidden="true"><ScanLine size={18} /></span><span><strong>{new Date(a.queued_at).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</strong><small>{relativeTime(a.queued_at)}</small></span></span>
                  <span>{a.homepage_unavailable === 1 ? <span className="cn-score cn-score--none" aria-label="Homepage could not be assessed, score 0">0 · Homepage could not be assessed</span> : a.overall_score != null ? <span className="cn-score" style={{ color: scoreColor(a.overall_score) }}>{a.overall_score}</span> : <span className="cn-score cn-score--none">{a.status === "completed" ? "Not assessed" : "No score"}</span>}</span>
                  <span><Chip tone={a.status === "completed" ? "good" : a.status === "failed" ? "bad" : "accent"}>{a.status.replace(/_/g, " ")}</Chip></span>
                  <ChevronRight size={18} className="cn-row-arrow" />
                </Link>
              ))}
            </div>
          </Panel>
        )}

        {tab === "incidents" && (
          <Panel flush title="Incidents" description="Downtime this site has had, with how long each lasted.">
            <div className="site-incidents">
              {data.incidents.length === 0 ? <p className="cn-empty-row">No incidents recorded.</p> : data.incidents.map((i) => (
                <div key={i.id} className="site-incident">
                  <div className="site-incident__head">
                    <div><strong>{i.reason ?? "Downtime"}</strong><small>{new Date(i.started_at).toLocaleString()}</small></div>
                    <Chip tone={i.resolved_at ? "good" : "bad"} dot>{i.resolved_at ? "Resolved" : "Ongoing"}</Chip>
                  </div>
                  <IncidentTrace startedAt={i.started_at} resolvedAt={i.resolved_at} reason={i.reason} />
                </div>
              ))}
            </div>
          </Panel>
        )}

      </div>
    </div>
  );
}
