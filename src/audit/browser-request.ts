import { validatePublicTarget } from "@shared/ssrf";
import { isUnsafeCrawlPath } from "@shared/url";

export type BrowserRequestDecision =
  | { allowed: true; url: string }
  | { allowed: false; reason: "method_not_allowed" | "unsafe_path" | "blocked_target" };

/** Keep browser-rendered page requests public, read-only, and away from known state-changing routes. */
export function checkBrowserRequest(url: string, method: string): BrowserRequestDecision {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod !== "GET" && normalizedMethod !== "HEAD") {
    return { allowed: false, reason: "method_not_allowed" };
  }

  const target = validatePublicTarget(url);
  if (!target.ok) return { allowed: false, reason: "blocked_target" };
  const parsedUrl = new URL(target.url);
  if (isUnsafeCrawlPath(`${parsedUrl.pathname}${parsedUrl.search}`)) {
    return { allowed: false, reason: "unsafe_path" };
  }
  return { allowed: true, url: target.url };
}
