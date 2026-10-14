import { useEffect } from "react";

/** Canonical host. The product/marketing pages return 200 only on the Zenith
 *  origin — the primary domain serves the Labs page at "/" and 308-redirects
 *  every product path here — so the canonical must point at Zenith, not the
 *  redirecting/parent host. Matches the sitemap and the static canonical/OG in
 *  index.html. */
const CANONICAL_BASE = "https://zenith.me.uk";

/** Set the document title, meta description and per-route canonical URL for SEO
 *  and JS-executing crawlers. Runs during prerender too, so the static HTML for
 *  each route carries the right tags. Restores base values on unmount. */
export function useTitle(title: string, description?: string): void {
  useEffect(() => {
    const base = "Zenith";
    document.title = title ? `${title} · ${base}` : `${base}: website monitoring and audits`;

    const restorers: Array<() => void> = [];
    if (description) {
      const el = document.querySelector('meta[name="description"]');
      const prev = el?.getAttribute("content") ?? null;
      el?.setAttribute("content", description);
      restorers.push(() => { if (prev !== null) el?.setAttribute("content", prev); });
    }

    // Per-route canonical. Without this every prerendered page inherits the
    // homepage canonical and reads as a duplicate of "/".
    const path = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
    const url = path === "/" ? `${CANONICAL_BASE}/` : `${CANONICAL_BASE}${path}`;
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      const prevHref = canonical.getAttribute("href");
      canonical.setAttribute("href", url);
      restorers.push(() => { if (prevHref !== null) canonical.setAttribute("href", prevHref); });
    }

    // Per-route social metadata. The static index.html carries homepage OG/Twitter
    // tags; without syncing them here every inner page would share as the homepage
    // (wrong title, description and URL in link previews).
    const setMeta = (selector: string, value: string | null) => {
      if (!value) return;
      const el = document.querySelector(selector);
      if (!el) return;
      const prev = el.getAttribute("content");
      el.setAttribute("content", value);
      restorers.push(() => { if (prev !== null) el.setAttribute("content", prev); });
    };
    if (title) {
      setMeta('meta[property="og:title"]', `${title} · ${base}`);
      setMeta('meta[name="twitter:title"]', `${title} · ${base}`);
    }
    setMeta('meta[property="og:description"]', description ?? null);
    setMeta('meta[name="twitter:description"]', description ?? null);
    setMeta('meta[property="og:url"]', url);

    return () => {
      document.title = `${base}: website monitoring and audits`;
      for (const r of restorers) r();
    };
  }, [title, description]);
}

/** Set only the document title (noindex screens and the 404, where a
 *  canonical or og:url for the current path would be wrong or pointless).
 *  Restores the base title on unmount, like useTitle. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Zenith`;
    return () => {
      document.title = "Zenith: website monitoring and audits";
    };
  }, [title]);
}

/** Ask crawlers not to index this route (auth/app screens) while still following
 *  links. Adds a robots meta on mount and removes it on unmount so marketing
 *  routes stay indexable. */
export function useNoindex(): void {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, follow";
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);
}
