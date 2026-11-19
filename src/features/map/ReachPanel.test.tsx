import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { ReachLeg } from "@/features/isochrones/server/transit-plan";
import { TRANSITOUS_SOURCES_URL } from "@/features/map/credits";
import { buildReachSteps, stepChip } from "@/features/map/reach";
import type { ReachView } from "@/features/map/reach-directions-controller";
import ReachPanel from "@/features/map/ReachPanel";

const noop = () => {};

const LEGS: ReachLeg[] = [
  { mode: "WALK", fromName: "START", toName: "Emil Racovita", minutes: 9 },
  { mode: "BUS", line: "243", headsign: "Bd. Lacul Tei", fromName: "Emil Racovita", toName: "Soseaua Colentina", minutes: 50 },
  { mode: "SUBWAY", line: "M2", headsign: "Pipera", fromName: "Soseaua Colentina", toName: "Pipera", minutes: 6 },
  { mode: "WALK", fromName: "Pipera", toName: "END", minutes: 5 },
];

// A transit view built from the same step and chip helpers the directions controller uses.
const TRANSIT: ReachView = {
  state: "transit",
  title: "Cu transportul public",
  detail: "~70 min · 1 schimbare — dincolo de zona ta de ~40 min.",
  steps: buildReachSteps(LEGS).map((s, i) => ({ ...s, mode: LEGS[i].mode, chip: stepChip(LEGS[i]) })),
};

const HINT: ReachView = {
  state: "hint",
  title: "Cum ajung acolo?",
  detail: "Alege întâi o adresă, apoi ține apăsat pe hartă (clic dreapta pe calculator).",
};

function render(view: ReachView): string {
  return renderToStaticMarkup(<ReachPanel view={view} onHighlight={noop} onClose={noop} />);
}

/** The opening tag of the first element matching `pattern` inside its `<…>`, or "". */
function openTag(html: string, pattern: string): string {
  return html.match(new RegExp(`<[a-z0-9]+[^>]*${pattern}[^>]*>`))?.[0] ?? "";
}

