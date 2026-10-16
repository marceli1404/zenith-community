/** A calendar date in the product's UK style, e.g. "23 Sep 2026". */
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  const s = Math.round(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function scoreColor(score: number): string {
  if (score >= 90) return "var(--color-good)";
  if (score >= 70) return "var(--color-warn)";
  return "var(--color-bad)";
}

/** Human rating label for an Zenith Score, so a number always has context. */
export function scoreLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 70) return "Fair";
  if (score >= 40) return "Needs attention";
  return "Poor";
}

export function poundsFromMinor(minor: number): string {
  return `£${(minor / 100).toFixed(minor % 100 === 0 ? 0 : 2)}`;
}

export function severityColor(sev: string): string {
  switch (sev) {
    case "critical":
      return "var(--color-bad)";
    case "high":
      return "var(--color-bad)";
    case "medium":
      return "var(--color-warn)";
    case "low":
      return "var(--color-subtle)";
    default:
      return "var(--color-subtle)";
  }
}
