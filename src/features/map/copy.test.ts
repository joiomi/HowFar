import { describe, expect, it } from "vitest";

import { presetReachCaveat } from "@/features/isochrones/preset-view";
import {
  infoContent,
  INFO_LABEL,
  minutesLabel,
  MODE_NAMES,
  SEARCH_PLACEHOLDER,
  SEARCH_PLACEHOLDER_FIRST_OPEN,
  TRANSIT_NOTE,
} from "@/features/map/copy";

describe("search copy", () => {
  it("names the address search in Romanian, and invites a map tap on first open", () => {
    expect(SEARCH_PLACEHOLDER).toBe("Caută o adresă");
    expect(SEARCH_PLACEHOLDER_FIRST_OPEN).toBe("Caută o adresă sau atinge harta");
  });
});

describe("mode and minute copy", () => {
  it("names the three travel modes in Romanian", () => {
    expect(MODE_NAMES).toEqual({ walk: "Pe jos", transit: "Transport public", car: "Mașina" });
  });

  it("spells a minute count with the Romanian plural, adding 'de' from 20 on", () => {
    expect([1, 10, 19, 20, 25, 40, 100, 101, 120].map(minutesLabel)).toEqual([
      "1 minut",
      "10 minute",
      "19 minute",
      "20 de minute",
      "25 de minute",
      "40 de minute",
      "100 de minute",
      "101 minute",
      "120 de minute",
    ]);
  });
});

describe("info popover copy", () => {
  it("names the info control and states the transit note verbatim", () => {
    expect(INFO_LABEL).toBe("Despre estimări și surse");
    expect(TRANSIT_NOTE).toBe("Metroul nu depinde de trafic; autobuzul și tramvaiul pot întârzia la aglomerație.");
  });

  it("pairs the mode's caveat with the transit note on transit only, and credits Transitous exactly on transit states", () => {
    expect(infoContent("walk", false)).toEqual({ caveat: presetReachCaveat("walk"), note: null, transitous: false });
    expect(infoContent("transit", true)).toEqual({ caveat: presetReachCaveat("transit"), note: TRANSIT_NOTE, transitous: true });
    expect(infoContent("car", false)).toEqual({ caveat: presetReachCaveat("car"), note: null, transitous: false });
    // Directions opened before any place was chosen count as a transit state while the
    // mode is still walk: Transitous is credited, the walk caveat stays.
    expect(infoContent("walk", true)).toEqual({ caveat: presetReachCaveat("walk"), note: null, transitous: true });
  });
});
