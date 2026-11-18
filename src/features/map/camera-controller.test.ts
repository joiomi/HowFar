import { describe, expect, it } from "vitest";
import type maplibregl from "maplibre-gl";

import { createCameraController } from "@/features/map/camera-controller";
import { cameraPadding, MOBILE_CAMERA_PAD_BOTTOM_PX } from "@/features/map/camera";

/** The bottom inset a 390×844 phone reserves while the directions sheet is open. */
const SHEET_BOTTOM = cameraPadding(390, 844, true).bottom;

/** Minimal fake map: records setPadding calls, replays moveend once. */
function fakeMap({ moving = false }: { moving?: boolean } = {}) {
  const paddings: { top: number; right: number; bottom: number; left: number }[] = [];
  let moveendCb: (() => void) | null = null;
  const map = {
    setPadding(p: { top: number; right: number; bottom: number; left: number }) {
      paddings.push(p);
    },
    getPadding() {
      return paddings[paddings.length - 1];
    },
    isMoving: () => moving,
    once(event: string, cb: () => void) {
      if (event === "moveend") moveendCb = cb;
    },
  };
  return {
    map: map as unknown as maplibregl.Map,
    paddings,
    startMoving() {
      moving = true;
    },
    settle() {
      moving = false;
      moveendCb?.();
      moveendCb = null;
    },
  };
}

// Node test env (no DOM): the controller reads clientWidth/clientHeight and
// writes dataset read-back stamps — a plain object covers both.
function el(width = 390, height = 844): HTMLElement {
  return { clientWidth: width, clientHeight: height, dataset: {} } as unknown as HTMLElement;
}

describe("createCameraController sheet wiring", () => {
  it("consults the sheet getter at CALL time, not construction time", () => {
    // The directions open or close (the getter flips) between padding commits —
    // the controller must frame against the sheet that is on screen now.
    let sheetOpen = false;
    const { map, paddings } = fakeMap();
    const camera = createCameraController({ map, el: el(), sheetOpen: () => sheetOpen });

    camera.applyCameraPadding();
    expect(paddings[0].bottom).toBe(MOBILE_CAMERA_PAD_BOTTOM_PX);

    sheetOpen = true;
    camera.applyCameraPadding();
    expect(paddings[1].bottom).toBe(SHEET_BOTTOM);
  });

  it("returns and stamps the insets MapLibre applied", () => {
    const { map } = fakeMap();
    const element = el();
    const applied = createCameraController({ map, el: element }).applyCameraPadding();
    // No sheet getter: no sheet reserved.
    expect(applied).toEqual({ top: 76, right: 12, bottom: MOBILE_CAMERA_PAD_BOTTOM_PX, left: 12 });
    expect(element.dataset).toMatchObject({
      cameraPadTop: "76",
      cameraPadRight: "12",
      cameraPadBottom: String(MOBILE_CAMERA_PAD_BOTTOM_PX),
      cameraPadLeft: "12",
    });
  });

  it("applyCameraPaddingSafe applies immediately when the camera is at rest", () => {
    const { map, paddings } = fakeMap({ moving: false });
    const camera = createCameraController({ map, el: el() });
    camera.applyCameraPaddingSafe();
    expect(paddings).toHaveLength(1);
  });

  it("applyCameraPaddingSafe defers to moveend while an animation is in flight (setPadding would stop() it)", () => {
    const fake = fakeMap({ moving: true });
    const camera = createCameraController({ map: fake.map, el: el() });
    camera.applyCameraPaddingSafe();
    expect(fake.paddings).toHaveLength(0); // nothing committed mid-flight
    fake.settle();
    expect(fake.paddings).toHaveLength(1); // committed once the camera settled
  });

  it("coalesces queued deferred flips into one commit of the sheet state at settle time", () => {
    const fake = fakeMap({ moving: true });
    let sheetOpen = true;
    const camera = createCameraController({ map: fake.map, el: el(), sheetOpen: () => sheetOpen });
    camera.applyCameraPaddingSafe();
    sheetOpen = false;
    camera.applyCameraPaddingSafe();
    fake.settle();
    expect(fake.paddings).toHaveLength(1);
    expect(fake.paddings[0].bottom).toBe(MOBILE_CAMERA_PAD_BOTTOM_PX);
    // A later flip queues a fresh commit.
    fake.startMoving();
    sheetOpen = true;
    camera.applyCameraPaddingSafe();
    fake.settle();
    expect(fake.paddings).toHaveLength(2);
    expect(fake.paddings[1].bottom).toBe(SHEET_BOTTOM);
  });
});
