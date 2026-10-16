/**
 * Transparent, deterministic scoring. Documented for users so scores never look
 * like a black box. Each scored category starts at 100 and loses points
 * per grouped finding (so repeated page rules are not counted twice). Reliability
 * findings also reduce the overall score, with repeated failures charged per
 * affected URL up to five URLs per rule. A homepage outage makes the audit
 * unassessable and receives zero.
 */

import {
  GroupedFinding,
  ScoredCategory,
  SCORED_CATEGORIES,
  Severity,
} from "./findings";

export const SEVERITY_DEDUCTION: Readonly<Record<Severity, number>> = {
  critical: 25,
  high: 15,
  medium: 7,
  low: 3,
  info: 0,
};

/** Equal weighting: Security / Accessibility / Performance / SEO each 25%. */
export const CATEGORY_WEIGHT: Readonly<Record<ScoredCategory, number>> = {
  security: 0.25,
  accessibility: 0.25,
  performance: 0.25,
  seo: 0.25,
};

export interface AuditScore {
  overall: number | null;
  categories: Record<ScoredCategory, number | null>;
  reliabilityDeduction: number | null;
}

export interface ComputedAuditScore extends Omit<AuditScore, "overall"> {
  overall: number;
}

export const CURRENT_SCORING_VERSION = 2;

export interface StoredScoreSnapshot {
  overall: number;
  overallAssessed?: boolean;
  homepageUnavailable?: boolean;
  security: number;
  accessibility: number;
  performance: number;
  seo: number;
  categoriesAssessed: boolean;
  reliabilityDeduction: number | null;
}

/** Restore the score saved with an audit instead of recalculating it. */
export function scoreFromSnapshot(snapshot: StoredScoreSnapshot): AuditScore {
  return {
    overall: snapshot.homepageUnavailable ? 0 : snapshot.overallAssessed === false ? null : snapshot.overall,
    categories: snapshot.categoriesAssessed && !snapshot.homepageUnavailable
      ? {
          security: snapshot.security,
          accessibility: snapshot.accessibility,
          performance: snapshot.performance,
          seo: snapshot.seo,
        }
      : { security: null, accessibility: null, performance: null, seo: null },
    // A homepage outage is a measured zero-score outcome, not an unknown
    // reliability impact. Normalize legacy snapshots that stored NULL here.
    reliabilityDeduction: snapshot.homepageUnavailable ? 0 : snapshot.reliabilityDeduction,
  };
}

/**
 * A saved zero can mean either a measured homepage outage or an audit that was
 * never allowed to assess pages. The homepage finding makes the former a real
 * score; other category-unassessed snapshots have no overall score.
 */
export function isOverallScoreAssessed(
  categoriesAssessed: boolean,
  findings: readonly Pick<GroupedFinding, "ruleId">[],
): boolean {
  return categoriesAssessed || findings.some((finding) => finding.ruleId === "reliability.homepage-unavailable");
}

/** SQL expression used by summary queries to keep unassessed sentinels out of score displays and averages. */
export function displayOverallScoreSql(alias: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid audit-result SQL alias.");
  return `CASE WHEN EXISTS (
    SELECT 1 FROM findings score_finding
    WHERE score_finding.audit_result_id = ${alias}.id
      AND score_finding.rule_id = 'reliability.homepage-unavailable'
  ) THEN 0 WHEN COALESCE(${alias}.categories_assessed, 0) <> 0 THEN ${alias}.overall_score ELSE NULL END`;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Score a single category from its grouped findings. */
export function scoreCategory(grouped: readonly GroupedFinding[]): number {
  let score = 100;
  for (const g of grouped) {
    score -= SEVERITY_DEDUCTION[g.severity];
  }
  return clamp(score);
}

/**
 * Compute category and overall scores from grouped findings. Reliability issues
 * reduce the blended score, with up to five URL-based deductions per rule. A
 * homepage failure makes all four categories unassessed.
 */
export function computeScores(
  grouped: readonly GroupedFinding[],
  options: { siteAvailable?: boolean } = {},
): ComputedAuditScore {
  const categories = {} as Record<ScoredCategory, number | null>;
  for (const cat of SCORED_CATEGORIES) {
    const forCat = grouped.filter((g) => g.category === cat);
    categories[cat] = scoreCategory(forCat);
  }

  if (options.siteAvailable === false || grouped.some((g) => g.ruleId === "reliability.homepage-unavailable")) {
    for (const cat of SCORED_CATEGORIES) categories[cat] = null;
    return { overall: 0, categories, reliabilityDeduction: 0 };
  }

  let overall = 0;
  for (const cat of SCORED_CATEGORIES) {
    overall += (categories[cat] ?? 0) * CATEGORY_WEIGHT[cat];
  }

  const reliabilityDeduction = Math.min(100, grouped
    .filter((g) => g.category === "reliability")
    .reduce((sum, g) => sum + SEVERITY_DEDUCTION[g.severity] * Math.min(Math.max(g.affectedUrls.length, 1), 5), 0));

  return { overall: clamp(overall - reliabilityDeduction), categories, reliabilityDeduction };
}

/**
 * Monitoring reliability score for a site: the uptime percentage over the
 * window, expressed 0–100. Kept separate from the audit score by design.
 */
export function reliabilityScore(okChecks: number, totalChecks: number): number | null {
  if (totalChecks <= 0) return null;
  return clamp((okChecks / totalChecks) * 100);
}

export type ScoreBand = "good" | "fair" | "poor";
export function scoreBand(score: number): ScoreBand {
  if (score >= 90) return "good";
  if (score >= 70) return "fair";
  return "poor";
}
