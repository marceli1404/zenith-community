import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "../components/lucide";
import { ZenithMark } from "../components/PublicChrome";
import { scoreColor, scoreLabel } from "../lib/format";

export type CategoryScores = { security: number; accessibility: number; performance: number; seo: number };
const CATEGORIES = [["security", "Security"], ["accessibility", "Accessibility"], ["performance", "Performance"], ["seo", "Search"]] as const;

function useMeasuredNumber(value: number | null) {
  const [shown, setShown] = useState(value);
  const previous = useRef<number | null>(null);
  useEffect(() => {
    if (value === null) { setShown(null); previous.current = null; return; }
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const from = previous.current ?? 0;
    previous.current = value;
    let frame = 0;
    const settle = () => { cancelAnimationFrame(frame); setShown(value); };
    if (reduce.matches || document.hidden || from === value) { settle(); return; }
    const start = performance.now();
    const tick = (now: number) => { const t = Math.min(1, (now - start) / 900); setShown(Math.round(from + (value - from) * (1 - (1 - t) ** 3))); if (t < 1) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    const visibility = () => { if (document.hidden) settle(); };
    document.addEventListener("visibilitychange", visibility); reduce.addEventListener("change", settle);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", visibility); reduce.removeEventListener("change", settle); };
  }, [value]);
  return shown;
}

/** Panel body for "Current health": the category orbit, the readings, and a caption. */
export function HealthOrbit({ score, categories, audited, total }: { score: number | null; categories: CategoryScores | null; audited: number; total: number }) {
  const shown = useMeasuredNumber(score);
  const weakest = categories ? CATEGORIES.reduce((a, b) => (categories[a[0]] <= categories[b[0]] ? a : b))[0] : null;
  return (
    <>
      <div className="ov-health">
        <div className="console-orbit" role="img" aria-label={score === null ? "No audit score yet" : `Latest audit average ${score} out of 100, ${scoreLabel(score)}. ${audited} of ${total} sites audited.`}>
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <circle cx="100" cy="100" r="97" className="orbit-boundary" />
            {CATEGORIES.map(([key], i) => (
              <g key={key} transform="rotate(-90 100 100)">
                <circle cx="100" cy="100" r={86 - i * 11} className="orbit-track" />
                <circle cx="100" cy="100" r={86 - i * 11} pathLength="100" className="orbit-measure" style={{ "--orbit-value": categories?.[key] ?? 0, "--tone": categories ? scoreColor(categories[key]) : undefined, opacity: categories ? 1 : 0 } as CSSProperties} />
              </g>
            ))}
            <path d="M100 0v6M200 100h-6M100 200v-6M0 100h6" className="orbit-ticks" />
          </svg>
          <div className="console-orbit-value" aria-hidden="true">
            {score !== null ? <><strong>{shown ?? score}</strong><span>{scoreLabel(score)}</span></> : <><ZenithMark size={40} /><span>Not audited</span></>}
          </div>
        </div>
        <ul className="console-categories" aria-label="Category scores">
          {CATEGORIES.map(([key, label]) => (
            <li key={key} className={key === weakest ? "is-lowest" : undefined}>
              <span className="cat-line">
                <span className="cat-name">{label}{key === weakest && <small>Lowest</small>}</span>
                <span className="cat-value">{categories?.[key] ?? "No score"}</span>
              </span>
              <span className="category-track" aria-hidden="true"><i style={{ transform: `scaleX(${(categories?.[key] ?? 0) / 100})`, "--tone": categories ? scoreColor(categories[key]) : undefined } as CSSProperties} /></span>
            </li>
          ))}
        </ul>
      </div>
      <div className="console-health-caption">
        <span>{score === null ? "Your first audit sets the baseline." : `Average of the latest audits, ${audited} of ${total} sites audited`}</span>
        <Link to="/methodology" className="cn-link">How scoring works <ArrowUpRight size={14} /></Link>
      </div>
    </>
  );
}
