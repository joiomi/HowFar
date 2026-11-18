import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInfoController, INFO_AUTO_OPEN_MS } from "@/features/map/info-controller";

/**
 * The ⓘ popover's open/close rules, over fake timers: the first-load auto-open (once,
 * deferred while the address field has focus, skipped when the user already has the
 * popover open), its auto-close, and the user actions and map gestures that close it.
 */

function harness({ fieldFocused = false } = {}) {
  const shown: boolean[] = [];
  const focus = { field: fieldFocused };
  const info = createInfoController({
    setOpen: (open) => shown.push(open),
    fieldHasFocus: () => focus.field,
  });
  /** The state the shell would render: the last value handed to setOpen. */
  const open = () => shown[shown.length - 1] ?? false;
  return { info, shown, focus, open };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("info controller: the first-load auto-open", () => {
  it("opens when the map first loads and closes itself after INFO_AUTO_OPEN_MS", () => {
    const h = harness();
    expect(h.open()).toBe(false);
    h.info.mapReady();
    expect(h.open()).toBe(true);
    vi.advanceTimersByTime(INFO_AUTO_OPEN_MS - 1);
    expect(h.open()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(h.open()).toBe(false);
  });

  it("happens once per page load", () => {
    const h = harness();
    h.info.mapReady();
    vi.advanceTimersByTime(INFO_AUTO_OPEN_MS);
    expect(h.open()).toBe(false);
    h.info.mapReady();
    expect(h.open()).toBe(false);
    expect(h.shown).toEqual([true, false]);
  });

  it("waits while the address field has focus, then opens once it loses focus, and still closes itself", () => {
    const h = harness({ fieldFocused: true });
    h.info.mapReady();
    expect(h.open()).toBe(false);
    vi.advanceTimersByTime(INFO_AUTO_OPEN_MS * 2);
    expect(h.open()).toBe(false);
    h.focus.field = false;
    h.info.fieldBlur();
    expect(h.open()).toBe(true);
    vi.advanceTimersByTime(INFO_AUTO_OPEN_MS);
    expect(h.open()).toBe(false);
    // Once only: a later blur does not bring it back.
    h.info.fieldFocus();
    h.info.fieldBlur();
    expect(h.open()).toBe(false);
  });

  it("a field blur before the map has loaded opens nothing", () => {
    const h = harness();
    h.info.fieldBlur();
    expect(h.shown).toEqual([]);
  });

  it("leaves a popover the user opened before the map loaded open, with no auto-close", () => {
    const h = harness();
    h.info.userSet(true);
    h.info.mapReady();
    expect(h.open()).toBe(true);
    vi.advanceTimersByTime(INFO_AUTO_OPEN_MS * 2);
    expect(h.open()).toBe(true);
  });

  it("still opens at load when the user opened and closed it before the map loaded", () => {
    const h = harness();
    h.info.userSet(true);
    h.info.userSet(false);
    h.info.mapReady();
    expect(h.open()).toBe(true);
    vi.advanceTimersByTime(INFO_AUTO_OPEN_MS);
    expect(h.open()).toBe(false);
  });

  it("a user open while the auto-open waits on the field counts as the first showing", () => {
    const h = harness({ fieldFocused: true });
    h.info.mapReady();
    h.info.userSet(true);
    h.info.userSet(false);
    h.focus.field = false;
    h.info.fieldBlur();
    expect(h.open()).toBe(false);
  });
});

describe("info controller: user actions and map gestures", () => {
  it("a user open or close cancels the pending auto-close", () => {
    const h = harness();
    h.info.mapReady();
    h.info.userSet(false);
    h.info.userSet(true);
    vi.advanceTimersByTime(INFO_AUTO_OPEN_MS * 2);
    expect(h.open()).toBe(true);
  });

  it("a user open right after the deferred auto-open keeps it open (the tap on ⓘ that blurred the field)", () => {
    const h = harness({ fieldFocused: true });
    h.info.mapReady();
    h.focus.field = false;
    h.info.fieldBlur();
    h.info.userSet(true);
    vi.advanceTimersByTime(INFO_AUTO_OPEN_MS * 2);
    expect(h.open()).toBe(true);
  });

  it("focusing the address field closes it", () => {
    const h = harness();
    h.info.userSet(true);
    h.info.fieldFocus();
    expect(h.open()).toBe(false);
  });

  it("a tap on the map closes it", () => {
    const h = harness();
    h.info.userSet(true);
    h.info.mapClick();
    expect(h.open()).toBe(false);
  });

  it("a camera move the user starts closes it; one the app starts does not", () => {
    const h = harness();
    h.info.userSet(true);
    h.info.moveStart(false);
    expect(h.open()).toBe(true);
    h.info.moveStart(true);
    expect(h.open()).toBe(false);
  });

  it("a close cancels the pending auto-close: no stray close fires later", () => {
    const h = harness();
    h.info.mapReady();
    h.info.mapClick();
    vi.advanceTimersByTime(INFO_AUTO_OPEN_MS * 2);
    expect(h.shown).toEqual([true, false]);
  });

  it("dispose stops the pending auto-close", () => {
    const h = harness();
    h.info.mapReady();
    h.info.dispose();
    vi.advanceTimersByTime(INFO_AUTO_OPEN_MS * 2);
    expect(h.shown).toEqual([true]);
  });
});
