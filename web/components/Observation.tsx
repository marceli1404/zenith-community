import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** One coordinate system for observation, incidents and empty states. */
export function ScopeGrid({ width = 640, height = 460 }: { width?: number; height?: number }) {
  const id = useId().replace(/:/g, "");
  return <g className="scope-grid">
    <defs><pattern id={id} width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="currentColor" strokeWidth=".65" /></pattern></defs>
    <rect width={width} height={height} fill={`url(#${id})`} />
    {[40, width - 40].map(x => [40, height - 40].map(y => <path key={`${x}-${y}`} d={`M${x - 5} ${y}h10M${x} ${y - 5}v10`} stroke="currentColor" />))}
  </g>;
}

export function OrbitRing({ cx = 320, cy = 230, r = 160, className = "" }: { cx?: number; cy?: number; r?: number; className?: string }) {
  return <circle className={`orbit-ring ${className}`} cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth=".8" />;
}

export function SignalNode({ x, y, tone = "accent", pulse = false }: { x: number; y: number; tone?: string; pulse?: boolean }) {
  return <g style={{ color: `var(--color-${tone})` }}><circle className={pulse ? "pulse-marker" : ""} cx={x} cy={y} r="10" fill="none" stroke="currentColor" opacity=".35" /><circle cx={x} cy={y} r="3" fill="currentColor" /></g>;
}

