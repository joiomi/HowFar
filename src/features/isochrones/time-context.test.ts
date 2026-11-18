import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIME_CONTEXT,
  DEFAULT_TIME_PRESET,
  departureFields,
  nextTimePreset,
  parseTimeContext,
  TIME_PRESET_IDS,
  TIME_PRESETS,
} from "@/features/isochrones/time-context";

describe("TIME_PRESETS", () => {
  it("is exactly the two ids crowded, quiet; default = crowded == Wed 08:30", () => {
    expect(TIME_PRESET_IDS).toEqual(["crowded", "quiet"]);
    expect(DEFAULT_TIME_PRESET).toBe("crowded");
    expect(DEFAULT_TIME_CONTEXT).toEqual({ kind: "preset", preset: "crowded" });
    // The `crowded` preset must carry the default fields exactly.
    const c = TIME_PRESETS.crowded;
    expect([c.weekday, c.hour, c.minute]).toEqual([3, 8, 30]);
  });

  it("each preset's clock text is its departure time and its label names it", () => {
    const q = TIME_PRESETS.quiet;
    expect([q.weekday, q.hour, q.minute]).toEqual([3, 12, 30]);
    for (const id of TIME_PRESET_IDS) {
      const p = TIME_PRESETS[id];
      expect(p.clock).toBe(`${p.hour}:${String(p.minute).padStart(2, "0")}`);
      expect(p.ariaLabel).toContain(p.clock);
    }
    expect(TIME_PRESETS.crowded.ariaLabel).toBe("Plecare la 8:30 (ora de vârf)");
    expect(TIME_PRESETS.quiet.ariaLabel).toBe("Plecare la 12:30");
  });
});

describe("departureFields", () => {
  it("preset → its fields (strictly-future is applied by the resolver, no allowToday)", () => {
    expect(departureFields({ kind: "preset", preset: "crowded" })).toEqual({ weekday: 3, hour: 8, minute: 30 });
    expect(departureFields({ kind: "preset", preset: "quiet" })).toEqual({ weekday: 3, hour: 12, minute: 30 });
  });
});

describe("toggle", () => {
  it("nextTimePreset flips between the two presets", () => {
    expect(nextTimePreset("crowded")).toBe("quiet");
    expect(nextTimePreset("quiet")).toBe("crowded");
  });
});

describe("parseTimeContext (route validation)", () => {
  it("no params → default crowded", () => {
    expect(parseTimeContext({})).toEqual(DEFAULT_TIME_CONTEXT);
    expect(parseTimeContext({ preset: "", weekday: "", time: "" })).toEqual(DEFAULT_TIME_CONTEXT);
  });
  it("valid preset → preset context; unknown/retired preset → null (400)", () => {
    expect(parseTimeContext({ preset: "crowded" })).toEqual({ kind: "preset", preset: "crowded" });
    expect(parseTimeContext({ preset: "quiet" })).toEqual({ kind: "preset", preset: "quiet" });
    // Retired ids are NOT aliased — they 400 (no live users).
    expect(parseTimeContext({ preset: "weekday-morning" })).toBeNull();
    expect(parseTimeContext({ preset: "midday" })).toBeNull();
    expect(parseTimeContext({ preset: "lunchtime" })).toBeNull();
  });
  it("FAIL-LOUD on retired custom params: any weekday/time present → null (400), never silent default", () => {
    expect(parseTimeContext({ weekday: "6", time: "09:30" })).toBeNull();
    expect(parseTimeContext({ weekday: "6" })).toBeNull(); // partial
    expect(parseTimeContext({ time: "09:30" })).toBeNull(); // partial
    // Even alongside a valid preset, a stray custom param is rejected.
    expect(parseTimeContext({ preset: "crowded", weekday: "6", time: "09:30" })).toBeNull();
  });
});
