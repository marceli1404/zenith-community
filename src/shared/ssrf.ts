/**
 * SSRF security boundary — validatePublicTarget().
 *
 * The product accepts arbitrary user-supplied URLs (free scan, deep audit,
 * monitoring). This module is the single gate that decides whether a target is
 * a legitimate PUBLIC website or a request that could reach internal/cloud
 * infrastructure. It is pure and isomorphic so it can be exhaustively unit
 * tested and reused on every code path (validation, redirect hops, browser
 * request interception).
 *
 * Design principles:
 *  - Parse numeric hosts the way the network stack (inet_aton) actually would,
 *    THEN classify the resulting address. This defeats decimal/octal/hex/integer
 *    and short-form IPv4 tricks, because we evaluate the real destination, not
 *    the surface text.
 *  - Deny by default for anything reserved, private, loopback, link-local,
 *    unique-local, multicast, or otherwise non-public.
 *  - This function handles the LITERAL target. DNS-rebinding (a public name that
 *    resolves to a private IP) is a runtime concern: the fetch wrapper must
 *    re-validate the resolved address and EVERY redirect hop. See src/lib/http.ts.
 */

export interface ValidTarget {
  readonly ok: true;
  readonly url: string;
  readonly hostname: string;
  readonly port: number;
}

export interface InvalidTarget {
  readonly ok: false;
  /** Machine-readable reason code (safe to log). */
  readonly code: SsrfRejectCode;
  /** Human-readable reason (safe to show; contains no secrets). */
  readonly reason: string;
}

export type TargetValidation = ValidTarget | InvalidTarget;

export type SsrfRejectCode =
  | "malformed_url"
  | "empty_host"
  | "scheme_not_allowed"
  | "credentials_in_url"
  | "port_not_allowed"
  | "loopback"
  | "private_network"
  | "link_local"
  | "unique_local"
  | "reserved"
  | "multicast"
  | "unspecified"
  | "localhost_like"
  | "ipv6_not_public";

/** Only standard website ports are permitted. */
const ALLOWED_PORTS = new Set<number>([80, 443]);

/** Hostnames (exact or suffix) that must never be treated as public. */
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".corp",
  ".home",
  ".lan",
];
const BLOCKED_HOST_EXACT = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
]);

function reject(code: SsrfRejectCode, reason: string): InvalidTarget {
  return { ok: false, code, reason };
}

/**
 * Prepend a default scheme when the input clearly has none, so that
 * "example.com" and "example.com:8080/path" parse as hosts rather than as a
 * URL scheme. Anything already containing "://" is parsed verbatim so that
 * non-HTTP schemes are surfaced and rejected rather than silently rewritten.
 */
