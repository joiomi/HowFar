import { describe, expect, it } from "vitest";
import { isValidElement, type ChangeEvent, type FocusEvent, type InputHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import TopBar, { type TopBarProps } from "@/features/map/TopBar";
import { initialComboboxState, type ComboboxState } from "@/features/search/combobox";

const noop = () => {};

function props(overrides: Partial<TopBarProps> = {}): TopBarProps {
  return {
    combo: initialComboboxState,
    hasSelection: false,
    firstOpen: true,
    mode: "walk",
    onSubmit: noop,
    onQueryChange: noop,
    onKeyDown: noop,
    onFocus: noop,
    onBlur: noop,
    onPick: noop,
    onHover: noop,
    onClear: noop,
    ...overrides,
  };
}

function render(overrides: Partial<TopBarProps> = {}): string {
  return renderToStaticMarkup(<TopBar {...props(overrides)} />);
}

type InputElement = ReactElement<InputHTMLAttributes<HTMLInputElement>>;

/** The `<input>` element in the bar's element tree (TopBar has no hooks, so it can be called directly). */
function findInput(node: ReactNode): InputElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findInput(child);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === "input") return node as InputElement;
  return findInput((node.props as { children?: ReactNode }).children);
}

function barInput(overrides: Partial<TopBarProps>): InputElement {
  const input = findInput(TopBar(props(overrides)));
  if (!input) throw new Error("TopBar renders no input");
  return input;
}

const SUGGESTIONS = [
  { label: "Piața Unirii, București", lat: 44.4268, lng: 26.1025 },
  { label: "Piața Romană, București", lat: 44.4469, lng: 26.0975 },
];

// Static server render — the bar is pure presentation over its props, so the
// emitted markup IS its contract (no DOM library needed in the node test env).
describe("TopBar", () => {
  it("first open: search icon, first-open placeholder, Romanian label, no clear button, no Go button", () => {
    const html = render();
    expect(html).toContain('placeholder="Caută o adresă sau atinge harta"');
    expect(html).toContain('aria-label="Caută o adresă"');
    expect(html.toLowerCase()).toContain('enterkeyhint="search"');
    expect(html).not.toContain('data-testid="clear-address"');
    expect(html).not.toMatch(/>Go</);
  });

  it("with an address: plain placeholder and a 44px clear button labelled Șterge adresa", () => {
    const html = render({
      combo: { ...initialComboboxState, query: "Piața Unirii, București" },
      hasSelection: true,
      firstOpen: false,
    });
    expect(html).toContain('placeholder="Caută o adresă"');
    expect(html).toMatch(
      /data-testid="clear-address"[^>]*aria-label="Șterge adresa"|aria-label="Șterge adresa"[^>]*data-testid="clear-address"/,
    );
    // The 44px target belongs to the clear button itself, not to anything else in the bar.
    const clearButton = html.match(/<button[^>]*data-testid="clear-address"[^>]*>/)?.[0] ?? "";
    expect(clearButton).toMatch(/class="[^"]*\bsize-11\b/);
    expect(html).toContain('value="Piața Unirii, București"');
  });

  it("with an address the leading pin takes the travel mode's colour; without one nothing is tinted", () => {
    const transit = render({ hasSelection: true, firstOpen: false, mode: "transit" });
    expect(transit).toContain("color:var(--hf-transit)");
    const car = render({ hasSelection: true, firstOpen: false, mode: "car" });
    expect(car).toContain("color:var(--hf-car)");
    expect(render({ mode: "transit" })).not.toContain("var(--hf-transit)");
  });

  it("wires the combobox to the open suggestion list and its active option", () => {
    const open: ComboboxState = {
      ...initialComboboxState,
      query: "Piata",
      open: true,
      suggestions: SUGGESTIONS,
      activeIndex: 1,
    };
    const html = render({ combo: open });
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="suggest-list"');
    expect(html).toContain('aria-activedescendant="suggest-opt-1"');
    expect(html).toContain('id="suggest-list"');
    expect(html).toContain('aria-label="Sugestii de adrese"');
    expect(html).toContain("Piața Romană, București");

    const closed = render();
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("aria-activedescendant");
    expect(closed).not.toContain('id="suggest-list"');
  });

  it("speaks Romanian in every suggestion-list state", () => {
    const base: ComboboxState = { ...initialComboboxState, query: "Piata", open: true };
    expect(render({ combo: { ...base, status: "loading" } })).toContain("Caut…");
    expect(render({ combo: { ...base, status: "error" } })).toContain("Nu am putut încărca sugestiile.");
    expect(render({ combo: { ...base, status: "idle", suggestions: [] } })).toContain(
      "Nicio adresă găsită în București",
    );
  });

  it("focusing the field selects the shown address before reporting focus, so typing replaces it", () => {
    const calls: string[] = [];
    const input = barInput({ hasSelection: true, firstOpen: false, onFocus: () => calls.push("focus") });
    const event = { currentTarget: { select: () => calls.push("select") } };
    input.props.onFocus!(event as unknown as FocusEvent<HTMLInputElement>);
    expect(calls).toEqual(["select", "focus"]);
  });

  it("typing reports the field's new text", () => {
    const seen: string[] = [];
    const input = barInput({ onQueryChange: (value) => seen.push(value) });
    input.props.onChange!({ target: { value: "Piața Ro" } } as unknown as ChangeEvent<HTMLInputElement>);
    expect(seen).toEqual(["Piața Ro"]);
  });
});