export function SignalPath({ d, tone = "good", className = "" }: { d: string; tone?: string; className?: string }) {
  return <path d={d} pathLength="1" fill="none" stroke={`var(--color-${tone})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`signal-path ${className}`} />;
}

export function ObservationField({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { node.classList.add("in-view"); observer.disconnect(); }
    }, { threshold: .15 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`observation-field ${className}`}>{children}</div>;
}

export type EmptyKind = "sites" | "incidents" | "reports" | "audits";
export function EmptyIllustration({ kind = "sites" }: { kind?: EmptyKind }) {
  return <svg className={`empty-illustration empty-${kind}`} viewBox="0 0 240 112" aria-hidden="true">
    <ScopeGrid width={240} height={112} />
    {kind === "incidents" ? <><SignalPath d="M12 58H70l8 -2 8 2h48l8 -2 8 2h78" /><SignalNode x={190} y={58} tone="good" /></> : kind === "reports" ? <g fill="none" stroke="currentColor"><path d="M82 12h58l18 18v72H82zM140 12v18h18" /><path d="M96 48h48M96 60h32M96 72h40M96 84h22" opacity=".35" /></g> : <>
      <OrbitRing cx={120} cy={56} r={42} /><OrbitRing cx={120} cy={56} r={28} />
      <path d="M108 56h24M120 44v24" stroke="currentColor" opacity=".6" />
      {kind === "audits" ? [0, 90, 180, 270].map(a => <circle key={a} cx={120 + 42 * Math.cos(a * Math.PI / 180)} cy={56 + 42 * Math.sin(a * Math.PI / 180)} r="4" fill="var(--color-bg)" stroke="currentColor" />) : <path d="M154 20l14 -10h40" stroke="currentColor" fill="none" strokeDasharray="3 4" />}
    </>}
  </svg>;
}

export function ScanScope() {
  return <div className="scan-scope" role="status" aria-live="polite">
    <svg viewBox="0 0 160 120" aria-hidden="true"><ScopeGrid width={160} height={120} /><OrbitRing cx={80} cy={60} r={44} /><OrbitRing cx={80} cy={60} r={28} /><g className="scan-sweep"><path d="M80 60V16A44 44 0 0 1 124 60Z" fill="var(--color-accent)" opacity=".12" /><path d="M80 60V16" stroke="var(--color-accent)" /></g><SignalNode x={80} y={60} /><path d="M32 60h16m64 0h16" stroke="currentColor" /></svg>
    <div><strong>Observing your website</strong><p>Waiting for the scan results.</p><span>Response · headers · document · site health</span></div>
  </div>;
}

/** Symbolic state, not an invented time series. */
export function StatusSignal({ state }: { state: "operational" | "degraded" | "down" | "recovered" }) {
  const d = state === "down" ? "M0 44H140l14 -12 14 24 14 -12h38M278 44h202" : state === "degraded" ? "M0 44h120l20 -6 20 12 20 -24 20 32 20 -14h260" : "M0 44h110l20 -2 20 2h330";
  return <svg className={`status-signal state-${state}`} viewBox="0 0 480 88" role="img" aria-label={`Current signal: ${state}. Symbolic status indicator.`}><ScopeGrid width={480} height={88} /><SignalPath key={state} d={d} tone={state === "down" ? "bad" : state === "degraded" ? "warn" : "good"} />{state === "down" && <SignalNode x={248} y={44} tone="bad" pulse />}</svg>;
}

export function IncidentTrace({ startedAt, resolvedAt, reason }: { startedAt: number; resolvedAt: number | null; reason?: string | null }) {
  return <div className="incident-trace"><StatusSignal state={resolvedAt ? "recovered" : "down"} /><ol><li><span className="text-bad">Incident opened</span><time>{new Date(startedAt).toLocaleString()}</time></li><li><span>{reason || "Downtime detected"}</span></li><li><span className={resolvedAt ? "text-good" : "text-bad"}>{resolvedAt ? "Recovered" : "Under observation"}</span>{resolvedAt && <time>{new Date(resolvedAt).toLocaleString()}</time>}</li></ol></div>;
}

export function LostOrbit() {
  return <svg className="lost-orbit" viewBox="0 0 640 280" role="img" aria-label="An observation orbit leaves the coordinate field."><ScopeGrid width={640} height={280} /><g className="lost-orbit-travel"><ellipse cx="330" cy="180" rx="250" ry="90" transform="rotate(-24 330 180)" fill="none" stroke="var(--color-accent)" /><SignalNode x={556} y={74} /></g><path d="M280 140h80M320 100v80" stroke="currentColor" opacity=".3" /><text x="36" y="30" className="svg-label">TARGET / NOT LOCATED</text><text x="36" y="255" className="svg-label">FIELD 04 · SIGNAL LOST</text></svg>;
}

export function ResponseTrace({ samples }: { samples: Array<{ checked_at: number; ok: number; response_ms: number | null }> }) {
  const [selected, setSelected] = useState<number | null>(null);
  const values = samples.map(s => s.response_ms).filter((n): n is number => n !== null);
  const max = Math.max(1, ...values);
  const top = Math.ceil(max / 100) * 100;
  const first = samples[0]?.checked_at ?? 0;
  const last = samples[samples.length - 1]?.checked_at ?? first;
  const W = 800, L = 48, R = 12, T = 12, B = 176;
  const x = (t: number) => L + ((t - first) / Math.max(1, last - first)) * (W - L - R);
  const y = (ms: number) => B - (ms / top) * (B - T);
  // Consecutive successful checks form segments; a failed check breaks the line.
  const segments: Array<Array<[number, number]>> = [];
  let run: Array<[number, number]> = [];
  for (const s of samples) {
    if (s.ok && s.response_ms !== null) run.push([x(s.checked_at), y(s.response_ms)]);
    else if (run.length) { segments.push(run); run = []; }
  }
  if (run.length) segments.push(run);
  const index = selected ?? samples.length - 1;
  const picked = samples[index];
  const avg = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  const failures = samples.filter(s => !s.ok).length;
  const move = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setSelected(Math.max(0, Math.min(samples.length - 1, index + (e.key === "ArrowLeft" ? -1 : 1))));
    }
  };
  const pickAt = (clientX: number, el: SVGSVGElement) => {
    const box = el.getBoundingClientRect();
    const vx = ((clientX - box.left) / box.width) * W;
    let best = 0;
    samples.forEach((s, i) => { if (Math.abs(x(s.checked_at) - vx) < Math.abs(x(samples[best]!.checked_at) - vx)) best = i; });
    setSelected(best);
  };
  return <div className="response-trace">
    <dl className="response-trace__summary">
      <div><dt>Latest</dt><dd>{picked ? picked.ok ? picked.response_ms === null ? "No timing" : `${picked.response_ms} ms` : "Failed" : "-"}</dd></div>
      <div><dt>Average</dt><dd>{avg === null ? "-" : `${avg} ms`}</dd></div>
      <div><dt>Failed checks</dt><dd className={failures ? "text-bad" : undefined}>{failures}</dd></div>
      <div><dt>Checks shown</dt><dd>{samples.length}</dd></div>
    </dl>
    <svg viewBox={`0 0 ${W} 200`} tabIndex={0} role="img" aria-label={`Response times for ${samples.length} recent checks, average ${avg ?? "unknown"} milliseconds, ${failures} failed. Use the left and right arrow keys to read each check.`} onKeyDown={move} onPointerMove={e => pickAt(e.clientX, e.currentTarget)} onPointerLeave={() => setSelected(null)}>
      <defs><linearGradient id="trace-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="hsl(var(--accent))" stopOpacity="0.2" /><stop offset="1" stopColor="hsl(var(--accent))" stopOpacity="0" /></linearGradient></defs>
      {[0, 0.5, 1].map(f => <g key={f} className="trace-grid"><line x1={L} x2={W - R} y1={y(top * f)} y2={y(top * f)} /><text x={L - 10} y={y(top * f) + 4} textAnchor="end">{Math.round(top * f)}</text></g>)}
      {segments.map((seg, i) => <g key={i}>
        {seg.length > 1 && <path className="trace-area" d={`M${seg[0]![0]} ${B} ${seg.map(([px, py]) => `L${px} ${py}`).join(" ")} L${seg[seg.length - 1]![0]} ${B} Z`} />}
        {seg.length > 1 ? <path className="trace-line" d={seg.map(([px, py], j) => `${j ? "L" : "M"}${px} ${py}`).join(" ")} /> : <circle className="trace-dot" cx={seg[0]![0]} cy={seg[0]![1]} r="3" />}
      </g>)}
      {samples.map((s, i) => !s.ok && <g key={i} className="trace-fail"><line x1={x(s.checked_at)} x2={x(s.checked_at)} y1={T} y2={B} /><circle cx={x(s.checked_at)} cy={B} r="4" /></g>)}
      {picked && <g className="trace-cursor"><line x1={x(picked.checked_at)} x2={x(picked.checked_at)} y1={T} y2={B} /><circle cx={x(picked.checked_at)} cy={picked.ok && picked.response_ms !== null ? y(picked.response_ms) : B} r="5" className={picked.ok ? undefined : "is-fail"} /></g>}
      <text className="trace-axis" x={L} y="198">{new Date(first).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</text>
      <text className="trace-axis" x={W - R} y="198" textAnchor="end">{new Date(last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</text>
    </svg>
    <p className="response-trace__readout" aria-live="polite">{picked && <>{new Date(picked.checked_at).toLocaleString()}: {picked.ok ? picked.response_ms === null ? "response timing unavailable" : `${picked.response_ms} ms` : "failed check, no response"}</>}</p>
  </div>;
}
