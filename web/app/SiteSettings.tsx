import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, ShieldCheck, Trash2 } from "../components/lucide";
import { api, ApiError } from "../lib/api";
import { toast } from "../lib/toast";
import { Button, ConfirmDialog } from "../components/ui";
import { Chip, Panel } from "./ConsoleKit";
import type { SiteSummary } from "./SiteWorkspace";

/** Community site settings: public status page and site removal. */
export default function SiteSettings({ site, onChange }: { site: SiteSummary; onChange: () => void }) {
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  async function toggleStatusPage() {
    setSavingStatus(true);
    try {
      await api.post(`/api/sites/${site.id}/status-page`, { enabled: !site.statusPageEnabled });
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update the status page.");
    } finally {
      setSavingStatus(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await api.del(`/api/sites/${site.id}`);
      toast.success("Site deleted.");
      navigate("/app/sites");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the site.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return <div className="cn-page">
    <ConfirmDialog open={confirmDelete} title={`Delete ${site.name}?`} description={<>This permanently removes <strong>{site.origin}</strong>, its monitoring history, incidents, audits, and reports.</>} confirmLabel="Delete site" loading={deleting} onConfirm={remove} onClose={() => setConfirmDelete(false)} />
    <Panel title={<>Public status page {site.statusPageEnabled && <Chip tone="good" dot>Live</Chip>}</>} description="Share uptime and incident updates without exposing private audit findings." actions={<Button variant={site.statusPageEnabled ? "secondary" : "primary"} onClick={toggleStatusPage} disabled={savingStatus}>{savingStatus ? "Saving…" : site.statusPageEnabled ? "Turn off" : <><ShieldCheck size={17} /> Turn on</>}</Button>}>
      {site.statusPageEnabled && site.statusPageSlug && <a href={`/status/${site.statusPageSlug}`} target="_blank" rel="noreferrer" className="cn-link">Open public status page <ExternalLink size={14} /></a>}
    </Panel>
    <Panel tone="danger" title="Delete this site" description="Permanently remove the site and its saved monitoring and audit data." actions={<Button variant="secondary" onClick={() => setConfirmDelete(true)}><Trash2 size={17} /> Delete site</Button>} />
  </div>;
}
