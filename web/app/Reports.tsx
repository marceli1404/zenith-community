import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Download, ArrowUpRight, Check } from "../components/lucide";
import { api, ApiError } from "../lib/api";
import { toast } from "../lib/toast";
import { EmptyState, Spinner } from "../components/ui";
import { relativeTime, scoreColor } from "../lib/format";
import { Notice, PageHeader, Panel } from "./ConsoleKit";
import { PanelFrame } from "../components/LoadingFrames";
import "./audit-surfaces.css";

interface AuditRow {
  id: string;
  status: string;
  queued_at: number;
  completed_at: number | null;
  result_id: string | null;
  overall_score: number | null;
  site_name: string | null;
  origin: string | null;
}

export default function Reports() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    api.get<{ audits: AuditRow[] }>("/api/audits").then((d) => setRows(d.audits.filter((a) => a.status === "completed"))).catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="cn-page">
      <PageHeader
        title="Reports"
        description="Completed audits, ready to review and share."
        actions={<Link to="/app/audits" className="cn-link">Open audits <ArrowUpRight size={15} /></Link>}
      />
      {error && <Notice tone="bad" role="alert" action={<button type="button" onClick={load}>Retry</button>}>Reports couldn't be loaded.</Notice>}
      {!rows ? (!error && <PanelFrame label="Loading reports" />) : rows.length === 0 ? (
        <Panel><EmptyState kind="reports" title="Your first report starts with an audit" description="Completed audits appear here. You can download any report as a PDF." /></Panel>
      ) : (
        <Panel id="report-list" flush title={<>Completed audits <span className="cn-count">{rows.length}</span></>} description="Open a report to review its findings, or download it as a PDF to share.">
          <div className="cn-table report-table">
            {rows.map((a) => (
              <div key={a.id} className="cn-table__row">
                <Link to={`/app/audits/${a.id}`} className="cn-primary-cell report-link">
                  <span className="cn-monogram" aria-hidden="true"><FileText size={18} /></span>
                  <span><strong>{a.site_name || a.origin || "Audit"}</strong><small>Completed {relativeTime(a.completed_at ?? a.queued_at)}</small></span>
                </Link>
                <span>{a.overall_score != null && <span className="cn-score" style={{ color: scoreColor(a.overall_score) }}>{a.overall_score}</span>}</span>
                <span className="report-actions">{a.result_id && <PdfButton resultId={a.result_id} />}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function PdfButton({ resultId }: { resultId: string }) {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  async function generate() {
    setBusy(true);
    try {
      await api.post(`/api/reports/pdf/${resultId}/generate`);
      setReady(true);
      toast.success("Report ready.");
      // Open the freshly generated PDF (served with ownership checks).
      window.open(`/api/reports/pdf/${resultId}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not generate the PDF report.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={generate} disabled={busy} className={`report-pdf ${ready ? "report-complete" : ""}`} aria-label={ready ? "Download the PDF report again" : "Generate and download PDF report"}>
      {busy ? <><Spinner /> Preparing</> : ready ? <><Check size={16} /> Download again</> : <><Download size={16} /> Download PDF</>}
    </button>
  );
}
