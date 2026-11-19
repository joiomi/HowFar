import { describe, expect, it } from "vitest";

import type { ReachLeg, ReachPlan } from "@/features/isochrones/server/transit-plan";
import {
  buildReachSteps,
  hasTransitLeg,
  journeyLegs,
  journeyStops,
  legMode,
  reachBand,
  reachSummary,
  stepChip,
  transitModeLabel,
} from "@/features/map/reach";

// A square Polygon centred at (clng, clat), half-width halfDeg, as a ring's geometry.
function square(clat: number, clng: number, halfDeg: number) {
  return {
    type: "MultiPolygon" as const,
    coordinates: [[[
      [clng - halfDeg, clat - halfDeg],
      [clng + halfDeg, clat - halfDeg],
      [clng + halfDeg, clat + halfDeg],
      [clng - halfDeg, clat + halfDeg],
      [clng - halfDeg, clat - halfDeg],
    ]]],
  };
}
const C = { lat: 44.4268, lng: 26.1025 };

describe("reachBand", () => {
  const rings = [
    { minutes: 15, geometry: square(C.lat, C.lng, 0.005) },
    { minutes: 30, geometry: square(C.lat, C.lng, 0.01) },
    { minutes: 45, geometry: square(C.lat, C.lng, 0.02) },
  ];

  it("returns the smallest band containing the point", () => {
    expect(reachBand([C.lng, C.lat], rings)).toBe(15); // at centre → innermost
    expect(reachBand([C.lng + 0.008, C.lat], rings)).toBe(30); // outside 15, inside 30
    expect(reachBand([C.lng + 0.015, C.lat], rings)).toBe(45); // only inside 45
  });

  it("returns null when the point is outside every ring", () => {
    expect(reachBand([C.lng + 0.05, C.lat], rings)).toBeNull();
  });

  it("skips empty/degenerate ring geometry without throwing", () => {
    const withEmpty = [
      { minutes: 15, geometry: { type: "MultiPolygon", coordinates: [] } },
      { minutes: 30, geometry: square(C.lat, C.lng, 0.01) },
    ];
    expect(reachBand([C.lng, C.lat], withEmpty)).toBe(30);
    expect(reachBand([C.lng, C.lat], [{ minutes: 15, geometry: undefined }])).toBeNull();
  });

  it("is order-independent (sorts by minutes first)", () => {
    const shuffled = [rings[2], rings[0], rings[1]];
    expect(reachBand([C.lng, C.lat], shuffled)).toBe(15);
  });
});



// Leg builders for the step and chip tests.
function walk(minutes: number, fromName = "A", toName = "B"): ReachLeg {
  return { mode: "WALK", fromName, toName, minutes };
}
const leg: ReachLeg = { mode: "BUS", line: "", headsign: "", fromName: "A", toName: "B", minutes: 12 };
const bus243: ReachLeg = {
  mode: "BUS",
  line: "243",
  headsign: "Bd. Lacul Tei",
  fromName: "Emil Racovita",
  toName: "Soseaua Colentina",
  minutes: 50,
};

describe("transitModeLabel", () => {
  it("names every MOTIS mode in Romanian", () => {
    expect(["BUS", "TRAM", "SUBWAY", "METRO", "RAIL", "TROLLEYBUS", "FERRY", "COACH"].map(transitModeLabel)).toEqual(
      ["Autobuz", "Tramvai", "Metrou", "Metrou", "Tren", "Troleibuz", "Feribot", "Autocar"],
    );
    expect(transitModeLabel("REGIONAL_RAIL")).toBe("Tren");
    expect(transitModeLabel("WALK")).toBe("Pe jos");
    expect(transitModeLabel("subway")).toBe("Metrou");
  });

  it("names every MOTIS rail mode Tren", () => {
    for (const mode of ["LONG_DISTANCE", "REGIONAL_FAST_RAIL", "SUBURBAN", "HIGHSPEED_RAIL", "NIGHT_RAIL", "night_rail"]) {
      expect(transitModeLabel(mode)).toBe("Tren");
    }
  });

  it("names any other unknown mode Transport public, never the raw enum", () => {
    for (const mode of ["GONDOLA", "FUNICULAR", "AERIAL_LIFT", "Long_distance_bus"]) {
      expect(transitModeLabel(mode)).toBe("Transport public");
    }
    expect(buildReachSteps([{ mode: "GONDOLA", line: "7", fromName: "A", toName: "B", minutes: 4 }])[0].primary).toBe(
      "Transport public 7",
    );
  });
});

