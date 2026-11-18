/**
 * Pure PRESET reach render model (phone-first).
 *
 * PARALLEL + ADDITIVE to `isochrone-view.ts`'s legacy fixed-3-band render (walk/transit
 * 15/30/45, car 10/20/30). The legacy path is left byte-identical — this module drives the
 * `?model=preset` phone-first render only: the continuous per-mode light→dark reach
 * gradient over the CALIBRATED preset contours (walk 10/20, transit 20/40,
 * car 10/25) that the `?model=preset` serving path returns.
 *
 * HONESTY — the render-midpoint rule. Only TWO
 * calibrated contours exist per mode, NOT a per-minute time field. So:
 *   - the gradient FILL is a set of DECORATIVE shells (the served outer polygon scaled toward
 *     the origin at `PRESET_SHELL_STEPS` steps, colour-ramped). They carry NO minute label and
 *     claim nothing — pure "sooner→later" texture (a fill layer cannot paint an intra-polygon
 *     time ramp: `["get","fillColor"]` is constant per feature, so the ramp is built from many
 *     flat shells, not one gradient);
 *   - the ONLY honest interior line sits at the smaller CALIBRATED preset (`presetContourMinutes`
 *     minus the selection), and the outer edge line is the selected preset. Those two LINES are
 *     the world-claim; the shells are decoration.
 *
 * Pure (no MapLibre / no `window`), so the colour + geometry decisions are unit-testable
 * without a map — the imperative `setData`/layer calls live in the map controllers.
 */

import { difference } from "@turf/difference";
import { featureCollection } from "@turf/helpers";

import { presetContourMinutes, type Mode } from "@/features/isochrones/preset-reach";
import type { Origin, Ring } from "@/features/map/selection-flow";

/** Per-mode gradient stops, light (0′, at the origin) → mid → dark (the selected-time edge).
 * The phone-first design's per-mode ramp. `line` is the crisp contour-line colour (a light ramp tint that
 * reads as "figure" on the translucent fill). Exhaustive `Record<Mode,…>` so a new mode is a
 * compile error rather than a silent inherit. */
export const PRESET_GRADIENT_STOPS: Record<Mode, { origin: string; mid: string; edge: string; line: string }> = {
  walk: { origin: "#a7f3e6", mid: "#2dd4bf", edge: "#0a4f49", line: "#5eead4" },
  transit: { origin: "#ddd6fe", mid: "#a78bfa", edge: "#3f1673", line: "#c4b5fd" },
  car: { origin: "#bfdbfe", mid: "#3b82f6", edge: "#16307a", line: "#93c5fd" },
};

/** Decorative shells origin→edge. 8 reads as a smooth ramp at the fill opacity used on the
 * map (≈0.16, below the legacy 0.2 so the stacked shells don't bury the basemap) without a
 * per-frame cost — the shells are static GeoJSON the GPU pans/zooms for free. */
export const PRESET_SHELL_STEPS = 8;

/** MapLibre source + layer ids for the preset render (additive — distinct from `iso-*`). */
export const PRESET_FILL_SOURCE = "preset-reach-fill";
export const PRESET_LINE_SOURCE = "preset-reach-line";
export const PRESET_FILL_LAYER = "preset-reach-fill";
export const PRESET_EDGE_LAYER = "preset-reach-edge";
export const PRESET_INTERIOR_LAYER = "preset-reach-interior";
export const PRESET_LABEL_LAYER = "preset-reach-label";
/** The reach fill's opacity for a mode. Transit reads lighter: its shells already stack over a
 * wider area, so the same 0.16 would bury the basemap. */
export function presetFillOpacity(mode: Mode): number {
  return mode === "transit" ? 0.1 : 0.16;
}
export const PRESET_LINE_OPACITY = 0.95;

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function rgbToHex(rgb: [number, number, number]): string {
  return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

/**
 * The decorative ramp colour at fraction `f` (0 = origin/soonest, 1 = edge/farthest),
 * piecewise origin→mid→edge per the per-mode ramp stops. Clamped so a stray f outside [0,1] can't
 * produce a colour off the ramp.
 */
export function presetRampColor(mode: Mode, f: number): string {
  const s = PRESET_GRADIENT_STOPS[mode];
  const t = Math.max(0, Math.min(1, f));
  return t < 0.5 ? lerpHex(s.origin, s.mid, t / 0.5) : lerpHex(s.mid, s.edge, (t - 0.5) / 0.5);
}

/** A GeoJSON coordinate position `[lng, lat, …]`. */
type Position = number[];

/** Scale one position toward `origin` by factor `t` (t=1 keeps it, t→0 collapses to origin). */
function scalePosition(pos: Position, origin: Origin, t: number): Position {
  const [lng, lat, ...rest] = pos;
  return [origin.lng + (lng! - origin.lng) * t, origin.lat + (lat! - origin.lat) * t, ...rest];
}

/**
 * Scale a Polygon / MultiPolygon geometry toward `origin` by factor `t`. Returns a NEW
 * geometry (never mutates the served ring). Non-polygonal geometry is returned unchanged —
 * the ORS reach is always Polygon/MultiPolygon, but a caller must not crash on a surprise.
 */
export function scaleGeometryTowardOrigin(geometry: unknown, origin: Origin, t: number): GeoJSON.Geometry {
  const g = geometry as GeoJSON.Geometry;
  if (g && g.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: g.coordinates.map((ring) => ring.map((p) => scalePosition(p, origin, t))),
    };
  }
  if (g && g.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: g.coordinates.map((poly) => poly.map((ring) => ring.map((p) => scalePosition(p, origin, t)))),
    };
  }
  return g;
}

