/** Strong, short signatures for generic server or hosting error screens. */
export const GENERIC_ERROR_PAGE_SIGNATURES = [
  String.raw`^(?:http\s*)?(?:500\s+)?internal server error(?:\s+5\d{2})?[.!]?$`,
  String.raw`^(?:http\s*)?502\s+bad gateway(?:\s+(?:cloudflare|nginx))?[.!]?$`,
  String.raw`^bad gateway(?:\s+(?:cloudflare|nginx))?[.!]?$`,
  String.raw`^(?:http\s*)?503\s+service unavailable(?:\s+(?:cloudflare|nginx))?[.!]?$`,
  String.raw`^service unavailable(?:\s+(?:cloudflare|nginx))?[.!]?$`,
  String.raw`^(?:http\s*)?504\s+gateway timeout(?:\s+(?:cloudflare|nginx))?[.!]?$`,
  String.raw`^gateway timeout(?:\s+(?:cloudflare|nginx))?[.!]?$`,
  String.raw`^web server is (?:down|returning an unknown error)[.!]?$`,
  String.raw`^this site can(?:not|'t) be reached[.!]?$`,
  String.raw`^(?:404\s+)?page not found[.!]?$`,
  String.raw`^404(?:\s+(?:not found|error))?[.!]?$`,
  String.raw`^welcome to nginx!?$`,
  String.raw`^application (?:error|failed to load)[.!]?$`,
  String.raw`^server-side exception has occurred[.!]?$`,
  String.raw`^upstream connect error(?:\s+or disconnect/reset before headers)?[.!]?$`,
  String.raw`^error\s+5\d{2}\s*:\s*(?:connection timed out|web server|origin error)[.!]?$`,
] as const;

export const MAX_GENERIC_ERROR_PAGE_TEXT_LENGTH = 240;
export const MAX_GENERIC_ERROR_PAGE_WORD_COUNT = 28;
export const GENERIC_ERROR_DEBUG_CONTEXT_PATTERN = String.raw`(?:traceback\s*\(most recent call last\):|exception in thread ["'][^"']+["']|(?:uncaught|fatal)\s+(?:exception|error)\b|(?:stack\s*trace|stacktrace)\s*:|\bat\s+[\w.$<>]+\s+\([^\n)]*:\d+(?::\d+)?\)|\bpanic:\s+\S|\bgoroutine\s+\d+\s+\[running\]|debug(?:ging)?\s+(?:information|details|output)|(?:request|correlation|incident)\s+id\s*:\s*[\w-]{6,}|please\s+try\s+again\s+(?:later|shortly))`;

/**
 * Match a short, complete error heading/title/body rather than an error phrase
 * embedded in editorial copy. Callers may evaluate titles independently.
 */
export function isGenericErrorPageText(text: string): boolean {
  const normalized = text.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!normalized || normalized.length > 160 || words.length > 18) return false;
  return GENERIC_ERROR_PAGE_SIGNATURES.some((signature) => new RegExp(signature, "i").test(normalized));
}

/** Strong debug output that can corroborate an otherwise ambiguous error H1. */
export function hasGenericErrorDebugContext(text: string): boolean {
  return new RegExp(GENERIC_ERROR_DEBUG_CONTEXT_PATTERN, "i").test(text);
}

export interface GenericErrorPageOptions {
  signatures: string[];
  maxPageLength?: number;
  maxPageWordCount?: number;
  debugContextPattern?: string;
}

/** Serializable browser-context check; pass all options as its single argument. */
export function hasGenericErrorPageContent(options: GenericErrorPageOptions): boolean {
  const {
    signatures,
    maxPageLength = 240,
    maxPageWordCount = 28,
    debugContextPattern = "",
  } = options;
  const browserContext = globalThis as unknown as {
    document?: {
      title?: string;
      body?: { innerText?: string };
      querySelectorAll?: (selector: string) => ArrayLike<{ innerText?: string }>;
    };
  };
  const document = browserContext.document;
  if (!document) return false;
  const pageText = (document.body?.innerText ?? "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  const pageWords = pageText.match(/[\p{L}\p{N}]+/gu) ?? [];
  const shortPage = pageText.length <= maxPageLength && pageWords.length <= maxPageWordCount;
  const headings = document.querySelectorAll ? Array.from(document.querySelectorAll("h1"), (heading) => heading.innerText ?? "") : [];
  const isErrorText = (text: string) => {
    const normalized = text.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
    const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
    return Boolean(normalized)
      && normalized.length <= 160
      && words.length <= 18
      && signatures.some((signature) => new RegExp(signature, "i").test(normalized));
  };
  const candidates = [
    document.title ?? "",
    pageText,
  ];
  return candidates.some(isErrorText)
    || headings.some(isErrorText)
      && (shortPage || Boolean(debugContextPattern) && new RegExp(debugContextPattern, "i").test(pageText));
}