describe("legMode", () => {
  it("is the leg's mode in upper case, the one form every check compares", () => {
    expect(legMode({ mode: "walk" })).toBe("WALK");
    expect(legMode({ mode: "Subway" })).toBe("SUBWAY");
    expect(legMode({ mode: "BUS" })).toBe("BUS");
  });

  it("treats a lower-case walk leg as walking everywhere", () => {
    const lower: ReachLeg = { mode: "walk", fromName: "START", toName: "Emil Racovita", minutes: 4, from: { lat: 44.42, lng: 26.1 }, to: { lat: 44.43, lng: 26.1 } };
    expect(buildReachSteps([lower])[0]).toEqual({ primary: "Pe jos 4 min", secondary: "până la Emil Racovita" });
    expect(stepChip(lower)).toEqual({ icon: "walk", text: "4", tone: "walk" });
    expect(journeyLegs([lower])[0].isWalk).toBe(true);
    expect(journeyStops([lower])).toEqual([]);
  });
});

describe("buildReachSteps", () => {
  it("formats walk legs and transit legs into two-line Romanian steps", () => {
    expect(buildReachSteps([walk(9, "START", "Emil Racovita")])[0]).toEqual({
      primary: "Pe jos 9 min",
      secondary: "până la Emil Racovita",
    });
    expect(buildReachSteps([bus243])[0]).toEqual({
      primary: "Autobuz 243 → Bd. Lacul Tei",
      secondary: "Urcă la Emil Racovita → coboară la Soseaua Colentina · 50 min",
    });
  });

  it("omits an absent line/headsign gracefully", () => {
    const [step] = buildReachSteps([{ mode: "TRAM", fromName: "A", toName: "B", minutes: 3 }]);
    expect(step.primary).toBe("Tramvai");
  });

  it("names the trip endpoints (START/END, or no name) as places", () => {
    expect(buildReachSteps([walk(5, "X", "END")])[0].secondary).toBe("până la destinație");
    expect(buildReachSteps([walk(5, "X", "")])[0].secondary).toBe("până la destinație");
    const [ride] = buildReachSteps([{ mode: "BUS", line: "5", fromName: "START", toName: "Market", minutes: 4 }]);
    expect(ride.secondary).toBe("Urcă la punctul de plecare → coboară la Market · 4 min");
  });
});

describe("stepChip", () => {
  it("shows a walk leg as its minutes on a neutral chip", () => {
    expect(stepChip(walk(4))).toEqual({ icon: "walk", text: "4", tone: "walk" });
  });

  it("shows the metro as its line, or M when the line is missing", () => {
    expect(stepChip({ ...leg, mode: "SUBWAY", line: "M2" })).toEqual({ icon: "metro", text: "M2", tone: "metro" });
    expect(stepChip({ ...leg, mode: "METRO", line: "" })).toEqual({ icon: "metro", text: "M", tone: "metro" });
    expect(stepChip({ ...leg, mode: "subway", line: "M4" })).toEqual({ icon: "metro", text: "M4", tone: "metro" });
  });

  it("shows a surface vehicle as its line, or its minutes when the line is missing", () => {
    expect(stepChip({ ...leg, mode: "BUS", line: "131" })).toEqual({ icon: "bus", text: "131", tone: "surface" });
    expect(stepChip({ ...leg, mode: "TRAM", line: "", minutes: 7 })).toEqual({ icon: "tram", text: "7 min", tone: "surface" });
    expect(stepChip({ ...leg, mode: "TRAM", line: undefined, minutes: 7 })).toEqual({ icon: "tram", text: "7 min", tone: "surface" });
  });

  it("draws trains as a train and every other vehicle as a bus", () => {
    expect(stepChip({ ...leg, mode: "RAIL", line: "IR 1581" })).toMatchObject({ icon: "train", tone: "surface" });
    expect(stepChip({ ...leg, mode: "REGIONAL_RAIL", line: "R 9021" })).toMatchObject({ icon: "train", tone: "surface" });
    for (const mode of ["LONG_DISTANCE", "REGIONAL_FAST_RAIL", "SUBURBAN", "HIGHSPEED_RAIL", "NIGHT_RAIL"]) {
      expect(stepChip({ ...leg, mode, line: "IC 532" })).toEqual({ icon: "train", text: "IC 532", tone: "surface" });
    }
    for (const mode of ["TROLLEYBUS", "COACH", "FERRY", "FUNICULAR"]) {
      expect(stepChip({ ...leg, mode, line: "70" })).toEqual({ icon: "bus", text: "70", tone: "surface" });
    }
  });
});

