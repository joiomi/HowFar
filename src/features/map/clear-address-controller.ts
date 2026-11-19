import { FALLBACK_LABEL } from "@/features/map/select-flow-controller";
import type { Origin, SelectInput, SelectionAction } from "@/features/map/selection-flow";
import type { ComboboxAction } from "@/features/search/combobox";

/**
 * Remembers the origin of the last resolved selection, so the shell can tell a
 * newly chosen place (fill the address bar with its address) from a recompute of
 * the same one (mode, pace or time change: leave the address bar as it is).
 */
export function createOriginTracker() {
  let last: Origin | null = null;
  return {
    /** Records `origin`; true when it differs from the last one recorded (or none was). */
    note(origin: Origin): boolean {
      const isNew =
        last === null || Math.abs(last.lat - origin.lat) > 1e-9 || Math.abs(last.lng - origin.lng) > 1e-9;
      last = { lat: origin.lat, lng: origin.lng };
      return isNew;
    },
    forget(): void {
      last = null;
    },
  };
}

export type OriginTracker = ReturnType<typeof createOriginTracker>;

/**
 * What the address field shows across selection runs. It names the place being
 * drawn or asked for, never another one, since no card names the place.
 * - A fresh selection (a typed search, a picked suggestion, a map tap, my
 *   location, a dragged pin) is a new place even at the last one's coordinates,
 *   so its resolved address always replaces the field, whatever a failed attempt
 *   left there.
 * - Until it resolves, and if it fails, the field shows what was asked for: the
 *   typed query or the picked suggestion (already in the field), or "Punct pe
 *   hartă" for a point chosen on the map.
 * - A recompute (mode, pace or time change, ↻) of the place on screen leaves the
 *   field as it is, so typing in progress survives it; one that resolves with
 *   nothing resolved before it (a first search whose reach failed) shows the
 *   address.
 * Pure over the origin tracker and the combobox dispatch.
 */
export function createAddressField({
  origins,
  dispatchCombo,
}: {
  origins: OriginTracker;
  dispatchCombo: (action: ComboboxAction) => unknown;
}) {
  return {
    /** A fresh selection (not a recompute) started. */
    freshStart(input: SelectInput): void {
      origins.forget();
      if (input.kind === "click") dispatchCombo({ type: "showLabel", label: FALLBACK_LABEL });
    },
    /** A selection resolved at `origin`. */
    resolved(origin: Origin, label: string): void {
      if (origins.note(origin)) dispatchCombo({ type: "showLabel", label });
    },
  };
}

/**
 * The address bar's ✕: returns the shell to first open while keeping the mode,
 * pace and time the user set. Pure orchestration over injected callbacks (no
 * MapLibre, no DOM); the drawn reach, the directions and the suggest timer are
 * reached only through the callbacks.
 */
export function createClearAddressController({
  abortRef,
  dispatchSel,
  pendingInputRef,
  pendingSelectRef,
  origins,
  clearSelection,
  closeDirections,
  cancelSuggest,
  dispatchCombo,
}: {
  abortRef: { current: AbortController | null };
  dispatchSel: (action: SelectionAction) => unknown;
  /** The last user input, re-issued by a pace/time change before anything resolved. */
  pendingInputRef: { current: SelectInput | null };
  /** A search made before the map engine loaded, replayed once it has. */
  pendingSelectRef: { current: SelectInput | null };
  origins: OriginTracker;
  /** Removes the marker, the drawn reach and the reach stash. */
  clearSelection: () => void;
  closeDirections: () => void;
  cancelSuggest: () => void;
  dispatchCombo: (action: ComboboxAction) => unknown;
}) {
  function clear() {
    // Stop the request in flight; the reducer's token bump also rejects its
    // response if it still arrives.
    abortRef.current?.abort();
    dispatchSel({ type: "clear" });
    // Nothing is left to re-issue on a pace/time change, or to replay at map ready.
    pendingInputRef.current = null;
    pendingSelectRef.current = null;
    // Choosing the same place again is then a new origin, like any first selection.
    origins.forget();
    clearSelection();
    closeDirections();
    cancelSuggest();
    dispatchCombo({ type: "queryChanged", value: "" });
  }
  return { clear };
}
