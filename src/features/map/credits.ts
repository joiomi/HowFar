/** Transitous asks every app that shows its data to link to its sources page. */
export const TRANSITOUS_SOURCES_URL = "https://transitous.org/sources/";

/** One credited source: the link text and where it points. */
export interface CreditLink {
  label: string;
  href: string;
}

/**
 * The sources the basemap is built from, each with its licence or copyright page.
 * The map style's attribution (`map-setup.ts`) and the info popover both read
 * this one list, so the two can never credit different links.
 */
export const BASEMAP_CREDITS: {
  osm: CreditLink;
  esa: CreditLink;
  ccBy: CreditLink;
  daylight: CreditLink;
  naturalEarth: CreditLink;
} = {
  osm: { label: "OpenStreetMap", href: "https://www.openstreetmap.org/copyright" },
  esa: { label: "ESA WorldCover", href: "https://esa-worldcover.org/en/data-access" },
  ccBy: { label: "CC BY 4.0", href: "https://creativecommons.org/licenses/by/4.0/" },
  daylight: { label: "Daylight", href: "https://daylightmap.org" },
  naturalEarth: { label: "Natural Earth", href: "https://www.naturalearthdata.com" },
};
