import { layers, namedFlavor } from "@protomaps/basemaps";
import type maplibregl from "maplibre-gl";

import { AMENITY_CATEGORIES, UNKNOWN_DISTANCE_SORT } from "@/features/amenities/amenities";
import {
  AMENITY_SOURCE_MAX_ZOOM,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS_PX,
  pinRadiusHoverExpression,
} from "@/features/amenities/amenity-cluster";
import { amenityIconImageExpression } from "@/features/amenities/amenity-icons";
import { RING_BANDS } from "@/features/isochrones/isochrone-view";
import {
  PRESET_EDGE_LAYER,
  PRESET_FILL_LAYER,
  PRESET_FILL_SOURCE,
  PRESET_INTERIOR_LAYER,
  PRESET_LABEL_LAYER,
  PRESET_LINE_OPACITY,
  PRESET_LINE_SOURCE,
} from "@/features/isochrones/preset-view";
import { BASEMAP_CREDITS, type CreditLink } from "@/features/map/credits";

/**
 * Pure MapLibre setup: the basemap style and the source/layer definitions,
 * split out of `AppMap` so the exact specs are unit-testable without a map.
 * No closure state and no `window` — the origin-dependent tiles URL is a
 * parameter so this module stays node-safe.
 */

/** Empty FeatureCollection used to initialise and clear GeoJSON sources. */
export const EMPTY_FC = { type: "FeatureCollection" as const, features: [] as unknown[] };

/** The narrow slice of `maplibregl.Map` the layer helpers touch. */
type LayerHost = Pick<maplibregl.Map, "addSource" | "addLayer">;

export const ISOCHRONE_FILL_OPACITY = 0.2;
export const ISOCHRONE_LINE_OPACITY = 0.94;

/** A credit as an HTML link for the style's attribution string. */
function creditAnchor(credit: CreditLink): string {
  return `<a href="${credit.href}">${credit.label}</a>`;
}

/** Style for the self-hosted Protomaps basemap. `tilesUrl` is the absolute
 * `/api/tiles` URL (the caller computes it from `window.location.origin`). */
