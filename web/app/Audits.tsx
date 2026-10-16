import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, ScanLine, Search } from "../components/lucide";
import { api, ApiError } from "../lib/api";
import { Button, Input, EmptyState, Spinner } from "../components/ui";
import { relativeTime, scoreColor } from "../lib/format";
import { Chip, Notice, PageHeader, Panel } from "./ConsoleKit";
import { PanelFrame } from "../components/LoadingFrames";
import "./audit-surfaces.css";

interface AuditRow {
  id: string;
  status: string;
  source: string;
  queued_at: number;
  completed_at: number | null;
  overall_score: number | null;
  homepage_unavailable?: number;
  site_name: string | null;
  origin: string | null;
}

const ACTIVE = new Set(["queued", "crawling", "browser_analysis", "scoring"]);

export function auditStatus(status: string): { label: string; tone: "good" | "bad" | "accent" | "muted" } {
  if (status === "completed") return { label: "Completed", tone: "good" };
  if (status === "failed") return { label: "Failed", tone: "bad" };
  if (ACTIVE.has(status)) return { label: status === "queued" ? "Queued" : "In progress", tone: "accent" };
  return { label: status.replace(/_/g, " "), tone: "muted" };
}

export default function Audits() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const load = useCallback(() => {
    setLoadError(false);
    api.get<{ audits: AuditRow[] }>("/api/audits").then((d) => setRows(d.audits)).catch(() => setLoadError(true));
  }, []);
  useEffect(load, [load]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const res = await api.post<{ auditJobId: string }>("/api/audits", { url });
      navigate(`/app/audits/${res.auditJobId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start audit.");
      setRunning(false);
    }
  }

  const matches = (rows ?? []).filter((a) => `${a.site_name ?? ""} ${a.origin ?? ""}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="cn-page">
      <PageHeader title="Audits" description="Inspect a public website and review its automated findings." />

      <Panel id="run-audit" tone="accent" title="Run an audit" description="Check a public website and review its findings and recommendations.">
        <form onSubmit={run} className="cn-inline-form">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="example.com" aria-label="Website URL to audit" type="text" inputMode="url" autoCapitalize="none" spellCheck={false} />
          <Button type="submit" disabled={running}>{running ? <Spinner /> : <><ScanLine size={17} /> Run audit</>}</Button>
        </form>
        {error && <p role="alert" className="cn-form-error">{error}</p>}
      </Panel>

      {loadError && <Notice tone="bad" role="alert" action={<button type="button" onClick={load}>Retry</button>}>Audits couldn't be loaded.</Notice>}
      {!rows ? (!loadError && <PanelFrame label="Loading audits" />) : rows.length === 0 ? (
        <Panel><EmptyState title="Set your first baseline" description="Enter a public website address above to measure its health and find what to fix." /></Panel>
      ) : (
        <Panel id="audit-history" flush title={<>Audit history <span className="cn-count">{rows.length}</span></>} description="Scheduled and manual audits, newest first." actions={
          <label className="cn-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search audits by website" placeholder="Find a website" type="search" /></label>
        }>
          <div className="cn-table audit-table">
            <div className="cn-table__head" aria-hidden="true"><span>Website</span><span>Score</span><span>Status</span><span>Source</span><span /></div>
            {matches.map((a) => {
              const status = auditStatus(a.status);
              return (
                <Link key={a.id} to={`/app/audits/${a.id}`} className="cn-table__row">
                  <span className="cn-primary-cell"><span className="cn-monogram" aria-hidden="true"><ScanLine size={18} /></span><span><strong>{a.site_name || a.origin || "Ad-hoc audit"}</strong><small>{a.completed_at ? "Completed" : "Queued"} {relativeTime(a.completed_at ?? a.queued_at)}</small></span></span>
                  <span>{a.homepage_unavailable === 1 ? <span className="cn-score cn-score--none" aria-label="Homepage could not be assessed, score 0">0 · Homepage could not be assessed</span> : a.overall_score != null ? <span className="cn-score" style={{ color: scoreColor(a.overall_score) }}>{a.overall_score}</span> : <span className="cn-score cn-score--none">{a.completed_at ? "Not assessed" : "No score"}</span>}</span>
                  <span><Chip tone={status.tone} dot>{status.label}</Chip></span>
                  <span className="cn-muted audit-source">{a.source === "scheduled" ? "Scheduled" : "Manual"}</span>
                  <ChevronRight size={18} className="cn-row-arrow" />
                </Link>
              );
            })}
            {!matches.length && <p className="cn-empty-row">No audits match this website.</p>}
          </div>
        </Panel>
      )}
    </div>
  );
}
