import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Copy, Check, AlertTriangle, Download, FileJson, FileText, ChevronDown } from "../components/lucide";
import { api } from "../lib/api";
import { LinkButton, ScoreRing, cx } from "../components/ui";
import { Chip, Notice, PageHeader, Panel } from "./ConsoleKit";
import { ConsolePageFrame } from "../components/LoadingFrames";
import { scoreColor, scoreLabel } from "../lib/format";
import { homepageFailureDiagnosticForFinding } from "../../src/shared/reliability";
import "./audit-surfaces.css";

interface GroupedFinding {
  ruleId: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  recommendation: string;
  affectedUrls: string[];
  occurrences: number;
  evidenceSamples?: Array<{ pageUrl: string; evidence: Record<string, unknown> }>;
  status?: "new" | "ongoing" | "regressed";
}
interface Comparison {
  previous: { overall: number; categories: Record<string, number> };
  deltas: { overall: number; security: number; accessibility: number; seo: number; performance: number };
  counts: { new: number; ongoing: number; resolved: number; regressed: number };
}
interface AuditResponse {
  job: { id: string; status: string; error_code: string | null; site_id?: string | null; target_origin?: string | null };
  result: { id: string; scores: { overall: number | null; categories: Record<string, number | null>; reliabilityDeduction: number | null }; pageCount: number; brokenLinkCount: number } | null;
  comparison?: Comparison | null;
  findings?: GroupedFinding[];
}

const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const CATEGORIES = ["security", "accessibility", "seo", "performance", "reliability"];

