import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "../components/lucide";
import { api } from "../lib/api";
import { EmptyState } from "../components/ui";
import { IncidentTrace } from "../components/Observation";
import { Chip, Notice, PageHeader, Panel } from "./ConsoleKit";
import { PanelFrame } from "../components/LoadingFrames";
import "./audit-surfaces.css";

interface Incident {
  id: string;
  site_id: string;
  site_name: string;
  started_at: number;
  resolved_at: number | null;
  reason: string | null;
  initial_status_code: number | null;
}

function duration(ms: number) {
  const min = Math.max(1, Math.round(ms / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

export default function Incidents() {
  const [rows, setRows] = useState<Incident[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    setError(false);
    api.get<{ incidents: Incident[] }>("/api/dashboard/incidents").then((d) => setRows(d.incidents)).catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="cn-page">
      <PageHeader
        title="Incidents"
        description="Interruptions and recoveries across your websites."
        actions={<Link to="/app/sites" className="cn-link">View monitored sites <ArrowUpRight size={15} /></Link>}
      />
      {error && <Notice tone="bad" role="alert" action={<button type="button" onClick={load}>Retry</button>}>Incidents couldn't be loaded.</Notice>}
      {!rows ? (!error && <PanelFrame label="Loading incidents" rows={3} />) : rows.length === 0 ? (
        <Panel><EmptyState title="No recorded incidents" description="Incidents appear when a monitor finds downtime. Check your sites to review monitoring coverage." /></Panel>
      ) : (
        [false, true].map((resolved) => {
          const incidents = rows.filter((i) => (i.resolved_at !== null) === resolved).sort((a, b) => (b.resolved_at ?? b.started_at) - (a.resolved_at ?? a.started_at));
          return (
            <Panel
              key={String(resolved)}
              id={resolved ? "resolved" : "active"}
              flush
              tone={!resolved && incidents.length ? "danger" : undefined}
              title={<>{resolved ? "Resolved" : "Active incidents"} <span className="cn-count">{incidents.length}</span></>}
              description={resolved ? "Recovered interruptions, with how long each lasted." : "Sites that are down right now."}
            >
              {incidents.length === 0 ? (
                <p className="cn-empty-row">{resolved ? "No resolved incidents in this history." : "Nothing is down right now."}</p>
              ) : (
                <div className="incident-list">
                  {incidents.map((i) => (
                    <article key={i.id} id={i.id} className="incident-item">
                      <div className="incident-item__head">
                        <div>
                          <Link to={`/app/sites/${i.site_id}`}>{i.site_name}</Link>
                          <p>
                            {i.reason ?? "Downtime"}{i.initial_status_code != null ? `, HTTP ${i.initial_status_code}` : ""}
                            <span>Started {new Date(i.started_at).toLocaleString()}</span>
                            {i.resolved_at != null && <span>Lasted {duration(i.resolved_at - i.started_at)}</span>}
                          </p>
                        </div>
                        <Chip tone={i.resolved_at ? "good" : "bad"} dot>{i.resolved_at ? "Resolved" : "Ongoing"}</Chip>
                      </div>
                      <IncidentTrace startedAt={i.started_at} resolvedAt={i.resolved_at} reason={i.reason} />
                    </article>
                  ))}
                </div>
              )}
            </Panel>
          );
        })
      )}
    </div>
  );
}
