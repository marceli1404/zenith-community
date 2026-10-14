/**
 * Lightweight HTML metadata extraction using the Workers-native HTMLRewriter
 * (streaming, no DOM, no heavy dependency). Used by the free scan and the deep
 * audit's HTTP-level page analysis. This does NOT execute JavaScript — that is
 * what the (bounded, expensive) browser step is for.
 */

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
  hasViewportMeta: boolean;
}

const MAX_LINKS = 250;

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
 * Parse metadata from an HTML string. `baseUrl` is used to resolve relative
 * links and canonical URLs.
 */
export async function extractPageMeta(html: string, baseUrl: string): Promise<PageMeta> {
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
        if (rel === "canonical" && href) {
          meta.canonical = resolve(href, baseUrl);
        }
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
        if (!href) return;
        if (meta.links.length >= MAX_LINKS) return;
        const abs = resolve(href, baseUrl);
        if (abs) meta.links.push(abs);
      },
    });

  const response = rewriter.transform(new Response(html));
  await response.text(); // drive the rewriter to completion

  // Text nodes arrive raw, so "Acme &amp; Co" must be decoded to be measured.
  meta.title = decodeEntities(titleText).trim() || null;
  return meta;
}

function resolve(href: string, baseUrl: string): string | null {
  const trimmed = href.trim();
  if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("javascript:") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")) {
    return null;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
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
        const url = href ? resolve(href, baseUrl) : null;
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
