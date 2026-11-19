import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import type { Feature, MultiPolygon, Polygon } from "geojson";

import type { ReachLeg, ReachPlan, ReachPoint } from "@/features/isochrones/server/transit-plan";

/**
 * Pure helpers for the right-click "how do I get there?" directions (public-transport only): client-side reachability banding
 * (point-in-polygon on the SAME transit rings the map drew) and the display
 * formatting of a MOTIS trip into human steps and step chips. Kept pure +
 * unit-tested so the directions controller only does DOM + fetch.
 */

interface RingLike {
  minutes: number;
  geometry: unknown;
}

/**
 * The smallest-minutes ring whose polygon contains `point` ([lng, lat]), or null
 * if none does. Runs against the rings the client already rendered (post speck
 * filter, post walk-union, at the displayed pace), so the answer can never
 * disagree with what the user sees. Bad/empty geometry is
 * skipped, not thrown.
 */
export function reachBand(point: [number, number], rings: RingLike[]): number | null {
  const ascending = [...rings].sort((a, b) => a.minutes - b.minutes);
  for (const ring of ascending) {
    const geometry = ring.geometry as Polygon | MultiPolygon | undefined;
    const coords = (geometry as { coordinates?: unknown })?.coordinates;
    if (!geometry || !Array.isArray(coords) || coords.length === 0) continue;
    try {
      const feature: Feature<Polygon | MultiPolygon> = { type: "Feature", properties: {}, geometry };
      if (booleanPointInPolygon(point, feature)) return ring.minutes;
    } catch {
      // Degenerate geometry — treat as "not in this band" and keep scanning.
    }
  }
  return null;
}

/** A leg's MOTIS mode in upper case: the one form every mode check here
 * compares, whatever case the plan used. */
export function legMode(leg: Pick<ReachLeg, "mode">): string {
  return leg.mode.toUpperCase();
}

/** Every MOTIS rail mode: each reads "Tren" and draws a train. */
const TRAIN_MODES = new Set(["RAIL", "REGIONAL_RAIL", "REGIONAL_FAST_RAIL", "LONG_DISTANCE", "SUBURBAN", "HIGHSPEED_RAIL", "NIGHT_RAIL"]);

const MODE_LABELS: Record<string, string> = {
  WALK: "Pe jos",
  BUS: "Autobuz",
  TRAM: "Tramvai",
  SUBWAY: "Metrou",
  METRO: "Metrou",
  COACH: "Autocar",
  FERRY: "Feribot",
  TROLLEYBUS: "Troleibuz",
};

/** Romanian label for a MOTIS mode (e.g. SUBWAY → "Metrou", any rail mode →
 * "Tren"). Any other mode reads "Transport public": never a raw enum. */
export function transitModeLabel(mode: string): string {
  const m = legMode({ mode });
  if (TRAIN_MODES.has(m)) return "Tren";
  return MODE_LABELS[m] ?? "Transport public";
}

/** MOTIS uses "START"/"END" for the trip endpoints; give them human names. */
function stopLabel(name: string): string {
  if (name === "END" || name === "") return "destinație";
  if (name === "START") return "punctul de plecare";
  return name;
}

/**
 * What a right-click asks the directions controller to render (always
 * public transport). Built in AppMap (which holds the selection + stashed rings)
 * and consumed by the controller (DOM + the `/api/reach` fetch). `transit`
 * carries a ready-built URL; `band` is the transit reach ceiling the trip time is
 * framed against (the point's ring band when known, else the 45-min transit max —
 * always a number, so the honesty copy never renders "undefined").
 */
export type ReachRequest =
  | { kind: "hint"; coords: [number, number] }
  | { kind: "transit"; coords: [number, number]; band: number; url: string };

/** A trip step: two lines of untrusted text, rendered as React text nodes. */
export interface ReachStep {
  primary: string;
  secondary: string;
}

/**
 * Format a planned trip's legs into display steps. WALK legs read "Pe jos N min /
 * până la <place>"; transit legs read "<Mode> <line> → <headsign> / Urcă la
 * <stop> → coboară la <stop> · N min". Untrusted OSM names/headsigns are
 * returned as plain strings and MUST be rendered as text by the caller (never
 * innerHTML).
 */
export function buildReachSteps(legs: ReachLeg[]): ReachStep[] {
  return legs.map((leg) => {
    if (legMode(leg) === "WALK") {
      return { primary: `Pe jos ${leg.minutes} min`, secondary: `până la ${stopLabel(leg.toName)}` };
    }
    const label = transitModeLabel(leg.mode);
    const line = leg.line ? ` ${leg.line}` : "";
    const headsign = leg.headsign ? ` → ${leg.headsign}` : "";
    return {
      primary: `${label}${line}${headsign}`,
      // Show BOTH endpoints — the rider needs to know where to get off, not only
      // where to board.
      secondary: `Urcă la ${stopLabel(leg.fromName)} → coboară la ${stopLabel(leg.toName)} · ${leg.minutes} min`,
    };
  });
}

/** The icon a step chip carries. */
export type StepIcon = "walk" | "metro" | "bus" | "tram" | "train";

/**
 * A step as one compact chip in the directions sheet: an icon and a short text
 * (the walk minutes, or the line), coloured by `tone` — the metro has its own
 * colour, every other vehicle shares the surface one, walking is neutral. The
 * full step stays in the chip's accessible name.
 */
export interface StepChip {
  icon: StepIcon;
  text: string;
  tone: "walk" | "metro" | "surface";
}