export default function AuditDetail() {
  const { id } = useParams();
  const [data, setData] = useState<AuditResponse | null>(null);
  const [sevFilter, setSevFilter] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    let finished = false;
    setData(null);
    setError(false);
    async function load() {
      if (cancelled || pending || finished || document.hidden) return;
      pending = true;
      try {
        const res = await api.get<AuditResponse>(`/api/audits/${id}`);
        if (cancelled) return;
        setData(res);
        setError(false);
        finished = res.job.status === "completed" || res.job.status === "failed";
        if (!finished) timer = setTimeout(load, 3000);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        pending = false;
      }
    }
    function resume() { if (!document.hidden) { clearTimeout(timer); void load(); } }
    void load();
    document.addEventListener("visibilitychange", resume);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [id, retry]);

  const errorNotice = error && <Notice tone="bad" role="alert" action={<button type="button" onClick={() => setRetry((v) => v + 1)}>Retry</button>}>Couldn't update this audit.{data ? " Showing the last received state." : ""}</Notice>;
  const back = { to: "/app/audits", label: "Audits" };
  if (!data) return error ? <div className="cn-page"><PageHeader back={back} title="Audit report" />{errorNotice}</div> : <ConsolePageFrame kind="report" />;

  if (data.job.status === "failed") {
    return (
      <div className="cn-page">
        <PageHeader back={back} title="Audit failed" description={data.job.error_code ? `The audit stopped: ${data.job.error_code.replace(/_/g, " ")}.` : "Something went wrong running this audit."} actions={<LinkButton to="/app/audits">Run it again</LinkButton>} />
      </div>
    );
  }

  if (!data.result) {
    return (
      <div className="cn-page">
        <PageHeader back={back} title={data.job.status === "completed" ? "Audit completed" : "Audit in progress"} description="Results appear here when scoring finishes. You can leave this page and return later." />
        {errorNotice}
        <Panel className="audit-progress" aria-live="polite">
          {!error && <div className="audit-sweep" aria-hidden="true" />}
          <strong key={data.job.status} className="audit-stage">{({ queued: "Waiting in the audit queue", crawling: "Reading website pages", browser_analysis: "Analysing pages in the browser", scoring: "Calculating scores" } as Record<string, string>)[data.job.status] ?? data.job.status.replace(/_/g, " ")}</strong>
        </Panel>
      </div>
    );
  }

  const findings = (data.findings ?? []).filter(
    (f) => (!sevFilter || f.severity === sevFilter) && (!catFilter || f.category === catFilter),
  ).sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));

  // Severity takes precedence over the score: a healthy-looking number must
  // never hide a serious finding (score + severity).
  const allFindings = data.findings ?? [];
  const criticalCount = allFindings.filter((f) => f.severity === "critical").length;
  const highCount = allFindings.filter((f) => f.severity === "high").length;
  const homepageUnavailable = allFindings.some((finding) => finding.ruleId === "reliability.homepage-unavailable");
  const overallScore = data.result.scores.overall;
  const overallLabel = overallScore === null ? "Not assessed" : homepageUnavailable ? "Homepage could not be assessed" : scoreLabel(overallScore);
  const present = (list: string[], key: "severity" | "category") => list.filter((o) => allFindings.some((f) => f[key] === o));

  return (
    <div className="cn-page">
      <PageHeader
        back={back}
        title="Audit report"
        description={`${data.result.pageCount} ${data.result.pageCount === 1 ? "page" : "pages"} scanned, ${data.result.brokenLinkCount} broken ${data.result.brokenLinkCount === 1 ? "link" : "links"}.`}
        actions={<ReportExport data={data} />}
      />
      {errorNotice}

      <Panel aria-label="Audit summary" className="audit-summary">
        <div className="audit-summary__score">
          <ScoreRing score={overallScore} size={132} />
          <div>
            <span className="audit-summary__label">Zenith score</span>
            <strong style={{ color: overallScore === null ? "var(--color-muted)" : scoreColor(overallScore) }}>
              {overallLabel}
              {overallScore !== null && data.comparison && <Delta value={data.comparison.deltas.overall} />}
            </strong>
            {overallScore === null ? (
              <p>No score was calculated because the audit could not complete all required page checks.</p>
            ) : homepageUnavailable ? (
              <p>Homepage could not be assessed; overall score set to 0. Category scores were not assessed.</p>
            ) : data.result.scores.reliabilityDeduction === null ? (
              <p>Reliability impact was not recorded for this saved audit.</p>
            ) : data.result.scores.reliabilityDeduction > 0 && (
              <p>Reliability findings deducted {data.result.scores.reliabilityDeduction} points from the overall score.</p>
            )}
            {data.comparison && (
              <p>{data.comparison.counts.new} new, {data.comparison.counts.ongoing} ongoing, {data.comparison.counts.resolved} resolved{data.comparison.counts.regressed > 0 ? `, ${data.comparison.counts.regressed} regressed` : ""} since the previous audit.</p>
            )}
            <Link to="/methodology" className="cn-link">How scoring works</Link>
          </div>
        </div>
        <dl className="audit-dimensions">
          {(["security", "accessibility", "performance", "seo"] as const).map((cat) => {
            const v = data.result!.scores.categories[cat];
            const d = data.comparison?.deltas[cat];
            return (
              <div key={cat} className="audit-dimension">
                <dt>{CATEGORY_LABEL[cat]}</dt>
                <dd>
                  <span style={{ color: v == null ? "var(--color-muted)" : scoreColor(v) }}>{v == null ? "Unassessed" : v}</span>
                  {d !== undefined && d !== 0 && <Delta value={d} small />}
                </dd>
                <span className="audit-dimension__track" aria-hidden="true"><i style={{ transform: `scaleX(${(v ?? 0) / 100})`, background: v == null ? undefined : scoreColor(v) }} /></span>
              </div>
            );
          })}
        </dl>
      </Panel>

      {(criticalCount > 0 || highCount > 0) && (
        <Notice tone={criticalCount > 0 ? "bad" : "warn"}>
          <span className="audit-attention"><AlertTriangle size={17} />
            <span><strong>{criticalCount > 0 ? "Action required." : "Attention needed."}</strong>{" "}
            The overall score is {overallLabel.toLowerCase()}, but{" "}
            {[criticalCount > 0 ? `${criticalCount} critical` : null, highCount > 0 ? `${highCount} high-severity` : null].filter(Boolean).join(" and ")}{" "}
            {criticalCount + highCount === 1 ? "issue needs" : "issues need"} attention.</span>
          </span>
        </Notice>
      )}

      <Panel id="findings" flush title={<>Findings <span className="cn-count">{findings.length} of {allFindings.length}</span></>} description="Highest severity first, with a recommendation for each finding.">
        <div className="audit-filters">
          <FilterGroup label="Severity" options={present(SEVERITIES, "severity")} value={sevFilter} onChange={setSevFilter} />
          <FilterGroup label="Category" options={present(CATEGORIES, "category")} value={catFilter} onChange={setCatFilter} />
        </div>
        <div className="audit-findings">
          {findings.length === 0 ? (
            <p className="cn-empty-row">{allFindings.length === 0 ? "No findings were returned for this audit." : "No findings match these filters."}</p>
          ) : findings.map((f) => <FindingCard key={f.ruleId} f={f} />)}
        </div>
      </Panel>
    </div>
  );
}