describe("hasTransitLeg (gates the visual draw)", () => {
  it("is true when any leg is a public-transport mode", () => {
    expect(hasTransitLeg([{ mode: "WALK", fromName: "A", toName: "B", minutes: 3 }, { mode: "BUS", fromName: "B", toName: "C", minutes: 8 }])).toBe(true);
    expect(hasTransitLeg([{ mode: "SUBWAY", fromName: "A", toName: "B", minutes: 8 }])).toBe(true);
  });
  it("is false for walk-only AND for a bike/car direct fallback (never draws those)", () => {
    expect(hasTransitLeg([{ mode: "WALK", fromName: "A", toName: "B", minutes: 12 }])).toBe(false);
    expect(hasTransitLeg([{ mode: "BIKE", fromName: "A", toName: "B", minutes: 9 }])).toBe(false);
    expect(hasTransitLeg([{ mode: "CAR", fromName: "A", toName: "B", minutes: 6 }])).toBe(false);
  });
  it("treats an unknown non-{walk,bike,car} mode as transit (so a genuine transit mode still draws)", () => {
    expect(hasTransitLeg([{ mode: "FUNICULAR", fromName: "A", toName: "B", minutes: 4 }])).toBe(true);
  });
});

describe("journeyStops (drawable board/transfer/alight model)", () => {
  const P = (lat: number, lng: number) => ({ lat, lng });

  it("a single transit leg yields exactly board + alight (walk legs contribute no stops)", () => {
    const legs: ReachLeg[] = [
      { mode: "WALK", fromName: "START", toName: "Board", minutes: 9, from: P(44.42, 26.1), to: P(44.43, 26.1) },
      { mode: "BUS", line: "243", fromName: "Board", toName: "Alight", minutes: 50, from: P(44.43, 26.1), to: P(44.45, 26.09) },
      { mode: "WALK", fromName: "Alight", toName: "END", minutes: 5, from: P(44.45, 26.09), to: P(44.45, 26.087) },
    ];
    const stops = journeyStops(legs);
    expect(stops.map((s) => [s.name, s.kind])).toEqual([
      ["Board", "board"],
      ["Alight", "alight"],
    ]);
  });

  it("a same-stop (platform) transfer collapses to one transfer node → transfers+2 stops", () => {
    const legs: ReachLeg[] = [
      { mode: "BUS", fromName: "A", toName: "X", minutes: 10, from: P(44.4, 26.1), to: P(44.42, 26.1) },
      { mode: "TRAM", fromName: "X", toName: "B", minutes: 10, from: P(44.42, 26.1), to: P(44.44, 26.1) },
    ];
    const stops = journeyStops(legs);
    expect(stops.map((s) => s.kind)).toEqual(["board", "transfer", "alight"]);
    expect(stops.map((s) => s.name)).toEqual(["A", "X", "B"]);
  });

  it("a walk-transfer between DISTINCT stops keeps both → 2·transfers+2 stops (not transfers+2)", () => {
    const legs: ReachLeg[] = [
      { mode: "BUS", fromName: "A", toName: "X1", minutes: 10, from: P(44.4, 26.1), to: P(44.42, 26.1) },
      { mode: "WALK", fromName: "X1", toName: "X2", minutes: 3, from: P(44.42, 26.1), to: P(44.421, 26.101) },
      { mode: "TRAM", fromName: "X2", toName: "B", minutes: 10, from: P(44.421, 26.101), to: P(44.44, 26.1) },
    ];
    const stops = journeyStops(legs);
    // transfers = 1, but the distinct alight/board yields 4 dots.
    expect(stops.map((s) => s.kind)).toEqual(["board", "transfer", "transfer", "alight"]);
    expect(stops.map((s) => s.name)).toEqual(["A", "X1", "X2", "B"]);
  });

  it("prefers a real stop name over START/END when merging a coincident pair", () => {
    const legs: ReachLeg[] = [
      { mode: "BUS", fromName: "A", toName: "END", minutes: 10, from: P(44.4, 26.1), to: P(44.42, 26.1) },
      { mode: "TRAM", fromName: "Real Interchange", toName: "B", minutes: 10, from: P(44.42, 26.1), to: P(44.44, 26.1) },
    ];
    expect(journeyStops(legs)[1].name).toBe("Real Interchange");
  });

  it("when BOTH sides of a coincident merge are sentinels, keeps the first (betterName both-bad branch)", () => {
    const legs: ReachLeg[] = [
      { mode: "BUS", fromName: "A", toName: "END", minutes: 10, from: P(44.4, 26.1), to: P(44.42, 26.1) },
      { mode: "TRAM", fromName: "START", toName: "B", minutes: 10, from: P(44.42, 26.1), to: P(44.44, 26.1) },
    ];
    // alight "END" (bad) merges with board "START" (bad) → betterName returns the
    // first ("END"), not a swap to the equally-bad second.
    expect(journeyStops(legs)[1].name).toBe("END");
  });

  it("skips a vehicle leg's missing from/to endpoint (guards on leg.from / leg.to)", () => {
    const legs: ReachLeg[] = [
      { mode: "BUS", fromName: "A", toName: "B", minutes: 10, to: P(44.42, 26.1) }, // no `from`
      { mode: "TRAM", fromName: "B", toName: "C", minutes: 10, from: P(44.42, 26.1) }, // no `to`
    ];
    // Only the present endpoints contribute: leg0's `to` (B) + leg1's `from` (B),
    // which coincide → one merged stop. No throw on the absent endpoints.
    const stops = journeyStops(legs);
    expect(stops).toHaveLength(1);
    expect(stops[0].name).toBe("B");
  });

  it("returns [] for a walk-only itinerary (no vehicle legs)", () => {
    expect(journeyStops([{ mode: "WALK", fromName: "START", toName: "END", minutes: 8, from: P(44.4, 26.1), to: P(44.41, 26.1) }])).toEqual([]);
  });
});

