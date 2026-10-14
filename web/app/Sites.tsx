import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Copy, Check, Search, ChevronRight, ShieldCheck } from "../components/lucide";
import { api, ApiError } from "../lib/api";
import { toast } from "../lib/toast";
import { relativeTime, scoreColor } from "../lib/format";
import { Button, Input, EmptyState, Spinner } from "../components/ui";
import { Chip, Notice, PageHeader, Panel, Segmented } from "./ConsoleKit";
import { PanelFrame } from "../components/LoadingFrames";
import { siteStatus } from "@shared/site-status";
import "./site-surfaces.css";

interface Site {
  id: string;
  name: string;
  url: string;
  origin: string;
  status: string;
  verificationToken: string;
  verifiedAt: number | null;
  latestScore: number | null;
  uptime24h: number | null;
  lastOk: number | null;
  lastCheckedAt: number | null;
  openIncident: boolean;
  monitorEnabled?: boolean;
  nextCheckAt?: number | null;
  monitoringPaused: boolean;
  monitoringPausedReason: string | null;
}

function monitoring(s: Site) {
  return siteStatus({
    status: s.status,
    openIncident: s.openIncident,
    // Disabled either by the owner (monitorEnabled) or by the scheduler for
    // being over the plan's site limit (monitoringPaused) — either reads as
    // "not currently being monitored".
    monitorEnabled: s.monitorEnabled !== false && !s.monitoringPaused,
    lastCheckedAt: s.lastCheckedAt,
    lastOk: s.lastOk,
    nextCheckAt: s.nextCheckAt,
  });
}

