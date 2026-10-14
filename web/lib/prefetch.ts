/**
 * Route code, fetched on intent. Hovering, focusing or touching an internal link
 * starts downloading that route's chunk, so by the time the click lands the page
 * is usually ready and the current one simply swaps out. If a click still has to
 * wait, a `zenith:route-loading` event drives the top progress bar (see
 * RouteProgress) while the old page stays on screen.
 */

export type ChunkLoader = (pathname: string) => { key: string; load: () => Promise<unknown> } | null;

const loaders: ChunkLoader[] = [];
const state = new Map<string, Promise<unknown> | "ready">();

export function registerChunkLoader(loader: ChunkLoader) {
  if (!loaders.includes(loader)) loaders.push(loader);
}

function resolve(pathname: string) {
  for (const loader of loaders) {
    const hit = loader(pathname);
    if (hit) return hit;
  }
  return null;
}

/** Start (or reuse) the download for a path. Returns the pending promise, or
 *  null when the code is already here or the path needs none. */
export function warmRoute(pathname: string): Promise<unknown> | null {
  const hit = resolve(pathname);
  if (!hit) return null;
  const current = state.get(hit.key);
  if (current === "ready") return null;
  if (current) return current;
  const pending = hit
    .load()
    .then(() => state.set(hit.key, "ready"))
    .catch(() => state.delete(hit.key));
  state.set(hit.key, pending);
  return pending;
}

function internalPath(target: EventTarget | null): string | null {
  const anchor = (target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return null;
  if (anchor.origin !== window.location.origin) return null;
  return anchor.pathname;
}

let installed = false;

export function installRoutePrefetch() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const warm = (e: Event) => {
    const path = internalPath(e.target);
    if (path) warmRoute(path);
  };
  document.addEventListener("pointerover", warm, { passive: true });
  document.addEventListener("focusin", warm);
  document.addEventListener("touchstart", warm, { passive: true });
  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const path = internalPath(e.target);
      if (!path || path === window.location.pathname) return;
      const pending = warmRoute(path);
      if (!pending) return;
      window.dispatchEvent(new CustomEvent("zenith:route-loading", { detail: true }));
      void pending.finally(() => window.dispatchEvent(new CustomEvent("zenith:route-loading", { detail: false })));
    },
    true,
  );
}