export function ensureScheme(input: string): string {
  const trimmed = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  // A bare "scheme:" with no "//" (e.g. "javascript:..." or "file:...") should
  // NOT be treated as a host; keep it as-is so the scheme check rejects it.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[a-z0-9.-]+:\d+/i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/**
 * Parse a string as IPv4 using inet_aton semantics (decimal, octal with leading
 * 0, hex with 0x, and 1–4 dotted parts). Returns the 32-bit address as an
 * unsigned number, or null if the string is not a valid numeric IPv4 form.
 */
export function parseIPv4(host: string): number | null {
  if (host.length === 0) return null;
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;

  const nums: number[] = [];
  for (const part of parts) {
    if (part.length === 0) return null;
    let value: number;
    if (/^0x[0-9a-f]+$/i.test(part)) {
      value = parseInt(part.slice(2), 16);
    } else if (/^0[0-7]+$/.test(part)) {
      value = parseInt(part, 8);
    } else if (/^0$/.test(part)) {
      value = 0;
    } else if (/^[1-9][0-9]*$/.test(part)) {
      value = parseInt(part, 10);
    } else {
      return null; // contains non-numeric characters -> not an IPv4 literal
    }
    if (!Number.isFinite(value) || value < 0) return null;
    nums.push(value);
  }

  // Combine per inet_aton: the final part absorbs the remaining low-order bits.
  const n = nums.length;
  const maxLast = Math.pow(256, 4 - (n - 1));
  const last = nums[n - 1]!;
  if (last >= maxLast) return null;
  for (let i = 0; i < n - 1; i++) {
    if (nums[i]! > 255) return null;
  }
  let addr = last;
  for (let i = 0; i < n - 1; i++) {
    addr += nums[i]! * Math.pow(256, 3 - i);
  }
  if (addr < 0 || addr > 0xffffffff) return null;
  return addr >>> 0;
}

interface Cidr {
  base: number;
  bits: number;
}
function cidr(a: number, b: number, c: number, d: number, bits: number): Cidr {
  return { base: (((a << 24) | (b << 16) | (c << 8) | d) >>> 0), bits };
}

/** Reserved / non-public IPv4 ranges (RFC 1918, loopback, link-local, etc.). */
const BLOCKED_V4: ReadonlyArray<{ range: Cidr; code: SsrfRejectCode }> = [
  { range: cidr(0, 0, 0, 0, 8), code: "unspecified" }, // 0.0.0.0/8
  { range: cidr(10, 0, 0, 0, 8), code: "private_network" }, // 10/8
  { range: cidr(100, 64, 0, 0, 10), code: "reserved" }, // CGNAT 100.64/10
  { range: cidr(127, 0, 0, 0, 8), code: "loopback" }, // 127/8
  { range: cidr(169, 254, 0, 0, 16), code: "link_local" }, // 169.254/16 (incl. metadata)
  { range: cidr(172, 16, 0, 0, 12), code: "private_network" }, // 172.16/12
  { range: cidr(192, 0, 0, 0, 24), code: "reserved" }, // 192.0.0/24
  { range: cidr(192, 0, 2, 0, 24), code: "reserved" }, // TEST-NET-1
  { range: cidr(192, 88, 99, 0, 24), code: "reserved" }, // 6to4 relay anycast
  { range: cidr(192, 168, 0, 0, 16), code: "private_network" }, // 192.168/16
  { range: cidr(198, 18, 0, 0, 15), code: "reserved" }, // benchmarking
  { range: cidr(198, 51, 100, 0, 24), code: "reserved" }, // TEST-NET-2
  { range: cidr(203, 0, 113, 0, 24), code: "reserved" }, // TEST-NET-3
  { range: cidr(224, 0, 0, 0, 4), code: "multicast" }, // 224/4
  { range: cidr(240, 0, 0, 0, 4), code: "reserved" }, // 240/4 (incl. 255.255.255.255)
];

function inCidr(addr: number, c: Cidr): boolean {
  if (c.bits === 0) return true;
  const mask = c.bits === 32 ? 0xffffffff : (~((1 << (32 - c.bits)) - 1)) >>> 0;
  return ((addr & mask) >>> 0) === ((c.base & mask) >>> 0);
}

/** Classify a parsed 32-bit IPv4 address; null if it is a public address. */
export function classifyIPv4(addr: number): SsrfRejectCode | null {
  for (const { range, code } of BLOCKED_V4) {
    if (inCidr(addr, range)) return code;
  }
  return null;
}

/**
 * Parse and classify an IPv6 literal (host WITHOUT surrounding brackets).
 * Returns a reject code for non-public addresses, "public" for public ones, or
 * null when the string is not a valid IPv6 literal at all.
 */
export function classifyIPv6(host: string): SsrfRejectCode | "public" | null {
  const raw = host.toLowerCase();

  // IPv4-mapped / embedded (::ffff:a.b.c.d or ::a.b.c.d): classify the IPv4 part.
  const v4EmbedMatch = raw.match(/^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/);
  let normalized = raw;
  if (v4EmbedMatch) {
    const v4 = parseIPv4(v4EmbedMatch[2]!);
    if (v4 === null) return null;
    // Represent the embedded IPv4 as two hextets for range checks below.
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    normalized = `${v4EmbedMatch[1]}${hi}:${lo}`;
    // Any mapped/embedded private IPv4 is non-public.
    const v4code = classifyIPv4(v4);
    if (v4code) return v4code;
  }

  const groups = expandIPv6(normalized);
  if (!groups) return null;

  const [g0] = groups;
  const first = g0!;

  // ::  (unspecified) and ::1 (loopback)
  if (groups.every((g) => g === 0)) return "unspecified";
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return "loopback";

  // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96, deprecated):
  // the WHATWG URL parser compresses "::ffff:192.168.1.1" to hex, so classify
  // the embedded IPv4 from the last two hextets rather than relying on dotted form.
  const isMapped =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff;
  const isCompat = groups.slice(0, 6).every((g) => g === 0);
  if (isMapped || isCompat) {
    const embedded = ((((groups[6]! << 16) >>> 0) | groups[7]!) >>> 0);
    const code = classifyIPv4(embedded);
    if (code) return code;
    return "public";
  }

  // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfe80) return "link_local";
  // fc00::/7 unique local
  if ((first & 0xfe00) === 0xfc00) return "unique_local";
  // ff00::/8 multicast
  if ((first & 0xff00) === 0xff00) return "multicast";
  // ::ffff:0:0/96 IPv4-mapped that wasn't caught above as private -> treat host
  // as an IPv4; if we reached here the embedded v4 was public, allow.
  return "public";
}

/** Expand an IPv6 string into 8 16-bit groups, or null if invalid. */
function expandIPv6(input: string): number[] | null {
  const str = input;
  if (str.indexOf(":") === -1) return null;
  const halves = str.split("::");
  if (halves.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (side === "") return [];
    const parts = side.split(":");
    const out: number[] = [];
    for (const p of parts) {
      if (!/^[0-9a-f]{1,4}$/i.test(p)) return null;
      out.push(parseInt(p, 16));
    }
    return out;
  };

  if (halves.length === 2) {
    const head = parseSide(halves[0]!);
    const tail = parseSide(halves[1]!);
    if (!head || !tail) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null; // "::" must represent at least one group
    return [...head, ...Array(missing).fill(0), ...tail];
  }
  const all = parseSide(str);
  if (!all || all.length !== 8) return null;
  return all;
}

/**
 * The core gate. Accepts a raw user string and returns a validation result.
 * On success, `url` is the normalized absolute URL that is safe to (carefully)
 * fetch. Callers MUST still use the redirect-validating fetch wrapper.
 */
export function validatePublicTarget(input: string): TargetValidation {
  if (typeof input !== "string" || input.trim().length === 0) {
    return reject("malformed_url", "No URL was provided.");
  }

  let url: URL;
  try {
    url = new URL(ensureScheme(input));
  } catch {
    return reject("malformed_url", "The URL could not be parsed.");
  }

  const scheme = url.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    return reject("scheme_not_allowed", "Only http and https URLs are allowed.");
  }

  if (url.username !== "" || url.password !== "") {
    return reject("credentials_in_url", "URLs containing credentials are not allowed.");
  }

  const port = url.port === "" ? (scheme === "https:" ? 443 : 80) : Number(url.port);
  if (!Number.isInteger(port) || !ALLOWED_PORTS.has(port)) {
    return reject("port_not_allowed", "Only standard web ports (80, 443) are allowed.");
  }

  // Normalize hostname: strip IPv6 brackets, lowercase, remove a single FQDN
  // trailing dot, reject empty labels.
  let host = url.hostname.toLowerCase();
  const isBracketedV6 = host.startsWith("[") && host.endsWith("]");
  if (isBracketedV6) host = host.slice(1, -1);
  if (!isBracketedV6 && host.endsWith(".")) host = host.slice(0, -1);
  if (host.length === 0) return reject("empty_host", "The URL has no host.");
  if (!isBracketedV6 && (host.startsWith(".") || host.includes(".."))) {
    return reject("malformed_url", "The host contains empty labels.");
  }

  // Explicit localhost-like names.
  if (BLOCKED_HOST_EXACT.has(host)) {
    return reject("localhost_like", "That host is not a public address.");
  }
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) {
      return reject("localhost_like", "That host is not a public address.");
    }
  }

  // IPv6 literal (bracketed, or bare containing a colon).
  if (isBracketedV6 || host.includes(":")) {
    const v6 = classifyIPv6(host);
    if (v6 === null) return reject("malformed_url", "The IPv6 address is invalid.");
    if (v6 !== "public") return reject(v6, "That IPv6 address is not public.");
    return { ok: true, url: url.toString(), hostname: host, port };
  }

  // IPv4 literal in any numeric representation.
  const v4 = parseIPv4(host);
  if (v4 !== null) {
    const code = classifyIPv4(v4);
    if (code) return reject(code, "That IP address is not public.");
    return { ok: true, url: url.toString(), hostname: host, port };
  }

  // Otherwise a regular domain name. It must contain a dot and only DNS-legal
  // characters; DNS-rebinding is handled at fetch time by re-validating the
  // resolved address and every redirect hop.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) {
    return reject("malformed_url", "The host is not a valid public domain name.");
  }

  return { ok: true, url: url.toString(), hostname: host, port };
}
