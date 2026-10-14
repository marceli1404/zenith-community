import { describe, it, expect } from "vitest";
import { applyCheck, shouldOpenIncident, MonitorCounters } from "@shared/incidents";

const fresh: MonitorCounters = {
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  hasOpenIncident: false,
};

describe("applyCheck — incident state machine", () => {
  it("does not open on a single transient failure (threshold 2)", () => {
    const { counters, action } = applyCheck(fresh, { ok: false });
    expect(counters.consecutiveFailures).toBe(1);
    expect(counters.hasOpenIncident).toBe(false);
    expect(action.type).toBe("none");
  });

  it("opens exactly on the 2nd consecutive failure and notifies once", () => {
    const afterOne = applyCheck(fresh, { ok: false }).counters;
    const { counters, action } = applyCheck(afterOne, { ok: false });
    expect(counters.consecutiveFailures).toBe(2);
    expect(counters.hasOpenIncident).toBe(true);
    expect(action).toEqual({ type: "open_incident", notify: true });
  });

  it("does not re-open (no duplicate downtime notification) while already open", () => {
    const open: MonitorCounters = {
      consecutiveFailures: 5,
      consecutiveSuccesses: 0,
      hasOpenIncident: true,
    };
    const { action } = applyCheck(open, { ok: false });
    expect(action.type).toBe("none");
  });

  it("resolves on first success while open and notifies once", () => {
    const open: MonitorCounters = {
      consecutiveFailures: 3,
      consecutiveSuccesses: 0,
      hasOpenIncident: true,
    };
    const { counters, action } = applyCheck(open, { ok: true });
    expect(counters.hasOpenIncident).toBe(false);
    expect(counters.consecutiveFailures).toBe(0);
    expect(counters.consecutiveSuccesses).toBe(1);
    expect(action).toEqual({ type: "resolve_incident", notify: true });
  });

  it("success with no open incident does nothing", () => {
    const { action } = applyCheck(fresh, { ok: true });
    expect(action.type).toBe("none");
  });

  it("failure resets consecutiveSuccesses; success resets consecutiveFailures", () => {
    const afterSuccess = applyCheck(fresh, { ok: true }).counters;
    expect(afterSuccess.consecutiveSuccesses).toBe(1);
    const afterFailure = applyCheck(afterSuccess, { ok: false }).counters;
    expect(afterFailure.consecutiveSuccesses).toBe(0);
    expect(afterFailure.consecutiveFailures).toBe(1);
  });

  it("respects a custom threshold", () => {
    let c = fresh;
    for (let i = 0; i < 2; i++) c = applyCheck(c, { ok: false }, 3).counters;
    expect(c.hasOpenIncident).toBe(false);
    const { action } = applyCheck(c, { ok: false }, 3);
    expect(action.type).toBe("open_incident");
  });
});

describe("shouldOpenIncident", () => {
  it("matches threshold boundary", () => {
    expect(shouldOpenIncident(1, false)).toBe(false);
    expect(shouldOpenIncident(2, false)).toBe(true);
    expect(shouldOpenIncident(2, true)).toBe(false);
  });
});
