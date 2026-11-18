import { type Pace } from "@/features/isochrones/pace";
import { type TimeContext } from "@/features/isochrones/time-context";
import {
  effectivePace,
  isochroneUrl,
  reverseIsFatal,
  type CarMeta,
  type Mode,
  type Origin,
  type Ring,
  type SelectInput,
  type SelectionAction,
  type SelectionState,
} from "@/features/map/selection-flow";

interface GeoPoint {
  lat: number;
  lng: number;
  label: string;
}

/** The resolved departure instant — only for transit, only when the server
 * echoed a departure ISO. Walk and car selections carry null (cleared). */
function departureInfo(mode: Mode, departureIso: string | undefined): { iso: string } | null {
  if (mode !== "transit" || !departureIso) return null;
  return { iso: departureIso };
}

/** The honest car-reach basis echoed by /api/car — only for car
 * selections that actually returned it; walk/transit carry null (cleared). */
function carInfo(mode: Mode, car: CarMeta | undefined): CarMeta | null {
  if (mode !== "car" || !car) return null;
  return { basis: "estimate", slotId: car.slotId, slotLabel: car.slotLabel };
}

/** A map click's label until (or unless) the reverse geocode names the place. */
export const FALLBACK_LABEL = "Punct pe hartă";

interface IsoResponse {
  origin: Origin;
  rings: Ring[];
  departure?: string;
  car?: CarMeta;
}

/**
 * The selection orchestrator: resolves an address
 * (search / picked suggestion / map click) into an origin + label, then fetches
 * the isochrone in parallel with amenities, guarding every await against a
 * superseded run via the reducer's token. Invariants preserved verbatim:
 *  - the travel **mode is captured ONCE at entry** (`selRef.current.mode`) and
 *    threaded through the whole run, so a mid-flight toggle can't split this
 *    response's endpoint/colors/legend;
 *  - a map click's reverse 422 is **fatal** — no rings, no amenities (out of
 *    area); reverse ∥ isochrone so the label RTT never blocks ring start;
 *  - amenity markers **never** render without rings (every failed reach clears
 *    amenities); a mode/time recompute CHANGES the amenity fetch key, so
 *    it clears and refetches rather than preserving the markers (the clip is that
 *    mode's reach area). A recompute that lands on the same key still keeps them.
 *  - the origin pin goes up as soon as the origin is known and before the reach
 *    request: at once for a map click or a picked suggestion, after the geocode
 *    (and its staleness check) for a typed search. It pulses while the reach
 *    loads; a failed geocode or a superseded run pins nothing.
 * The mode/endpoint decision (`isochronePath`) and the fatal-reverse rule
 * (`reverseIsFatal`) are pure and unit-tested in selection-flow.
 */
