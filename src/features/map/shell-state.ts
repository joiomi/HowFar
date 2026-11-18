/**
 * Mobile shell state — how much of the result sheet is on screen around the map.
 *
 * Below the `md` breakpoint the result sheet opens at a one-line "peek" bar
 * until the user expands it, so the map keeps most of the screen. Desktop keeps
 * the sheet expanded — `deriveShell` is the single decision point, consumed by
 * rendering AND by `cameraPadding`, so the framed map area always matches the
 * chrome actually on screen.
 */

import type { SelectionStatus } from "@/features/map/selection-flow";

export type SheetState = "peek" | "expanded";

export interface ShellState {
  sheet: SheetState;
}

export interface ShellInputs {
  /** Viewport is below the `md` breakpoint (the phone layout). */
  isMobile: boolean;
  /** Selection status straight from the reducer. */
  selStatus: SelectionStatus;
  /** User expanded the sheet from the peek bar; sticky per selection. */
  userSheetExpanded: boolean;
  /** Right-click/long-press directions are showing in the result sheet. */
  reachActive: boolean;
}

export const EXPANDED_SHELL: ShellState = { sheet: "expanded" };

/**
 * Derivation rules:
 * - Desktop: always expanded.
 * - Phone: the sheet peeks by default; the user can expand it, and active
 *   directions FORCE it expanded (a journey answer must never hide behind a
 *   peek bar). An error forces it expanded too: the SelectionCard inside is
 *   the only surface that renders the failure message, and a peek bar reading
 *   "Result" over a hidden alert is a silent failure.
 */
export function deriveShell(i: ShellInputs): ShellState {
  if (!i.isMobile) return EXPANDED_SHELL;
  return { sheet: i.reachActive || i.userSheetExpanded || i.selStatus === "error" ? "expanded" : "peek" };
}
