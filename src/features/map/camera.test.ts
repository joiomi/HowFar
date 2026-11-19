import { describe, expect, it } from "vitest";

import {
  cameraPadding,
  DESKTOP_BREAKPOINT_PX,
  DESKTOP_CAMERA_PAD_LEFT_PX,
  MOBILE_CAMERA_PAD_BOTTOM_PX,
  MOBILE_CAMERA_PAD_TOP_PX,
  mobileSheetPadBottom,
} from "./camera";

describe("cameraPadding", () => {
  it("frames a phone between the address bar and the mode pill when no sheet is open", () => {
    expect(MOBILE_CAMERA_PAD_TOP_PX).toBe(76);
    expect(MOBILE_CAMERA_PAD_BOTTOM_PX).toBe(70); // 12 + the 48 px pill + 10
    expect(cameraPadding(390, 844, false)).toEqual({ top: 76, right: 12, bottom: 70, left: 12 });
    expect(cameraPadding(360, 780, false)).toEqual({ top: 76, right: 12, bottom: 70, left: 12 });
    // The same at a short height: nothing at the bottom grows with the viewport.
    expect(cameraPadding(390, 600, false)).toEqual({ top: 76, right: 12, bottom: 70, left: 12 });
  });

  it("reserves the directions sheet at the bottom of a phone while it is open, by height", () => {
    expect(cameraPadding(390, 844, true).bottom).toBe(300);
    expect(cameraPadding(360, 780, true).bottom).toBe(300);
    expect(cameraPadding(390, 600, true).bottom).toBe(252);
    expect(cameraPadding(390, 844, true)).toMatchObject({ top: 76, right: 12, left: 12 });
  });

  it("sizes the sheet reserve as the sheet's cap, min(40% of the height, 288 px), plus 12 px", () => {
    // The cap binds from 720 px up.
    expect(mobileSheetPadBottom(844)).toBe(300);
    expect(mobileSheetPadBottom(720)).toBe(300);
    // Below it the reserve follows 40% of the height, rounded to a whole pixel.
    expect(mobileSheetPadBottom(700)).toBe(292);
    expect(mobileSheetPadBottom(647)).toBe(271); // 258.8 rounds up
    expect(mobileSheetPadBottom(646)).toBe(270); // 258.4 rounds down
    expect(mobileSheetPadBottom(600)).toBe(252);
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
