/**
 * Lightweight HTML metadata extraction using the Workers-native HTMLRewriter
 * (streaming, no DOM, no heavy dependency). Used by the free scan and the deep
 * audit's HTTP-level page analysis. This does NOT execute JavaScript — that is
 * what the (bounded, expensive) browser step is for.
 */

import {
  hasGenericErrorDebugContext,
  isGenericErrorPageText,
  MAX_GENERIC_ERROR_PAGE_TEXT_LENGTH,
  MAX_GENERIC_ERROR_PAGE_WORD_COUNT,
} from "@shared/availability";
import { isSameOrigin } from "@shared/url";

export interface PageMeta {
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  htmlLang: string | null;
  robotsMeta: string | null;
  h1Count: number;
  imagesMissingAlt: number;
  imageCount: number;
  /** Absolute-resolved hrefs discovered on the page (bounded). */
  links: string[];
  /** True when more than 250 unique same-origin links were found. */
  sameOriginLinksTruncated?: boolean;
  hasViewportMeta: boolean;
}

const MAX_LINKS_PER_SCOPE = 250;

/**
 * Whether a response is an HTML document worth analysing as a page. Crawls find
 * links to text files, PDFs and feeds too; HTML rules (title, h1, lang...) make
 * no sense for those and would report false findings. A missing content type
 * falls back to sniffing the start of the body.
 */
