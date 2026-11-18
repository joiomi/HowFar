import type { JSX } from "react";

/**
 * The shell's one screen-reader status line (a visually hidden polite live
 * region): what the selection is doing, worded by `selectionAnnouncement`. It is
 * always in the page, empty while there is nothing to say, so a screen reader is
 * already listening when the first announcement arrives.
 */
export default function StatusAnnouncer({ text }: { text: string }): JSX.Element {
  return (
    <p data-testid="status-announcer" role="status" aria-live="polite" className="sr-only">
      {text}
    </p>
  );
}
