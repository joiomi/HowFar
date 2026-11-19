import type { JSX } from "react";

import { Icon } from "@/features/map/icons";

interface ErrorBannerProps {
  /** The short Romanian sentence naming what failed. */
  message: string;
  /** Runs the failed request again; omitted where retrying cannot succeed (no ↻). */
  onRetry?: () => void;
  /** Switches to walking; given only when the failed mode is not walking. */
  onSwitchToWalk?: () => void;
}

/**
 * A failed selection as one compact row over the live map, never a takeover: a
 * warning icon, the message, a ↻ that retries (unless retrying cannot succeed, as
 * with a refused location) and, for a failed transit or car reach, a button that
 * switches to walking. Both buttons are 44 px targets, and the row keeps their
 * height without them. It is an alert, so a screen reader announces the failure
 * when it appears.
 * Presentation only; placement is the caller's.
 */
export default function ErrorBanner({ message, onRetry, onSwitchToWalk }: ErrorBannerProps): JSX.Element {
  return (
    <div
      data-testid="error-banner"
      role="alert"
      className={`flex min-h-12 items-center gap-1 rounded-[1.25rem] border border-[var(--hf-border)] bg-[var(--hf-panel-strong)] py-0.5 pl-3 shadow-[var(--hf-shadow-float)] backdrop-blur-2xl ${
        onRetry || onSwitchToWalk ? "pr-0.5" : "pr-3"
      }`}
    >
      <span className="shrink-0 text-[var(--hf-warning)]">
        <Icon name="warning" size={20} />
      </span>
      <p className="min-w-0 flex-1 px-1.5 text-[0.84rem] font-medium leading-5 text-[var(--hf-text)]">{message}</p>
      {onRetry ? (
        <button
          type="button"
          data-testid="banner-retry"
          aria-label="Reîncearcă"
          onClick={() => onRetry()}
          className="grid size-11 shrink-0 place-items-center rounded-full text-[var(--hf-text)] transition-colors hover:bg-white/[.08]"
        >
          <Icon name="retry" size={20} />
        </button>
      ) : null}
      {onSwitchToWalk ? (
        <button
          type="button"
          data-testid="banner-walk"
          aria-label="Treci la mersul pe jos"
          onClick={() => onSwitchToWalk()}
          className="grid size-11 shrink-0 place-items-center rounded-full text-[var(--hf-walk)] transition-colors hover:bg-white/[.08]"
        >
          <Icon name="walk" size={22} />
        </button>
      ) : null}
    </div>
  );
}
