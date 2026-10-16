/**
 * Runs inside the page's browser context. Checks actual text layout and loaded
 * media, while rejecting content hidden by ancestor styles.
 */
/**
 * Runs in the page's browser context. With no argument, checks the document;
 * when invoked on an ElementHandle, checks that element through its ancestors.
 */
export function hasRenderedPageContent(elementToCheck?: unknown): boolean {
  const browserContext = globalThis as unknown as {
    document?: {
      body?: {
        innerText: string;
        querySelectorAll(selector: string): ArrayLike<{
          tagName: string;
          naturalWidth?: number;
          naturalHeight?: number;
          videoWidth?: number;
          videoHeight?: number;
          readyState?: number;
          getBoundingClientRect(): { width: number; height: number };
          contentDocument?: { body?: { innerText?: string } } | null;
        }>;
        ownerDocument?: {
          createTreeWalker(root: unknown, whatToShow: number): {
            nextNode(): { nodeValue?: string | null; parentElement?: unknown } | null;
          };
        };
      };
      createRange?: () => {
        selectNodeContents(root: unknown): void;
        getClientRects(): ArrayLike<{ width: number; height: number }>;
      };
    };
    getComputedStyle(element: unknown): {
      display: string;
      visibility: string;
      opacity: string;
      contentVisibility?: string;
      overflowX?: string;
      overflowY?: string;
      clip?: string;
      clipPath?: string;
    };
  };
  const document = browserContext.document;
  const body = document?.body;
  if (!document || !body) return false;

  const isVisibleThroughAncestors = (element: unknown) => {
    let ancestor: unknown = element;
    while (ancestor) {
      const style = browserContext.getComputedStyle(ancestor);
      const rect = (ancestor as { getBoundingClientRect?: () => { width: number; height: number } }).getBoundingClientRect?.();
      if (
        style.display === "none"
        || style.visibility === "hidden"
        || style.visibility === "collapse"
        || style.contentVisibility === "hidden"
        || Number(style.opacity) <= 0
      ) return false;
      // A zero-size clipping ancestor can hide content even when its text range
      // still reports a positive fragment rectangle. Ignore that content.
      if (rect && (
        (rect.width <= 0 && ["hidden", "clip", "scroll", "auto"].includes(style.overflowX ?? ""))
        || (rect.height <= 0 && ["hidden", "clip", "scroll", "auto"].includes(style.overflowY ?? ""))
      )) return false;
      if (style.clip && /^rect\(\s*0(?:px)?\s*,\s*0(?:px)?\s*,\s*0(?:px)?\s*,\s*0(?:px)?\s*\)$/i.test(style.clip)) return false;
      const insetText = style.clipPath?.match(/^inset\(\s*([^)]*?)(?:\s+round\b[^)]*)?\s*\)$/i)?.[1];
      const inset = insetText?.trim().split(/\s+/);
      if (inset && inset.length >= 1 && inset.length <= 4) {
        const values = inset.map((value) => {
          const percent = /^([\d.]+)%$/.exec(value);
          if (percent) return Number(percent[1]);
          return /^0(?:\.0+)?(?:px)?$/i.test(value) ? 0 : undefined;
        });
        if (values.every((value): value is number => value !== undefined)) {
          const top = values[0] ?? 0;
          const right = values[1] ?? top;
          const bottom = values[2] ?? top;
          const left = values[3] ?? right;
          if (top + bottom >= 100 || right + left >= 100) return false;
        }
      }
      ancestor = (ancestor as { parentElement?: unknown }).parentElement;
    }
    return true;
  };

  // Puppeteer passes the selected element as the first argument for
  // ElementHandle.evaluate, letting iframe checks reuse this exact predicate.
  if (elementToCheck !== undefined) return isVisibleThroughAncestors(elementToCheck);

  const walker = body.ownerDocument?.createTreeWalker(body, 4);
  if (walker && document.createRange) {
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (node.nodeValue?.trim() && parent && isVisibleThroughAncestors(parent)) {
        const range = document.createRange();
        range.selectNodeContents(node);
        if (Array.from(range.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0)) return true;
      }
      node = walker.nextNode();
    }
  } else if (body.innerText.trim().length > 0 && isVisibleThroughAncestors(body)) {
    return true;
  }

  // Images/video count only when they loaded and have visible dimensions. Alt
  // text remains an accessibility concern and is checked separately.
  const loadedMedia = Array.from(body.querySelectorAll("img, video")).some((element) => {
    const rect = element.getBoundingClientRect();
    if (!isVisibleThroughAncestors(element) || rect.width <= 0 || rect.height <= 0) return false;
    const tag = element.tagName.toLowerCase();
    if (tag === "img") return (element.naturalWidth ?? 0) > 0 && (element.naturalHeight ?? 0) > 0;
    return (element.readyState ?? 0) >= 2 && (element.videoWidth ?? 0) > 0 && (element.videoHeight ?? 0) > 0;
  });
  if (loadedMedia) return true;

  // Puppeteer checks each child frame with this same predicate. Do not infer
  // child visibility from body.innerText here: hidden iframe text can remain
  // nonempty even when none of it is rendered.
  return false;
}
