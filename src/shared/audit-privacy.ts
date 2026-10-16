/** Privacy helpers for URLs retained in audit results and generated reports. */

const SENSITIVE_PATH_WORDS = new Set([
  "token", "secret", "auth", "oauth", "password", "passwd", "reset", "verify", "verification",
  "confirm", "invite", "invitation", "magic", "magiclink", "session", "credential", "signature",
  "access", "refresh", "email", "code", "key", "login", "logout", "activation", "recovery", "callback",
]);
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_SEGMENT = /^[^/\s@]+@[^/\s@]+\.[^/\s@]+$/;
const OPAQUE_SEGMENT = /^[A-Za-z0-9_-]{20,}$/;
const MIXED_TOKEN_SEGMENT = /^(?=.{8,}$)(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]+$/;
const SEPARATED_TOKEN_SEGMENT = /^(?=.{8,}$)(?=.*[A-Za-z])(?=.*\d)(?=.*[-_])(?:(?=.*[A-Z])(?=.*[a-z])|(?=.*\d[-_A-Za-z]+\d))[A-Za-z0-9_-]+$/;
const ABSOLUTE_URL = /https?:\/\/[^\s"'<>),]+/gi;
const RELATIVE_URL_IN_TEXT = /(^|[\s("'=[<{])((?:\/|\.\.\/|\.\/)[^\s"'<>),;]*)/g;
const URL_FIELD = /(?:url|href|canonical|destination|redirect|path)$/i;

/**
 * Remove query and fragment data, credentials, and path components commonly
 * used for one-time credentials or opaque identifiers while retaining safe
 * page paths for useful findings. Audit grouping and scoring happen before
 * this display/storage normalization.
 */
export function sanitizeAuditUrl(input: string, base?: string): string {
  let url: URL;
  try {
    url = base ? new URL(input, base) : new URL(input);
  } catch {
    return "[redacted URL]";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "[redacted URL]";

  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";

  const parts = url.pathname.split("/");
  let redactNext = false;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? "";
    if (!part) continue;
    let decoded = part;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      redactNext = true;
      parts[i] = "[redacted]";
      continue;
    }
    const words = decoded.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^a-z0-9]+/i).filter(Boolean);
    const sensitive = words.some((word) => SENSITIVE_PATH_WORDS.has(word.toLowerCase()));
    const opaque = UUID_SEGMENT.test(decoded) || EMAIL_SEGMENT.test(decoded) || OPAQUE_SEGMENT.test(decoded)
      || MIXED_TOKEN_SEGMENT.test(decoded) || SEPARATED_TOKEN_SEGMENT.test(decoded) || /^\d{8,}$/.test(decoded);
    if (redactNext || sensitive || opaque) parts[i] = "[redacted]";
    redactNext = sensitive;
  }
  url.pathname = parts.join("/");
  return url.toString();
}

/** Recursively sanitize URL-shaped values inside evidence from old and new rows. */
export function sanitizeAuditEvidence<T>(value: T, baseUrl: string): T {
  const sanitize = (item: unknown, base: string): unknown => {
    if (typeof item === "string") {
      const safeAbsoluteUrls = item.replace(ABSOLUTE_URL, (url) => sanitizeAuditUrl(url));
      if (/^(?:\/|\.\.?\/)[^\s]*$/.test(safeAbsoluteUrls)) return sanitizeAuditUrl(safeAbsoluteUrls, base);
      return safeAbsoluteUrls.replace(RELATIVE_URL_IN_TEXT, (_match, prefix: string, path: string) => {
        const closing = /[\]}]+$/.exec(path)?.[0] ?? "";
        const candidate = closing ? path.slice(0, -closing.length) : path;
        const sanitized = sanitizeAuditUrl(candidate, base);
        try {
          return `${prefix}${new URL(sanitized).pathname}${closing}`;
        } catch {
          return `${prefix}[redacted URL]`;
        }
      });
    }
    if (Array.isArray(item)) return item.map((child) => sanitize(child, base));
    if (item && typeof item === "object") {
      const source = item as Record<string, unknown>;
      const objectOrigin = typeof source.origin === "string" ? source.origin : base;
      return Object.fromEntries(Object.entries(source).map(([key, child]) => {
        if (typeof child === "string" && URL_FIELD.test(key)) {
          return [key, sanitizeAuditUrl(child, objectOrigin)];
        }
        return [key, sanitize(child, objectOrigin)];
      }));
    }
    return item;
  };
  return sanitize(value, baseUrl) as T;
}