export function createSelectFlowController({
  dispatchSel,
  selRef,
  pendingInputRef,
  abortRef,
  clearSelection,
  clearAmenities,
  maybeFetchAmenities,
  renderSelection,
  showOrigin,
}: {
  dispatchSel: (action: SelectionAction) => SelectionState;
  selRef: { current: SelectionState };
  pendingInputRef: { current: SelectInput | null };
  abortRef: { current: AbortController | null };
  clearSelection: () => void;
  clearAmenities: () => void;
  maybeFetchAmenities: (origin: Origin, pace: Pace, mode: Mode, timeContext: TimeContext) => void;
  renderSelection: (origin: Origin, label: string, rings: Ring[], mode: Mode) => void;
  /** Places (or moves) the origin pin while the reach loads: no reach, no camera move. */
  showOrigin: (origin: Origin, mode: Mode) => void;
}) {
  async function select(input: SelectInput, opts?: { recompute?: boolean }) {
    // Record the input so a pace/time change before this resolves can re-issue
    // it (finding G). A recompute re-issues an already-tracked input.
    pendingInputRef.current = input;
    // Snapshot the mode ONCE (from the selection machine) so this response's
    // endpoint, colors, legend and data-mode all agree even if the user toggles
    // mid-flight; `start` bumps the token that guards staleness. A toggle-driven
    // recompute preserves lastSelection so a further toggle before it resolves
    // can still recover the origin.
    const mode = selRef.current.mode;
    // Snapshot pace + departure context ONCE alongside mode (same staleness
    // guarantee): this response's rings, amenity radius and departure copy all
    // agree even if the user changes pace/time mid-flight. Pace is passed through
    // `effectivePace` so a non-walk request is Normal even if the user left a
    // Slow pace set in Walk (single source for isochrone
    // URL AND amenity fetch, which is why it lives at this one snapshot point).
    const pace = effectivePace(mode, selRef.current.pace);
    const timeContext = selRef.current.timeContext;
    const { token } = dispatchSel({ type: "start", mode, preserveLast: opts?.recompute });
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    const stale = () => token !== selRef.current.token;

    clearSelection(); // drop the previous marker/rings the moment a new selection starts
    // A genuinely-new selection drops the old amenities immediately. A RECOMPUTE
    // (mode/pace/time change) does not clear here — `maybeFetchAmenities` clears only
    // when the fetch key actually changes, so a recompute that lands on the same key
    // keeps its markers, while one that changes the clip drops them before the new
    // request. A mode toggle does not blanketly leave them in place: the clip follows
    // the mode, so those markers would describe an area the user is no longer looking at.
    if (!opts?.recompute) clearAmenities();

    try {
      // Resolve the origin (what the isochrone + marker use) and its label.
      let origin: Origin;
      let label: string;

      if (input.kind === "search") {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(input.query)}`, { signal });
        if (stale()) return;
        if (!res.ok) return void dispatchSel({ type: "failed", token, stage: "geocode", httpStatus: res.status });
        const point = (await res.json()) as GeoPoint;
        origin = { lat: point.lat, lng: point.lng };
        label = point.label;
      } else if (input.kind === "point") {
        // A picked autocomplete suggestion: point + label already resolved — go
        // straight to the isochrone, NO geocode/reverse round-trip.
        origin = { lat: input.lat, lng: input.lng };
        label = input.label;
      } else {
        // A map click: the origin IS the clicked point (not a reverse-geocoded
        // centroid); reverse geocoding only supplies the human-readable label.
        // Reverse and isochrone run in parallel so label RTT no longer blocks
        // ring start. Out-of-area (422) is still fatal: no amenities/rings.
        origin = { lat: input.lat, lng: input.lng };
        label = FALLBACK_LABEL;
        showOrigin(origin, mode);
        const reverseUrl = `/api/reverse?lat=${input.lat}&lng=${input.lng}`;
        const isoUrl = isochroneUrl(mode, origin, pace, timeContext);
        const [revRes, isoRes] = await Promise.all([
          fetch(reverseUrl, { signal }),
          fetch(isoUrl, { signal }),
        ]);
        if (stale()) return;
        if (reverseIsFatal(revRes.status)) {
          // Do not paint rings or fetch amenities for out-of-area clicks.
          clearAmenities();
          return void dispatchSel({ type: "failed", token, stage: "reverse", httpStatus: revRes.status });
        }
        if (revRes.ok) {
          try {
            const body = (await revRes.json()) as { label?: unknown };
            if (typeof body.label === "string" && body.label.trim()) label = body.label;
          } catch {
            /* keep the fallback label */
          }
        }
        // Amenities only after reverse is known non-fatal (422 must not start ORS/PostGIS).
        if (stale()) return; // a newer selection landed during revRes.json()
        maybeFetchAmenities(origin, pace, mode, timeContext);
        if (!isoRes.ok) {
          clearAmenities();
          return void dispatchSel({ type: "failed", token, stage: "isochrone", httpStatus: isoRes.status });
        }
        const iso = (await isoRes.json()) as IsoResponse;
        if (stale()) return;
        dispatchSel({ type: "resolved", token, origin: iso.origin, label, departure: departureInfo(mode, iso.departure), car: carInfo(mode, iso.car) });
        renderSelection(iso.origin, label, iso.rings, mode);
        return;
      }

      // Search / suggestion paths: origin is known; amenities ∥ isochrone.
      if (stale()) return; // a newer selection landed during geocode res.json()
      showOrigin(origin, mode);
      maybeFetchAmenities(origin, pace, mode, timeContext);

      const isoRes = await fetch(isochroneUrl(mode, origin, pace, timeContext), { signal });
      if (stale()) return;
      if (!isoRes.ok) {
        // Invariant: amenity markers never render without rings. The rings were
        // already dropped when this run started (clearSelection above), so a
        // failed reach — fresh selection OR toggle recompute — clears the
        // amenities too; a recompute back will refetch (server-cached).
        clearAmenities();
        return void dispatchSel({ type: "failed", token, stage: "isochrone", httpStatus: isoRes.status });
      }
      const iso = (await isoRes.json()) as IsoResponse;
      if (stale()) return;

      // Fresh (stale() just checked): accept and paint. Reducer records the
      // isochrone's rounded origin so a mode toggle recomputes the same point.
      dispatchSel({ type: "resolved", token, origin: iso.origin, label, departure: departureInfo(mode, iso.departure), car: carInfo(mode, iso.car) });
      renderSelection(iso.origin, label, iso.rings, mode);
    } catch (err) {
      if ((err as Error)?.name === "AbortError" || stale()) return;
      clearAmenities(); // same invariant as the failed-reach branch above
      dispatchSel({ type: "crash", token });
    }
  }

  return {
    select,
    dispose() {
      abortRef.current?.abort();
    },
  };
}

export type SelectFlowController = ReturnType<typeof createSelectFlowController>;
