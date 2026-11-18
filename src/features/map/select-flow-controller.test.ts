import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSelectFlowController, FALLBACK_LABEL } from "@/features/map/select-flow-controller";
import {
  initialSelectionState,
  selectionReducer,
  type Mode,
  type SelectionState,
} from "@/features/map/selection-flow";

/**
 * Unit coverage for the selection orchestrator — pure over injected callbacks +
 * fetch (no MapLibre), so its moved must-not-regress invariants are tested
 * directly rather than only via e2e: mode frozen at entry,
 * reverse-422-fatal → no rings/amenities, isochrone-fail → clearAmenities,
 * and stale-token drops.
 */

type FetchImpl = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
let fetchImpl: FetchImpl;
const fetchedUrls: string[] = [];

function res(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function makeHarness(startMode: Mode = "walk") {
  const selRef = { current: { ...initialSelectionState, mode: startMode } as SelectionState };
  const dispatched: Array<{ type: string; stage?: string }> = [];
  const dispatchSel = (action: Parameters<typeof selectionReducer>[1]) => {
    dispatched.push(action as { type: string; stage?: string });
    selRef.current = selectionReducer(selRef.current, action);
    return selRef.current;
  };
  const clearSelection = vi.fn();
  const clearAmenities = vi.fn();
  const maybeFetchAmenities = vi.fn();
  const renderSelection = vi.fn();
  const showOrigin = vi.fn();
  const pendingInputRef = { current: null };
  const controller = createSelectFlowController({
    dispatchSel,
    selRef,
    pendingInputRef,
    abortRef: { current: null },
    clearSelection,
    clearAmenities,
    maybeFetchAmenities,
    renderSelection,
    showOrigin,
  });
  return { controller, selRef, dispatched, clearSelection, clearAmenities, maybeFetchAmenities, renderSelection, showOrigin };
}

beforeEach(() => {
  fetchedUrls.length = 0;
  fetchImpl = (url) => {
    fetchedUrls.push(url);
    return res(200, { origin: { lat: 44.4, lng: 26.1 }, rings: [] });
  };
  vi.stubGlobal("fetch", (url: string) => fetchImpl(url));
});

afterEach(() => vi.restoreAllMocks());

describe("select() — mode frozen at entry", () => {
  it("uses the entry mode for the endpoint AND renderSelection even if selRef.mode mutates mid-flight", async () => {
    const h = makeHarness("walk");
    let resolveIso: () => void = () => {};
    fetchImpl = (url) => {
      fetchedUrls.push(url);
      return new Promise((r) => {
        resolveIso = () => r({ ok: true, status: 200, json: async () => ({ origin: { lat: 44.4, lng: 26.1 }, rings: [] }) });
      });
    };

    const run = h.controller.select({ kind: "point", lat: 44.4, lng: 26.1, label: "X" });
    // Mutate the live mode WITHOUT bumping the token (not a real dispatch) — the
    // captured `const mode` must be immune.
    h.selRef.current = { ...h.selRef.current, mode: "transit" };
    resolveIso();
    await run;

    expect(fetchedUrls.some((u) => u.startsWith("/api/isochrone"))).toBe(true); // walk endpoint
    expect(fetchedUrls.some((u) => u.startsWith("/api/transit"))).toBe(false);
    expect(h.renderSelection).toHaveBeenCalledTimes(1);
    expect(h.renderSelection.mock.calls[0][3]).toBe("walk"); // 4th arg = mode
  });

  it("a fresh select reads the current mode at its own entry", async () => {
    const h = makeHarness("transit");
    await h.controller.select({ kind: "point", lat: 44.4, lng: 26.1, label: "X" });
    expect(fetchedUrls.some((u) => u.startsWith("/api/transit"))).toBe(true);
    expect(h.renderSelection.mock.calls[0][3]).toBe("transit");
  });
});

describe("select() — effective pace (pace is walk-only)", () => {
  it("a transit select requests Normal for BOTH the isochrone URL and amenities, even with a Slow pace left from Walk", async () => {
    const h = makeHarness("transit");
    // User had picked Slow in Walk; it's remembered in state but must not leak
    // into a Public-transport request.
    h.selRef.current = { ...h.selRef.current, pace: "slow" };
    await h.controller.select({ kind: "point", lat: 44.4, lng: 26.1, label: "X" });

    const transitUrl = fetchedUrls.find((u) => u.startsWith("/api/transit"));
    expect(transitUrl).toContain("pace=normal");
    expect(transitUrl).not.toContain("pace=slow");
    // Amenity fetch (parallel branch) got the same effective pace.
    expect(h.maybeFetchAmenities).toHaveBeenCalledTimes(1);
    expect(h.maybeFetchAmenities.mock.calls[0][1]).toBe("normal");
  });

  it("a WALK select still honors the chosen Slow pace on both the isochrone URL and amenities", async () => {
    const h = makeHarness("walk");
    h.selRef.current = { ...h.selRef.current, pace: "slow" };
    await h.controller.select({ kind: "point", lat: 44.4, lng: 26.1, label: "X" });

    const walkUrl = fetchedUrls.find((u) => u.startsWith("/api/isochrone"));
    expect(walkUrl).toContain("pace=slow");
    expect(h.maybeFetchAmenities.mock.calls[0][1]).toBe("slow");
  });

  it("a CAR select threads the /api/car `car` block (basis + slot) into resolved state", async () => {
    const h = makeHarness("car");
    fetchImpl = (url) => {
      fetchedUrls.push(url);
      return res(200, {
        origin: { lat: 44.4, lng: 26.1 },
        rings: [],
        car: { basis: "estimate", slotId: "am-peak", slotLabel: "weekday morning rush" },
      });
    };
    await h.controller.select({ kind: "point", lat: 44.4, lng: 26.1, label: "X" });
    expect(fetchedUrls.some((u) => u.startsWith("/api/car"))).toBe(true);
    // The car block is threaded (carInfo → resolved.car), and the drawn reach is
    // stashed with it.
    expect(h.selRef.current.car).toEqual({ basis: "estimate", slotId: "am-peak", slotLabel: "weekday morning rush" });
  });

  it("carInfo is mode-gated: a WALK select ignores any stray car block", async () => {
    const h = makeHarness("walk");
    fetchImpl = (url) => {
      fetchedUrls.push(url);
      return res(200, { origin: { lat: 44.4, lng: 26.1 }, rings: [], car: { basis: "estimate", slotId: "am-peak", slotLabel: "x" } });
    };
    await h.controller.select({ kind: "point", lat: 44.4, lng: 26.1, label: "X" });
    expect(h.selRef.current.car).toBeNull();
  });

  it("a TRANSIT select keeps the echoed departure as its ISO instant only; a walk select ignores a stray one", async () => {
    const departure = "2026-07-29T05:30:00.000Z";
    fetchImpl = (url) => {
      fetchedUrls.push(url);
      return res(200, { origin: { lat: 44.4, lng: 26.1 }, rings: [], departure });
    };
    const transit = makeHarness("transit");
    await transit.controller.select({ kind: "point", lat: 44.4, lng: 26.1, label: "X" });
    expect(transit.selRef.current.departure).toEqual({ iso: departure });
    const walk = makeHarness("walk");
    await walk.controller.select({ kind: "point", lat: 44.4, lng: 26.1, label: "X" });
    expect(walk.selRef.current.departure).toBeNull();
  });
});

describe("select() — invariants", () => {
  it("reverse 422 is fatal: no rings, no amenities (click path)", async () => {
    const h = makeHarness();
    fetchImpl = (url) => {
      fetchedUrls.push(url);
      if (url.startsWith("/api/reverse")) return res(422, {});
      return res(200, { origin: { lat: 44.4, lng: 26.1 }, rings: [] });
    };
    await h.controller.select({ kind: "click", lat: 44.4, lng: 26.1 });
    expect(h.renderSelection).not.toHaveBeenCalled();
    expect(h.maybeFetchAmenities).not.toHaveBeenCalled();
    expect(h.clearAmenities).toHaveBeenCalled();
    expect(h.dispatched.some((a) => a.type === "failed" && a.stage === "reverse")).toBe(true);
  });

  it("a failed isochrone clears amenities and never renders rings", async () => {
    const h = makeHarness();
    fetchImpl = (url) => {
      fetchedUrls.push(url);
      return res(500, {});
    };
    await h.controller.select({ kind: "point", lat: 44.4, lng: 26.1, label: "X" });
    expect(h.renderSelection).not.toHaveBeenCalled();
    expect(h.clearAmenities).toHaveBeenCalled();
    expect(h.dispatched.some((a) => a.type === "failed" && a.stage === "isochrone")).toBe(true);
  });

  it("search path: geocode → isochrone → render + amenities in parallel", async () => {
    const h = makeHarness();
    fetchImpl = (url) => {
      fetchedUrls.push(url);
      if (url.startsWith("/api/geocode")) return res(200, { lat: 44.5, lng: 26.2, label: "Str. Foo" });
      return res(200, { origin: { lat: 44.5, lng: 26.2 }, rings: [] });
    };
    await h.controller.select({ kind: "search", query: "foo" });
    expect(h.maybeFetchAmenities).toHaveBeenCalledTimes(1);
    expect(h.renderSelection).toHaveBeenCalledTimes(1);
    expect(h.renderSelection.mock.calls[0][1]).toBe("Str. Foo"); // 2nd arg = label
  });

  it("search path: a failed geocode reports failed(geocode) and never renders", async () => {
    const h = makeHarness();
    fetchImpl = (url) => {
      fetchedUrls.push(url);
      return res(500, {});
    };
    await h.controller.select({ kind: "search", query: "foo" });
    expect(h.renderSelection).not.toHaveBeenCalled();
    expect(h.dispatched.some((a) => a.type === "failed" && a.stage === "geocode")).toBe(true);
  });

  it("click path: a non-fatal reverse supplies the human label and fetches amenities", async () => {
    const h = makeHarness();
    fetchImpl = (url) => {
      fetchedUrls.push(url);
      if (url.startsWith("/api/reverse")) return res(200, { label: "Piața Unirii" });
      return res(200, { origin: { lat: 44.4, lng: 26.1 }, rings: [] });
    };
    await h.controller.select({ kind: "click", lat: 44.4, lng: 26.1 });
    expect(h.maybeFetchAmenities).toHaveBeenCalledTimes(1);
    expect(h.renderSelection).toHaveBeenCalledTimes(1);
    expect(h.renderSelection.mock.calls[0][1]).toBe("Piața Unirii");
  });

  it("click path: a non-fatal but failed reverse (500) keeps the fallback and still paints rings", async () => {
    const h = makeHarness();
    fetchImpl = (url) => {
      fetchedUrls.push(url);
      if (url.startsWith("/api/reverse")) return res(500, {}); // not ok, not 422 → not fatal
      return res(200, { origin: { lat: 44.4, lng: 26.1 }, rings: [] });
    };
    await h.controller.select({ kind: "click", lat: 44.4, lng: 26.1 });
    expect(h.renderSelection).toHaveBeenCalledTimes(1);
    expect(h.renderSelection.mock.calls[0][1]).toBe(FALLBACK_LABEL);
    expect(h.maybeFetchAmenities).toHaveBeenCalledTimes(1);
  });

  it("click path: a reverse with a blank label keeps the fallback label", async () => {
    const h = makeHarness();
    fetchImpl = (url) => {
      fetchedUrls.push(url);
      if (url.startsWith("/api/reverse")) return res(200, { label: "   " }); // blank → ignored
      return res(200, { origin: { lat: 44.4, lng: 26.1 }, rings: [] });
    };
    await h.controller.select({ kind: "click", lat: 44.4, lng: 26.1 });
    expect(h.renderSelection.mock.calls[0][1]).toBe(FALLBACK_LABEL);
  });

  it("click path: a malformed reverse body still renders with the fallback label", async () => {
    const h = makeHarness();
    fetchImpl = (url) => {
      fetchedUrls.push(url);
      if (url.startsWith("/api/reverse")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } });
      }
      return res(200, { origin: { lat: 44.4, lng: 26.1 }, rings: [] });
    };
    await h.controller.select({ kind: "click", lat: 44.4, lng: 26.1 });
    expect(h.renderSelection).toHaveBeenCalledTimes(1);
    expect(h.renderSelection.mock.calls[0][1]).toBe(FALLBACK_LABEL);
  });

  it("a thrown fetch (network crash) clears amenities and dispatches crash", async () => {
    const h = makeHarness();
    fetchImpl = () => Promise.reject(new TypeError("network down"));
    await h.controller.select({ kind: "point", lat: 44.4, lng: 26.1, label: "X" });
    expect(h.renderSelection).not.toHaveBeenCalled();
    expect(h.clearAmenities).toHaveBeenCalled();
    expect(h.dispatched.some((a) => a.type === "crash")).toBe(true);
  });

  it("drops a superseded run: a newer selection bumped the token mid-flight", async () => {
    const h = makeHarness();
    let resolveIso: () => void = () => {};
    fetchImpl = () =>
      new Promise((r) => {
        resolveIso = () => r({ ok: true, status: 200, json: async () => ({ origin: { lat: 44.4, lng: 26.1 }, rings: [] }) });
      });
    const run = h.controller.select({ kind: "point", lat: 44.4, lng: 26.1, label: "X" });
    // A new selection starts (bumps the token) while the first is awaiting.
    h.selRef.current = selectionReducer(h.selRef.current, { type: "start", mode: "walk" });
    resolveIso();
    await run;
    expect(h.renderSelection).not.toHaveBeenCalled(); // stale run must not paint
  });
});

