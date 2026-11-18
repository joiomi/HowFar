import { describe, expect, it, vi } from "vitest";
import type maplibregl from "maplibre-gl";

import {
  activeGuardHasFeature,
  hitTestHasFeature,
  reachLabelAt,
  safeQueryRenderedFeatures,
  safeQuerySourceFeatures,
} from "@/features/map/query-features";

const bbox = [
  [0, 0],
  [10, 10],
] as [maplibregl.PointLike, maplibregl.PointLike];

describe("safeQueryRenderedFeatures", () => {
  it("passes the map's features through on a normal query", () => {
    const feats = [{ id: 1 }, { id: 2 }] as unknown as maplibregl.MapGeoJSONFeature[];
    const map = { queryRenderedFeatures: vi.fn(() => feats) } as unknown as maplibregl.Map;
    expect(safeQueryRenderedFeatures(map, bbox, { layers: ["amenity-markers"] })).toBe(feats);
  });

  it("returns [] when queryRenderedFeatures THROWS (source mid-setData swap — 'feature index out of bounds')", () => {
    const map = {
      queryRenderedFeatures: vi.fn(() => {
        throw new Error("feature index out of bounds");
      }),
    } as unknown as maplibregl.Map;
    expect(safeQueryRenderedFeatures(map, bbox, { layers: ["amenity-markers"] })).toEqual([]);
  });
});

describe("hitTestHasFeature (fail-CLOSED click guard)", () => {
  it("reports whether a feature is under the point on a normal query", () => {
    const withFeature = { queryRenderedFeatures: vi.fn(() => [{ id: 1 }]) } as unknown as maplibregl.Map;
    const empty = { queryRenderedFeatures: vi.fn(() => []) } as unknown as maplibregl.Map;
    expect(hitTestHasFeature(withFeature, bbox, { layers: ["route-path-line"] })).toBe(true);
    expect(hitTestHasFeature(empty, bbox, { layers: ["route-path-line"] })).toBe(false);
  });

  it("fails CLOSED — returns TRUE when the query throws mid-swap, so a click guard swallows the click instead of resetting the selection", () => {
    const map = {
      queryRenderedFeatures: vi.fn(() => {
        throw new Error("feature index out of bounds");
      }),
    } as unknown as maplibregl.Map;
    expect(hitTestHasFeature(map, bbox, { layers: ["route-path-line"] })).toBe(true);
  });
});

describe("activeGuardHasFeature (fail-closed click guard for route-path/reach-journey)", () => {
  const bboxLayers = ["route-path-stops", "route-path-line"];
  it("reports a hit when a resolved layer has a feature under the point", () => {
    const map = {
      getLayer: (id: string) => (id === "route-path-line" ? {} : undefined),
      queryRenderedFeatures: vi.fn(() => [{ id: 1 }]),
    } as unknown as maplibregl.Map;
    expect(activeGuardHasFeature(map, bbox, bboxLayers)).toBe(true);
  });
  it("returns false (no hit) when resolved layers have nothing under the point", () => {
    const map = {
      getLayer: () => ({}),
      queryRenderedFeatures: vi.fn(() => []),
    } as unknown as maplibregl.Map;
    expect(activeGuardHasFeature(map, bbox, bboxLayers)).toBe(false);
  });
  it("fails CLOSED (true) when NONE of the layers resolve yet (mid-style-reload race — no throw)", () => {
    const map = {
      getLayer: () => undefined, // no layers exist
      queryRenderedFeatures: vi.fn(() => []),
    } as unknown as maplibregl.Map;
    expect(activeGuardHasFeature(map, bbox, bboxLayers)).toBe(true);
  });
  it("fails CLOSED (true) when the query throws mid source-swap", () => {
    const map = {
      getLayer: () => ({}),
      queryRenderedFeatures: vi.fn(() => {
        throw new Error("feature index out of bounds");
      }),
    } as unknown as maplibregl.Map;
    expect(activeGuardHasFeature(map, bbox, bboxLayers)).toBe(true);
  });
});

describe("safeQuerySourceFeatures (rAF stamp-poll guard)", () => {
  it("passes source features through on a normal query", () => {
    const feats = [{ properties: { kind: "leg" } }];
    const map = { querySourceFeatures: vi.fn(() => feats) } as unknown as maplibregl.Map;
    expect(safeQuerySourceFeatures(map, "reach-path")).toBe(feats);
  });

  it("returns [] when querySourceFeatures THROWS mid source-swap, so the rAF poll never raises an Uncaught Error", () => {
    const map = {
      querySourceFeatures: vi.fn(() => {
        throw new Error("feature index out of bounds");
      }),
    } as unknown as maplibregl.Map;
    expect(safeQuerySourceFeatures(map, "route-path")).toEqual([]);
  });
});

describe("reachLabelAt (fail-OPEN tap guard for the reach label)", () => {
  const mapWith = (query: () => unknown, hasLayer = true) =>
    ({
      getLayer: vi.fn(() => (hasLayer ? {} : undefined)),
      queryRenderedFeatures: vi.fn(query),
    }) as unknown as maplibregl.Map;

  it("hits the label layer inside a 4 px box around the tap", () => {
    const map = mapWith(() => [{ id: 1 }]);
    expect(reachLabelAt(map, { x: 100, y: 200 })).toBe(true);
    expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
      [
        [96, 196],
        [104, 204],
      ],
      { layers: ["preset-reach-label"] },
    );
  });

  it("is false when nothing is under the tap", () => {
    expect(reachLabelAt(mapWith(() => []), { x: 1, y: 1 })).toBe(false);
  });

  it("is false, without querying, while the label layer does not exist yet", () => {
    const map = mapWith(() => [{ id: 1 }], false);
    expect(reachLabelAt(map, { x: 1, y: 1 })).toBe(false);
    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
  });

  it("fails open: a query error must not swallow the tap", () => {
    const map = mapWith(() => {
      throw new Error("feature index out of bounds");
    });
    expect(reachLabelAt(map, { x: 1, y: 1 })).toBe(false);
  });
});
