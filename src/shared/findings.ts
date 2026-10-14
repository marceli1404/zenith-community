/**
 * The structured finding model. Every audit rule emits findings in this exact
 * shape so scoring, reporting, and recommendations can all consume them
 * deterministically.
 */

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const SEVERITY_ORDER: Readonly<Record<Severity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** Categories that feed the weighted overall score. Reliability is shown
 *  separately (from monitoring) and is not part of the audit weighting. */
export type ScoredCategory = "security" | "accessibility" | "seo" | "performance";
export type FindingCategory = ScoredCategory | "reliability";

export const SCORED_CATEGORIES: readonly ScoredCategory[] = [
  "security",
  "accessibility",
  "seo",
  "performance",
];

export interface Finding {
  /** Stable identifier for the rule, e.g. "seo.title-missing". */
  ruleId: string;
  category: FindingCategory;
  severity: Severity;
  title: string;
  /** What the rule checks and what it observed, in plain language. */
  description: string;
  /** The specific page this instance was found on (absolute URL). */
  pageUrl: string;
  /** Concrete observed evidence (header value, element selector, measurement…). */
  evidence: Record<string, unknown>;
  /** Actionable, non-overstated recommendation. */
  recommendation: string;
}

/**
 * A finding grouped across all pages where the same rule fired. This is what we
 * score and report on, so a single misconfiguration repeated on 200 pages counts
 * once (with the affected pages listed) rather than tanking the score 200×.
 */
export interface GroupedFinding {
  ruleId: string;
  category: FindingCategory;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  /** Distinct pages affected. */
  affectedUrls: string[];
  /** One representative evidence sample per affected page (bounded). */
  evidenceSamples: Array<{ pageUrl: string; evidence: Record<string, unknown> }>;
  occurrences: number;
}

const MAX_EVIDENCE_SAMPLES = 5;
const MAX_AFFECTED_URLS = 100;

/**
 * Group findings by ruleId, deduplicating repeats across pages. If the same rule
 * somehow reports different severities, the highest severity wins.
 */
export function groupFindings(findings: readonly Finding[]): GroupedFinding[] {
  const byRule = new Map<string, GroupedFinding>();

  for (const f of findings) {
    const existing = byRule.get(f.ruleId);
    if (!existing) {
      byRule.set(f.ruleId, {
        ruleId: f.ruleId,
        category: f.category,
        severity: f.severity,
        title: f.title,
        description: f.description,
        recommendation: f.recommendation,
        affectedUrls: [f.pageUrl],
        evidenceSamples: [{ pageUrl: f.pageUrl, evidence: f.evidence }],
        occurrences: 1,
      });
      continue;
    }
    existing.occurrences += 1;
    if (SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[existing.severity]) {
      existing.severity = f.severity;
    }
    if (
      !existing.affectedUrls.includes(f.pageUrl) &&
      existing.affectedUrls.length < MAX_AFFECTED_URLS
    ) {
      existing.affectedUrls.push(f.pageUrl);
    }
    if (existing.evidenceSamples.length < MAX_EVIDENCE_SAMPLES) {
      existing.evidenceSamples.push({ pageUrl: f.pageUrl, evidence: f.evidence });
    }
  }

  return [...byRule.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.category.localeCompare(b.category) ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

export function sortBySeverity<T extends { severity: Severity }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