describe("select() — the origin pin shows while the reach loads", () => {
  it("names a click without an address 'Punct pe hartă'", () => {
    expect(FALLBACK_LABEL).toBe("Punct pe hartă");
  });

  it("pins a clicked point before the reach request goes out", async () => {
    for (const input of [
      { kind: "click", lat: 44.4, lng: 26.1 },
      { kind: "point", lat: 44.4, lng: 26.1, label: "X" },
    ] as const) {
      const h = makeHarness("walk");
      let pinnedAtReachRequest: unknown[][] | null = null;
      fetchImpl = (url) => {
        fetchedUrls.push(url);
        if (url.startsWith("/api/isochrone")) pinnedAtReachRequest = [...h.showOrigin.mock.calls];
        if (url.startsWith("/api/reverse")) return res(200, { label: "Piața Unirii" });
        return res(200, { origin: { lat: 44.4, lng: 26.1 }, rings: [] });
      };
      await h.controller.select(input);
      expect(pinnedAtReachRequest).toEqual([[{ lat: 44.4, lng: 26.1 }, "walk"]]);
      // Pinned once: the resolution moves that same pin.
      expect(h.showOrigin).toHaveBeenCalledTimes(1);
      // The pin comes after the previous selection was cleared, never before it.
      expect(h.clearSelection.mock.invocationCallOrder[0]).toBeLessThan(h.showOrigin.mock.invocationCallOrder[0]);
    }
  });

  it("pins a typed search only after the geocode answers, and a failed geocode pins nothing", async () => {
    const h = makeHarness("transit");
    let pinnedAtGeocode = -1;
    let pinnedAtReachRequest: unknown[][] | null = null;
    fetchImpl = (url) => {
      fetchedUrls.push(url);
      if (url.startsWith("/api/geocode")) {
        pinnedAtGeocode = h.showOrigin.mock.calls.length;
        return res(200, { lat: 44.5, lng: 26.2, label: "Str. Foo" });
      }
      if (url.startsWith("/api/transit")) pinnedAtReachRequest = [...h.showOrigin.mock.calls];
      return res(200, { origin: { lat: 44.5, lng: 26.2 }, rings: [] });
    };
    await h.controller.select({ kind: "search", query: "foo" });
    expect(pinnedAtGeocode).toBe(0);
    expect(pinnedAtReachRequest).toEqual([[{ lat: 44.5, lng: 26.2 }, "transit"]]);

    const failed = makeHarness();
    fetchImpl = (url) => {
      fetchedUrls.push(url);
      return res(404, {});
    };
    await failed.controller.select({ kind: "search", query: "nowhere" });
    expect(failed.showOrigin).not.toHaveBeenCalled();
  });

  it("never pins a superseded run's origin", async () => {
    const h = makeHarness();
    let answerGeocode: () => void = () => {};
    fetchImpl = (url) => {
      fetchedUrls.push(url);
      if (url.startsWith("/api/geocode")) {
        return new Promise((r) => {
          answerGeocode = () => r({ ok: true, status: 200, json: async () => ({ lat: 44.5, lng: 26.2, label: "Old" }) });
        });
      }
      return res(200, { origin: { lat: 44.5, lng: 26.2 }, rings: [] });
    };
    const run = h.controller.select({ kind: "search", query: "old" });
    // A newer selection starts (bumps the token) while the geocode is pending.
    h.selRef.current = selectionReducer(h.selRef.current, { type: "start", mode: "walk" });
    answerGeocode();
    await run;
    expect(h.showOrigin).not.toHaveBeenCalled();
    expect(fetchedUrls.some((u) => u.startsWith("/api/isochrone"))).toBe(false);
  });
});