/**
 * The chip for one leg. WALK shows its minutes; SUBWAY/METRO shows its line, or
 * "M" without one; TRAM draws a tram, every rail mode a train, and any other
 * vehicle a bus, each showing its line, or its minutes without one.
 */
export function stepChip(leg: ReachLeg): StepChip {
  const mode = legMode(leg);
  if (mode === "WALK") return { icon: "walk", text: String(leg.minutes), tone: "walk" };
  if (mode === "SUBWAY" || mode === "METRO") return { icon: "metro", text: leg.line || "M", tone: "metro" };
  const icon: StepIcon = mode === "TRAM" ? "tram" : TRAIN_MODES.has(mode) ? "train" : "bus";
  return { icon, text: leg.line || `${leg.minutes} min`, tone: "surface" };
}

/** Transit classification (does this plan deserve the public-transport
 * treatment — draw, declutter, "Cu transportul public" copy) is shared with the
 * server, which picks its cache TTL by the same rule: see
 * `features/isochrones/transit-classify.ts`. Re-exported so existing consumers
 * keep one import site. */
export { hasTransitLeg } from "@/features/isochrones/transit-classify";

// --- Drawable journey model ------------------------------------
// Pure derivation of what the map draws for a right-click transit journey: the
// leg lines and the stops the rider actually uses (board → transfer(s) →
// alight). Kept here (unit-tested) rather than in the coverage-excluded draw
// controller (the classification must have a pure home). The step
// list from `buildReachSteps` is 1:1 with `legs`, so a step chip's index maps
// straight to `journeyLegs(...).index` for the hover→highlight link.

export type ReachStopKind = "board" | "transfer" | "alight";

/** A stop the rider uses, in journey order. `legIndex` is the transit leg that
 * touches it (its board leg; for a same-stop transfer, the earlier leg). */
export interface ReachJourneyStop {
  lat: number;
  lng: number;
  name: string;
  kind: ReachStopKind;
  legIndex: number;
}

/** A leg to draw as a line: its coordinates (the decoded `path`, or a straight
 * from→to fallback when the path was empty/budget-dropped so a transfer/egress
 * is never silently missing), whether it is a walking leg (for dashed styling),
 * and its index in the `legs` array (== step chip index). */
export interface ReachJourneyLeg {
  index: number;
  isWalk: boolean;
  coords: [number, number][];
}

function coincident(a: ReachPoint, b: ReachPoint): boolean {
  // ~1e-6° ≈ 0.1 m: a genuine platform transfer shares the exact stop node, a
  // walk-transfer lands metres away — this separates the two.
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;
}

function betterName(a: string, b: string): string {
  // Prefer a real stop name over the trip-endpoint sentinels / empty.
  const bad = (n: string) => n === "" || n === "START" || n === "END";
  if (bad(a)) return bad(b) ? a : b;
  return a;
}

/** Draw model for each leg: real path when present, else a straight from→to
 * segment; legs with no usable coords at all are dropped. Index preserved. */
export function journeyLegs(legs: ReachLeg[]): ReachJourneyLeg[] {
  const out: ReachJourneyLeg[] = [];
  legs.forEach((leg, index) => {
    let coords: [number, number][] = Array.isArray(leg.path) && leg.path.length >= 2 ? leg.path : [];
    if (coords.length < 2 && leg.from && leg.to) {
      coords = [
        [leg.from.lng, leg.from.lat],
        [leg.to.lng, leg.to.lat],
      ];
    }
    if (coords.length >= 2) out.push({ index, isWalk: legMode(leg) === "WALK", coords });
  });
  return out;
}

/**
 * The stops the rider actually uses, in order: the board + alight of every
 * TRANSIT leg, deduped ONLY when the alight of one leg and the board of the next
 * are the exact same node (a platform transfer) — a walk-transfer between
 * distinct stops keeps BOTH (so dot count is 2·transfers+2 there, not the naive
 * transfers+2). First = board, last = alight, the rest = transfer.
 */
export function journeyStops(legs: ReachLeg[]): ReachJourneyStop[] {
  type Raw = { pt: ReachPoint; name: string; legIndex: number };
  const raw: Raw[] = [];
  legs.forEach((leg, index) => {
    if (legMode(leg) === "WALK") return; // only vehicle legs contribute used stops
    if (leg.from) raw.push({ pt: leg.from, name: leg.fromName, legIndex: index });
    if (leg.to) raw.push({ pt: leg.to, name: leg.toName, legIndex: index });
  });
  // Collapse a consecutive coincident alight→board pair into one transfer node.
  const merged: Raw[] = [];
  for (const r of raw) {
    const prev = merged[merged.length - 1];
    if (prev && coincident(prev.pt, r.pt)) {
      prev.name = betterName(prev.name, r.name);
      continue;
    }
    merged.push({ ...r });
  }
  return merged.map((r, i) => ({
    lat: r.pt.lat,
    lng: r.pt.lng,
    name: r.name,
    legIndex: r.legIndex,
    kind: i === 0 ? "board" : i === merged.length - 1 ? "alight" : "transfer",
  }));
}

/** One-line trip summary: "~57 min · 1 schimbare" ("fără schimbări", "N schimbări"). */
export function reachSummary(plan: Extract<ReachPlan, { reachable: true }>): string {
  const t = plan.transfers;
  const transfers = t === 0 ? "fără schimbări" : t === 1 ? "1 schimbare" : `${t} schimbări`;
  return `~${plan.totalMinutes} min · ${transfers}`;
}