/**
 * The served ring for the SELECTED preset minute (the outer edge of the drawn reach), and the
 * nested CALIBRATED interior contour minutes below it (the smaller preset(s)). The route serves
 * ALL preset contours regardless of selection (walk → [10,20]); the chip is pure client-side
 * visibility — so selecting 10 draws the 10-min ring with no interior line, selecting 20 draws
 * the 20-min ring with the 10-min interior line. Throws (via `presetContourMinutes`) on a minute
 * that is not a selectable preset, and returns `null` if the served set is missing that ring
 * (a drifted server contract — the caller renders nothing rather than a mislabelled reach).
 */
export function selectPresetRings(
  rings: Ring[],
  mode: Mode,
  selectedMin: number,
): { outer: Ring; interiorMinutes: number[]; interiorRings: Ring[] } | null {
  const contour = presetContourMinutes(mode, selectedMin); // e.g. selected 20 → [10,20]
  const byMinute = new Map(rings.map((r) => [r.minutes, r]));
  const outer = byMinute.get(selectedMin);
  if (!outer) return null;
  const interiorMinutes = contour.filter((m) => m < selectedMin);
  const interiorRings: Ring[] = [];
  for (const m of interiorMinutes) {
    const r = byMinute.get(m);
    if (!r) return null; // a calibrated interior contour is missing — do not fake it
    interiorRings.push(r);
  }
  return { outer, interiorMinutes, interiorRings };
}

type Poly = GeoJSON.Polygon | GeoJSON.MultiPolygon;

function asPolyFeature(geom: GeoJSON.Geometry | undefined): GeoJSON.Feature<Poly> | null {
  if (geom && (geom.type === "Polygon" || geom.type === "MultiPolygon")) {
    return { type: "Feature", properties: {}, geometry: geom as Poly };
  }
  return null;
}

/** `a − b` (turf difference), null-safe: returns `a` when `b` is null, `null` when `a` is fully
 * consumed, and — on degenerate geometry that makes turf throw — falls back to `a` rather than
 * crash the render (a slightly-imperfect decorative shell beats a blank map). */
function diffPoly(a: GeoJSON.Feature<Poly>, b: GeoJSON.Feature<Poly> | null): GeoJSON.Feature<Poly> | null {
  if (!b) return a;
  try {
    return difference(featureCollection([a, b])) as GeoJSON.Feature<Poly> | null;
  } catch {
    return a;
  }
}

/** `a ∩ outer`, computed as `a − (a − outer)` (turf ships no intersect at this version). null when
 * the intersection is empty — so a scaled shell that lands entirely OUTSIDE the served reach (the
 * non-star / detached-component case a naive homothety produces) contributes nothing. */
function clipToOuter(a: GeoJSON.Feature<Poly>, outer: GeoJSON.Feature<Poly>): GeoJSON.Feature<Poly> | null {
  const outsidePart = diffPoly(a, outer); // the part of `a` that pokes outside the served reach
  if (outsidePart === null) return a; // `a` is already fully within `outer`
  return diffPoly(a, outsidePart); // a − (a − outer) = a ∩ outer
}

/**
 * Decorative shell FILL features for the selected preset — a CLIPPED, ANNULAR set so the ramp
 * reads as a smooth "sooner→later" texture WITHOUT the two defects a naive homothety has:
 *   - each shell is `ring_i = scale(outer, i/N) ∩ outer`, so it can never spill past the served
 *     reach (a homothety of a concave / multi-part isochrone is NOT contained in the original;
 *     without the clip a detached far component would paint fill over unreachable
 *     ground and overstate reach);
 *   - the painted feature is the ANNULUS `ring_i − ring_{i-1}`, so no two features overlap and the
 *     single translucent fill layer can't composite to an opaque wash at the origin (8 nested
 *     full fills at 0.16 stack to ≈0.75 there). Union of the annuli = the outer
 *     reach, painted at one uniform opacity, lightest at the origin.
 * The shells carry NO minute label and claim nothing (only the calibrated contour LINES are a
 * claim) — pure decoration, honest by construction.
 */
