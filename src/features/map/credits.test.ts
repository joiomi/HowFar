import { describe, expect, it } from "vitest";

import { BASEMAP_CREDITS, TRANSITOUS_SOURCES_URL } from "@/features/map/credits";
import { createMapStyle } from "@/features/map/map-setup";

describe("basemap credits", () => {
  it("names each source the basemap is built from, with its licence link", () => {
    expect(BASEMAP_CREDITS).toEqual({
      osm: { label: "OpenStreetMap", href: "https://www.openstreetmap.org/copyright" },
      esa: { label: "ESA WorldCover", href: "https://esa-worldcover.org/en/data-access" },
      ccBy: { label: "CC BY 4.0", href: "https://creativecommons.org/licenses/by/4.0/" },
      daylight: { label: "Daylight", href: "https://daylightmap.org" },
      naturalEarth: { label: "Natural Earth", href: "https://www.naturalearthdata.com" },
    });
    expect(TRANSITOUS_SOURCES_URL).toBe("https://transitous.org/sources/");
  });

  it("the style attribution and the info popover share one link list, in the same order", () => {
    const attribution = (createMapStyle("x").sources.protomaps as { attribution: string }).attribution;
    const hrefs = [...attribution.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(
      [BASEMAP_CREDITS.osm, BASEMAP_CREDITS.esa, BASEMAP_CREDITS.ccBy, BASEMAP_CREDITS.daylight, BASEMAP_CREDITS.naturalEarth].map(
        (c) => c.href,
      ),
    );
    // Each link carries its credit's label as its text.
    for (const c of Object.values(BASEMAP_CREDITS)) expect(attribution).toContain(`<a href="${c.href}">${c.label}</a>`);
  });
});
