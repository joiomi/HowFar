import type { JSX, KeyboardEvent } from "react";

import { INFO_LABEL, infoContent } from "@/features/map/copy";
import { BASEMAP_CREDITS, TRANSITOUS_SOURCES_URL, type CreditLink } from "@/features/map/credits";
import { Icon } from "@/features/map/icons";
import type { Mode } from "@/features/map/selection-flow";

/** How long the popover stays open on its own after the map first loads. */
export const INFO_AUTO_OPEN_MS = 5000;

interface InfoControlProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  /** A state showing Transitous data (a transit reach or open directions): Transitous is credited too. */
  transitState: boolean;
}

function Credit({ credit }: { credit: CreditLink }) {
  return (
    <a
      href={credit.href}
      target="_blank"
      rel="noreferrer"
      className="whitespace-nowrap font-medium text-[var(--hf-text)] underline decoration-white/30 underline-offset-2 hover:decoration-current"
    >
      {credit.label}
    </a>
  );
}

/**
 * The ⓘ control: a 44 px button that opens a popover holding the drawn mode's
 * caveat (marked "~", an estimate), the transit note on transit, and the data
 * credits: OpenStreetMap, ESA WorldCover with its licence and the "modificat"
 * indication, Daylight, Natural Earth, and Transitous on transit states. It is
 * the only place the basemap credits are shown, so the shell renders it in every
 * map state. Presentation only: AppMap owns `open` (the first-load auto-open and
 * the closes on a map tap, a pan or the address field). Escape inside the control
 * closes the popover and puts focus back on the button.
 */
export default function InfoControl({ open, onOpenChange, mode, transitState }: InfoControlProps): JSX.Element {
  const { caveat, note, transitous } = infoContent(mode, transitState);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !open) return;
    onOpenChange(false);
    event.currentTarget.querySelector<HTMLButtonElement>('[data-testid="info-button"]')?.focus();
  }
  return (
    <div className="contents" onKeyDown={onKeyDown}>
      <button
        type="button"
        data-testid="info-button"
        aria-label={INFO_LABEL}
        aria-expanded={open}
        aria-controls="info-popover"
        onClick={() => onOpenChange(!open)}
        className="hf-floating pointer-events-auto absolute right-2.5 top-[68px] z-30 grid size-11 place-items-center md:right-4 md:top-4"
      >
        <span className="grid size-8 place-items-center rounded-full border border-[var(--hf-border)] bg-[var(--hf-panel)] text-[var(--hf-muted)] shadow-[0_8px_20px_rgba(0,0,0,.3)] backdrop-blur-xl">
          <Icon name="info" size={18} />
        </span>
      </button>
      {open ? (
        <div
          id="info-popover"
          data-testid="info-popover"
          role="dialog"
          aria-label={INFO_LABEL}
          className="pointer-events-auto absolute left-3 right-3 top-[7.25rem] z-30 rounded-[1.25rem] border border-[var(--hf-border)] bg-[var(--hf-panel-strong)] p-3.5 shadow-[var(--hf-shadow-float)] backdrop-blur-2xl md:left-auto md:right-4 md:top-[4.5rem] md:w-[360px]"
        >
          <p className="flex gap-2 text-[0.84rem] leading-5 text-[var(--hf-text)]">
            <span aria-hidden="true" className="shrink-0 font-bold text-[var(--hf-accent)]">
              ~
            </span>
            <span>{caveat}</span>
          </p>
          {note ? <p className="mt-2 text-[0.84rem] leading-5 text-[var(--hf-muted)]">{note}</p> : null}
          <p className="mt-3 border-t border-[var(--hf-border)] pt-2.5 text-[0.75rem] leading-5 text-[var(--hf-muted)]">
            {"© "}
            <Credit credit={BASEMAP_CREDITS.osm} />
            {" · "}
            <Credit credit={BASEMAP_CREDITS.esa} />
            {" ("}
            <Credit credit={BASEMAP_CREDITS.ccBy} />
            {"), modificat, via "}
            <Credit credit={BASEMAP_CREDITS.daylight} />
            {" · "}
            <Credit credit={BASEMAP_CREDITS.naturalEarth} />
            {transitous ? (
              <>
                {" · "}
                <Credit credit={{ label: "Transitous", href: TRANSITOUS_SOURCES_URL }} />
              </>
            ) : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}
