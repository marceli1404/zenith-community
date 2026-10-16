import { useEffect } from "react";

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
    const url = new URL(path, window.location.origin).toString();
    const existingCanonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const canonical = existingCanonical ?? document.createElement("link");
    const previousCanonical = canonical.getAttribute("href");
    if (!existingCanonical) {
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = url;
    restorers.push(() => {
      if (previousCanonical !== null) canonical.href = previousCanonical;
      else canonical.remove();
    });

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
    const existingOgUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    const ogUrl = existingOgUrl ?? document.createElement("meta");
    const previousOgUrl = ogUrl.getAttribute("content");
    if (!existingOgUrl) {
      ogUrl.setAttribute("property", "og:url");
      document.head.appendChild(ogUrl);
    }
    ogUrl.content = url;
    restorers.push(() => {
      if (previousOgUrl !== null) ogUrl.content = previousOgUrl;
      else ogUrl.remove();
    });

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
