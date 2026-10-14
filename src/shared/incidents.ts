/**
 * Incident state machine (pure). An incident opens only after a configurable
 * number of consecutive failures (default 2) to avoid flapping on a single
 * transient error, and resolves on the first successful check. Exactly one
 * downtime notification is sent per incident; exactly one recovery notification.
 */

export const DEFAULT_FAILURE_THRESHOLD = 2;

export interface MonitorCounters {
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  /** Whether an incident is currently open for this monitor. */
  hasOpenIncident: boolean;
}

export interface CheckOutcome {
  ok: boolean;
}

export type IncidentAction =
  | { type: "none" }
  | { type: "open_incident"; notify: true }
  | { type: "resolve_incident"; notify: true };

/**
 * Given the current counters and the latest check outcome, return the updated
 * counters and any incident action to take. The caller persists the counters
 * and performs the notification (once) based on the action.
 */
export function applyCheck(
  counters: MonitorCounters,
  outcome: CheckOutcome,
  threshold: number = DEFAULT_FAILURE_THRESHOLD,
): { counters: MonitorCounters; action: IncidentAction } {
  if (outcome.ok) {
    const next: MonitorCounters = {
      consecutiveFailures: 0,
      consecutiveSuccesses: counters.consecutiveSuccesses + 1,
      hasOpenIncident: false,
    };
    if (counters.hasOpenIncident) {
      return { counters: next, action: { type: "resolve_incident", notify: true } };
    }
    return { counters: next, action: { type: "none" } };
  }

  // failure
  const consecutiveFailures = counters.consecutiveFailures + 1;
  const shouldOpen = !counters.hasOpenIncident && consecutiveFailures >= threshold;
  const next: MonitorCounters = {
    consecutiveFailures,
    consecutiveSuccesses: 0,
    hasOpenIncident: counters.hasOpenIncident || shouldOpen,
  };
  if (shouldOpen) {
    return { counters: next, action: { type: "open_incident", notify: true } };
  }
  return { counters: next, action: { type: "none" } };
}

export function shouldOpenIncident(
  consecutiveFailures: number,
  hasOpenIncident: boolean,
  threshold: number = DEFAULT_FAILURE_THRESHOLD,
): boolean {
  return !hasOpenIncident && consecutiveFailures >= threshold;
}
