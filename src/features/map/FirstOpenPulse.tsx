import type { JSX } from "react";

/**
 * First open, before any place: a pulsing target dot at the centre of the framed
 * map (the phone's centre; from md the centre of the map beside the 432 px left
 * column, half of 432 − 24 to the right). It points at the map as the other way in
 * besides the address search. Decoration only: hidden from assistive tech and
 * pointer-transparent, so a tap on it selects the map point beneath. The caller
 * removes it once a place is chosen.
 */
export default function FirstOpenPulse(): JSX.Element {
  return (
    <div
      data-testid="first-open-pulse"
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1/2 z-10 size-14 -translate-x-1/2 -translate-y-1/2 md:left-[calc(50%+204px)]"
    >
      <span className="hf-pulse absolute left-1/2 top-1/2 size-12 rounded-full border-2 border-[var(--hf-accent)]" />
      <span className="absolute left-1/2 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#f7fff7] bg-[var(--hf-accent)] shadow-[0_0_0_4px_rgba(8,11,9,.6)]" />
    </div>
  );
}
