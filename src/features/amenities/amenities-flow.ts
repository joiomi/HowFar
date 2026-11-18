/**
 * Pure decision helpers for the client-side amenities fetch, split out of
 * `AppMap` so the race-sensitive rule is unit-testable (flow decisions live in
 * the owning feature root, not the component).
 *
 * **Amenities describe the reach area of the CURRENT mode, not just an address.**
 * Keying them by the rounded origin alone (plus pace) would not work: the clip is
 * the reach area of the current mode at the current departure/traffic context, so a
 * Walk↔Transit toggle changes which places are in range. The identity has to
 * include mode and the time context, and a toggle MUST refetch.
 *
 * `originKey` rounds to 5 decimals so the key computed from a pre-round geocode
 * result matches the one from the isochrone's already-rounded origin.
 */

import { effectivePace, type Mode } from "@/features/map/selection-flow";
import type { Pace } from "@/features/isochrones/pace";
import type { TimeContext } from "@/features/isochrones/time-context";

/** Stable identity of an origin for "same address?" comparison (5-decimal round,
 * matching the server's `roundCoord`). */
export function originKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

/**
 * Identity of an amenity FETCH — everything that changes which places are in range.
 *
 * Origin + mode + the pace that mode actually uses + (for the time-aware modes) the
 * departure context. `effectivePace` is reused rather than re-encoded so a Slow pace
 * left over from Walk cannot make a transit key differ from the transit request the
 * server will serve.
 *
 * **The ring filter is deliberately NOT part of this.** All three bands are fetched
 * once and band visibility is applied client-side, so widening or narrowing the rings
 * is instant and costs no request — the same reasoning that keeps all three ring
 * geometries in one provider response.
 *
 * **The time context is keyed by PRESET id, not by the resolved departure**, even
 * though the server's cache key uses the resolved ISO. Following the resolved value
 * would make a tab left open across the weekly strictly-future roll refetch, but that
 * is not needed: rings and
 * amenities are fetched by the SAME select flow (`select-flow-controller` calls
 * `maybeFetchAmenities` on every resolve, including recomputes), and every recompute
 * trigger — mode, pace, time — also changes this key. So there is no path that
 * refreshes the rings while leaving the markers stale; a week-old tab holds a
 * week-old ring AND a week-old marker set, which is consistent. Keying on the
 * resolved departure is also not cleanly possible here: it arrives on the isochrone
 * response, which lands *after* the amenity fetch starts.
 */
export function amenityFetchKey(params: {
  origin: { lat: number; lng: number };
  mode: Mode;
  pace: Pace;
  timeContext: TimeContext;
}): string {
  const { origin, mode, pace, timeContext } = params;
  const paceForMode = effectivePace(mode, pace);
  return `${originKey(origin.lat, origin.lng)}:${mode}:${paceForMode}:${timeContext.preset}`;
}

/** True when a resolved origin is a genuinely-new address (⇒ fetch amenities).
 * The same origin (e.g. a mode toggle's recompute) returns false ⇒ persist. */
export function isNewAmenityOrigin(currentKey: string | null, nextKey: string): boolean {
  return currentKey !== nextKey;
}

/** Automatic retries per user-visible attempt. One is enough for a transient
 * ORS, database connection, or catalogue cutover failure; more would keep the
 * panel behind a spinner without improving deterministic empty/error states. */
export const AMENITY_MAX_AUTO_RETRIES = 1;

/** Delay before the automatic retry. Long enough for a briefly-saturated
 * provider to breathe, short enough that the panel still feels responsive. */
export const AMENITY_RETRY_DELAY_MS = 1500;

/**
 * True when a failed amenity fetch is worth retrying (automatically or via the
 * Retry button): transient provider failures only. `null` = the request never
 * completed (network drop / fetch TypeError) — transient. 5xx = upstream
 * provider trouble (the 502 all-hosts-failed race) — transient. Anything else
 * (422 out-of-area, other 4xx, a completed 200 with a malformed body) is
 * deterministic for this origin: retrying would re-fail identically.
 */
export function isRetryableAmenityFailure(httpStatus: number | null): boolean {
  return httpStatus === null || httpStatus >= 500;
}

/**
 * What a failed amenity fetch attempt should do: schedule one more automatic
 * `retry` (transient failure, attempts left) or `surface` the error to the user
 * (deterministic failure, or the auto-retry budget is spent). Extracted from
 * `AppMap`'s `failWith` so the retry-vs-surface decision is unit-tested; the
 * component keeps only the timer/abort plumbing around this verdict. Surfacing
 * also clears the origin key so Retry / a toggle recompute can refetch.
 */
export function classifyAmenityFailure(
  httpStatus: number | null,
  attempt: number,
  maxRetries: number = AMENITY_MAX_AUTO_RETRIES,
): "retry" | "surface" {
  return isRetryableAmenityFailure(httpStatus) && attempt < maxRetries ? "retry" : "surface";
}
