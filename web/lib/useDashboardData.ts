import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

interface Options<T> {
  /** Poll while this holds for the data we already have — e.g. an audit is still
   *  running. Polling is bounded, pauses while the tab is hidden, and stops as
   *  soon as the predicate goes false. */
  shouldPoll?: (data: T) => boolean;
  pollMs?: number;
  /** Don't revalidate on focus/visibility if we refreshed more recently than this. */
  staleMs?: number;
  errorMessage?: string;
}

export interface DashboardState<T> {
  data: T | null;
  error: string | null;
  /** A request is in flight. With `data` present this is a background refresh. */
  refreshing: boolean;
  /** Nothing has ever loaded and the last attempt failed — callers must stop
   *  showing skeletons and show a resting state instead. */
  unloaded: boolean;
  /** ms epoch of the last successful load, or null. */
  lastLoadedAt: number | null;
  refresh: () => void;
}

/**
 * Loads a dashboard endpoint and keeps it genuinely fresh.
 *
 * Revalidation triggers, all driven by real user/browser events rather than a
 * permanent timer:
 *  - first mount;
 *  - the tab becoming visible again, or the window regaining focus, when the
 *    data is older than `staleMs`;
 *  - bounded polling while `shouldPoll(data)` holds (an audit queued/running),
 *    paused whenever the document is hidden.
 *
 * On failure the previously loaded values are retained — never blanked — and the
 * caller is told to show an actionable error. Only one request is in flight at a
 * time; a response that arrives after unmount or after a newer request is
 * discarded.
 */
export function useDashboardData<T>(path: string, options: Options<T> = {}): DashboardState<T> {
  const { shouldPoll, pollMs = 10_000, staleMs = 30_000, errorMessage = "Couldn't refresh this view." } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const id = ++requestIdRef.current;
    setRefreshing(true);
    api.get<T>(path)
      .then((next) => {
        if (!mountedRef.current || id !== requestIdRef.current) return;
        setData(next);
        setError(null);
        setLastLoadedAt(Date.now());
      })
      .catch(() => {
        if (!mountedRef.current || id !== requestIdRef.current) return;
        // Keep whatever we already have on screen.
        setError(errorMessage);
      })
      .finally(() => {
        inFlightRef.current = false;
        if (mountedRef.current && id === requestIdRef.current) setRefreshing(false);
      });
  }, [path, errorMessage]);

  // Initial load.
  useEffect(() => { load(); }, [load]);

  // Revalidate when the user comes back to a stale dashboard.
  const lastLoadedRef = useRef<number | null>(null);
  lastLoadedRef.current = lastLoadedAt;
  useEffect(() => {
    const maybeRevalidate = () => {
      if (document.visibilityState !== "visible") return;
      const at = lastLoadedRef.current;
      if (at !== null && Date.now() - at < staleMs) return;
      load();
    };
    document.addEventListener("visibilitychange", maybeRevalidate);
    window.addEventListener("focus", maybeRevalidate);
    return () => {
      document.removeEventListener("visibilitychange", maybeRevalidate);
      window.removeEventListener("focus", maybeRevalidate);
    };
  }, [load, staleMs]);

  // Bounded polling while work is genuinely in progress, paused while hidden.
  const active = data !== null && shouldPoll !== undefined && shouldPoll(data);
  useEffect(() => {
    if (!active) return;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") load();
        schedule();
      }, pollMs);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [active, pollMs, load]);

  return {
    data,
    error,
    refreshing,
    unloaded: data === null && error !== null && !refreshing,
    lastLoadedAt,
    refresh: load,
  };
}
