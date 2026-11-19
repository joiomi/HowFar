import type { JSX } from "react";

import { Icon } from "@/features/map/icons";

/**
 * The one-time hint, shown once the first place resolves: a long press on the map
 * (a right-click from md) shows how long the trip there takes by public transport;
 * the shell picks the wording for the layout (`holdHintText` in copy.ts). A short pill under the
 * top bar, centred over the framed map, pointer-transparent so it never blocks the
 * map. A status line, so a screen reader reads it once. Presentation only:
 * hold-hint-controller decides when it shows and for how long. Its panel is
 * near-opaque and takes no backdrop blur: the ⓘ popover opens over the same
 * spot, and a blur stacked on a blur over the live map is costly to redraw.
 */
export default function HoldToast({ text }: { text: string }): JSX.Element {
  return (
    <div
      data-testid="hold-toast"
      role="status"
      className="hf-surface-in pointer-events-none absolute left-1/2 top-[7.75rem] z-30 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--hf-border)] bg-[var(--hf-panel-strong)] px-3.5 py-2 text-[0.8rem] font-medium leading-5 text-[var(--hf-text)] shadow-[var(--hf-shadow-float)] md:left-[calc(50%+204px)] md:max-w-[calc(100%-29rem)]"
    >
      <span className="shrink-0 text-[var(--hf-accent)]">
        <Icon name="hold" size={18} />
      </span>
      <span>{text}</span>
    </div>
  );
}
