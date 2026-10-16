// Added for Zenith Community; see Git history for the changes.
import type { SafeFetchErrorCode } from "../lib/http";

export interface HomepageFailureDiagnostic {
  code: SafeFetchErrorCode;
  summary: string;
}

const HOMEPAGE_FAILURE_SUMMARIES: Readonly<Record<SafeFetchErrorCode, string>> = {
  blocked_target: "The homepage target was blocked by the public-address safety check.",
  blocked_redirect: "A homepage redirect was blocked by the public-address safety check.",
  redirect_policy: "A homepage redirect was blocked by robots.txt or crawler safety policy.",
  too_many_redirects: "The homepage exceeded the allowed redirect count.",
  timeout: "The request timed out before the homepage responded.",
  dns_or_network: "The hostname could not be resolved or the network connection failed.",
  tls: "The secure connection failed TLS or certificate validation.",
  aborted: "The request was interrupted before the homepage responded.",
};

/** Return only an allowlisted, user-safe diagnosis for a homepage fetch failure. */
export function homepageFailureDiagnostic(evidence: unknown): HomepageFailureDiagnostic | null {
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const record = evidence as Record<string, unknown>;
  if (record.kind !== "request_failed" || typeof record.errorCode !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(HOMEPAGE_FAILURE_SUMMARIES, record.errorCode)) return null;

  const code = record.errorCode as SafeFetchErrorCode;
  return { code, summary: HOMEPAGE_FAILURE_SUMMARIES[code] };
}

/** Select an allowlisted homepage failure diagnosis from grouped finding evidence. */
export function homepageFailureDiagnosticForFinding(
  finding: { ruleId: string; evidenceSamples?: readonly { evidence: unknown }[] },
): HomepageFailureDiagnostic | null {
  if (finding.ruleId !== "reliability.homepage-unavailable") return null;
  for (const sample of finding.evidenceSamples ?? []) {
    const diagnostic = homepageFailureDiagnostic(sample.evidence);
    if (diagnostic) return diagnostic;
  }
  return null;
}

/** Parse persisted JSON evidence without leaking malformed or non-object values. */
export function parseEvidenceJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
