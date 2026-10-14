/**
 * The check library — what Zenith actually checks, written for the people fixing
 * it. Every entry maps to a real rule (src/audit/rules.ts, src/lib/scan.ts,
 * src/shared/incidents.ts). Where a check has a known limit, the entry says so
 * rather than implying more coverage than exists.
 */

export type CheckFamily = "security" | "accessibility" | "seo" | "performance" | "uptime";

export interface CheckEntry {
  id: string;
  family: CheckFamily;
  name: string;
  /** Severity Zenith assigns when the check fails, when it's fixed in the rules. */
  severity?: "critical" | "high" | "medium" | "low" | "info";
  what: string;
  why: string;
  worksWith: string[];
  avoid: string[];
  how: string;
}

export const CHECK_FAMILIES: Array<{ id: CheckFamily; label: string }> = [
  { id: "security", label: "Security" },
  { id: "accessibility", label: "Accessibility" },
  { id: "seo", label: "Search" },
  { id: "performance", label: "Performance" },
  { id: "uptime", label: "Uptime" },
];

export const CHECKS: CheckEntry[] = [
  {
    id: "https",
    family: "security",
    name: "HTTPS and the HTTP redirect",
    severity: "critical",
    what: "Every page is served over HTTPS, and a plain http:// request is sent there.",
    why: "Without it, anyone on the same network can read or change what a visitor sees. Browsers also label the page Not secure.",
    worksWith: ["Strict-Transport-Security", "A single 301 redirect from http to https"],
    avoid: ["Redirect chains that hop through several addresses", "Links and assets that still point at http://"],
    how: "Zenith requests the http:// address and follows where it goes. A page that stays on plain HTTP is marked critical.",
  },
  {
    id: "hsts",
    family: "security",
    name: "Strict-Transport-Security",
    severity: "high",
    what: "Tells browsers to use HTTPS for your domain for a set time, even if someone types http://.",
    why: "It closes the gap on a visitor's first insecure request. That's the moment a downgrade attack needs.",
    worksWith: ["An HTTPS redirect on every host", "A max-age of six months or more once HTTPS is stable"],
    avoid: ["includeSubDomains or preload before every subdomain serves HTTPS: it locks those subdomains out"],
    how: "Read from the response headers of each HTTPS page. A missing header is marked high.",
  },
  {
    id: "csp",
    family: "security",
    name: "Content-Security-Policy",
    severity: "medium",
    what: "Lists which scripts, styles, images and frames a page is allowed to load.",
    why: "If someone manages to inject markup, the browser won't run anything the policy doesn't allow.",
    worksWith: ["Report-only mode while you tune it", "Hashes or nonces for the inline scripts you keep"],
    avoid: ["'unsafe-inline' in script-src: it switches off most of the protection"],
    how: "Zenith checks that a policy is sent. It doesn't yet grade how strict the policy is, so a weak CSP won't be flagged.",
  },
  {
    id: "framing",
    family: "security",
    name: "Clickjacking protection",
    severity: "medium",
    what: "Stops other sites from loading your pages inside a hidden frame.",
    why: "A framed page can trick people into clicking controls they can't see. Think confirming a change on an account page.",
    worksWith: ["CSP frame-ancestors 'self'", "X-Frame-Options: DENY for older browsers"],
    avoid: ["X-Frame-Options: ALLOW-FROM: current browsers ignore it"],
    how: "Passes when either X-Frame-Options or a frame-ancestors directive is present. Marked medium when neither is.",
  },
  {
    id: "nosniff",
    family: "security",
    name: "X-Content-Type-Options",
    severity: "low",
    what: "The value nosniff tells browsers to trust the Content-Type you send.",
    why: "Without it, a browser can decide an uploaded file looks like a script and run it.",
    worksWith: ["Accurate Content-Type headers on every file you serve"],
    avoid: ["JavaScript served with the wrong type: with nosniff on, the browser blocks it"],
    how: "Header presence on each page. Marked low when missing.",
  },
  {
    id: "referrer",
    family: "security",
    name: "Referrer-Policy",
    severity: "low",
    what: "Controls how much of the current address is passed to the next site a visitor opens.",
    why: "Full URLs can carry account IDs, search terms or reset tokens you didn't mean to share.",
    worksWith: ["strict-origin-when-cross-origin as a sensible default"],
    avoid: ["unsafe-url, which sends the full address everywhere, including over HTTP"],
    how: "Header presence. Marked low when missing.",
  },
  {
    id: "permissions",
    family: "security",
    name: "Permissions-Policy",
    severity: "info",
    what: "Turns off browser features you don't use, such as the camera, microphone or location.",
    why: "If a third-party script is compromised, it can't ask your visitors for access you never needed.",
    worksWith: ["An explicit list of the features you do use"],
    avoid: ["Blocking something an embed relies on: payment forms may need the payment feature"],
    how: "Header presence. Reported as information, not as a problem.",
  },
  {
    id: "cookies",
    family: "security",
    name: "Cookie flags",
    severity: "medium",
    what: "Secure keeps a cookie on HTTPS connections. HttpOnly hides it from page scripts.",
    why: "Session cookies without both are easier to steal, through the network or an injected script.",
    worksWith: ["SameSite=Lax on session cookies"],
    avoid: ["HttpOnly on a cookie your own JavaScript reads: it'll stop working", "SameSite=None without Secure, which browsers reject"],
    how: "Reads the Set-Cookie header on the response Zenith receives. It can only see cookies set on that response.",
  },
  {
    id: "alt",
    family: "accessibility",
    name: "Image descriptions",
    what: "Meaningful images carry alt text that says what they show.",
    why: "Screen reader users hear the description. Without it they hear a file name, or nothing.",
    worksWith: ['alt="" on purely decorative images, so they\'re skipped'],
    avoid: ['Starting with "image of", or repeating the caption beside it'],
    how: "Finds images with no alt attribute on each crawled page and lists the pages they're on.",
  },
  {
    id: "lang",
    family: "accessibility",
    name: "Document language",
    severity: "medium",
    what: "The lang attribute on the html element, such as en-GB.",
    why: "Screen readers use it to choose pronunciation. Translation tools use it to detect the language.",
    worksWith: ["lang on any passage written in a different language"],
    avoid: ['A template\'s lang="en" left on a site written in another language'],
    how: "Reads the html element on every crawled page.",
  },
  {
    id: "titles",
    family: "seo",
    name: "Titles and descriptions",
    what: "A unique title and meta description for each page.",
    why: "They're usually the first thing people read in search results, before they decide to click.",
    worksWith: ["One H1 that matches the page's purpose", "A canonical URL"],
    avoid: ["The same title on every page"],
    how: "Flags missing titles as high. Very short titles, ones likely to be cut off, and missing descriptions are flagged lower.",
  },
  {
    id: "noindex",
    family: "seo",
    name: "Accidental noindex",
    severity: "high",
    what: "A robots noindex instruction that hides a page from search engines.",
    why: "It's often left on when a site moves from staging, and the page quietly drops out of search.",
    worksWith: ["noindex on pages that genuinely should stay private, like account settings"],
    avoid: ["Shipping a staging template's noindex to production"],
    how: "Reads the robots meta tag on each page. A noindex is marked high.",
  },
  {
    id: "response",
    family: "performance",
    name: "Server response time",
    what: "How long your server takes to start sending the page.",
    why: "Everything waits on it. Fonts, images and scripts can't start until the HTML arrives.",
    worksWith: ["Caching HTML at the edge where the page allows it"],
    avoid: ["Holding the response while slow third-party API calls finish"],
    how: "Timed on every request Zenith makes. Slow responses are marked high, moderate ones medium.",
  },
  {
    id: "uptime",
    family: "uptime",
    name: "Uptime checks",
    what: "A request to your site every 60 seconds by default in the Community edition.",
    why: "See outages and recovery in the monitoring history for your site.",
    worksWith: ["A public status page you choose to enable"],
    avoid: ["Monitoring an address that redirects to a login page: it can look up while the app is down"],
    how: "An incident opens after two failed checks in a row, so one slow response won't page you.",
  },
];
