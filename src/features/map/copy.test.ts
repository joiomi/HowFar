import { describe, expect, it } from "vitest";

import { SEARCH_PLACEHOLDER, SEARCH_PLACEHOLDER_FIRST_OPEN } from "@/features/map/copy";

describe("search copy", () => {
  it("names the address search in Romanian, and invites a map tap on first open", () => {
    expect(SEARCH_PLACEHOLDER).toBe("Caută o adresă");
    expect(SEARCH_PLACEHOLDER_FIRST_OPEN).toBe("Caută o adresă sau atinge harta");
  });
});
