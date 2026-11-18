/**
 * Transit/car departure "time context" — the single source of truth for WHEN
 * reachability is computed, shared by the mode pill's clock toggle (clock text +
 * accessible name), the `/api/transit` `/api/car` `/api/reach` routes (param
 * parsing), and `server/transit.ts` (resolution to a pinned ISO instant).
 *
 * PURE module — no server imports — so the client toggle and the server read
 * the same table.
 *
 * The least-necessary set: TWO options, `crowded` (weekday rush, shown as 8:30)
 * and `quiet` (off-peak midday, shown as 12:30); there is no free-form day/time
 * editor. `crowded` is the default (upcoming Wednesday 08:30 Europe/Bucharest,
 * strictly-future / never-today), so a default request resolves to the same
 * departure, the same transit cache key and the same am-peak car slot.
 *
 * No live users, so removed query params are NOT aliased — they are
 * rejected fail-loud (→ 400) rather than silently defaulting, and the intentional
 * API break is documented in docs/PROVIDERS.md.
 */

// JS `Date.getUTCDay()` convention: 0=Sun … 3=Wed … 6=Sat.
export type TimePresetId = "crowded" | "quiet";

export interface TimePreset {
  id: TimePresetId;
  /** The departure time shown on the clock toggle ("8:30"). */
  clock: string;
  /** The clock toggle's accessible name: the departure time, and why it was chosen. */
  ariaLabel: string;
  weekday: number;
  hour: number;
  minute: number;
}

export const TIME_PRESETS: Record<TimePresetId, TimePreset> = {
  // `crowded` == the default (Wed 08:30) → the default rings and the
  // weekday-morning car slot (am-peak ×2.1).
  crowded: {
    id: "crowded",
    clock: "8:30",
    ariaLabel: "Plecare la 8:30 (ora de vârf)",
    weekday: 3,
    hour: 8,
    minute: 30,
  },
  quiet: {
    id: "quiet",
    // Weekday MIDDAY (Wed 12:30): the honest "not crowded" for BOTH engines —
    // full daytime transit service + light-but-real traffic (car midday ×1.5).
    // Night/weekend would misread as a thin timetable (worse reach), which is
    // not what "quieter" should imply.
    clock: "12:30",
    ariaLabel: "Plecare la 12:30",
    weekday: 3,
    hour: 12,
    minute: 30,
  },
};

export const TIME_PRESET_IDS = Object.keys(TIME_PRESETS) as TimePresetId[];
export const DEFAULT_TIME_PRESET: TimePresetId = "crowded";

/** The other preset: the clock toggle flips between the two. */
export function nextTimePreset(id: TimePresetId): TimePresetId {
  return id === "crowded" ? "quiet" : "crowded";
}

/** Preset-only; kept as a discriminated shape so `tc.kind`/`tc.preset`
 *  consumers stay unchanged. */
export type TimeContext = { kind: "preset"; preset: TimePresetId };

export const DEFAULT_TIME_CONTEXT: TimeContext = { kind: "preset", preset: DEFAULT_TIME_PRESET };

/** Resolved wall-clock fields. Both presets are strictly-future/never-today for
 * cache stability (~6-day reuse, rolls forward weekly). */
export interface DepartureFields {
  weekday: number;
  hour: number;
  minute: number;
}

export function departureFields(tc: TimeContext): DepartureFields {
  const p = TIME_PRESETS[tc.preset];
  return { weekday: p.weekday, hour: p.hour, minute: p.minute };
}

/**
 * Parse untrusted query params into a `TimeContext`. Preset-only.
 * Returns `DEFAULT_TIME_CONTEXT` when nothing relevant is supplied, `null` on
 * anything invalid (route → 400). Fail-loud on the RETIRED custom params: any
 * `weekday` or `time` present is rejected (never silently defaulted to `crowded`),
 * and an unknown/removed preset id is rejected.
 */
export function parseTimeContext(params: {
  preset?: string | null;
  weekday?: string | null;
  time?: string | null;
}): TimeContext | null {
  const preset = params.preset ?? "";
  const weekday = params.weekday ?? "";
  const time = params.time ?? "";

  // Retired custom mode: reject rather than ignore, so a stale client fails
  // loudly instead of getting a silent `crowded` default.
  if (weekday !== "" || time !== "") return null;

  if (preset !== "") {
    if (!(TIME_PRESET_IDS as string[]).includes(preset)) return null;
    return { kind: "preset", preset: preset as TimePresetId };
  }
  return DEFAULT_TIME_CONTEXT;
}
