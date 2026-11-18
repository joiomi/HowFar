import { describe, expect, it } from "vitest";

import {
  cameraPadding,
  DESKTOP_BREAKPOINT_PX,
  DESKTOP_CAMERA_PAD_LEFT_PX,
  MOBILE_CAMERA_PAD_BOTTOM_PX,
  MOBILE_CAMERA_PAD_TOP_PX,
} from "./camera";

describe("cameraPadding", () => {
  it("frames a phone between the address bar and the mode pill when no sheet is open", () => {
    expect(MOBILE_CAMERA_PAD_TOP_PX).toBe(76);
    expect(MOBILE_CAMERA_PAD_BOTTOM_PX).toBe(70); // 12 + the 46 px pill + 12
    expect(cameraPadding(390, 844, false)).toEqual({ top: 76, right: 12, bottom: 70, left: 12 });
    expect(cameraPadding(360, 780, false)).toEqual({ top: 76, right: 12, bottom: 70, left: 12 });
    // The same at a short height: nothing at the bottom grows with the viewport.
    expect(cameraPadding(390, 600, false)).toEqual({ top: 76, right: 12, bottom: 70, left: 12 });
  });

  it("reserves the directions sheet at the bottom of a phone while it is open, by height", () => {
    expect(cameraPadding(390, 844, true).bottom).toBe(228);
    expect(cameraPadding(390, 640, true).bottom).toBe(168);
    expect(cameraPadding(390, 844, true)).toMatchObject({ top: 76, right: 12, left: 12 });
  });

  it("reserves the desktop left column at md+ widths, sheet open or not", () => {
    expect(DESKTOP_BREAKPOINT_PX).toBe(768);
    expect(DESKTOP_CAMERA_PAD_LEFT_PX).toBe(432);
    expect(cameraPadding(1280, 900, true)).toEqual({ top: 24, right: 24, bottom: 24, left: 432 });
    expect(cameraPadding(1280, 900, false)).toEqual({ top: 24, right: 24, bottom: 24, left: 432 });
    expect(cameraPadding(DESKTOP_BREAKPOINT_PX, 720, false)).toEqual({ top: 24, right: 24, bottom: 24, left: 432 });
  });

  it("frames a landscape phone against the same desktop column", () => {
    expect(cameraPadding(844, 390, false)).toEqual(cameraPadding(1280, 900, false));
    expect(cameraPadding(844, 390, true)).toEqual(cameraPadding(1280, 900, false));
  });

  it("switches layouts at the md breakpoint", () => {
    expect(cameraPadding(DESKTOP_BREAKPOINT_PX - 1, 844, false).left).toBe(12);
    expect(cameraPadding(DESKTOP_BREAKPOINT_PX, 844, false).left).toBe(432);
  });
});
