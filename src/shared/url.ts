/**
 * URL normalization helpers shared by scanning, crawling and site management.
 * Pure and isomorphic. Security decisions live in ssrf.ts; this module only
 * normalizes shapes so we compare and store URLs consistently.
 */

/**
 * Normalize an origin for equality/storage: lowercase scheme+host, drop default
 * ports, drop any path/query/fragment, drop a trailing dot. Returns null if the
 * input cannot be parsed as an http(s) URL.
 */
export function normalizeOrigin(input: string): string | null {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  const scheme = url.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") return null;
  let host = url.hostname.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.length === 0) return null;
  const isDefaultPort =
    url.port === "" ||
    (scheme === "https:" && url.port === "443") ||
    (scheme === "http:" && url.port === "80");
  const portPart = isDefaultPort ? "" : `:${url.port}`;
  return `${scheme}//${host}${portPart}`;
}

/**
 * Canonicalize a full URL for crawl de-duplication: normalize origin, resolve
 * against a base, strip the fragment, drop a trailing slash on non-root paths,
 * and remove common tracking query params. Returns null if unparseable.
 */
export function canonicalizeUrl(input: string, base?: string): string | null {
  let url: URL;
  try {
    url = base ? new URL(input, base) : new URL(input);
  } catch {
    return null;
  }
  const scheme = url.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") return null;

  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  const TRACKING = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
    "mc_cid",
    "mc_eid",
    "ref",
  ];
  for (const key of TRACKING) url.searchParams.delete(key);
  // Sort remaining params for stable comparison.
  url.searchParams.sort();

  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  url.pathname = path === "" ? "/" : path;

  return url.toString();
}

/** True when `candidate` shares the same normalized origin as `origin`. */
export function isSameOrigin(candidate: string, origin: string): boolean {
  const a = normalizeOrigin(candidate);
  const b = normalizeOrigin(origin);
  return a !== null && a === b;
}

/**
 * Routes that mutate state or log the crawler out. The crawler must skip these
 * even when discovered via links — it only ever performs safe GETs.
 */
const UNSAFE_PATH_PATTERNS = [
  /\blogout\b/i,
  /\bsign[-_]?out\b/i,
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bcart\b/i,
  /\bcheckout\b/i,
  /\badmin\b/i,
  /\bwp-admin\b/i,
  /\baccount\/delete/i,
];

export function isUnsafeCrawlPath(pathname: string): boolean {
  return UNSAFE_PATH_PATTERNS.some((re) => re.test(pathname));
}

/** Extract the registrable-ish label for display (best effort, not PSL-aware). */
export function displayHost(input: string): string {
  const origin = normalizeOrigin(input);
  if (!origin) return input;
  try {
    return new URL(origin).host;
  } catch {
    return input;
  }
}
