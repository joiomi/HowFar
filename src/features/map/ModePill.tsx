import type { JSX } from "react";

import { MODE_ACCENT } from "@/features/isochrones/isochrone-view";
import type { Pace } from "@/features/isochrones/pace";
import { PRESET_MIN_BY_MODE, type PresetIndex } from "@/features/isochrones/preset-reach";
import { TIME_PRESETS, type TimePresetId } from "@/features/isochrones/time-context";
import { minutesLabel, MODE_NAMES } from "@/features/map/copy";
import { Icon, type IconName } from "@/features/map/icons";
import { MODES, type Mode } from "@/features/map/selection-flow";

/**
 * The floating mode pill: the three travel modes, the active mode's two
 * calibrated presets (walk 10/20, transit 20/40, car 10/25), and one toggle —
 * a turtle for walking pace (pressed = Slow) or a clock for the transit/car
 * departure (8:30 rush, the default, or 12:30). It sits above the result sheet
 * on a phone and under the address bar from 768 px. Presentation only: AppMap
 * owns every state change.
 *
 * A preset only changes which served contour is painted (both come in one
 * response), so it never refetches. A mode whose reach failed keeps a "!" badge
 * on its button and says so in its accessible name.
 */

export interface ModePillProps {
  mode: Mode;
  presetIndex: PresetIndex;
  pace: Pace;
  timePreset: TimePresetId;
  /** The mode whose reach failed to load, flagged on its button. */
  failedMode: Mode | null;
  onSwitchMode: (m: Mode) => void;
  onSelectPreset: (i: PresetIndex) => void;
  onTogglePace: () => void;
  onToggleTime: () => void;
}

const MODE_ICON: Record<Mode, IconName> = { walk: "walk", transit: "bus", car: "car" };

/** Text colour on a mode's accent fill. */
const MODE_INK = "#08130f";

function Divider() {
  return <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-[var(--hf-border)]" />;
}

export default function ModePill({
  mode,
  presetIndex,
  pace,
  timePreset,
  failedMode,
  onSwitchMode,
  onSelectPreset,
  onTogglePace,
  onToggleTime,
}: ModePillProps): JSX.Element {
  const time = TIME_PRESETS[timePreset];
  return (
    <div
      data-testid="mode-pill"
      className="hf-mode-pill pointer-events-auto absolute bottom-[calc(var(--hf-sheet-clearance,0px)+0.75rem)] left-3 z-30 flex items-center gap-0.5 rounded-full border border-[var(--hf-border)] bg-[var(--hf-panel)] p-[3px] shadow-[0_12px_30px_rgba(0,0,0,.4)] backdrop-blur-xl md:bottom-auto md:left-4 md:top-[5.25rem]"
    >
      <div role="group" aria-label="Cum te deplasezi" className="flex items-center gap-0.5">
        {MODES.map((m) => {
          const active = m === mode;
          const failed = m === failedMode;
          return (
            <button
              key={m}
              type="button"
              data-testid={`mode-icon-${m}`}
              aria-pressed={active}
              aria-label={failed ? `${MODE_NAMES[m]} (indisponibil)` : MODE_NAMES[m]}
              onClick={() => onSwitchMode(m)}
              style={active ? { background: MODE_ACCENT[m], color: MODE_INK } : undefined}
              className={`relative grid size-10 shrink-0 place-items-center rounded-full transition-[background-color,color] ${
                active ? "" : "text-[var(--hf-muted)] hover:bg-white/[.06] hover:text-[var(--hf-text)]"
              }`}
            >
              <Icon name={MODE_ICON[m]} size={22} />
              {failed ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-[var(--hf-danger)] text-[0.6rem] font-bold text-[#2a0f0a] ring-2 ring-[#0d110e]"
                >
                  !
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <Divider />
      <div role="group" aria-label="Timp" className="flex items-center gap-0.5">
        {PRESET_MIN_BY_MODE[mode].map((min, i) => {
          const active = i === presetIndex;
          return (
            <button
              key={min}
              type="button"
              data-testid={`preset-chip-${min}`}
              aria-pressed={active}
              aria-label={minutesLabel(min)}
              onClick={() => onSelectPreset(i as PresetIndex)}
              className={`flex h-10 w-[42px] shrink-0 flex-col items-center justify-center rounded-full leading-none transition-[background-color,color] ${
                active
                  ? "bg-[#edf2ed] text-[#111713]"
                  : "text-[var(--hf-muted)] hover:bg-white/[.06] hover:text-[var(--hf-text)]"
              }`}
            >
              <b className="text-[17px] font-bold tabular-nums">{min}</b>
              <small className="mt-0.5 text-[10px] font-semibold opacity-80">min</small>
            </button>
          );
        })}
      </div>
      <Divider />
      {mode === "walk" ? (
        <button
          type="button"
          data-testid="pace-toggle"
          aria-pressed={pace === "slow"}
          aria-label="Mers încet"
          onClick={onTogglePace}
          className={`grid h-10 min-w-10 shrink-0 place-items-center rounded-full px-2 transition-[background-color,color] ${
            pace === "slow"
              ? "bg-white/10 text-[var(--hf-text)]"
              : "text-[var(--hf-muted)] hover:bg-white/[.06] hover:text-[var(--hf-text)]"
          }`}
        >
          <Icon name="turtle" size={22} />
        </button>
      ) : (
        // Names the current departure; a tap switches to the other one.
        <button
          type="button"
          data-testid="time-toggle"
          aria-label={time.ariaLabel}
          onClick={onToggleTime}
          className="flex h-10 shrink-0 items-center gap-1 rounded-full px-2 text-[15px] font-semibold tabular-nums text-[var(--hf-text)] transition-colors hover:bg-white/[.06]"
        >
          <Icon name="clock" size={20} />
          {time.clock}
        </button>
      )}
    </div>
  );
}
