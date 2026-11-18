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
