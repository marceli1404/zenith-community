// Added for Zenith Community; see Git history for the changes.
import { safeFetch, USER_AGENT, type SafeFetchErrorCode } from "./http";
import { isUnsafeCrawlPath } from "@shared/url";

export interface RobotsRule {
  allow: boolean;
  path: string;
}

export type RobotsPolicyBlock =
  | { kind: "unreachable"; status?: number; errorCode?: SafeFetchErrorCode };

export interface RobotsPolicy {
  rules: RobotsRule[];
  block: RobotsPolicyBlock | null;
  found: boolean;
}

/** Load and parse robots.txt for this crawler's product token. */
export async function loadRobots(origin: string, timeoutMs = 6_000): Promise<RobotsPolicy> {
  const res = await safeFetch(`${origin}/robots.txt`, {
    readBody: true,
    maxBytes: 512 * 1024,
    timeoutMs,
    // A robots endpoint may redirect. Check every destination before issuing
    // its GET too; the redirect can otherwise bypass the crawler's path guard.
    redirectPolicy: async (redirectUrl) => {
      const redirected = new URL(redirectUrl);
      const path = `${redirected.pathname || "/"}${redirected.search}`;
      return isUnsafeCrawlPath(path)
        ? { allowed: false, code: "unsafe_crawl_path", reason: "The robots.txt redirect points to a path excluded from scanning." }
        : { allowed: true };
    },
  });
  if (!res.ok) return { rules: [], block: { kind: "unreachable", errorCode: res.errorCode }, found: false };
  if (res.status >= 500 || (res.status >= 300 && res.status < 400)) {
    return { rules: [], block: { kind: "unreachable", status: res.status }, found: false };
  }
  // RFC 9309 allows crawling when robots.txt is unavailable (4xx).
  if (res.status >= 400) return { rules: [], block: null, found: false };
  if (res.status < 200 || res.status >= 300) {
    return { rules: [], block: { kind: "unreachable", status: res.status }, found: false };
  }

  const lines = (res.body ?? "").split(/\r?\n/);
  const crawlerName = USER_AGENT.split("/")[0]!.toLowerCase();
  const groups: Array<{ agents: string[]; rules: RobotsRule[] }> = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  let hasRuleDirective = false;
  const flush = () => {
    if (agents.length > 0) groups.push({ agents, rules });
    agents = [];
    rules = [];
    hasRuleDirective = false;
  };

  for (const raw of lines) {
    const line = raw.split("#")[0]!.trim();
    if (line === "") continue;
    const [field, ...rest] = line.split(":");
    const key = field?.toLowerCase().trim();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      // An empty Allow/Disallow still starts the group's rule section. Use that
      // boundary rather than rules.length so the next user-agent starts a new
      // group even when the preceding directive has no path value.
      if (hasRuleDirective) flush();
      if (value) agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && agents.length > 0) {
      hasRuleDirective = true;
      if (value) rules.push({ allow: key === "allow", path: value });
    }
  }
  flush();

  const specific = groups.filter((group) => group.agents.some((agent) => agent !== "*" && crawlerName.includes(agent)));
  const matching = specific.length > 0 ? specific : groups.filter((group) => group.agents.includes("*"));
  return { rules: matching.flatMap((group) => group.rules), block: null, found: true };
}

export function isDisallowed(rules: readonly RobotsRule[], path: string): boolean {
  const normalizedPath = normalizeRobotsPath(path);
  let best: RobotsRule | undefined;
  let bestSpecificity = -1;
  for (const rule of rules) {
    const normalizedRule = normalizeRobotsPath(rule.path);
    if (!robotsPathMatches(normalizedRule, normalizedPath)) continue;
    // Percent escapes represent one octet, not three characters, for the RFC's
    // longest-match specificity rule.
    const specificity = normalizedRule.replace(/\*/g, "").replace(/\$$/, "").replace(/%[0-9a-f]{2}/gi, "x").length;
    if (specificity > bestSpecificity || (specificity === bestSpecificity && rule.allow)) {
      best = rule;
      bestSpecificity = specificity;
    }
  }
  return best !== undefined && !best.allow;
}

function normalizeRobotsPath(value: string): string {
  const encodedUnicode = Array.from(value, (character) => {
    return character.codePointAt(0)! > 0x7f ? encodeURIComponent(character) : character;
  }).join("");
  return encodedUnicode.replace(/%([0-9a-f]{2})/gi, (_escape, hex: string) => {
    const character = String.fromCharCode(Number.parseInt(hex, 16));
    return /^[a-z0-9._~-]$/i.test(character) ? character : `%${hex.toUpperCase()}`;
  });
}

function robotsPathMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const source = anchored ? pattern.slice(0, -1) : pattern;
  const parts = source.split("*");
  let offset = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (i === 0) {
      if (!path.startsWith(part)) return false;
      offset = part.length;
    } else if (i === parts.length - 1 && anchored) {
      const start = path.length - part.length;
      return start >= offset && path.startsWith(part, start);
    } else {
      const next = path.indexOf(part, offset);
      if (next < 0) return false;
      offset = next + part.length;
    }
  }
  return !anchored || offset === path.length;
}
