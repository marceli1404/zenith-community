import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App, { appChunkLoader, routeChunk } from "./App";
import { ThemeProvider } from "./lib/theme";
import { AuthProvider } from "./lib/auth";
import { Toaster } from "./lib/toast";
import { installRoutePrefetch, registerChunkLoader } from "./lib/prefetch";
import { RouteProgress } from "./components/LoadingFrames";
import "./index.css";

registerChunkLoader(appChunkLoader);
installRoutePrefetch();

const container = document.getElementById("root")!;

const tree = (
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        {/* Navigations run as transitions: while the next route's code loads,
            the current page stays on screen instead of a loading state. */}
        <BrowserRouter>
          <RouteProgress />
          <App />
          <Toaster />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);

function mount() {
  /*
   * The public routes are served as real prerendered HTML (scripts/prerender.mjs),
   * so the hero is already on screen when this runs. createRoot would discard
   * those nodes and paint the same heading a second time — and the second paint
   * is the one Largest Contentful Paint reports, which cost us ~2.4s on mobile.
   * hydrateRoot adopts the existing DOM instead, so nothing repaints.
   *
   * Client-only routes (/app/*, /login, …) are served the untouched shell, which
   * still holds the boot frame: there is no app markup to adopt, so they mount.
   */
  const prerendered = container.firstElementChild !== null && !container.querySelector("[data-boot-frame]");
  if (!prerendered) {
    createRoot(container).render(tree);
    return;
  }
  hydrateRoot(container, tree, {
    onRecoverableError: (error) => console.error("Page hydration recovered", error),
  });
}

/*
 * The public information routes are code-split so /login and /signup avoid
 * loading the landing page's visual components. The route's
 * chunk has to be resolved *before* we mount: hydration compares the prerendered
 * markup against the first client render, and a Suspense fallback there would be
 * a mismatch that throws the prerendered page away.
 *
 * The auth and dashboard routes have no chunk to wait for (auth is in the entry
 * chunk, the dashboard has its own Suspense boundary) so they mount immediately.
 */
const pending = routeChunk(window.location.pathname);
if (pending) pending.then(mount, mount);
else mount();

// Register the service worker in production only (offline fallback + faster
// repeat loads of immutable assets). It never intercepts the API or auth.
if (
  "serviceWorker" in navigator &&
  location.hostname !== "localhost" &&
  location.hostname !== "127.0.0.1"
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* SW is a progressive enhancement; ignore registration failures */
    });
  });
}