export function createMapStyle(tilesUrl: string): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/dark",
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${tilesUrl}`,
        // Credit the data sources the basemap is BUILT from, not just OSM. Both the
        // public build.protomaps.com cut and the self-built `build-tiles.sh` archive
        // bundle the same sources (see docs/SELFHOST.md), so this one string is
        // correct for either `/api/tiles` backing. Sources per Protomaps' own
        // basemaps LICENSE_DATA.md (durable copy: github.com/protomaps/basemaps @ the
        // build-pinned commit a50c699, recorded in docker/selfhost/run-manifest.md):
        //  - OpenStreetMap (ODbL) — required. Also covers the ODbL water/land
        //    coastline polygons (osmdata.openstreetmap.de), which are OSM-derived.
        //  - ESA WorldCover landcover (CC BY 4.0), distributed via Daylight. The dark
        //    flavor DEFINES a `landcover` layer but fades it to opacity 0 above z7
        //    (@protomaps/basemaps base_layers), and the city-extent `maxBounds`
        //    (NEXT_PUBLIC_MAP_BBOX) keeps the camera above z7 today, so those pixels
        //    do not paint at this extent — BUT the ESA data is BUNDLED in the pmtiles
        //    archive we serve regardless, and a wider extent (multi-city support) could drop the
        //    floor to where it paints. Either way the credit is carried for the
        //    distribution (deliberately shown). CC BY 4.0 requires indicating the data
        //    was modified — Daylight vectorised ESA's raster, so the credit says
        //    "modified". ESA's fuller "Contains modified Copernicus Sentinel data …"
        //    acknowledgement + the exact WorldCover vintage live in README/docs and
        //    at the linked data-access page; the vintage is not pinned in our build
        //    (not yet done), so it is NOT asserted here.
        //  - Natural Earth — public-domain ("crediting unnecessary"); shown by design.
        // Mapzen POI-icon sprite (MIT) is hot-linked from protomaps.github.io
        // (glyphs/sprite above), i.e. referenced not redistributed; its MIT notice is
        // carried in README for good measure (docs/SELFHOST.md explains the basis).
        // The links come from BASEMAP_CREDITS, the list the info popover shows. The
        // map is created without MapLibre's attribution control, so the popover is
        // where users see these credits; the source still declares them here.
        attribution:
          `&copy; ${creditAnchor(BASEMAP_CREDITS.osm)} contributors` +
          ` &middot; Landcover &copy; ${creditAnchor(BASEMAP_CREDITS.esa)}` +
          ` (${creditAnchor(BASEMAP_CREDITS.ccBy)}), modified,` +
          ` via ${creditAnchor(BASEMAP_CREDITS.daylight)}` +
          ` &middot; ${creditAnchor(BASEMAP_CREDITS.naturalEarth)}`,
      },
    },
    layers: layers("protomaps", namedFlavor("dark"), { lang: "ro" }),
  };
}

/** Romanian strings for MapLibre's own controls and canvas, passed as the
 * map's `locale` option. */
export const MAP_LOCALE: Record<string, string> = {
  "Map.Title": "Hartă",
  "Marker.Title": "Punct pe hartă",
  "NavigationControl.ZoomIn": "Mărește",
  "NavigationControl.ZoomOut": "Micșorează",
  "NavigationControl.ResetBearing": "Orientează spre nord",
  "Popup.Close": "Închide",
};

/** One fill + one line layer per ring BAND, filtered by the feature's `band`
 * (fixed position id 15/30/45, mode-independent — see isochrone-view). Color
 * comes from the feature (per-mode ramp) so every mode reuses these layers. */
export function addIsochroneLayers(map: LayerHost): void {
  map.addSource("isochrone", { type: "geojson", data: EMPTY_FC as GeoJSON.FeatureCollection });
  for (const band of RING_BANDS) {
    const filter = ["==", ["get", "band"], band] as maplibregl.FilterSpecification;
    map.addLayer({
      id: `iso-fill-${band}`,
      type: "fill",
      source: "isochrone",
      filter,
      paint: {
        "fill-color": ["get", "fillColor"],
        "fill-opacity": ISOCHRONE_FILL_OPACITY,
        "fill-opacity-transition": { duration: 320, delay: 0 },
      },
    });
    map.addLayer({
      id: `iso-line-${band}`,
      type: "line",
      source: "isochrone",
      filter,
      paint: {
        "line-color": ["get", "lineColor"],
        "line-width": 2,
        "line-opacity": ISOCHRONE_LINE_OPACITY,
        "line-opacity-transition": { duration: 320, delay: 0 },
      },
    });
  }
}

/**
 * PRESET reach layers (phone-first) — ADDITIVE, alongside the legacy
 * `iso-*` band layers (which stay byte-identical). Two sources:
 *  - `preset-reach-fill`: the DECORATIVE gradient shells (`buildPresetShellFeatures`), each a
 *    flat translucent fill carrying its own ramp `fillColor`; stacked in source order they read
 *    as one continuous light→dark ramp. NOT a per-minute time claim (see preset-view.ts).
 *  - `preset-reach-line`: the honest contour LINES (`buildPresetContourFeatures`) — the outer
 *    edge (solid) and the single calibrated interior line (dashed). `line-dasharray` is not
 *    data-driven in MapLibre, so edge vs interior are TWO layers over one source, split by the
 *    feature's `kind`.
 * One mode's reach shows at a time, so — like the `iso-*` layers — the per-feature colour lets
 * every mode reuse these layers. */
export function addPresetReachLayers(map: LayerHost): void {
  map.addSource(PRESET_FILL_SOURCE, { type: "geojson", data: EMPTY_FC as GeoJSON.FeatureCollection });
  map.addSource(PRESET_LINE_SOURCE, { type: "geojson", data: EMPTY_FC as GeoJSON.FeatureCollection });
  map.addLayer({
    id: PRESET_FILL_LAYER,
    type: "fill",
    source: PRESET_FILL_SOURCE,
    paint: {
      "fill-color": ["get", "fillColor"],
      "fill-opacity": 0,
      "fill-opacity-transition": { duration: 320, delay: 0 },
    },
  });
  map.addLayer({
    id: PRESET_EDGE_LAYER,
    type: "line",
    source: PRESET_LINE_SOURCE,
    filter: ["==", ["get", "kind"], "edge"] as maplibregl.FilterSpecification,
    paint: {
      "line-color": ["get", "lineColor"],
      "line-width": 2,
      "line-opacity": PRESET_LINE_OPACITY,
      "line-opacity-transition": { duration: 320, delay: 0 },
    },
  });
  map.addLayer({
    id: PRESET_INTERIOR_LAYER,
    type: "line",
    source: PRESET_LINE_SOURCE,
    filter: ["==", ["get", "kind"], "interior"] as maplibregl.FilterSpecification,
    paint: {
      "line-color": ["get", "lineColor"],
      "line-width": 1.6,
      "line-dasharray": [5, 4],
      "line-opacity": 0.85,
      "line-opacity-transition": { duration: 320, delay: 0 },
    },
  });
  // The reach time written along the edge, in the line's own colour with a dark halo.
  map.addLayer({
    id: PRESET_LABEL_LAYER,
    type: "symbol",
    source: PRESET_LINE_SOURCE,
    filter: ["==", ["get", "kind"], "edge"] as maplibregl.FilterSpecification,
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 300,
      "text-field": ["concat", "~", ["to-string", ["get", "minutes"]], " min"],
      "text-font": ["Noto Sans Medium"],
      "text-size": 13,
      "text-keep-upright": true,
    },
    paint: {
      "text-color": ["get", "lineColor"],
      "text-halo-color": "#0d110e",
      "text-halo-width": 2,
    },
  });
}

/** Highlighted transit-route color: near-white reads as "figure" on
 * the dark basemap and collides with no category hue or mode ramp. */
export const ROUTE_PATH_COLOR = "#fafafa";
const ROUTE_PATH_CASING = "#09090b";

/** Selected transit line: dark casing under a bright line, plus the
 * route's stops as casing-colored dots ringed in the line color. One GeoJSON
 * source; the layers split track from stops by geometry type. Added BETWEEN
 * the isochrone fills and the amenity markers, so a drawn path never covers
 * the interactive dots. */
export function addRoutePathLayers(map: LayerHost): void {
  map.addSource("route-path", { type: "geojson", data: EMPTY_FC as GeoJSON.FeatureCollection });
  const isLine = ["==", ["geometry-type"], "LineString"] as maplibregl.FilterSpecification;
  const round = { "line-cap": "round" as const, "line-join": "round" as const };
  map.addLayer({
    id: "route-path-casing",
    type: "line",
    source: "route-path",
    filter: isLine,
    layout: round,
    paint: { "line-color": ROUTE_PATH_CASING, "line-width": 8, "line-opacity": 0.88 },
  });
  map.addLayer({
    id: "route-path-line",
    type: "line",
    source: "route-path",
    filter: isLine,
    layout: round,
    paint: { "line-color": ROUTE_PATH_COLOR, "line-width": 3.5, "line-opacity": 0.97 },
  });
  map.addLayer({
    id: "route-path-stops",
    type: "circle",
    source: "route-path",
    filter: ["==", ["geometry-type"], "Point"] as maplibregl.FilterSpecification,
    paint: {
      "circle-radius": 5,
      "circle-color": ROUTE_PATH_CASING,
      "circle-stroke-color": ROUTE_PATH_COLOR,
      "circle-stroke-width": 2,
    },
  });
  // The stop NAMES are the point of the feature ("know all the places it
  // stops") — halo-on-dark labels; MapLibre's symbol collision thins them
  // automatically where stops crowd.
  map.addLayer({
    id: "route-path-labels",
    type: "symbol",
    source: "route-path",
    filter: ["==", ["geometry-type"], "Point"] as maplibregl.FilterSpecification,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Medium"],
      "text-size": 11,
      "text-anchor": "top",
      "text-offset": [0, 0.7],
    },
    paint: {
      "text-color": ROUTE_PATH_COLOR,
      "text-halo-color": ROUTE_PATH_CASING,
      "text-halo-width": 1.5,
    },
  });
}

/** Right-click journey draw palette. Walk legs = the walk-mode teal
 * (dashed), transit legs = the transit violet, matching the isochrone ramp so
 * the drawn trip reads in the same visual language as the rings. Board/alight
 * dots are emphasized; transfers are a quieter hollow dot; the highlight layers
 * pulse a near-white figure when a popup step is hovered. */
const REACH_WALK_COLOR = "#2dd4bf"; // --hf-walk
const REACH_TRANSIT_COLOR = "#a78bfa"; // --hf-transit
const REACH_CASING = "#09090b";
const REACH_HIGHLIGHT = "#fafafa";

/** The journey a right-click drew: one GeoJSON source holds the leg
 * LineStrings (props `kind:"leg"`, `legIndex`, `isWalk`) and the used-stop Points
 * (props `kind:"stop"`, `stopKind`, `stopIndex`, `name`). Two `*-hl` layers stay
 * filtered to nothing until a popup step is hovered. Added BETWEEN the OSM
 * route-path and the amenity markers so a drawn journey never covers the
 * interactive markers, and (with amenities decluttered while it shows) reads
 * cleanly over the basemap + rings. */
export function addReachPathLayers(map: LayerHost): void {
  map.addSource("reach-path", { type: "geojson", data: EMPTY_FC as GeoJSON.FeatureCollection });
  const isLine = ["==", ["geometry-type"], "LineString"] as maplibregl.FilterSpecification;
  const isPoint = ["==", ["geometry-type"], "Point"] as maplibregl.FilterSpecification;
  const round = { "line-cap": "round" as const, "line-join": "round" as const };

  map.addLayer({
    id: "reach-path-casing",
    type: "line",
    source: "reach-path",
    filter: isLine,
    layout: round,
    paint: { "line-color": REACH_CASING, "line-width": 7, "line-opacity": 0.85 },
  });
  // Walk legs: dashed teal (a walked segment reads differently from a ridden one).
  map.addLayer({
    id: "reach-path-walk",
    type: "line",
    source: "reach-path",
    filter: ["all", isLine, ["==", ["get", "isWalk"], true]] as maplibregl.FilterSpecification,
    layout: round,
    paint: { "line-color": REACH_WALK_COLOR, "line-width": 3, "line-dasharray": [1.4, 1.4], "line-opacity": 0.95 },
  });
  // Transit legs: solid violet.
  map.addLayer({
    id: "reach-path-transit",
    type: "line",
    source: "reach-path",
    filter: ["all", isLine, ["==", ["get", "isWalk"], false]] as maplibregl.FilterSpecification,
    layout: round,
    paint: { "line-color": REACH_TRANSIT_COLOR, "line-width": 4.5, "line-opacity": 0.97 },
  });
  // Highlight line (hover): filtered to the active leg only; near-white figure.
  map.addLayer({
    id: "reach-path-line-hl",
    type: "line",
    source: "reach-path",
    filter: ["all", isLine, ["==", ["get", "legIndex"], -1]] as maplibregl.FilterSpecification,
    layout: round,
    paint: { "line-color": REACH_HIGHLIGHT, "line-width": 6, "line-opacity": 0.9 },
  });
  // The reach-path source also carries a single `kind:"destination"` pin — the point the user asked "how do I get there?" about. The stop layers
  // below are scoped to `kind:"stop"` so the pin never renders as a transit stop
  // or gets a stop label (atomic source, one
  // writer, kind-scoped layers).
  const isStop = ["all", isPoint, ["==", ["get", "kind"], "stop"]] as maplibregl.FilterSpecification;
  // Used stops: board/alight are big filled violet dots; transfers a smaller
  // hollow dot. White stroke gives figure/ground pop on the dark basemap.
  map.addLayer({
    id: "reach-path-stops",
    type: "circle",
    source: "reach-path",
    filter: isStop,
    paint: {
      "circle-radius": ["match", ["get", "stopKind"], "transfer", 5, 6.5],
      "circle-color": ["match", ["get", "stopKind"], "transfer", REACH_CASING, REACH_TRANSIT_COLOR],
      "circle-stroke-color": REACH_HIGHLIGHT,
      "circle-stroke-width": 2,
    },
  });
  // Highlight ring (hover): filtered to the hovered step's stop ids.
  map.addLayer({
    id: "reach-path-stops-hl",
    type: "circle",
    source: "reach-path",
    filter: ["all", isStop, ["in", ["get", "stopIndex"], ["literal", []]]] as maplibregl.FilterSpecification,
    paint: {
      "circle-radius": 10,
      "circle-color": "rgba(250,250,250,0.14)",
      "circle-stroke-color": REACH_HIGHLIGHT,
      "circle-stroke-width": 2.5,
    },
  });
  // Board/alight names (the endpoints that matter most); transfers stay unlabelled
  // to avoid crowding — their dot + the popup step carry the detail.
  map.addLayer({
    id: "reach-path-labels",
    type: "symbol",
    source: "reach-path",
    filter: ["all", isStop, ["!=", ["get", "stopKind"], "transfer"]] as maplibregl.FilterSpecification,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Medium"],
      "text-size": 11,
      "text-anchor": "top",
      "text-offset": [0, 0.8],
    },
    paint: {
      "text-color": REACH_HIGHLIGHT,
      "text-halo-color": REACH_CASING,
      "text-halo-width": 1.5,
    },
  });
  // Destination pin: the point the user asked about. A near-white
  // filled dot with a dark halo + a small inner core — deliberately unlike the
  // violet transit stops, so it reads as "here's the place" for every reach kind
  // (walk/car band answers too, which draw no journey). One dot per feature.
  const isDestination = ["all", isPoint, ["==", ["get", "kind"], "destination"]] as maplibregl.FilterSpecification;
  map.addLayer({
    id: "reach-path-destination",
    type: "circle",
    source: "reach-path",
    filter: isDestination,
    paint: {
      "circle-radius": 7,
      "circle-color": REACH_HIGHLIGHT,
      "circle-stroke-color": REACH_CASING,
      "circle-stroke-width": 3,
    },
  });
}

/** Zoom at which individual pins start showing their place NAME. Below this the
 * icon + colour carry the meaning; above it there is room for text. */
export const AMENITY_LABEL_MINZOOM = 15.5;

/** Only clusters / only individual points. A clustered GeoJSON source serves BOTH
 * from one source, so every amenity layer must state which half it draws — an
 * unfiltered layer would paint cluster centroids as if they were places. */
const IS_SINGLE = ["!", ["has", "point_count"]] as unknown as maplibregl.FilterSpecification;

/** Feature-state-driven value: `hovered` when the pointer's pick lands on the
 * marker (AppMap sets `hover` via setFeatureState), else `rest`. */
function hoverCase(
  hovered: maplibregl.ExpressionSpecification | number,
  rest: maplibregl.ExpressionSpecification | number,
): maplibregl.DataDrivenPropertyValueSpecification<number> {
  return ["case", ["boolean", ["feature-state", "hover"], false], hovered, rest] as
    maplibregl.DataDrivenPropertyValueSpecification<number>;
}

/**
 * Amenity layers (display-level aggregation).
 *
 * The source **clusters**, and `clusterMaxZoom` is pinned to the map's own
 * maximum so aggregation never dissolves: any two amenities closer than
 * `CLUSTER_RADIUS_PX` are one mark at every zoom, which is what makes overlapping
 * unreadable pins structurally impossible rather than merely rarer. `maxzoom`
 * must stay STRICTLY above `clusterMaxZoom` — MapLibre otherwise warns and stops
 * clustering early, and the source default (18) is below the map default (22), so
 * both are explicit.
 *
 * `clusterProperties` accumulate a per-category count on every cluster, so an
 * aggregate can still say *what kinds* of places it holds — the whole point of
 * the feature, and something a plain count bubble throws away.
 *
 * Feature ids are explicit (`buildAmenityFeatures` emits them) rather than
 * `generateId`, because supercluster preserves an author-supplied id — verified
 * stable across tile seams and zooms — while generated ids are not available on a
 * clustered source. Hover feature-state depends on that stability.
 *
 * Layers, in paint order: cluster halo (WebGL, under the DOM donuts) → individual
 * pins → icons → names. Icon and name are SEPARATE symbol layers because they
 * need opposite overlap policies: the icon must stay glued to its pin
 * (`icon-allow-overlap`), while names must be collision-managed so they thin
 * instead of overprinting into mud (the previous letter-glyph layer disabled
 * collisions outright, which produced `GG`/`+G+` text mud).
 */
export function addAmenityLayers(map: LayerHost): void {
  map.addSource("amenities", {
    type: "geojson",
    data: EMPTY_FC as GeoJSON.FeatureCollection,
    cluster: true,
    clusterRadius: CLUSTER_RADIUS_PX,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    maxzoom: AMENITY_SOURCE_MAX_ZOOM,
    clusterProperties: Object.fromEntries(
      AMENITY_CATEGORIES.map(({ key }) => [
        key,
        ["+", ["case", ["==", ["get", "category"], key], 1, 0]],
      ]),
    ),
  });

  // NOTE: there is deliberately NO WebGL layer for clusters. An earlier "halo" circle
  // was painted per SOURCE cluster, but donuts are merged in SCREEN space, so after a
  // merge the halos stayed at the un-merged positions and visibly reintroduced exactly
  // the overlap. The donut SVG draws its own dark seat,
  // so the halo was redundant as well as wrong.
  // Individual places. Radius now scales with zoom (a fixed 7px at every zoom was
  // one of the three causes of the original crowding complaint); the cap in
  // `pinRadiusForZoom` keeps the footprint inside the separation invariant.
  map.addLayer({
    id: "amenity-markers",
    type: "circle",
    source: "amenities",
    filter: IS_SINGLE,
    paint: {
      // ONE zoom interpolation, scaled by a hover factor — MapLibre allows only a
      // single zoom-based subexpression per paint property, and the two-interp
      // `case` form makes addLayer throw (see pinRadiusHoverExpression).
      "circle-radius":
        pinRadiusHoverExpression() as unknown as maplibregl.DataDrivenPropertyValueSpecification<number>,
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": hoverCase(2.5, 1.75),
      "circle-opacity": hoverCase(1, 0.96),
    },
  });

  // Category icons — the shared `AMENITY_ICONS` shapes, so the map and the
  // AmenityPanel speak one visual language and a marker no longer needs a legend
  // lookup to decode. Glued to its pin, so overlap is allowed here.
  map.addLayer({
    id: "amenity-icons",
    type: "symbol",
    source: "amenities",
    filter: IS_SINGLE,
    // No minzoom: the map opens at 11.5, and an isolated pin down there was drawn as a
    // bare coloured dot with no category encoding at all. `icon-size`
    // already shrinks the glyph at low zoom, so there is nothing to gate.
    layout: {
      "icon-image": amenityIconImageExpression() as unknown as maplibregl.DataDrivenPropertyValueSpecification<maplibregl.ResolvedImageSpecification>,
      // Calibrated against real screenshots: sizes of
      // (0.32/0.42/0.55) render legible-but-faint icons inside the pin, so each
      // stop is nudged up to fill more of the disc without touching its edge.
      // Stops scaled with the PIN_RADIUS_STOPS legibility bump (icons
      // track their pin's disc — mid-zoom +~22%, top +~10%).
      "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.36, 12.5, 0.42, 15, 0.56, 18, 0.68],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-optional": true,
    },
  });

  // Place NAMES with collision ON. `symbol-sort-key` is the served walking
  // distance, so when MapLibre must thin labels it keeps the NEAREST places'
  // names (lower sort key wins placement) — the ones the user is most likely to
  // care about — instead of an arbitrary subset. Ties fall back to the name so
  // thinning is deterministic between repaints.
  map.addLayer({
    id: "amenity-labels",
    type: "symbol",
    source: "amenities",
    filter: IS_SINGLE,
    minzoom: AMENITY_LABEL_MINZOOM,
    layout: {
      "text-field": ["coalesce", ["get", "name"], ""],
      "text-font": ["Noto Sans Medium"],
      "text-size": 11,
      "text-anchor": "top",
      "text-offset": [0, 0.9],
      "text-max-width": 9,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "text-optional": true,
      "symbol-sort-key": ["coalesce", ["get", "distanceSort"], UNKNOWN_DISTANCE_SORT],
    },
    paint: {
      "text-color": "#e8ede8",
      "text-halo-color": "rgba(6,9,8,0.92)",
      "text-halo-width": 1.4,
    },
  });
}

/** Source + layer ids for the spiderfy fan, exported so the controller and the
 * e2e name them once. */
export const SPIDER_SOURCE = "amenity-spider";
export const SPIDER_LEG_LAYER = "amenity-spider-legs";
export const SPIDER_MARKER_LAYER = "amenity-spider-markers";
export const SPIDER_ICON_LAYER = "amenity-spider-icons";
export const SPIDER_LABEL_LAYER = "amenity-spider-labels";

/**
 * Spiderfy layers — the fan that makes coincident places
 * individually visible.
 *
 * Added AFTER the amenity layers so the fan draws on top of everything it
 * replaces, and kept in its OWN source for three reasons that each bit during
 * design:
 *
 * 1. The fan's positions are screen-space offsets recomputed every frame, so they
 *    cannot live in the clustered source (which would re-cluster them straight back
 *    into the hub they came from).
 * 2. Reusing the pin paint here means a fanned leaf looks exactly like an ordinary
 *    place — same colour, same icon sprite, same label style — so nothing has to be
 *    re-learned when a mark fans out.
 * 3. Labels are COLLISION-MANAGED, like the main map's. `text-allow-overlap: true` would be tempting, since a fan is at most
 *    `SPIDER_MAX_LEAVES` provably separated marks — but the proof covers the PINS (25px apart), not their names: a 10em POI name
 *    is far wider than that, so long names in a full fan reproduced exactly the text
 *    mud. Thinning a name is the lesser harm — the pin is always
 *    drawn, the hub's `aria-label` enumerates every member, and the leaves list is one
 *    keystroke away — so `text-optional` lets a name drop rather than overprint, and
 *    `symbol-sort-key` makes which one drops deterministic instead of arbitrary.
 */
export function addAmenitySpiderLayers(map: LayerHost): void {
  map.addSource(SPIDER_SOURCE, { type: "geojson", data: EMPTY_FC as GeoJSON.FeatureCollection });

  // Leader lines from the hub to each leaf: without them a fanned pin is a place
  // floating where no place is. Drawn first so the leaves cap their own legs.
  map.addLayer({
    id: SPIDER_LEG_LAYER,
    type: "line",
    source: SPIDER_SOURCE,
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-cap": "round" },
    paint: { "line-color": "#8b9a8f", "line-width": 1.4, "line-opacity": 0.9 },
  });

  map.addLayer({
    id: SPIDER_MARKER_LAYER,
    type: "circle",
    source: SPIDER_SOURCE,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      // Fixed radius, not the zoom interpolation the map pins use: the fan is a
      // transient focused view and its leaves must stay readable at any zoom.
      "circle-radius": ["get", "radius"],
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });

  map.addLayer({
    id: SPIDER_ICON_LAYER,
    type: "symbol",
    source: SPIDER_SOURCE,
    filter: ["==", ["geometry-type"], "Point"],
    layout: {
      "icon-image": amenityIconImageExpression() as unknown as maplibregl.DataDrivenPropertyValueSpecification<maplibregl.ResolvedImageSpecification>,
      // Tracks the pin-icon size (fan leaves reuse the pin paint).
      "icon-size": 0.56,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-optional": true,
    },
  });

  map.addLayer({
    id: SPIDER_LABEL_LAYER,
    type: "symbol",
    source: SPIDER_SOURCE,
    filter: ["==", ["geometry-type"], "Point"],
    layout: {
      "text-field": ["coalesce", ["get", "name"], ""],
      "text-font": ["Noto Sans Medium"],
      "text-size": 11,
      "text-anchor": "top",
      "text-offset": [0, 0.95],
      "text-max-width": 10,
      // See the header note (3): pin separation is not label separation.
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "text-optional": true,
      // Lower wins placement, so the fan's first members keep their names when the
      // set has to be thinned — deterministic between repaints of identical data.
      "symbol-sort-key": ["coalesce", ["get", "leafOrder"], 0],
    },
    paint: {
      "text-color": "#f4f7f2",
      "text-halo-color": "rgba(6,9,8,0.95)",
      "text-halo-width": 1.5,
    },
  });
}