export default function Sites() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [sort, setSort] = useState("attention");
  const [page, setPage] = useState(0);

  async function load() {
    const { sites } = await api.get<{ sites: Site[] }>("/api/sites");
    setSites(sites);
    setLoadError(false);
  }
  useEffect(() => {
    load().catch(() => setLoadError(true));
    // Prefill from a URL the visitor scanned before signing up (§31).
    try {
      const remembered = sessionStorage.getItem("astra-scan-url");
      if (remembered) {
        setUrl(remembered);
        setShowAdd(true);
        sessionStorage.removeItem("astra-scan-url");
      }
    } catch {
      /* ignore */
    }
  }, []);

  async function addSite(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await api.post("/api/sites", { url });
      toast.success("Site added.");
      setUrl("");
      await load();
      setShowAdd(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add site.");
    } finally {
      setAdding(false);
    }
  }

  const needsAttention = (s: Site) => s.openIncident || s.lastOk === 0 || s.status !== "verified";
  const filtered = (sites ?? []).filter((s) => (!attentionOnly || needsAttention(s)) && (!query || `${s.origin} ${s.name}`.toLowerCase().includes(query.toLowerCase()))).sort((a, b) => {
    if (sort === "score") return (b.latestScore ?? -1) - (a.latestScore ?? -1) || a.name.localeCompare(b.name);
    if (sort === "recent") return (b.lastCheckedAt ?? 0) - (a.lastCheckedAt ?? 0);
    return (sort === "attention" ? Number(needsAttention(b)) - Number(needsAttention(a)) : 0) || a.name.localeCompare(b.name);
  });
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 12) - 1));
  const first = sites?.length === 0;

  return (
    <div className="cn-page site-console">
      <PageHeader
        title="Sites"
        description="Every website you watch, with its audit score and monitoring status."
        actions={sites && sites.length > 0 && <Button onClick={() => setShowAdd(!showAdd)} aria-expanded={showAdd} aria-controls="site-add-form"><Plus size={17} /> Add site</Button>}
      />

      {(showAdd || first) && (
        <Panel id="site-add-form" title={first ? "Add your first site" : "Add a website"} description="Enter the address of a public site you run. You'll verify ownership next.">
          <form onSubmit={addSite} className="cn-inline-form">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="yourwebsite.com" aria-label="Website URL" type="text" inputMode="url" autoCapitalize="none" spellCheck={false} />
            <Button type="submit" disabled={adding}>{adding ? <Spinner /> : <><Plus size={17} /> Add website</>}</Button>
          </form>
          {error && <p role="alert" className="cn-form-error">{error}</p>}
        </Panel>
      )}

      {loadError ? (
        <Notice tone="bad" role="alert" action={<button type="button" onClick={() => { void load().catch(() => setLoadError(true)); }}>Retry</button>}>Sites couldn't be loaded.</Notice>
      ) : !sites ? (
        <PanelFrame label="Loading sites" />
      ) : first ? (
        <Panel><EmptyState kind="sites" title="Ready for your first observation" description="Add a website, verify ownership, then set its health baseline with an audit." /></Panel>
      ) : (
        <Panel flush aria-label="Site health comparison">
          <div className="cn-toolbar cn-toolbar--top">
            <label className="cn-search"><Search size={16} /><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Search sites" aria-label="Search sites" /></label>
            <Segmented label="Filter sites" value={attentionOnly ? "attention" : "all"} onChange={(v) => { setAttentionOnly(v === "attention"); setPage(0); }} options={[{ value: "all", label: "All" }, { value: "attention", label: "Needs attention" }]} />
            <select className="cn-select cn-toolbar__end" aria-label="Sort sites" value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}><option value="attention">Attention first</option><option value="name">Name</option><option value="score">Highest score</option><option value="recent">Latest check</option></select>
          </div>
          <div className="cn-table cn-table--sites">
            <div className="cn-table__head" aria-hidden="true"><span>Website</span><span>Audit score</span><span>Monitoring</span><span>Uptime, 24h</span><span className="cn-col-checked">Last check</span><span /></div>
            {filtered.length === 0 && <p className="cn-empty-row">No sites match these filters.</p>}
            {filtered.slice(currentPage * 12, currentPage * 12 + 12).map((s) => {
              const status = monitoring(s);
              return (
                <article key={s.id} id={`site-${s.id}`} className="site-item">
                  <Link to={`/app/sites/${s.id}`} className="cn-table__row">
                    <span className="cn-primary-cell">
                      <span className="cn-monogram" aria-hidden="true">{s.name.charAt(0).toUpperCase()}</span>
                      <span>
                        <strong>{s.name}</strong>
                        <small>{s.origin.replace(/^https?:\/\//, "")}</small>
                        {s.monitoringPaused && <small className="cn-muted site-item__badges"><Chip tone="warn">Monitoring paused</Chip></small>}
                      </span>
                    </span>
                    <span>{s.latestScore != null ? <span className="cn-score" style={{ color: scoreColor(s.latestScore) }}>{s.latestScore}</span> : <span className="cn-score cn-score--none">Not audited</span>}</span>
                    <span className={`ov-site-status signal-${status.kind}`}><i aria-hidden="true" />{status.text}</span>
                    <span className="cn-value"><span className="cn-cell-label">24h uptime </span>{s.lastCheckedAt && s.uptime24h != null ? `${s.uptime24h}%` : <span className="cn-muted">No checks</span>}</span>
                    <span className="cn-value cn-muted cn-col-checked">{s.lastCheckedAt ? relativeTime(s.lastCheckedAt) : "Not checked"}</span>
                    <ChevronRight size={18} className="cn-row-arrow" />
                  </Link>
                  {s.status !== "verified" && (
                    <details className="site-verify">
                      <summary><ShieldCheck size={16} /> Verify ownership to start monitoring</summary>
                      <VerifyPanel site={s} verifying={verifyingId === s.id} onVerify={async (method) => {
                        setVerifyingId(s.id);
                        try {
                          await api.post(`/api/sites/${s.id}/verify`, { method });
                          toast.success("Site verified. Monitoring is now active.");
                          await load();
                        } catch (err) {
                          toast.error(err instanceof ApiError ? err.message : "We couldn't verify ownership yet.");
                        } finally {
                          setVerifyingId(null);
                        }
                      }} />
                    </details>
                  )}
                </article>
              );
            })}
          </div>
          {filtered.length > 12 && (
            <div className="cn-table__foot">
              <span role="status">{currentPage * 12 + 1} to {Math.min((currentPage + 1) * 12, filtered.length)} of {filtered.length} sites</span>
              <Button variant="secondary" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={(currentPage + 1) * 12 >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next</Button>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function VerifyPanel({ site, verifying, onVerify }: { site: Site; verifying: boolean; onVerify: (m: string) => void }) {
  const [method, setMethod] = useState<"dns_txt" | "well_known" | "meta_tag">("meta_tag");
  const [copied, setCopied] = useState(false);
  const host = site.origin.replace(/^https?:\/\//, "");

  const snippets: Record<string, string> = {
    meta_tag: `<meta name="zenith-verification" content="${site.verificationToken}">`,
    well_known: site.verificationToken,
    dns_txt: `_zenith-verify.${host}  TXT  "${site.verificationToken}"`,
  };
  const instructions: Record<string, string> = {
    meta_tag: "Add this meta tag inside the <head> of your homepage.",
    well_known: `Create a file at ${site.origin}/.well-known/zenith-verification.txt containing this token.`,
    dns_txt: "Add this TXT record in your DNS settings.",
  };

  async function copy() {
    await navigator.clipboard.writeText(snippets[method]!);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="site-verify__body">
      <Segmented label="Verification method" value={method} onChange={setMethod} options={[{ value: "meta_tag", label: "Meta tag" }, { value: "well_known", label: "File" }, { value: "dns_txt", label: "DNS record" }]} />
      <p>{instructions[method]}</p>
      <div className="site-verify__snippet">
        <code>{snippets[method]}</code>
        <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy"} className="console-icon-button">
          {copied ? <Check size={17} className="text-good" /> : <Copy size={17} />}
        </button>
      </div>
      <Button size="sm" disabled={verifying} onClick={() => onVerify(method)}>
        {verifying ? <Spinner /> : "Verify now"}
      </Button>
    </div>
  );
}
