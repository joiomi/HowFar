import { afterEach, describe, expect, it, vi } from "vitest";

import { createClearAddressController, createOriginTracker } from "@/features/map/clear-address-controller";
import { createSelectFlowController } from "@/features/map/select-flow-controller";
import {
  initialSelectionState,
  selectionReducer,
  type SelectInput,
  type SelectionAction,
  type SelectionState,
} from "@/features/map/selection-flow";
import {
  comboboxReducer,
  initialComboboxState,
  type ComboboxAction,
  type ComboboxState,
} from "@/features/search/combobox";

/**
 * The address bar's ✕, driven against the real selection and combobox reducers;
 * only the MapLibre-side effects (drawn reach, directions) and the suggest
 * timer are spies.
 */

const PLACE = { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" };

function harness(sel: Partial<SelectionState> = {}) {
  const selRef = { current: { ...initialSelectionState, ...sel } as SelectionState };
  const dispatchSel = (action: SelectionAction) => (selRef.current = selectionReducer(selRef.current, action));
  const comboRef = {
    current: comboboxReducer(initialComboboxState, { type: "showLabel", label: PLACE.label }) as ComboboxState,
  };
  const dispatchCombo = (action: ComboboxAction) => (comboRef.current = comboboxReducer(comboRef.current, action));
  const abortRef = { current: new AbortController() as AbortController | null };
  const pendingInputRef = { current: { kind: "point", ...PLACE } as SelectInput | null };
  const pendingSelectRef = { current: { kind: "search", query: "Piata Unirii" } as SelectInput | null };
  const origins = createOriginTracker();
  const clearSelection = vi.fn();
  const closeDirections = vi.fn();
  const cancelSuggest = vi.fn();
  const controller = createClearAddressController({
    abortRef,
    dispatchSel,
    pendingInputRef,
    pendingSelectRef,
    origins,
    clearSelection,
    closeDirections,
    cancelSuggest,
    dispatchCombo,
  });
  return {
    controller,
    selRef,
    dispatchSel,
    comboRef,
    abortRef,
    pendingInputRef,
    pendingSelectRef,
    origins,
    clearSelection,
    closeDirections,
    cancelSuggest,
  };
}

const RESOLVED: Partial<SelectionState> = {
  mode: "transit",
  pace: "slow",
  token: 3,
  status: "idle",
  label: PLACE.label,
  lastSelection: PLACE,
  departure: { iso: "2026-11-18T07:30:00.000Z", summary: "Weekday morning" },
};

describe("createOriginTracker", () => {
  it("tells a new place from a recompute of the same one", () => {
    const origins = createOriginTracker();
    expect(origins.note({ lat: 44.4268, lng: 26.1025 })).toBe(true); // first ever
    expect(origins.note({ lat: 44.4268, lng: 26.1025 })).toBe(false); // same place again
    expect(origins.note({ lat: 44.4268 + 1e-12, lng: 26.1025 })).toBe(false); // float noise
    expect(origins.note({ lat: 44.43, lng: 26.1025 })).toBe(true); // moved
  });

  it("after forget, the same place counts as new again", () => {
    const origins = createOriginTracker();
    origins.note({ lat: 44.4268, lng: 26.1025 });
    origins.forget();
    expect(origins.note({ lat: 44.4268, lng: 26.1025 })).toBe(true);
  });
});

describe("clear address", () => {
  it("returns the selection to first open, keeping mode, pace and time", () => {
    const h = harness(RESOLVED);
    h.controller.clear();
    expect(h.selRef.current).toMatchObject({
      status: "idle",
      label: null,
      lastSelection: null,
      departure: null,
      mode: "transit",
      pace: "slow",
    });
  });

  it("aborts the request in flight", () => {
    const h = harness(RESOLVED);
    const inFlight = h.abortRef.current!;
    h.controller.clear();
    expect(inFlight.signal.aborted).toBe(true);
  });

  it("forgets the last input, so a later pace or time change has nothing to re-issue", () => {
    const h = harness(RESOLVED);
    h.controller.clear();
    expect(h.pendingInputRef.current).toBeNull();
  });

  it("forgets a search buffered before the map was ready, so it is not replayed", () => {
    const h = harness(RESOLVED);
    h.controller.clear();
    expect(h.pendingSelectRef.current).toBeNull();
  });

  it("choosing the same place again afterwards counts as a new origin", () => {
    const h = harness(RESOLVED);
    expect(h.origins.note(PLACE)).toBe(true);
    h.controller.clear();
    expect(h.origins.note(PLACE)).toBe(true);
  });

  it("removes the drawn reach and marker", () => {
    const h = harness(RESOLVED);
    h.controller.clear();
    expect(h.clearSelection).toHaveBeenCalledTimes(1);
  });

  it("closes open directions", () => {
    const h = harness(RESOLVED);
    h.controller.clear();
    expect(h.closeDirections).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending suggestion request", () => {
    const h = harness(RESOLVED);
    h.controller.clear();
    expect(h.cancelSuggest).toHaveBeenCalledTimes(1);
  });

  it("empties the address field and lets the next typing suggest again", () => {
    const h = harness(RESOLVED);
    expect(h.comboRef.current.suppress).toBe(true); // the shown address never fetched
    h.controller.clear();
    expect(h.comboRef.current).toMatchObject({ query: "", suppress: false, open: false, suggestions: [] });
  });
});

describe("clear address during a recompute", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a recompute still in flight when the address is cleared never repaints the map", async () => {
    const h = harness();
    const renderSelection = vi.fn();
    const flow = createSelectFlowController({
      dispatchSel: h.dispatchSel,
      selRef: h.selRef,
      pendingInputRef: h.pendingInputRef,
      abortRef: h.abortRef,
      clearSelection: vi.fn(),
      clearAmenities: vi.fn(),
      maybeFetchAmenities: vi.fn(),
      renderSelection,
    });
    // The response ignores the abort and arrives anyway, so only the token can stop it.
    const signals: AbortSignal[] = [];
    let respond: () => void = () => {};
    vi.stubGlobal("fetch", (_url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise((resolve) => {
        respond = () =>
          resolve({ ok: true, status: 200, json: async () => ({ origin: PLACE, rings: [] }) });
      });
    });

    // A resolved place, then a mode toggle whose recompute is still loading.
    const first = flow.select({ kind: "point", ...PLACE });
    respond();
    await first;
    expect(renderSelection).toHaveBeenCalledTimes(1);
    h.dispatchSel({ type: "toggle", next: "transit" });
    const recompute = flow.select({ kind: "point", ...PLACE }, { recompute: true });
    expect(h.selRef.current.status).toBe("loading");
    expect(h.selRef.current.lastSelection).not.toBeNull(); // so the ✕ is on screen

    h.controller.clear();
    respond();
    await recompute;

    expect(signals.at(-1)?.aborted).toBe(true);
    expect(renderSelection).toHaveBeenCalledTimes(1); // only the first place was ever drawn
    expect(h.selRef.current).toMatchObject({ status: "idle", lastSelection: null, label: null });
  });
});
