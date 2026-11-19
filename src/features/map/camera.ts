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

/** The phone directions sheet's height cap, `max-h-[min(40dvh,18rem)]`: 40% of
 * the viewport height, at most 288 px. */
const MOBILE_SHEET_MAX_HEIGHT_RATIO = 0.4;
const MOBILE_SHEET_MAX_HEIGHT_PX = 288;
/** Breathing room above the sheet. */
const MOBILE_SHEET_GAP_PX = 12;

/**
 * The bottom inset that keeps a framed subject clear of the open directions sheet
 * on a phone: the sheet's height cap, round(min(0.4·h, 288)), plus 12 px. The
 * sheet is sized by its content up to that cap, so the reserve never falls short
 * of the sheet on screen.
 */
export function mobileSheetPadBottom(viewportHeightPx: number): number {
  return (
    Math.round(Math.min(MOBILE_SHEET_MAX_HEIGHT_RATIO * viewportHeightPx, MOBILE_SHEET_MAX_HEIGHT_PX)) +
    MOBILE_SHEET_GAP_PX
  );
}

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
 * pill, or the directions sheet (`mobileSheetPadBottom`, by viewport height)
 * while `sheetOpen`; the mode pill is hidden then.
 */
export function cameraPadding(viewportWidthPx: number, viewportHeightPx: number, sheetOpen: boolean): CameraPadding {
  if (viewportWidthPx >= DESKTOP_BREAKPOINT_PX) {
    return { top: 24, right: 24, bottom: 24, left: DESKTOP_CAMERA_PAD_LEFT_PX };
  }

  return {
    top: MOBILE_CAMERA_PAD_TOP_PX,
    right: 12,
    bottom: sheetOpen ? mobileSheetPadBottom(viewportHeightPx) : MOBILE_CAMERA_PAD_BOTTOM_PX,
    left: 12,
  };
}
