/** Romanian interface strings shared by more than one part of the shell. */

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
