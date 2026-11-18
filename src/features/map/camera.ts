/**
 * Shared responsive camera-inset contract. Every camera movement that frames a
 * subject must account for the same visible UI footprint: the left column
 * (address bar and mode pill) at 768 px and wider, or on a phone the top address
 * bar and the bottom mode pill, plus the directions sheet while it is open.
 */

/** Tailwind `md` breakpoint — the desktop layout (left column) starts here. */
export const DESKTOP_BREAKPOINT_PX = 768;

/** 16px page edge + 400px left column + 16px map breathing room. */
export const DESKTOP_CAMERA_PAD_LEFT_PX = 432;

/** 12px gap + the 52px address bar + 12px breathing room. */
export const MOBILE_CAMERA_PAD_TOP_PX = 76;

/** 12px gap + the 48px mode pill + 10px breathing room. */
export const MOBILE_CAMERA_PAD_BOTTOM_PX = 70;

const SHORT_VIEWPORT_HEIGHT_PX = 700;
/** The open directions sheet on a phone, by viewport height. */
const MOBILE_SHEET_CAMERA_PAD_BOTTOM_PX = 228;
const MOBILE_SHORT_SHEET_CAMERA_PAD_BOTTOM_PX = 168;

export interface CameraPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Camera padding for the current shell geometry. At 768 px and wider (a
 * landscape phone included) the left column is reserved and the other edges
 * keep a small breathing room, sheet or not: the sheet sits in that column. On a
 * phone the address bar is reserved at the top, and the bottom reserves the mode
 * pill, or the directions sheet (sized by viewport height) while `sheetOpen`.
 */
export function cameraPadding(viewportWidthPx: number, viewportHeightPx: number, sheetOpen: boolean): CameraPadding {
  if (viewportWidthPx >= DESKTOP_BREAKPOINT_PX) {
    return { top: 24, right: 24, bottom: 24, left: DESKTOP_CAMERA_PAD_LEFT_PX };
  }

  const sheetBottom =
    viewportHeightPx <= SHORT_VIEWPORT_HEIGHT_PX
      ? MOBILE_SHORT_SHEET_CAMERA_PAD_BOTTOM_PX
      : MOBILE_SHEET_CAMERA_PAD_BOTTOM_PX;
  return {
    top: MOBILE_CAMERA_PAD_TOP_PX,
    right: 12,
    bottom: sheetOpen ? sheetBottom : MOBILE_CAMERA_PAD_BOTTOM_PX,
    left: 12,
  };
}
