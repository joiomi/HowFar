/** Romanian interface strings shared by more than one part of the shell. */

import { presetReachCaveat } from "@/features/isochrones/preset-view";
import type { Mode } from "@/features/map/selection-flow";

/** The search field's accessible name, and its placeholder once a place has been chosen. */
export const SEARCH_PLACEHOLDER = "Caută o adresă";

/** Placeholder before anything is chosen: the map itself is the other way in. */
export const SEARCH_PLACEHOLDER_FIRST_OPEN = "Caută o adresă sau atinge harta";

/** The travel modes' names: the mode buttons' accessible names. */
export const MODE_NAMES: Record<Mode, string> = { walk: "Pe jos", transit: "Transport public", car: "Mașina" };

/**
 * A minute count as Romanian words for an accessible name: "1 minut", "10 minute",
 * "20 de minute". Romanian puts "de" before the noun once the number's last two
 * digits are 0 or 20 and above (so 100 and 120 take it, 101 does not).
 */
export function minutesLabel(n: number): string {
  if (n === 1) return "1 minut";
  const lastTwo = n % 100;
  return n !== 0 && (lastTwo === 0 || lastTwo >= 20) ? `${n} de minute` : `${n} minute`;
}

/** The info button's accessible name, and the popover's. */
export const INFO_LABEL = "Despre estimări și surse";

/** Under the transit caveat: why a bus or tram trip can run longer at rush hour. */
export const TRANSIT_NOTE = "Metroul nu depinde de trafic; autobuzul și tramvaiul pot întârzia la aglomerație.";

/**
 * What the info popover says for the drawn mode: its caveat, the transit note on
 * transit, and whether Transitous is credited (any state showing Transitous data:
 * a transit reach or open directions).
 */
export function infoContent(mode: Mode, transitState: boolean): { caveat: string; note: string | null; transitous: boolean } {
  return { caveat: presetReachCaveat(mode), note: mode === "transit" ? TRANSIT_NOTE : null, transitous: transitState };
}
