import type { JSX } from "react";

import { TRANSITOUS_SOURCES_URL } from "@/features/map/credits";

/**
 * The visible Transitous credit, required whenever a value derived from
 * Transitous data is on screen (a transit reach, a transit trip). The basemap
 * credits (OpenStreetMap, ESA WorldCover, Natural Earth) are shown by the
 * MapLibre attribution control instead. Placement is the caller's.
 */
export default function TransitousCredit(): JSX.Element {
  return (
    <a
      data-testid="transitous-credit"
      href={TRANSITOUS_SOURCES_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-6 items-center rounded-full border border-[var(--hf-border)] bg-[var(--hf-panel)] px-2.5 text-[0.68rem] font-medium text-[var(--hf-muted)] shadow-[0_8px_20px_rgba(0,0,0,.24)] backdrop-blur-xl transition-colors hover:text-[var(--hf-text)]"
    >
      © Transitous
    </a>
  );
}