describe("journeyLegs (drawable leg lines)", () => {
  const P = (lat: number, lng: number) => ({ lat, lng });

  it("uses the decoded path when present, else a straight from→to fallback, and drops coordinateless legs", () => {
    const legs: ReachLeg[] = [
      { mode: "WALK", fromName: "START", toName: "Board", minutes: 9, from: P(44.42, 26.1), to: P(44.43, 26.1) },
      { mode: "BUS", fromName: "Board", toName: "Alight", minutes: 50, from: P(44.43, 26.1), to: P(44.45, 26.09), path: [[26.1, 44.43], [26.095, 44.44], [26.09, 44.45]] },
      { mode: "WALK", fromName: "Alight", toName: "END", minutes: 5 }, // no coords → dropped
    ];
    const drawn = journeyLegs(legs);
    expect(drawn.map((l) => l.index)).toEqual([0, 1]); // leg 2 dropped, indices preserved
    expect(drawn[0]).toEqual({ index: 0, isWalk: true, coords: [[26.1, 44.42], [26.1, 44.43]] });
    expect(drawn[1].isWalk).toBe(false);
    expect(drawn[1].coords).toHaveLength(3); // real path, not the 2-point fallback
  });
});

describe("reachSummary", () => {
  const plan = (totalMinutes: number, transfers: number): Extract<ReachPlan, { reachable: true }> => ({
    reachable: true,
    totalMinutes,
    transfers,
    legs: [],
  });

  it("states the trip time and the transfers in Romanian", () => {
    expect(reachSummary(plan(57, 1))).toBe("~57 min · 1 schimbare");
    expect(reachSummary(plan(20, 0))).toBe("~20 min · fără schimbări");
    expect(reachSummary(plan(40, 2))).toBe("~40 min · 2 schimbări");
  });
});
