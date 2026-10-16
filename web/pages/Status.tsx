import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { Logo } from "../components/PublicChrome";
import { Spinner } from "../components/ui";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { IncidentTrace, EmptyIllustration } from "../components/Observation";

interface StatusData {
  name: string;
  state: "operational" | "degraded" | "down" | "unknown";
  uptime24h: number | null;
  uptime30d: number | null;
  avgResponseMs: number | null;
  lastResponseMs: number | null;
  lastCheckedAt: number | null;
  openSince: number | null;
  incidents: Array<{ startedAt: number; resolvedAt: number | null; reason: string | null }>;
  updatedAt: number;
}

const STATE_META = {
  operational: { label: "All systems operational", color: "hsl(var(--good))" },
  degraded: { label: "Degraded performance", color: "hsl(var(--warn))" },
  down: { label: "Service disruption", color: "hsl(var(--bad))" },
  unknown: { label: "Monitoring status unavailable", color: "hsl(var(--muted))" },
};

export default function Status() {
  const { slug } = useParams();
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<StatusData>(`/api/status/${slug}`).then(setData).catch(() => setError("This status page is not available."));
  }, [slug]);

  if (error) {
    return (
      <div className="lx-site">
        <main id="main" className="lx-notfound">
          <div className="lx-enter">
            <h1 className="lx-heading lx-heading--section">{error}</h1>
            <p>Check the address, or ask the site owner for the current link.</p>
          </div>
        </main>
      </div>
    );
  }
  if (!data) {
    return <div className="lx-site lx-notfound"><Spinner className="w-6 h-6" /></div>;
  }

  const meta = STATE_META[data.state];
  return (
    <div className="lx-site">
      <header className="lx-status__bar">
        <div className="lx-container">
          <Logo />
          <span className="lx-status__updated">{data.lastCheckedAt ? `Last checked ${relativeTime(data.lastCheckedAt)}` : "No check recorded yet"}</span>
        </div>
      </header>
      <main id="main" className="lx-main">
        <section className="lx-pagehero tx-paper" aria-labelledby="status-title">
          <div className="lx-container lx-enter">
            <p className="lx-label"><span>Status</span></p>
            <h1 id="status-title" className="lx-heading lx-heading--page">{data.name}</h1>
            <p className="lx-status__state" style={{ "--state": meta.color } as CSSProperties} role="status">
              <span className="lx-status__dot" data-live={data.state === "operational"} aria-hidden="true" />
              {meta.label}
            </p>
          </div>
        </section>

        <div className="lx-container lx-status__body">
          <dl className="lx-status__stats lx-enter lx-enter--late">
            <div>
              <dt className="lx-status__label">24-hour uptime</dt>
              <dd className="lx-status__value lx-numeric">{data.uptime24h == null ? "No checks in this period" : `${data.uptime24h}%`}</dd>
            </div>
            <div>
              <dt className="lx-status__label">30-day uptime</dt>
              <dd className="lx-status__value lx-numeric">{data.uptime30d == null ? "No checks in this period" : `${data.uptime30d}%`}</dd>
            </div>
            <div>
              <dt className="lx-status__label">Average response</dt>
              <dd className="lx-status__value lx-numeric">{data.avgResponseMs != null ? `${data.avgResponseMs} ms` : "No response data"}</dd>
            </div>
          </dl>

          <h2 className="lx-heading lx-heading--title lx-status__heading">Recent incidents</h2>
          {data.incidents.length === 0 ? (
            <div className="lx-status__empty">
              <EmptyIllustration kind="incidents" />
              <p className="lx-caption">No incidents recorded.</p>
            </div>
          ) : (
            <ol className="lx-status__incidents">
              {data.incidents.map((i, idx) => (
                <li key={idx}>
                  <div className="lx-status__incident-head">
                    <span>{i.reason ?? "Downtime"}</span>
                    <span className={`lx-severity ${i.resolvedAt ? "lx-severity--low" : "lx-severity--high"}`}>{i.resolvedAt ? "Resolved" : "Ongoing"}</span>
                  </div>
                  <IncidentTrace startedAt={i.startedAt} resolvedAt={i.resolvedAt} reason={i.reason} />
                </li>
              ))}
            </ol>
          )}
        </div>
      </main>
    </div>
  );
}
