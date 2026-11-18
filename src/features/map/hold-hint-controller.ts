import { HOLD_HINT_MS } from "@/features/map/copy";
import { HOLD_HINT_KEY, readOnceFlag, writeOnceFlag } from "@/features/map/once-flag";

/**
 * The one-time "hold on the map" hint. The first place that resolves in a page
 * decides it: unless this device has seen the hint before, it is marked seen and
 * shown for `durationMs`, then hides itself. Later resolutions (a mode switch, a
 * new place) change nothing, and in particular never restart the hide timer, which
 * lives here rather than in a render. With storage blocked the hint cannot be
 * remembered, so it shows once per page. Pure over a callback, storage and timers.
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
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    /** A selection resolved. */
    resolved() {
      if (decided) return;
      decided = true;
      if (readOnceFlag(HOLD_HINT_KEY, getStorage)) return;
      writeOnceFlag(HOLD_HINT_KEY, getStorage);
      setVisible(true);
      hideTimer = setTimeout(() => {
        hideTimer = null;
        setVisible(false);
      }, durationMs);
    },
    dispose() {
      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = null;
    },
  };
}

export type HoldHintController = ReturnType<typeof createHoldHintController>;
