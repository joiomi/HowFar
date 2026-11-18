/** How long the ⓘ popover stays open on its own after the map first loads. */
export const INFO_AUTO_OPEN_MS = 5000;

/**
 * When the ⓘ popover opens and closes. The shell renders whatever `setOpen` last
 * received; every rule lives here, pure over that callback, a focus probe and the
 * timers, so each one is unit-tested.
 *
 * - The first map load opens the popover once, so the data credits are on screen
 *   when the map appears, and closes it again after INFO_AUTO_OPEN_MS.
 * - If the address field has focus at that moment, the opening waits until the
 *   field loses focus (still once per page load).
 * - If the popover is already open then (the user opened it before the map was
 *   ready), it stays open and nothing closes it on a timer; a user open while the
 *   opening waits on the field counts as that first showing.
 * - Any user open or close cancels the pending timed close.
 * - Focusing the address field, a tap on the map and a camera move the user starts
 *   close the popover; a camera move the app starts (framing a place) does not.
 */
export function createInfoController({
  setOpen,
  fieldHasFocus,
}: {
  setOpen: (open: boolean) => void;
  /** True while the address field has focus. */
  fieldHasFocus: () => boolean;
}) {
  let open = false;
  // The first-load showing: not yet due (map loading), waiting on the address
  // field, or done.
  let firstShowing: "before-load" | "waiting-on-field" | "done" = "before-load";
  let autoClose: ReturnType<typeof setTimeout> | null = null;

  function cancelAutoClose() {
    if (autoClose !== null) clearTimeout(autoClose);
    autoClose = null;
  }
  function set(next: boolean) {
    open = next;
    setOpen(next);
  }
  function autoOpen() {
    firstShowing = "done";
    set(true);
    autoClose = setTimeout(() => {
      autoClose = null;
      set(false);
    }, INFO_AUTO_OPEN_MS);
  }
  function close() {
    cancelAutoClose();
    set(false);
  }

  return {
    /** The map finished its first load. */
    mapReady() {
      if (firstShowing !== "before-load") return;
      if (open) {
        firstShowing = "done";
        return;
      }
      if (fieldHasFocus()) {
        firstShowing = "waiting-on-field";
        return;
      }
      autoOpen();
    },
    fieldFocus: close,
    fieldBlur() {
      if (firstShowing === "waiting-on-field") autoOpen();
    },
    /** The user opened or closed the popover (the ⓘ button, or Escape). */
    userSet(next: boolean) {
      cancelAutoClose();
      if (next && firstShowing === "waiting-on-field") firstShowing = "done";
      set(next);
    },
    mapClick: close,
    /** A camera move started; `byUser` when a gesture or key started it. */
    moveStart(byUser: boolean) {
      if (byUser) close();
    },
    dispose: cancelAutoClose,
  };
}

export type InfoController = ReturnType<typeof createInfoController>;