/** The step chips, in order: each `<li data-step-mode>` with its attributes and visible text. */
function chips(html: string): { tag: string; text: string; inner: string }[] {
  return [...html.matchAll(/(<li[^>]*data-step-mode[^>]*>)([\s\S]*?)<\/li>/g)].map(([, tag, inner]) => ({
    tag,
    inner,
    text: inner.replace(/<[^>]+>/g, ""),
  }));
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

describe("ReachPanel", () => {
  it("is a region named Traseu, with a 44 px close button named Închide", () => {
    const html = render(TRANSIT);
    const root = openTag(html, 'data-testid="reach-panel"');
    expect(root).toMatch(/^<section/);
    expect(attr(root, "aria-label")).toBe("Traseu");
    expect(attr(root, "data-state")).toBe("transit");
    const close = openTag(html, 'aria-label="Închide"');
    expect(close).toMatch(/^<button/);
    expect(close).toMatch(/class="[^"]*\bsize-11\b/);
  });

  it("heads the sheet with a bus icon in the transit hue, the title and the detail", () => {
    const html = render(TRANSIT);
    expect(html).toContain(">Cu transportul public</h2>");
    expect(html).toContain("~70 min · 1 schimbare — dincolo de zona ta de ~40 min.");
    expect(openTag(html, 'data-testid="reach-icon"')).toMatch(/class="[^"]*text-\[var\(--hf-transit\)\]/);
  });

  it("lists the steps as chips named by the full step and showing only the short text", () => {
    const html = render(TRANSIT);
    expect(attr(openTag(html, 'data-testid="reach-steps"'), "aria-label")).toBe("Pașii călătoriei");
    expect(openTag(html, 'data-testid="reach-steps"')).toMatch(/^<ol/);
    const list = chips(html);
    expect(list.map((c) => attr(c.tag, "aria-label"))).toEqual([
      "Pe jos 9 min, până la Emil Racovita",
      "Autobuz 243 → Bd. Lacul Tei, Urcă la Emil Racovita → coboară la Soseaua Colentina · 50 min",
      "Metrou M2 → Pipera, Urcă la Soseaua Colentina → coboară la Pipera · 6 min",
      "Pe jos 5 min, până la destinație",
    ]);
    // The tooltip says the same as the accessible name.
    expect(list.map((c) => attr(c.tag, "title"))).toEqual(list.map((c) => attr(c.tag, "aria-label")));
    expect(list.map((c) => c.text)).toEqual(["9", "243", "M2", "5"]);
    expect(list.map((c) => attr(c.tag, "data-step-mode"))).toEqual(["walk", "transit", "transit", "walk"]);
    // Every chip can be reached with the keyboard.
    expect(list.every((c) => attr(c.tag, "tabindex") === "0")).toBe(true);
  });

  it("colours the metro blue, surface vehicles violet and walking neutral, each chip with its icon", () => {
    const [walk, bus, metro] = chips(render(TRANSIT));
    expect(bus.inner).toMatch(/class="[^"]*\bbg-\[#5b4a9e\][^"]*\btext-white\b/);
    expect(metro.inner).toMatch(/class="[^"]*\bbg-\[#2563eb\][^"]*\btext-white\b/);
    expect(walk.inner).not.toMatch(/#5b4a9e|#2563eb|text-white/);
    // One icon per chip, plus the arrow joining it to the step before.
    expect(walk.inner.match(/<svg/g)).toHaveLength(1);
    expect(bus.inner.match(/<svg/g)).toHaveLength(2);
    expect(metro.inner.match(/<svg/g)).toHaveLength(2);
  });

  it("joins the chips with hidden arrows", () => {
    const html = render(TRANSIT);
    const arrows = html.match(/<span[^>]*data-testid="step-arrow"[^>]*>/g) ?? [];
    expect(arrows).toHaveLength(LEGS.length - 1);
    expect(arrows.every((a) => a.includes('aria-hidden="true"'))).toBe(true);
  });

  it("credits Transitous in its footer, a link to the sources page", () => {
    const html = render(TRANSIT);
    const link = openTag(html, 'data-testid="transitous-credit"');
    expect(link).toMatch(/^<a/);
    expect(attr(link, "href")).toBe(TRANSITOUS_SOURCES_URL);
    expect(attr(link, "target")).toBe("_blank");
    expect(attr(link, "rel")).toBe("noreferrer");
    expect(html).toContain(">© Transitous</a>");
    // Inside the sheet it is not a floating control: it does not fade while the map pans.
    expect(link).not.toMatch(/\bhf-floating\b/);
    // A long trip scrolls inside the sheet; the footer stays pinned to the sheet's
    // bottom edge, on an opaque panel, so the credit never scrolls out of view.
    const footer = openTag(html, 'data-testid="reach-footer"');
    expect(footer).toMatch(/class="[^"]*\bsticky\b[^"]*\bbottom-0\b/);
    expect(footer).toMatch(/class="[^"]*bg-\[var\(--hf-panel-strong\)\]/);
    expect(html.indexOf('data-testid="reach-footer"')).toBeLessThan(html.indexOf('data-testid="transitous-credit"'));
  });

  it("renders no steps for the hint", () => {
    const html = render(HINT);
    expect(html).toContain(">Cum ajung acolo?</h2>");
    expect(html).toContain("Alege întâi o adresă");
    expect(html).not.toContain("<ol");
    expect(html).not.toContain("data-step-mode");
    expect(html).not.toContain("hf-pulse");
  });

  it("shows loading as a pulsing bus icon with no sentence", () => {
    const html = render({ state: "loading", title: "Caut un traseu…", detail: "" });
    expect(openTag(html, 'data-testid="reach-icon"')).not.toBe("");
    expect(html).toMatch(/class="[^"]*\bhf-pulse\b/);
    expect(html).not.toContain("<ol");
    // The title is the only text: no detail paragraph under it.
    expect(html.replace(/<[^>]+>/g, "")).toBe("Caut un traseu…© Transitous");
  });
});
