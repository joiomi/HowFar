/**
 * Shared responsive camera-inset contract. Every camera movement that frames a
 * subject must account for the same visible UI footprint: the left column
 * (address bar, mode pill, result card) at 768 px and wider, or the top address
 * bar and bounded result sheet on a phone.
 */

import { EXPANDED_SHELL, type ShellState } from "@/features/map/shell-state";

/** Tailwind `md` breakpoint — the desktop layout (left column) starts here. */
export const DESKTOP_BREAKPOINT_PX = 768;

/** 16px page edge + 400px left column + 16px map breathing room. */
export const DESKTOP_CAMERA_PAD_LEFT_PX = 432;

/** 12px gap + the 52px address bar + 12px breathing room. */
export const MOBILE_CAMERA_PAD_TOP_PX = 76;

const SHORT_VIEWPORT_HEIGHT_PX = 700;
export const MOBILE_CAMERA_PAD_BOTTOM_PX = 228;
export const MOBILE_SHORT_CAMERA_PAD_BOTTOM_PX = 168;
/** Peek sheet = one-line bar (~62px) above the 2.8rem bottom offset + breathing room. */
export const MOBILE_CAMERA_PAD_BOTTOM_PEEK_PX = 124;

export interface CameraPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Camera padding for the current shell geometry. At 768 px and wider (a
 * landscape phone included) the left column is reserved and the other edges
 * keep a small breathing room. On a phone the address bar is reserved at the
 * top at every height; `hasResults` controls the bottom inset: before a
 * selection there is no result sheet, while a resolved/error state reserves a
 * bounded sheet footprint — only the one-line bar when `shell.sheet` is
 * "peek". Desktop ignores `shell`. It defaults to the expanded shell, so
 * callers that omit it reserve the full sheet.
 */
export function cameraPadding(
  viewportWidthPx: number,
  viewportHeightPx: number,
  hasResults: boolean,
  shell: ShellState = EXPANDED_SHELL,
): CameraPadding {
  if (viewportWidthPx >= DESKTOP_BREAKPOINT_PX) {
    return { top: 24, right: 24, bottom: 24, left: DESKTOP_CAMERA_PAD_LEFT_PX };
  }

  const expandedBottom =
    viewportHeightPx <= SHORT_VIEWPORT_HEIGHT_PX ? MOBILE_SHORT_CAMERA_PAD_BOTTOM_PX : MOBILE_CAMERA_PAD_BOTTOM_PX;
  return {
    top: MOBILE_CAMERA_PAD_TOP_PX,
    right: 12,
    bottom: hasResults
      ? shell.sheet === "peek"
        ? Math.min(MOBILE_CAMERA_PAD_BOTTOM_PEEK_PX, expandedBottom)
        : expandedBottom
      : 64,
    left: 12,
  };
}