const CATEGORY_LABEL: Record<string, string> = { security: "Security", accessibility: "Accessibility", performance: "Performance", seo: "Search", reliability: "Reliability" };

/** Trigger a client-side file download (own browser; the app is not sandboxed). */
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportJson(data: AuditResponse): string {
  return JSON.stringify(
    {
      generatedBy: "Zenith",
      auditId: data.job.id,
      website: data.job.target_origin ?? null,
      generatedAt: new Date().toISOString(),
      scores: data.result?.scores ?? null,
      pageCount: data.result?.pageCount ?? null,
      brokenLinkCount: data.result?.brokenLinkCount ?? null,
      comparison: data.comparison ?? null,
      findings: (data.findings ?? []).map((f) => ({
        ruleId: f.ruleId, category: f.category, severity: f.severity, title: f.title,
        description: f.description, recommendation: f.recommendation,
        affectedUrls: f.affectedUrls, occurrences: f.occurrences, status: f.status ?? null,
        diagnosis: homepageFailureDiagnosticForFinding(f),
      })),
      disclaimer: "Passive checks only, not a penetration test or compliance certification.",
    },
    null,
    2,
  );
}

function reportMarkdown(data: AuditResponse): string {
  const s = data.result!.scores;
  const L: string[] = [];
  L.push("# Zenith audit report", "");
  if (data.job.target_origin) L.push(`- **Website:** ${data.job.target_origin}`);
  const homepageUnavailable = (data.findings ?? []).some((finding) => finding.ruleId === "reliability.homepage-unavailable");
  const overallLabel = s.overall === null ? "Not assessed" : homepageUnavailable ? "Homepage could not be assessed" : scoreLabel(s.overall);
  L.push(`- **Overall score:** ${s.overall === null ? overallLabel : `${s.overall} (${overallLabel})`}`);
  L.push(`- **Pages scanned:** ${data.result!.pageCount} · **Broken links:** ${data.result!.brokenLinkCount}`);
  L.push(`- **Generated:** ${new Date().toLocaleString()}`, "");
  L.push("## Category scores", "");
  for (const [k, v] of Object.entries(s.categories)) L.push(`- **${k}:** ${v ?? "Unassessed"}`);
  const findings = data.findings ?? [];
  L.push("", `## Findings (${findings.length})`);
  for (const f of findings) {
    const diagnosis = homepageFailureDiagnosticForFinding(f);
    L.push("", `### [${f.severity.toUpperCase()}] ${f.title}`);
    L.push(`- **Category:** ${f.category}${f.occurrences > 1 ? ` · ${f.occurrences} pages` : ""}`);
    if (f.affectedUrls?.length) L.push(`- **Affected URLs:** ${f.affectedUrls.slice(0, 10).join(", ")}`);
    if (diagnosis) L.push(`- **Observed:** ${diagnosis.summary} (${diagnosis.code})`);
    L.push("", f.description);
    if (f.recommendation) L.push("", `**Recommended fix:** ${f.recommendation}`);
  }
  if (findings.length === 0) L.push("", "_No findings were returned for this audit._");
  L.push("", "---", "Generated by Zenith. Passive checks only, not a penetration test or compliance certification.");
  return L.join("\n");
}

