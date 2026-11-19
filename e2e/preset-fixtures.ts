// Served reach fixtures for the phone UI, which asks every reach route for its calibrated
// preset: walk 10/20, public transport 20/40, car 10/25 minutes. A set that does not
// contain those minutes draws no zone, so specs that stub a reach must serve these.

export type PresetMode = "walk" | "transit" | "car";

export const PRESET_MINUTES: Record<PresetMode, readonly [number, number]> = {
  walk: [10, 20],
  transit: [20, 40],
  car: [10, 25],
};

export const BUCHAREST_ORIGIN = { lat: 44.4268, lng: 26.1025 };

type Origin = { lat: number; lng: number };

// A square zone `half` degrees either side of `origin`, as a Polygon or a MultiPolygon.
export function squareRing(minutes: number, half: number, origin: Origin = BUCHAREST_ORIGIN, multi = false) {
  const box = [
    [origin.lng - half, origin.lat - half],
    [origin.lng + half, origin.lat - half],
    [origin.lng + half, origin.lat + half],
    [origin.lng - half, origin.lat + half],
    [origin.lng - half, origin.lat - half],
  ];
  return {
    minutes,
    geometry: multi
      ? { type: "MultiPolygon", coordinates: [[box]] }
      : { type: "Polygon", coordinates: [box] },
  };
}

// The nested preset zones for `mode` around `origin`. `halves` sizes the inner and outer zone.
export function presetReach(
  mode: PresetMode,
  options: { origin?: Origin; halves?: readonly [number, number]; multi?: boolean } = {},
) {
  const origin = options.origin ?? BUCHAREST_ORIGIN;
  const halves = options.halves ?? { walk: [0.01, 0.02], transit: [0.03, 0.06], car: [0.02, 0.045] }[mode];
  const [inner, outer] = PRESET_MINUTES[mode];
  return {
    origin,
    rings: [squareRing(inner, halves[0], origin, options.multi), squareRing(outer, halves[1], origin, options.multi)],
  };
}
