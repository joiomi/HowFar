import { useEffect, useRef } from "react";

import { TRANSITOUS_SOURCES_URL } from "@/features/map/credits";
import { Icon } from "@/features/map/icons";
import type { StepChip } from "@/features/map/reach";
import type { ReachView } from "@/features/map/reach-directions-controller";

/**
 * The right-click / long-press directions, rendered in the result sheet (which
 * opens only for them). Pure presentation of the reach-directions controller's
 * `ReachView`: a header (bus icon, title, detail, ✕), the trip as a strip of
 * step chips joined by arrows, and the "© Transitous" credit in the footer —
 * the one Transitous credit on screen while the sheet is open. Chip hover/focus
 * drives the map highlight via `onHighlight`; ✕ and Escape close via `onClose`.
 *
 * A11y: the map container is a plain div, so focus can't just
 * "return to the map" implicitly. On open we move focus to the panel heading
 * (tabIndex -1 + ref); Escape and ✕ close and AppMap returns focus to the map
 * container. Each chip is keyboard-reachable (tabIndex 0, focus == hover) and
 * named by its full step, so the short chip text loses nothing. All text is
 * React text nodes — OSM stop names / line headsigns stay untrusted.
 */

interface ReachPanelProps {
  view: ReachView;
  onHighlight: (index: number | null) => void;
  onClose: () => void;
}

// The metro keeps its own blue; buses, trams and trains share one violet; walking
// is a neutral chip.
const CHIP_TONE: Record<StepChip["tone"], string> = {
  metro: "bg-[#2563eb] text-white",
  surface: "bg-[#5b4a9e] text-white",
  walk: "bg-white/[.07] text-[var(--hf-text)] ring-1 ring-inset ring-[var(--hf-border)]",
};

/**
 * Whether an Escape key press closes the directions. Not one the address bar gets
 * (its own Escape dismisses the suggestions, so the directions are not yanked out
 * from under it), and not one a surface above the sheet already handled: the ⓘ
 * popover closes first and marks the key handled, so one Escape closes only the
 * topmost surface and the next one reaches the sheet.
 */
export function escapeClosesDirections(event: Pick<KeyboardEvent, "key" | "defaultPrevented" | "target">): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) return false;
  return !(event.target as Element | null)?.closest?.('[data-testid="top-bar"]');
}

export default function ReachPanel({ view, onHighlight, onClose }: ReachPanelProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  // Move focus to the heading when the directions open (and whenever the view's
  // state changes to a new answer), so keyboard users land in the panel.
  useEffect(() => {
    headingRef.current?.focus();
  }, [view.state]);

  // Escape closes the directions from ANYWHERE: after the user
  // pans/clicks the map, focus leaves the panel, so a panel-scoped handler would
  // go dead. Listen at document level while mounted; `escapeClosesDirections`
  // decides which Escapes are the sheet's. One listener for the panel's life,
  // reading the latest `onClose` through a ref: re-subscribing on every parent
  // render could drop the listener in the middle of a key press (a render that
  // press caused removes it before it runs), so whether a press reached the sheet
  // would depend on what else re-rendered.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (escapeClosesDirections(e)) onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const steps = view.state === "transit" ? view.steps : undefined;

  return (
    <section data-testid="reach-panel" data-state={view.state} aria-label="Traseu" className="px-4">
      {/* Pinned to the sheet's top edge on an opaque panel, like the footer below:
          a long trip scrolls inside the sheet, and the ✕ must stay in reach (a
          phone has no Escape key). */}
      <div
        data-testid="reach-header"
        className="sticky top-0 z-10 flex items-start gap-3 bg-[var(--hf-panel-strong)] pb-1 pt-3"
      >
        <span
          data-testid="reach-icon"
          className="relative mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-[var(--hf-transit)]/15 text-[var(--hf-transit)]"
        >
          {/* While the trip loads the icon pulses: the shared ring pulse, which
              reduced motion stops. */}
          {view.state === "loading" ? (
            <span
              aria-hidden="true"
              className="hf-pulse absolute left-1/2 top-1/2 size-9 rounded-full border-2 border-[var(--hf-transit)]"
            />
          ) : null}
          <Icon name="bus" size={20} />
        </span>
        {/* aria-live region: a second right-click of the same kind updates the
            title/detail without remounting the panel, so this makes AT announce
            the new answer. */}
        <div aria-live="polite" aria-atomic="true" className="min-w-0 flex-1 pt-1.5">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-[0.95rem] font-semibold leading-5 text-[var(--hf-text)] outline-none"
          >
            {view.title}
          </h2>
          {view.detail ? <p className="mt-1 text-[0.8rem] leading-5 text-[var(--hf-muted)]">{view.detail}</p> : null}
        </div>
        <button
          type="button"
          aria-label="Închide"
          onClick={onClose}
          className="-mr-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-full text-[var(--hf-muted)] transition-colors hover:bg-white/[.08] hover:text-[var(--hf-text)]"
        >
          <Icon name="x" size={20} />
        </button>
      </div>

      {steps ? (
        // role="list": without list markers Safari drops the list semantics.
        <ol
          data-testid="reach-steps"
          role="list"
          aria-label="Pașii călătoriei"
          className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-2"
        >
          {steps.map((step, index) => {
            const label = `${step.primary}, ${step.secondary}`;
            return (
              <li
                key={index}
                data-step-mode={step.mode === "WALK" ? "walk" : "transit"}
                tabIndex={0}
                aria-label={label}
                title={label}
                onMouseEnter={() => onHighlight(index)}
                onMouseLeave={() => onHighlight(null)}
                onFocus={() => onHighlight(index)}
                onBlur={() => onHighlight(null)}
                // The focus ring goes on the chip, not around the arrow before it.
                className="group flex items-center gap-1 rounded-full focus-visible:outline-none!"
              >
                {index > 0 ? (
                  <span data-testid="step-arrow" aria-hidden="true" className="text-[var(--hf-subtle)]">
                    <Icon name="arrow" size={14} />
                  </span>
                ) : null}
                {/* Focus shows as a ring (a box-shadow) plus a transparent outline,
                    which forced-colors mode draws in the system colour where it
                    drops the shadow. */}
                <span
                  className={`inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-[0.84rem] font-semibold tabular-nums transition-shadow group-hover:shadow-[0_0_0_2px_var(--hf-border-strong)] group-focus-visible:shadow-[0_0_0_3px_var(--hf-accent)] group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-transparent ${CHIP_TONE[step.chip.tone]}`}
                >
                  <Icon name={step.chip.icon} size={17} />
                  {step.chip.text}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {/* Pinned to the sheet's bottom edge on an opaque panel: a long trip scrolls
          inside the sheet, and the credit must stay in view while it does. */}
      <p
        data-testid="reach-footer"
        className="sticky bottom-0 mt-1 flex justify-end bg-[var(--hf-panel-strong)] pb-2 pt-1"
      >
        <a
          data-testid="transitous-credit"
          href={TRANSITOUS_SOURCES_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-6 items-center text-[0.68rem] font-medium text-[var(--hf-muted)] hover:text-[var(--hf-text)]"
        >
          © Transitous
        </a>
      </p>
    </section>
  );
}
