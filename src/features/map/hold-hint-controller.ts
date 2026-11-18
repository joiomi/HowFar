import { HOLD_HINT_MS } from "@/features/map/copy";
import { HOLD_HINT_KEY, readOnceFlag, writeOnceFlag } from "@/features/map/once-flag";

/**
 * The one-time "hold on the map" hint. The first place that resolves in a page
 * decides it: unless this device has seen the hint before, it is due. It is only
 * spent once it is actually on screen: while something covers its spot (the ⓘ
 * popover), a due hint waits, and only when the cover lifts is it marked seen and
 * shown for `durationMs`. A cover over a hint already showing hides it without
 * stopping its clock; lifted inside the window, the hint shows again. Later
 * resolutions (a mode switch, a new place) change nothing, and never restart the
 * hide timer, which lives here rather than in a render. With storage blocked the
 * hint cannot be remembered, so it shows once per page. Pure over a callback,
 * storage and timers.
 */
export function createHoldHintController({
  setVisible,
  getStorage,
  durationMs = HOLD_HINT_MS,
}: {
  setVisible: (visible: boolean) => void;
  getStorage?: () => Storage;
  durationMs?: number;
}) {
  let decided = false;
  let due = false;
  let started = false;
  let expired = false;
  let covered = false;
  let visible = false;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function sync() {
    const next = started && !expired && !covered;
    if (next === visible) return;
    visible = next;
    setVisible(next);
  }

  function start() {
    due = false;
    started = true;
    writeOnceFlag(HOLD_HINT_KEY, getStorage);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      expired = true;
      sync();
    }, durationMs);
    sync();
  }

  return {
    /** A selection resolved. */
    resolved() {
      if (decided) return;
      decided = true;
      if (readOnceFlag(HOLD_HINT_KEY, getStorage)) return;
      due = true;
      if (!covered) start();
    },
    /** Whether something covers the hint's spot (the ⓘ popover is open). */
    setCovered(next: boolean) {
      covered = next;
      if (!covered && due) start();
      else sync();
    },
    dispose() {
      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = null;
    },
  };
}

export type HoldHintController = ReturnType<typeof createHoldHintController>;
