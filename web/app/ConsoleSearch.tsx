import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowUpRight, X } from "../components/lucide";
import { api } from "../lib/api";

type Result = { to: string; label: string; kind: string; detail?: string };
export function ConsoleSearch({ open, onClose, routes }: { open: boolean; onClose: () => void; routes: { to: string; label: string }[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    dialog.current?.showModal(); input.current?.focus(); setQuery(""); setIndex(0); setLoading(true); setFailed(false); setRecords([]);
    let cancelled = false;
    Promise.allSettled([
      api.get<{ sites: { id: string; name: string; origin: string }[] }>("/api/sites"),
      api.get<{ audits: { id: string; site_name: string | null; origin: string | null; status: string; queued_at: number }[] }>("/api/audits"),
      api.get<{ incidents: { id: string; site_name: string; started_at: number; resolved_at: number | null }[] }>("/api/dashboard/incidents"),
    ]).then(([sites, audits, incidents]) => {
      if (cancelled) return;
      const next: Result[] = [];
      if (sites.status === "fulfilled") next.push(...sites.value.sites.map((s) => ({ to: `/app/sites/${s.id}`, label: s.name || s.origin, kind: "Site", detail: s.origin })));
      if (audits.status === "fulfilled") next.push(...audits.value.audits.map((a) => ({ to: `/app/audits/${a.id}`, label: a.site_name || a.origin || "Audit", kind: "Audit", detail: `${a.status} · ${new Date(a.queued_at).toLocaleDateString()}` })));
      if (incidents.status === "fulfilled") next.push(...incidents.value.incidents.map((i) => ({ to: `/app/incidents#${i.id}`, label: i.site_name, kind: "Incident", detail: `${i.resolved_at ? "Resolved" : "Active"} · ${new Date(i.started_at).toLocaleDateString()}` })));
      setRecords(next); setFailed([sites, audits, incidents].some((r) => r.status === "rejected")); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open]);
  const results: Result[] = [...routes.map((r): Result => ({ ...r, kind: "Page" })), ...records].filter((r) => `${r.label} ${r.kind} ${r.detail ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 20);
  const selected = Math.min(index, Math.max(results.length - 1, 0));
  const choose = (r: Result) => { onClose(); navigate(r.to); };
  return <dialog ref={dialog} className="console-command" aria-label="Search workspace" onCancel={onClose} onClose={onClose}>
    <div className="console-command-input"><Search size={20} /><input ref={input} value={query} role="combobox" aria-label="Search workspace" aria-expanded={open} aria-controls="workspace-results" aria-activedescendant={results.length ? `workspace-result-${selected}` : undefined} autoComplete="off" placeholder="Find a site, audit or page…" onChange={(e) => { setQuery(e.target.value); setIndex(0); }} onKeyDown={(e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setIndex((selected + 1) % Math.max(results.length, 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setIndex((selected + results.length - 1) % Math.max(results.length, 1)); }
      if (e.key === "Enter" && results[selected]) { e.preventDefault(); choose(results[selected]); }
    }} /><button type="button" className="console-icon-button" aria-label="Close search" onClick={onClose}><X size={18} /></button></div>
    <div className="console-command-results" role="listbox" id="workspace-results" aria-label="Search results">{results.map((r, i) => <div role="option" id={`workspace-result-${i}`} key={`${r.kind}-${r.to}`} aria-selected={i === selected} className={i === selected ? "is-selected" : ""} onMouseMove={() => setIndex(i)} onClick={() => choose(r)}><span><small>{r.kind}</small><strong>{r.label}</strong>{r.detail && <em>{r.detail}</em>}</span><ArrowUpRight size={16} /></div>)}</div>
    <div className="console-command-foot" role="status">{loading ? "Loading workspace results…" : failed ? "Some results couldn't load. Page navigation is available." : results.length ? "↑ ↓ to navigate · Enter to open · Esc to close" : "No matching sites, audits or pages."}</div>
  </dialog>;
}
