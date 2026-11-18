import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ModePill, { type ModePillProps } from "@/features/map/ModePill";

const noop = () => {};

function render(overrides: Partial<ModePillProps> = {}): string {
  const props: ModePillProps = {
    mode: "walk",
    presetIndex: 0,
    pace: "normal",
    timePreset: "crowded",
    failedMode: null,
    onSwitchMode: noop,
    onSelectPreset: noop,
    onTogglePace: noop,
    onToggleTime: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<ModePill {...props} />);
}

/** The opening tag of the element carrying `data-testid`, or "" when absent. */
function openTag(html: string, testId: string): string {
  return html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";
}

type ButtonElement = ReactElement<ButtonHTMLAttributes<HTMLButtonElement> & { "data-testid"?: string }>;

/** Every `<button>` in an element tree (ModePill has no hooks, so it can be called directly). */
function buttons(node: ReactNode): ButtonElement[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement(node)) return [];
  if (node.type === "button") return [node as ButtonElement];
  return buttons((node.props as { children?: ReactNode }).children);
}

/** The markup between a button's opening tag and its closing tag. */
function buttonInner(html: string, testId: string): string {
  const tag = openTag(html, testId);
  const start = html.indexOf(tag) + tag.length;
  return html.slice(start, html.indexOf("</button>", start));
}

// Static server render: the pill is presentation over its props, so the markup is its contract.
describe("ModePill", () => {
  it("names the modes in Romanian inside a 'Cum te deplasezi' group and marks the active one", () => {
    const html = render();
    expect(html).toMatch(/<div[^>]*role="group"[^>]*aria-label="Cum te deplasezi"/);
    expect(openTag(html, "mode-pill")).toContain("hf-mode-pill");
    const walk = openTag(html, "mode-icon-walk");
    expect(walk).toContain('aria-label="Pe jos"');
    expect(walk).toContain('aria-pressed="true"');
    expect(openTag(html, "mode-icon-transit")).toContain('aria-label="Transport public"');
    expect(openTag(html, "mode-icon-transit")).toContain('aria-pressed="false"');
    expect(openTag(html, "mode-icon-car")).toContain('aria-label="Mașina"');
    expect(openTag(html, "mode-icon-car")).toContain('aria-pressed="false"');
    // The mode group comes first, before any preset.
    expect(html.indexOf('aria-label="Cum te deplasezi"')).toBeLessThan(html.indexOf("mode-icon-walk"));
    expect(html.indexOf("mode-icon-car")).toBeLessThan(html.indexOf("preset-chip-"));
  });

  it("shows the active mode's two presets as numbers with Romanian labels", () => {
    for (const [mode, labels] of [
      ["walk", { 10: "10 minute", 20: "20 de minute" }],
      ["transit", { 20: "20 de minute", 40: "40 de minute" }],
      ["car", { 10: "10 minute", 25: "25 de minute" }],
    ] as const) {
      const html = render({ mode });
      // Exactly the two calibrated presets: no Custom chip, no free-minute input.
      expect(html.match(/data-testid="preset-chip-/g)).toHaveLength(2);
      expect(html.toLowerCase()).not.toContain("custom");
      expect(html).not.toContain("<input");
      for (const [min, label] of Object.entries(labels)) {
        expect(openTag(html, `preset-chip-${min}`)).toContain(`aria-label="${label}"`);
        expect(buttonInner(html, `preset-chip-${min}`)).toMatch(new RegExp(`<b[^>]*>${min}</b><small[^>]*>min</small>`));
      }
    }
    // The selected preset is the pressed one.
    const second = render({ mode: "walk", presetIndex: 1 });
    expect(openTag(second, "preset-chip-20")).toContain('aria-pressed="true"');
    expect(openTag(second, "preset-chip-10")).toContain('aria-pressed="false"');
  });

  it("walk shows only the turtle, pressed exactly at Slow pace", () => {
    const normal = render({ mode: "walk", pace: "normal" });
    expect(openTag(normal, "pace-toggle")).toContain('aria-label="Mers încet"');
    expect(openTag(normal, "pace-toggle")).toContain('aria-pressed="false"');
    expect(normal).not.toContain('data-testid="time-toggle"');
    const slow = render({ mode: "walk", pace: "slow" });
    expect(openTag(slow, "pace-toggle")).toContain('aria-pressed="true"');
  });

  it("transit and car show only the clock with the departure time", () => {
    for (const mode of ["transit", "car"] as const) {
      const rush = render({ mode, timePreset: "crowded", pace: "slow" });
      expect(rush).not.toContain('data-testid="pace-toggle"');
      const tag = openTag(rush, "time-toggle");
      expect(tag).toContain('aria-label="Plecare la 8:30 (ora de vârf)"');
      // A two-way switch named by its current value, not an on/off button.
      expect(tag).not.toContain("aria-pressed");
      expect(buttonInner(rush, "time-toggle")).toMatch(/<\/svg>8:30$/);
      const quiet = render({ mode, timePreset: "quiet" });
      expect(openTag(quiet, "time-toggle")).toContain('aria-label="Plecare la 12:30"');
      expect(buttonInner(quiet, "time-toggle")).toMatch(/<\/svg>12:30$/);
    }
  });

  it("flags a failed mode as unavailable", () => {
    const html = render({ mode: "transit", failedMode: "transit" });
    expect(openTag(html, "mode-icon-transit")).toContain('aria-label="Transport public (indisponibil)"');
    expect(buttonInner(html, "mode-icon-transit")).toMatch(/<span[^>]*aria-hidden="true"[^>]*>!<\/span>/);
    // Only the failed mode carries the flag.
    expect(openTag(html, "mode-icon-walk")).toContain('aria-label="Pe jos"');
    expect(buttonInner(html, "mode-icon-walk")).not.toContain(">!<");
    expect(render()).not.toContain("indisponibil");
  });

  it("each control reports its own choice to its handler", () => {
    const handlers = {
      onSwitchMode: vi.fn(),
      onSelectPreset: vi.fn(),
      onTogglePace: vi.fn(),
      onToggleTime: vi.fn(),
    };
    const base: ModePillProps = { mode: "walk", presetIndex: 0, pace: "normal", timePreset: "crowded", failedMode: null, ...handlers };
    const click = (props: ModePillProps, testId: string) => {
      const button = buttons(ModePill(props)).find((b) => b.props["data-testid"] === testId);
      if (!button) throw new Error(`no ${testId} button`);
      button.props.onClick?.({} as never);
    };
    click(base, "mode-icon-car");
    expect(handlers.onSwitchMode).toHaveBeenLastCalledWith("car");
    // A preset reports its index in the mode's pair, not its minutes.
    click({ ...base, mode: "transit" }, "preset-chip-40");
    expect(handlers.onSelectPreset).toHaveBeenLastCalledWith(1);
    click(base, "preset-chip-10");
    expect(handlers.onSelectPreset).toHaveBeenLastCalledWith(0);
    click(base, "pace-toggle");
    expect(handlers.onTogglePace).toHaveBeenCalledTimes(1);
    click({ ...base, mode: "car" }, "time-toggle");
    expect(handlers.onToggleTime).toHaveBeenCalledTimes(1);
  });
});