export function isHtmlDocument(contentType: string | null | undefined, body?: string | null): boolean {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (type) return type === "text/html" || type === "application/xhtml+xml";
  const head = (body ?? "").slice(0, 512).trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

/**
 * Whether the HTTP-only scanner can find text content in an HTML response.
 * This static check cannot verify CSS or media loading, so it requires text
 * outside metadata, scripts, styles, templates, comments, and hidden subtrees.
 */
export function hasMeaningfulHtmlContent(html: string | null | undefined): boolean {
  if (!html) return false;
  return visibleHtmlText(html).length > 0;
}

/** True when an HTML response matches a strong generic error-screen signature. */
export function isGenericErrorHtmlDocument(html: string | null | undefined): boolean {
  if (!html) return false;
  const uncommentedHtml = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, " ");
  const title = uncommentedHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "";
  const titleText = title.replace(/<(?:[^>]+)>/g, " ").replace(/\s+/g, " ").trim();
  const headings = Array.from(uncommentedHtml.matchAll(/<h1\b[^>]*>([\s\S]*?)(?:<\/h1\s*>|$)/gi), (match) =>
    visibleHtmlText(`<div>${match[1] ?? ""}</div>`).replace(/&(?:apos|#0*39|#x0*27);/gi, "'"));
  const bodyText = visibleHtmlText(html).replace(/&(?:apos|#0*39|#x0*27);/gi, "'");
  const bodyWords = bodyText.match(/[\p{L}\p{N}]+/gu) ?? [];
  const shortPage = bodyText.length <= MAX_GENERIC_ERROR_PAGE_TEXT_LENGTH && bodyWords.length <= MAX_GENERIC_ERROR_PAGE_WORD_COUNT;
  return isGenericErrorPageText(titleText)
    || isGenericErrorPageText(bodyText)
    || headings.some(isGenericErrorPageText) && (shortPage || hasGenericErrorDebugContext(bodyText));
}

function visibleHtmlText(html: string): string {
  return availabilityMarkup(html)
    .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, " ")
    .replace(/&(?:nbsp|tab|newline|shy|NoBreak|ZeroWidthSpace|zwnj|zwj|lrm|rlm);/gi, " ")
    .replace(/&(?:#x0*(?:a0|ad|200b|200c|200d|200e|200f|2060|feff)|#0*(?:160|173|8203|8204|8205|8206|8207|8288|65279));/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Media URLs are possible content, but HTTP-only Quick Scan cannot confirm they loaded. */
export function hasUnverifiedMediaContent(html: string | null | undefined): boolean {
  if (!html) return false;
  const content = availabilityMarkup(html);
  const source = String.raw`(?=[^>]*\b(?:src|srcset)\s*=\s*(?:"[^"]+"|'[^']+'|[^\s>"']+))`;
  const iframes = content.matchAll(/<iframe\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi);
  const mediaWithChildSources = Array.from(content.matchAll(/<(video|audio)\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)(?:<\/\1\s*>|$)/gi));
  return new RegExp(`<img\\b${source}[^>]*>`, "i").test(content)
    || new RegExp(`<(?:video|audio|iframe|embed)\\b${source}[^>]*>`, "i").test(content)
    || /<video\b(?=[^>]*\bposter\s*=\s*(?:"[^"]+"|'[^']+'|[^\s>"']+))[^>]*>/i.test(content)
    || mediaWithChildSources.some((match) => new RegExp(`<source\\b${source}[^>]*>`, "i").test(match[3] ?? ""))
    || /<object\b(?=[^>]*\bdata\s*=\s*(?:"[^"]+"|'[^']+'|[^\s>"']+))[^>]*>/i.test(content)
    || Array.from(iframes).some(([tag]) => /\bsrcdoc\s*=\s*(?:"[^"]+"|'[^']+'|[^\s>]+)/i.test(tag));
}

function availabilityMarkup(html: string): string {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, " ");
  const bodyMatch = withoutComments.match(/<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i);
  const body = bodyMatch?.[1] ?? withoutComments.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, "");
  // HTML raw-text elements consume the rest of the document if their closing
  // tag is missing. Treating their contents as prose would make a broken shell
  // such as an unclosed script appear to be a page.
  const withoutNonContent = body.replace(/<(script|style|template|noscript|title)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, " ");
  // Preserve an iframe's opening tag so the media check can identify an
  // unverified frame, while excluding any fallback or embedded page text.
  const framePlaceholders = withoutNonContent.replace(/<iframe\b((?:[^>"']|"[^"]*"|'[^']*')*)>[\s\S]*?(?:<\/iframe\s*>|$)/gi, "<iframe$1></iframe>");
  return stripExplicitlyHiddenContent(framePlaceholders);
}

function stripExplicitlyHiddenContent(html: string): string {
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const tokens = /<([a-z][\w:-]*(?:[^>"']|"[^"]*"|'[^']*')*)>|<\/([a-z][\w:-]*)\s*>/gi;
  const hiddenStack: string[] = [];
  let result = "";
  let lastIndex = 0;
  for (const match of html.matchAll(tokens)) {
    const token = match[0];
    const tagName = (match[1]?.match(/^[a-z][\w:-]*/i)?.[0] ?? match[2] ?? "").toLowerCase();
    const closing = Boolean(match[2]);
    const openingIsHidden = !closing && isExplicitlyHiddenTag(token);
    if (hiddenStack.length === 0 && !openingIsHidden) result += html.slice(lastIndex, match.index) + token;
    if (hiddenStack.length > 0) {
      if (closing) {
        const stackIndex = hiddenStack.lastIndexOf(tagName);
        if (stackIndex >= 0) hiddenStack.length = stackIndex;
      } else if (!voidTags.has(tagName) && !token.endsWith("/>")) {
        hiddenStack.push(tagName);
      }
    } else if (openingIsHidden && !voidTags.has(tagName)) {
      hiddenStack.push(tagName);
    }
    lastIndex = match.index + token.length;
  }
  if (hiddenStack.length === 0) result += html.slice(lastIndex);
  return result;
}

function isExplicitlyHiddenTag(tag: string): boolean {
  if (/\shidden(?:\s|=|\/?>)/i.test(tag)) return true;
  const classMatch = tag.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const classes = (classMatch?.[1] ?? classMatch?.[2] ?? classMatch?.[3] ?? "").toLowerCase().split(/\s+/);
  if (classes.some((name) => ["hidden", "invisible", "is-hidden", "visually-hidden", "visuallyhidden", "sr-only", "d-none", "display-none"].includes(name))) return true;
  const styleMatch = tag.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const style = styleMatch?.[1] ?? styleMatch?.[2] ?? styleMatch?.[3] ?? "";
  return /(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:!important)?(?=;|$))/i.test(style);
}

/**
 * Parse metadata from an HTML string. `baseUrl` is used to resolve relative
 * links and canonical URLs.
 */
export async function extractPageMeta(html: string, baseUrl: string, priorityOrigin = baseUrl): Promise<PageMeta> {
  const effectiveBaseUrl = await extractDocumentBaseUrl(html, baseUrl);
  const meta: PageMeta = {
    title: null,
    metaDescription: null,
    canonical: null,
    htmlLang: null,
    robotsMeta: null,
    h1Count: 0,
    imagesMissingAlt: 0,
    imageCount: 0,
    links: [],
    hasViewportMeta: false,
  };

  // Only the document's own <title> counts. Inline SVG icons carry <title>
  // elements for their accessible names; those must not be read as (or glued
  // onto) the page title.
  let inTitle = false;
  let titleDone = false;
  let svgDepth = 0;
  let titleText = "";
  let canonicalHref: string | null = null;
  const sameOriginLinks: string[] = [];
  const seenSameOriginLinks = new Set<string>();
  const otherOriginLinks: string[] = [];
  let sameOriginLinksTruncated = false;

  const rewriter = new HTMLRewriter()
    .on("html", {
      element(el) {
        const lang = el.getAttribute("lang");
        if (lang) meta.htmlLang = lang;
      },
    })
    .on("svg", {
      element(el) {
        svgDepth += 1;
        el.onEndTag(() => {
          svgDepth = Math.max(0, svgDepth - 1);
        });
      },
    })
    .on("title", {
      element(el) {
        if (titleDone || svgDepth > 0) return;
        inTitle = true;
        el.onEndTag(() => {
          inTitle = false;
          titleDone = true;
        });
      },
      text(t) {
        if (inTitle) titleText += t.text;
      },
    })
    .on("meta", {
      element(el) {
        const name = el.getAttribute("name")?.toLowerCase();
        const property = el.getAttribute("property")?.toLowerCase();
        const content = el.getAttribute("content");
        if (name === "description" && content) meta.metaDescription = content;
        if (name === "robots" && content) meta.robotsMeta = content.toLowerCase();
        if (name === "viewport") meta.hasViewportMeta = true;
        if (property === "og:title" || property === "og:description") {
          /* available if needed later */
        }
      },
    })
    .on("link", {
      element(el) {
        const rel = el.getAttribute("rel")?.toLowerCase();
        const href = el.getAttribute("href");
        if (rel === "canonical" && href && canonicalHref === null) canonicalHref = href;
      },
    })
    .on("h1", {
      element() {
        meta.h1Count += 1;
      },
    })
    .on("img", {
      element(el) {
        meta.imageCount += 1;
        const alt = el.getAttribute("alt");
        if (alt === null) meta.imagesMissingAlt += 1;
      },
    })
    .on("a", {
      element(el) {
        const href = el.getAttribute("href");
        if (href === null) return;
        const abs = resolveHttpUrl(href, effectiveBaseUrl);
        if (!abs) return;
        if (isSameOrigin(abs, priorityOrigin)) {
          if (seenSameOriginLinks.has(abs)) return;
          seenSameOriginLinks.add(abs);
          if (sameOriginLinks.length < MAX_LINKS_PER_SCOPE) sameOriginLinks.push(abs);
          else sameOriginLinksTruncated = true;
          return;
        }
        if (otherOriginLinks.length < MAX_LINKS_PER_SCOPE) otherOriginLinks.push(abs);
      },
    });

  const response = rewriter.transform(new Response(html));
  await response.text(); // drive the rewriter to completion

  meta.canonical = canonicalHref === null ? null : resolveHttpUrl(canonicalHref, effectiveBaseUrl);
  // Give the crawler and Quick Scan first access to the bounded link budget;
  // external links cannot crowd same-origin pages out of the result.
  meta.links = prioritizePageLinks(sameOriginLinks, otherOriginLinks);
  meta.sameOriginLinksTruncated = sameOriginLinksTruncated;

  // Text nodes arrive raw, so "Acme &amp; Co" must be decoded to be measured.
  meta.title = decodeEntities(titleText).trim() || null;
  return meta;
}

async function extractDocumentBaseUrl(html: string, fallbackUrl: string): Promise<string> {
  let href: string | null = null;
  const response = new HTMLRewriter()
    .on("base", {
      element(el) {
        if (href === null) href = el.getAttribute("href");
      },
    })
    .transform(new Response(html));
  await response.text();
  return resolveDocumentBaseHref(href, fallbackUrl);
}

/** Resolve a document's first base href when it is a safe HTTP(S) URL. */
export function resolveDocumentBaseHref(href: string | null, fallbackUrl: string): string {
  return href === null ? fallbackUrl : resolveHttpUrl(href, fallbackUrl) ?? fallbackUrl;
}

/** Keep same-origin crawl candidates ahead of external links within a fixed budget. */
export function prioritizePageLinks(sameOriginLinks: readonly string[], otherOriginLinks: readonly string[]): string[] {
  return [
    ...sameOriginLinks.slice(0, MAX_LINKS_PER_SCOPE),
    ...otherOriginLinks.slice(0, Math.max(0, MAX_LINKS_PER_SCOPE - sameOriginLinks.length)),
  ];
}

export function resolveHttpUrl(href: string, baseUrl: string): string | null {
  const trimmed = href.trim();
  if (trimmed === "" || trimmed.startsWith("#")) {
    return null;
  }
  try {
    const resolved = new URL(trimmed, baseUrl);
    const protocol = resolved.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

/** Page metadata used by monitoring and audit report features. */
export interface PageDetail extends PageMeta {
  /** h1–h3 in document order (bounded), whitespace-collapsed. */
  headings: { level: 1 | 2 | 3; text: string }[];
  /** JSON-LD `@type` values found on the page, de-duplicated. */
  schemaTypes: string[];
  /** Parsed JSON-LD blocks (bounded); malformed blocks are skipped. */
  jsonLd: unknown[];
  ogTitle: string | null;
  ogDescription: string | null;
  ogSiteName: string | null;
  /** Links inside <nav>, with their visible text: a site's own map of itself. */
  navLinks: { url: string; text: string }[];
  /** Visible text outside script/style/nav/header/footer, truncated. */
  text: string;
  wordCount: number;
  /** `<input type="password">` present anywhere on the page — the strongest
   *  signal that this is a sign-in/app screen rather than marketing content. */
  hasPasswordInput: boolean;
  /** Any `<form>` on the page. */
  hasForm: boolean;
}

const MAX_HEADINGS = 60;
const MAX_TEXT = 40_000;
const MAX_JSON_LD = 20;
const MAX_NAV_LINKS = 60;

/**
 * Parse metadata plus content structure. Heavier than extractPageMeta (it
 * collects text), so the audit keeps using extractPageMeta and only site
 * analysis and page monitoring call this.
 */
export async function extractPageDetail(html: string, baseUrl: string): Promise<PageDetail> {
  const meta = await extractPageMeta(html, baseUrl);
  const detail: PageDetail = {
    ...meta,
    headings: [],
    schemaTypes: [],
    jsonLd: [],
    ogTitle: null,
    ogDescription: null,
    ogSiteName: null,
    navLinks: [],
    text: "",
    wordCount: 0,
    hasPasswordInput: false,
    hasForm: false,
  };

  // Text inside these elements is not the page's own prose.
  let skipDepth = 0;
  let chromeDepth = 0;
  let navDepth = 0;
  let heading: { level: 1 | 2 | 3; text: string } | null = null;
  let jsonLdText: string | null = null;
  let navLink: { url: string; text: string } | null = null;
  const textParts: string[] = [];
  let textLength = 0;
  const types = new Set<string>();

  const skip = { element(el: Element) { skipDepth += 1; el.onEndTag(() => { skipDepth -= 1; }); } };
  const chrome = { element(el: Element) { chromeDepth += 1; el.onEndTag(() => { chromeDepth -= 1; }); } };

  const rewriter = new HTMLRewriter()
    .on("title, style, noscript, template, svg, iframe", skip)
    .on("header, footer, aside", chrome)
    .on("script", {
      element(el) {
        skipDepth += 1;
        const isJsonLd = (el.getAttribute("type") ?? "").toLowerCase().includes("ld+json");
        if (isJsonLd) jsonLdText = "";
        el.onEndTag(() => {
          skipDepth -= 1;
          if (jsonLdText !== null) {
            if (detail.jsonLd.length < MAX_JSON_LD) {
              try {
                const parsed: unknown = JSON.parse(jsonLdText);
                detail.jsonLd.push(parsed);
                collectTypes(parsed, types);
              } catch {
                // Malformed JSON-LD is a finding for the audit, not a crash here.
              }
            }
            jsonLdText = null;
          }
        });
      },
      text(t) {
        if (jsonLdText !== null) jsonLdText += t.text;
      },
    })
    .on("meta", {
      element(el) {
        const property = el.getAttribute("property")?.toLowerCase();
        const content = el.getAttribute("content")?.trim();
        if (!content) return;
        if (property === "og:title") detail.ogTitle = content;
        if (property === "og:description") detail.ogDescription = content;
        if (property === "og:site_name") detail.ogSiteName = content;
      },
    })
    .on("nav", {
      element(el) {
        navDepth += 1;
        chromeDepth += 1;
        el.onEndTag(() => {
          navDepth -= 1;
          chromeDepth -= 1;
        });
      },
    })
    .on("form", {
      element() {
        detail.hasForm = true;
      },
    })
    .on("input", {
      element(el) {
        if ((el.getAttribute("type") ?? "").toLowerCase() === "password") detail.hasPasswordInput = true;
      },
    })
    .on("a", {
      element(el) {
        if (navDepth === 0 || detail.navLinks.length >= MAX_NAV_LINKS) return;
        const href = el.getAttribute("href");
        const url = href ? resolveHttpUrl(href, baseUrl) : null;
        if (!url) return;
        navLink = { url, text: "" };
        el.onEndTag(() => {
          if (navLink) {
            const text = collapse(navLink.text);
            if (text) detail.navLinks.push({ url: navLink.url, text });
          }
          navLink = null;
        });
      },
    })
    .on("h1, h2, h3", {
      element(el) {
        if (skipDepth > 0 || detail.headings.length >= MAX_HEADINGS) return;
        const level = Number(el.tagName.slice(1)) as 1 | 2 | 3;
        heading = { level, text: "" };
        el.onEndTag(() => {
          if (heading) {
            const text = collapse(heading.text);
            if (text) detail.headings.push({ level: heading.level, text });
          }
          heading = null;
        });
      },
    })
    .onDocument({
      text(t) {
        if (skipDepth > 0) return;
        if (navLink) navLink.text += t.text;
        if (heading) heading.text += t.text;
        if (chromeDepth > 0 || textLength >= MAX_TEXT) return;
        textParts.push(t.text);
        textLength += t.text.length;
      },
    });

  await rewriter.transform(new Response(html)).text();

  detail.schemaTypes = [...types];
  detail.text = decodeEntities(collapse(textParts.join(" "))).slice(0, MAX_TEXT);
  detail.wordCount = detail.text ? detail.text.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
  detail.headings = detail.headings.map((h) => ({ ...h, text: decodeEntities(h.text) }));
  detail.navLinks = detail.navLinks.map((l) => ({ ...l, text: decodeEntities(l.text) }));
  return detail;
}

function collectTypes(node: unknown, into: Set<string>, depth = 0): void {
  if (depth > 6 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, into, depth + 1);
    return;
  }
  const record = node as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") into.add(type);
  else if (Array.isArray(type)) for (const t of type) if (typeof t === "string") into.add(t);
  for (const [key, value] of Object.entries(record)) {
    if (key !== "@context") collectTypes(value, into, depth + 1);
  }
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** HTMLRewriter hands over raw text, entities included. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}
