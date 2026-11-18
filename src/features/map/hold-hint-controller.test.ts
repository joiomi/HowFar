import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HOLD_HINT_MS } from "@/features/map/copy";
import { createHoldHintController } from "@/features/map/hold-hint-controller";
import { HOLD_HINT_KEY } from "@/features/map/once-flag";

function memStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

function harness(storage: () => Storage) {
  const visible: boolean[] = [];
  const controller = createHoldHintController({ setVisible: (v) => visible.push(v), getStorage: storage });
  return { controller, visible };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the one-time hold hint", () => {
  it("shows after the first resolved place, records that it was shown, and hides itself after HOLD_HINT_MS", () => {
    const storage = memStorage();
    const { controller, visible } = harness(() => storage);
    controller.resolved();
    expect(visible).toEqual([true]);
    expect(storage.getItem(HOLD_HINT_KEY)).toBe("1");
    vi.advanceTimersByTime(HOLD_HINT_MS - 1);
    expect(visible).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(visible).toEqual([true, false]);
  });

  it("is decided once per page: later places neither show it again nor restart its timer", () => {
    const storage = memStorage();
    const { controller, visible } = harness(() => storage);
    controller.resolved();
    vi.advanceTimersByTime(HOLD_HINT_MS - 100);
    // A mode switch or a new place resolves again while the hint is up.
    controller.resolved();
    vi.advanceTimersByTime(100);
    expect(visible).toEqual([true, false]);
    controller.resolved();
    vi.runAllTimers();
    expect(visible).toEqual([true, false]);
  });

  it("stays hidden when this device already saw it", () => {
    const { controller, visible } = harness(() => memStorage({ [HOLD_HINT_KEY]: "1" }));
    controller.resolved();
    vi.runAllTimers();
    expect(visible).toEqual([]);
  });

  it("still shows once per page when storage is blocked", () => {
    const { controller, visible } = harness(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    controller.resolved();
    controller.resolved();
    vi.runAllTimers();
    expect(visible).toEqual([true, false]);
    // Nothing could be remembered, yet a place after the hint hid brings no second one.
    controller.resolved();
    vi.runAllTimers();
    expect(visible).toEqual([true, false]);
  });

  it("dispose cancels a pending hide, so nothing is set after unmount", () => {
    const { controller, visible } = harness(() => memStorage());
    controller.resolved();
    controller.dispose();
    vi.runAllTimers();
    expect(visible).toEqual([true]);
    controller.dispose(); // idempotent
  });
});
