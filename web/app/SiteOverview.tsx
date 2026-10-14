import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Panel, Notice } from "./ConsoleKit";
import { PanelFrame } from "../components/LoadingFrames";
import { api } from "../lib/api";
import { relativeTime, scoreColor } from "../lib/format";

interface OverviewData {
  health: { score: number; auditId: string; at: number } | null;
  uptime30d: number | null;
  highPriorityFindings: number;
  recentAudits: Array<{ id: string; status: string; score: number | null; at: number }>;
}

/** A compact overview of the site's latest audit and monitoring data. */
export default function SiteOverview({ siteId }: { siteId: string }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get<OverviewData>(`/api/sites/${siteId}/overview`));
      setError(false);
    } catch {
      setError(true);
    }
  }, [siteId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return error ? (
      <Notice tone="bad" role="alert" action={<button type="button" onClick={load}>Retry</button>}>
        Couldn't load this site's overview.
      </Notice>
    ) : (
      <PanelFrame label="Loading overview" />
    );
  }

  const tiles = [
    { label: "Latest audit", value: data.health ? `${data.health.score}/100` : "Not audited yet", color: data.health ? scoreColor(data.health.score) : undefined },
    { label: "Uptime, 30 days", value: data.uptime30d != null ? `${data.uptime30d}%` : "No checks yet", color: undefined },
    { label: "High-priority findings", value: String(data.highPriorityFindings), color: undefined },
  ];

  return (
    <div className="site-overview">
      <div className="site-overview__tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className="site-overview__tile">
            <span className="site-overview__tile-label">{tile.label}</span>
            <strong className="site-overview__tile-value" style={tile.color ? { color: tile.color } : undefined}>{tile.value}</strong>
          </div>
        ))}
      </div>

      <Panel flush title="Recent audits" description="Recent audit runs and their scores.">
        {data.recentAudits.length === 0 ? (
          <p className="cn-empty-row">No audits yet. Run an audit to set this site's baseline.</p>
        ) : (
          <ul className="site-activity-list">
            {data.recentAudits.map((audit) => (
              <li key={audit.id}>
                <Link to={`/app/audits/${audit.id}`}>
                  {audit.status.replace(/_/g, " ")}{audit.score != null ? ` · ${audit.score}/100` : ""}
                </Link>
                <time>{relativeTime(audit.at)}</time>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
