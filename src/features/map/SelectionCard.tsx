import { MODE_ACCENT, MODE_LABEL } from "@/features/isochrones/isochrone-view";
import { PRESET_GRADIENT_STOPS, presetReachExplainer } from "@/features/isochrones/preset-view";
import type { Mode } from "@/features/map/selection-flow";

/**
 * Selected-address card: the resolved label + the phone-first PRESET reach legend
 * and explainer, or the loading state. A failure is not shown here: the error
 * banner over the map carries it. Pure presentation of the selection machine's
 * state. The legend + explainer derive from the SELECTED preset minute
 * (walk 10/20, transit 20/40, car 10/25), so they can never claim a reach the map
 * isn't drawing (phone-first). The mode's caveat and the transit note live in
 * the info popover (InfoControl), which every map state shows.
 */

interface SelectionCardProps {
  label: string | null;
  mode: Mode;
  /** The selected preset minute (the reach edge). */
  selectedMin: number;
  loading: boolean;
}

export default function SelectionCard({ label, mode, selectedMin, loading }: SelectionCardProps) {
  if (!label && !loading) return null;
  const modeColor = MODE_ACCENT[mode];
  const stops = PRESET_GRADIENT_STOPS[mode];
  return (
    <div
      aria-live="polite"
      aria-busy={loading}
      className="rounded-[1.1rem] border border-white/[.08] bg-white/[.035] p-3.5 md:p-4"
    >
      {loading ? (
        <div className="flex min-h-14 items-center gap-3">
          <span className="hf-spinner size-5 shrink-0 rounded-full border-2 border-[#c7f36b]/25 border-t-[#c7f36b]" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-[#f4f7f2]">Mapping your everyday reach…</p>
            <p className="mt-1 text-xs text-[#78857b]">Calculating routes across the city</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-white/[.05] ring-1 ring-white/[.08]"
              style={{ color: modeColor }}
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" className="size-[1.1rem]" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" />
                <circle cx="12" cy="10" r="2" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[#78857b]">Your selected place</p>
              <p className="mt-1 line-clamp-2 text-sm font-medium leading-5 text-[#edf2ed]">{label}</p>
            </div>
          </div>
          <div
            data-testid="ring-legend"
            className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/[.07] pt-3 text-[0.7rem] text-[#9ca9a0]"
          >
            <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: modeColor }}>
              <span className="size-1.5 rounded-full bg-current" />
              {MODE_LABEL[mode]}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-8 rounded-full ring-1 ring-white/20"
                style={{ background: `linear-gradient(90deg, ${stops.origin}, ${stops.mid}, ${stops.edge})` }}
              />
              <span data-testid="reach-minutes" className="tabular-nums">≤ {selectedMin} min</span>
            </span>
            <span className="ml-auto text-[#667269]">shown on map</span>
          </div>
          <p data-testid="ring-explainer" className="mt-2 text-[0.68rem] leading-4 text-[#9ca9a0]">
            {presetReachExplainer(mode, selectedMin)}
          </p>
        </>
      )}
    </div>
  );
}
