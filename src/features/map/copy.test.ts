import { describe, expect, it } from "vitest";

import { minutesLabel, MODE_NAMES, SEARCH_PLACEHOLDER, SEARCH_PLACEHOLDER_FIRST_OPEN } from "@/features/map/copy";

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
