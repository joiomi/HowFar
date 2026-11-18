import type maplibregl from "maplibre-gl";

import { cameraPadding } from "@/features/map/camera";
import type { EdgeInsets } from "@/features/map/route-framing";

/**
 * Owns the map's permanent edge padding: the insets that keep a
 * selection centred in the map area the shell's surfaces don't cover. Split out of `AppMap`
 * as the first leaf controller — it depends only on the map and its container.
 * `cameraPadding` (the pure size→inset math) stays unit-tested in `camera.ts`;
 * this glue commits it to MapLibre and stamps the read-back attributes the e2e
 * suite asserts. No timers; the only listener is a deferred commit's one-shot
 * `moveend`, which goes with the map, so `dispose` is a no-op (kept for the
 * uniform factory contract).
 *
 * `sheetOpen` reports whether the directions sheet is on screen. It is a
 * getter, not a value: AppMap backs it with a ref the directions controller
 * updates synchronously, so a commit made in the same tick as the directions
 * opening or closing (a journey fit, a resize) already frames against the sheet
 * that is on screen. Without it no sheet is reserved.
 */
export function createCameraController({
  map,
  el,
  sheetOpen = () => false,
}: {
  map: maplibregl.Map;
  el: HTMLElement;
  sheetOpen?: () => boolean;
}) {
  function applyCameraPadding(): EdgeInsets {
    const padding = cameraPadding(el.clientWidth, el.clientHeight, sheetOpen());
    // Permanent MapLibre edge insets — route fit and interrupted flyTo paths
    // read map.getPadding(), so dataset stamps alone are not enough.
    map.setPadding(padding);
    const live = map.getPadding();
    const applied = {
      top: live.top ?? padding.top,
      right: live.right ?? padding.right,
      bottom: live.bottom ?? padding.bottom,
      left: live.left ?? padding.left,
    };
    el.dataset.cameraPadTop = String(applied.top);
    el.dataset.cameraPadRight = String(applied.right);
    el.dataset.cameraPadBottom = String(applied.bottom);
    el.dataset.cameraPadLeft = String(applied.left);
    return applied;
  }

  // The directions sheet can open or close mid-flyTo, and `map.setPadding`
  // internally runs `jumpTo`, which unconditionally `stop()`s whatever camera
  // animation is in flight (the documented trap that once killed every search's
  // zoom). Selection framing applies its padding BEFORE starting the flyTo, so
  // this deferred variant is only for sheet changes that do not come with their
  // own camera move: apply now when the camera is at rest, otherwise once it
  // settles. Queued requests coalesce into one commit, which reads the sheet
  // state at that moment.
  let queued = false;
  function applyCameraPaddingSafe(): void {
    if (!map.isMoving()) {
      applyCameraPadding();
      return;
    }
    if (queued) return;
    queued = true;
    map.once("moveend", () => {
      queued = false;
      applyCameraPadding();
    });
  }

  return {
    applyCameraPadding,
    applyCameraPaddingSafe,
    dispose() {},
  };
}

export type CameraController = ReturnType<typeof createCameraController>;
