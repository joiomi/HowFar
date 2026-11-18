import { describe, expect, it } from "vitest";

import {
  cameraPadding,
  DESKTOP_BREAKPOINT_PX,
  DESKTOP_CAMERA_PAD_LEFT_PX,
  MOBILE_CAMERA_PAD_TOP_PX,
} from "./camera";

describe("cameraPadding", () => {
  it("reserves the desktop left column at md+ widths, whatever the shell state", () => {
    expect(DESKTOP_BREAKPOINT_PX).toBe(768);
    expect(DESKTOP_CAMERA_PAD_LEFT_PX).toBe(432);
    expect(cameraPadding(1280, 900, true)).toEqual({ top: 24, right: 24, bottom: 24, left: 432 });
    expect(cameraPadding(DESKTOP_BREAKPOINT_PX, 720, false)).toEqual({ top: 24, right: 24, bottom: 24, left: 432 });
    expect(cameraPadding(1280, 900, true, { sheet: "peek" })).toEqual(cameraPadding(1280, 900, true));
  });

  it("frames a short landscape phone against the same desktop column", () => {
    expect(cameraPadding(844, 390, true)).toEqual({ top: 24, right: 24, bottom: 24, left: 432 });
    expect(cameraPadding(844, 390, false)).toEqual({ top: 24, right: 24, bottom: 24, left: 432 });
  });

  it("keeps the mobile top inset to the address bar at every height", () => {
    expect(MOBILE_CAMERA_PAD_TOP_PX).toBe(76);
    expect(cameraPadding(390, 844, true).top).toBe(76);
    expect(cameraPadding(390, 640, true).top).toBe(76);
    expect(cameraPadding(390, 844, false, { sheet: "peek" }).top).toBe(76);
    expect(cameraPadding(390, 844, true)).toMatchObject({ left: 12, right: 12 });
  });

  it("reserves the result sheet at the bottom: the peek bar, or the expanded sheet by height", () => {
    expect(cameraPadding(390, 844, true, { sheet: "peek" }).bottom).toBe(124);
    expect(cameraPadding(390, 844, true, { sheet: "expanded" }).bottom).toBe(228);
    expect(cameraPadding(390, 640, true, { sheet: "expanded" }).bottom).toBe(168);
    // A compact sheet never reserves more than the expanded one would.
    expect(cameraPadding(390, 640, true, { sheet: "peek" }).bottom).toBeLessThanOrEqual(168);
  });

  it("keeps the no-results bottom inset regardless of sheet state", () => {
    expect(cameraPadding(390, 844, false, { sheet: "peek" }).bottom).toBe(64);
    expect(cameraPadding(390, 844, false, { sheet: "expanded" }).bottom).toBe(64);
  });
});
