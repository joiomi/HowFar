import type maplibregl from "maplibre-gl";

import { cameraPadding } from "@/features/map/camera";
import { EXPANDED_SHELL, type ShellState } from "@/features/map/shell-state";
import type { EdgeInsets } from "@/features/map/route-framing";

/**
 * Owns the map's permanent edge padding: the insets that keep a
 * selection centred in the map area the shell's surfaces don't cover. Split out of `AppMap`
 * as the first leaf controller — it depends only on the map and its container.
 * `cameraPadding` (the pure size→inset math) stays unit-tested in `camera.ts`;
 * this glue commits it to MapLibre and stamps the read-back attributes the e2e
 * suite asserts. No timers/listeners, so `dispose` is a no-op (kept for the
 * uniform factory contract).
 *
 * `shell` reports the live mobile sheet state. It is a getter, not a value:
 * AppMap derives it from refs that the selection flow updates synchronously
 * before `renderSelection` runs, so the padding committed immediately before
 * the selection flyTo already reflects the sheet that is ABOUT to return to
 * peek — the required ordering (framing must never run against stale
 * expanded-sheet insets).
 */
export function createCameraController({
  map,
  el,
  shell = () => EXPANDED_SHELL,
}: {
  map: maplibregl.Map;
  el: HTMLElement;
  shell?: () => ShellState;
}) {
  function applyCameraPadding(hasResults: boolean): EdgeInsets {
    const padding = cameraPadding(el.clientWidth, el.clientHeight, hasResults, shell());
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

  // A user shell flip (sheet peek/expand) can land mid-flyTo, and
  // `map.setPadding` internally runs `jumpTo`, which unconditionally `stop()`s
  // whatever camera animation is in flight (the documented trap that
  // once killed every search's zoom). Selection framing applies its padding
  // BEFORE starting the flyTo, so this deferred variant is only for flips that
  // do not come with their own camera move: apply now when the camera is at
  // rest, otherwise once it settles.
  let deferredHasResults: boolean | null = null;
  function applyCameraPaddingSafe(hasResults: boolean): void {
    if (!map.isMoving()) {
      applyCameraPadding(hasResults);
      return;
    }
    const alreadyQueued = deferredHasResults !== null;
    deferredHasResults = hasResults;
    if (alreadyQueued) return;
    map.once("moveend", () => {
      const pending = deferredHasResults;
      deferredHasResults = null;
      if (pending !== null) applyCameraPadding(pending);
    });
  }

  return {
    applyCameraPadding,
    applyCameraPaddingSafe,
    dispose() {},
  };
}

export type CameraController = ReturnType<typeof createCameraController>;