function ReportExport({ data }: { data: AuditResponse }) {
  const [copied, setCopied] = useState(false);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `zenith-audit-${stamp}`;

  async function copyMd() {
    try {
      await navigator.clipboard.writeText(reportMarkdown(data));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }

  const btn = "audit-export__button";
  return (
    <div className="audit-export" role="group" aria-label="Export report">
      <button type="button" onClick={copyMd} className={btn}>
        <span key={String(copied)} className="copy-swap">{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy Markdown</>}</span>
      </button>
      <button type="button" onClick={() => download(`${base}.md`, reportMarkdown(data), "text/markdown")} className={btn}>
        <FileText size={14} /> Markdown
      </button>
      <button type="button" onClick={() => download(`${base}.json`, reportJson(data), "application/json")} className={btn}>
        <FileJson size={14} /> JSON
      </button>
      <button type="button" onClick={() => window.print()} className={btn}>
        <Download size={14} /> Print / PDF
      </button>
    </div>
  );
}

/** Score change vs the previous audit. Higher is better, so positive = green. */
function Delta({ value, small }: { value: number; small?: boolean }) {
  const up = value > 0;
  const color = value === 0 ? "var(--color-subtle)" : up ? "var(--color-good)" : "var(--color-bad)";
  return (
    <span
      className={cx("audit-delta", small && "audit-delta--small")}
      style={{ color }}
      aria-label={`${value > 0 ? "up" : value < 0 ? "down" : "unchanged"} ${Math.abs(value)} since the previous audit`}
    >
      {value > 0 ? "+" : ""}{value}
    </span>
  );
}

function FilterGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="audit-filter" role="group" aria-label={`Filter by ${label.toLowerCase()}`}>
      <span className="audit-filter__label">{label}</span>
      <button type="button" aria-pressed={!value} aria-label={`All ${label.toLowerCase()} filters`} onClick={() => onChange(null)}>All</button>
      {options.map((o) => (
        <button type="button" key={o} aria-pressed={value === o} onClick={() => onChange(value === o ? null : o)}>{CATEGORY_LABEL[o] ?? o.charAt(0).toUpperCase() + o.slice(1)}</button>
      ))}
    </div>
  );
}

const SEVERITY_TONE: Record<string, "bad" | "warn" | "accent" | "muted"> = { critical: "bad", high: "bad", medium: "warn", low: "muted", info: "muted" };

export function FindingCard({ f }: { f: GroupedFinding }) {
  const [open, setOpen] = useState(false);
  const diagnosis = homepageFailureDiagnosticForFinding(f);

  return (
    <article className="finding-card">
      <div className="finding-card__main">
        <div className="finding-card__tags">
          <Chip tone={SEVERITY_TONE[f.severity] ?? "muted"} dot>{f.severity.charAt(0).toUpperCase() + f.severity.slice(1)}</Chip>
          {f.status === "new" && <Chip tone="accent">New</Chip>}
          {f.status === "regressed" && <Chip tone="bad">Regressed</Chip>}
          <span>{CATEGORY_LABEL[f.category] ?? f.category}</span>
          {f.occurrences > 1 && <span>{f.occurrences} pages</span>}
        </div>
        <h3>{f.title}</h3>
        <p>{f.description}</p>
        {diagnosis && <p><strong>Observed:</strong> {diagnosis.summary} (<code>{diagnosis.code}</code>)</p>}
        <p className="finding-card__fix"><strong>What to do: </strong>{f.recommendation}</p>
        {f.affectedUrls.length > 0 && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="finding-card__pages">
            <ChevronDown size={15} /> {open ? "Hide" : "Show"} affected pages ({f.affectedUrls.length})
          </button>
        )}
        {open && (
          <ul className="finding-detail">
            {f.affectedUrls.slice(0, 20).map((u) => <li key={u}>{u}</li>)}
          </ul>
        )}
      </div>
    </article>
  );
}