export function buildPresetShellFeatures(
  rings: Ring[],
  mode: Mode,
  selectedMin: number,
  origin: Origin,
): GeoJSON.Feature[] {
  const sel = selectPresetRings(rings, mode, selectedMin);
  if (!sel) return [];
  const outerFeat = asPolyFeature(sel.outer.geometry as GeoJSON.Geometry);
  if (!outerFeat) return [];
  // ring_i = scale(outer, i/N) clipped to the served reach; ring_N is the served outer itself.
  const ring: (GeoJSON.Feature<Poly> | null)[] = [];
  for (let i = 1; i <= PRESET_SHELL_STEPS; i++) {
    if (i === PRESET_SHELL_STEPS) {
      ring.push(outerFeat);
      continue;
    }
    const scaled = asPolyFeature(scaleGeometryTowardOrigin(sel.outer.geometry, origin, i / PRESET_SHELL_STEPS));
    ring.push(scaled ? clipToOuter(scaled, outerFeat) : null);
  }
  // Paint outer→inner (largest annulus first) so the source order is stable; the fill layer is
  // opacity-uniform so order is cosmetic. Colour: outermost annulus → edge (darkest), inner → origin.
  const features: GeoJSON.Feature[] = [];
  for (let i = PRESET_SHELL_STEPS; i >= 1; i--) {
    const outerRing = ring[i - 1];
    if (!outerRing) continue;
    const innerRing = i >= 2 ? ring[i - 2] : null;
    const annulus = diffPoly(outerRing, innerRing);
    if (!annulus) continue;
    const f = (i - 1) / (PRESET_SHELL_STEPS - 1);
    features.push({
      type: "Feature",
      properties: { fillColor: presetRampColor(mode, f), decorative: true },
      geometry: annulus.geometry,
    });
  }
  return features;
}

/**
 * Contour LINE features — the only honest world-claim in the render. One `kind:"edge"` line at
 * the selected preset (the calibrated outer reach) plus one `kind:"interior"` line per nested
 * CALIBRATED preset below it (walk 20 → a 10-min interior line; walk 10 → none). Each carries
 * its real `minutes` so a test can assert the interior line sits exactly on the calibrated
 * midpoint and nowhere else.
 */
export function buildPresetContourFeatures(rings: Ring[], mode: Mode, selectedMin: number): GeoJSON.Feature[] {
  const sel = selectPresetRings(rings, mode, selectedMin);
  if (!sel) return [];
  const line = PRESET_GRADIENT_STOPS[mode].line;
  const features: GeoJSON.Feature[] = [
    {
      type: "Feature",
      properties: { kind: "edge", minutes: selectedMin, lineColor: line },
      geometry: sel.outer.geometry as GeoJSON.Geometry,
    },
  ];
  for (const r of sel.interiorRings) {
    features.push({
      type: "Feature",
      properties: { kind: "interior", minutes: r.minutes, lineColor: line },
      geometry: r.geometry as GeoJSON.Geometry,
    });
  }
  return features;
}

/** The interior calibrated-line minutes for a selection — the render-midpoint stamp the e2e
 * read-back asserts (walk 20 → [10]; walk 10 → []; transit 40 → [20]; car 25 → [10]). */
export function presetInteriorLineMinutes(mode: Mode, selectedMin: number): number[] {
  return presetContourMinutes(mode, selectedMin).filter((m) => m < selectedMin);
}

/**
 * The honesty CAVEAT shown in the info popover, one sentence per mode (Romanian).
 * Walk and transit reaches fold in a street walk that a barrier can lengthen, so
 * near a river or rail line (walk) or at the city's edge (transit) the real trip
 * can take LONGER than the drawn reach suggests: the estimate over-reaches there,
 * it never under-reaches, so the copy never claims a trip can be shorter. The gap
 * is real (a river/rail detour adds ~10 min on foot; the transit periphery can run
 * ~30 min longer), so the copy states it plainly rather than as "a little".
 * Car has no street-walk component (0% over-claim measured on the served
 * free-flow ranges); its caveat names the assumption instead: typical traffic for
 * the chosen departure, not live traffic.
 */
export function presetReachCaveat(mode: Mode): string {
  switch (mode) {
    case "walk":
      return "Timpi estimați pe străzi. Lângă râu sau calea ferată drumul poate fi mai lung decât arată harta.";
    case "transit":
      return "Timpi după orarele publicate, cu mersul pe jos până la stații. La marginea orașului drumul poate fi mai lung decât arată harta.";
    case "car":
      return "Trafic obișnuit pentru ora aleasă, nu trafic în timp real.";
  }
}
