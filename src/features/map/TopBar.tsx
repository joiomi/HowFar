import type { FormEvent, KeyboardEvent } from "react";

import { MODE_ACCENT } from "@/features/isochrones/isochrone-view";
import { SEARCH_PLACEHOLDER, SEARCH_PLACEHOLDER_FIRST_OPEN } from "@/features/map/copy";
import { Icon } from "@/features/map/icons";
import type { Mode } from "@/features/map/selection-flow";
import SuggestList from "@/features/map/SuggestList";
import type { ComboboxState, Suggestion } from "@/features/search/combobox";

/**
 * The address bar floating over the top of the map: the search combobox with its
 * suggestion list, and, once a place is chosen, a pin in the travel mode's colour
 * plus a ✕ that clears the place. Presentation only: every state transition lives
 * in AppMap's combobox and selection wiring. Enter submits the form; there is no
 * submit button.
 */

export interface TopBarProps {
  combo: ComboboxState;
  /** A place is selected: show the pin and the clear button. */
  hasSelection: boolean;
  /** Nothing chosen yet and nothing loading: the placeholder also invites a map tap. */
  firstOpen: boolean;
  mode: Mode;
  onSubmit: (e: FormEvent) => void;
  onQueryChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onFocus: () => void;
  onBlur: () => void;
  onPick: (s: Suggestion) => void;
  onHover: (index: number) => void;
  onClear: () => void;
}

export default function TopBar({
  combo,
  hasSelection,
  firstOpen,
  mode,
  onSubmit,
  onQueryChange,
  onKeyDown,
  onFocus,
  onBlur,
  onPick,
  onHover,
  onClear,
}: TopBarProps) {
  return (
    <div
      data-testid="top-bar"
      className="pointer-events-auto absolute inset-x-3 top-3 z-40 md:left-4 md:right-auto md:top-4 md:w-[400px]"
    >
      <form role="search" onSubmit={onSubmit}>
        <div
          data-testid="search-field"
          // The focus ring is drawn on the whole field rather than on the bare input,
          // so it follows the field's rounded outline.
          className={`relative flex h-[52px] items-center gap-2.5 rounded-[18px] border border-[var(--hf-border)] bg-[var(--hf-panel)] pl-4 shadow-[0_12px_30px_rgba(0,0,0,.35)] backdrop-blur-xl has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-solid has-[input:focus-visible]:outline-[color:var(--hf-accent)] ${
            hasSelection ? "pr-1" : "pr-4"
          }`}
        >
          {hasSelection ? (
            <span className="shrink-0" style={{ color: MODE_ACCENT[mode] }}>
              <Icon name="pin" size={20} />
            </span>
          ) : (
            <Icon name="search" size={20} className="shrink-0 text-[var(--hf-muted)]" />
          )}
          <input
            value={combo.query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={(e) => {
              // Selecting the shown address lets the first keystroke replace it.
              e.currentTarget.select();
              onFocus();
            }}
            onBlur={onBlur}
            placeholder={firstOpen ? SEARCH_PLACEHOLDER_FIRST_OPEN : SEARCH_PLACEHOLDER}
            aria-label={SEARCH_PLACEHOLDER}
            role="combobox"
            aria-expanded={combo.open}
            aria-controls="suggest-list"
            aria-autocomplete="list"
            aria-activedescendant={combo.activeIndex >= 0 ? `suggest-opt-${combo.activeIndex}` : undefined}
            autoComplete="off"
            enterKeyHint="search"
            // 16px text keeps iOS from zooming the page when the field takes focus.
            // The field draws the focus ring; `!` is needed to override the global
            // focus outline, an unlayered rule that beats any layered utility.
            className="h-full min-w-0 flex-1 truncate bg-transparent text-base font-semibold text-[var(--hf-text)] placeholder:font-medium placeholder:text-[var(--hf-muted)] focus-visible:outline-none!"
          />
          {hasSelection ? (
            <button
              type="button"
              data-testid="clear-address"
              aria-label="Șterge adresa"
              onClick={onClear}
              className="grid size-11 shrink-0 place-items-center rounded-xl text-[var(--hf-subtle)] transition-colors hover:bg-white/[.06] hover:text-[var(--hf-text)]"
            >
              <Icon name="x" size={18} />
            </button>
          ) : null}
          <SuggestList combo={combo} onPick={onPick} onHover={onHover} />
        </div>
      </form>
    </div>
  );
}
