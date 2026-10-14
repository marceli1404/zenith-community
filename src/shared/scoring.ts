/**
 * Transparent, deterministic scoring. Documented for users so scores never look
 * like a black box (§30). Each scored category starts at 100 and loses points
 * per GROUPED finding (so a repeated issue is penalized once). The overall score
 * is an equal-weighted blend of the four scored categories. Reliability is
 * computed from monitoring separately and is not part of this blend.
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
  overall: number;
  categories: Record<ScoredCategory, number>;
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
 * Compute category and overall scores from grouped findings. Pass grouped
 * findings (post-dedup) so repeated issues are not double-counted. A failed
 * homepage request is an explicit zero for the overall score; observed category
 * scores remain available to explain what could still be checked.
 */
export function computeScores(
  grouped: readonly GroupedFinding[],
  options: { siteAvailable?: boolean } = {},
): AuditScore {
  const categories = {} as Record<ScoredCategory, number>;
  for (const cat of SCORED_CATEGORIES) {
    const forCat = grouped.filter((g) => g.category === cat);
    categories[cat] = scoreCategory(forCat);
  }

  if (options.siteAvailable === false || grouped.some((g) => g.ruleId === "reliability.homepage-unavailable")) {
    return { overall: 0, categories };
  }

  let overall = 0;
  for (const cat of SCORED_CATEGORIES) {
    overall += categories[cat] * CATEGORY_WEIGHT[cat];
  }

  return { overall: clamp(overall), categories };
}

/**
 * Monitoring reliability score for a site: the uptime percentage over the
 * window, expressed 0–100. Kept separate from the audit score by design.
 */
export function reliabilityScore(okChecks: number, totalChecks: number): number {
  if (totalChecks <= 0) return 100;
  return clamp((okChecks / totalChecks) * 100);
}

export type ScoreBand = "good" | "fair" | "poor";
export function scoreBand(score: number): ScoreBand {
  if (score >= 90) return "good";
  if (score >= 70) return "fair";
  return "poor";
}
