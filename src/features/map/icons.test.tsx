import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Icon, ICON_NAMES } from "@/features/map/icons";

// Static server render — an icon is pure markup, so the emitted SVG IS its contract.
describe("Icon", () => {
  it("lists every icon the shell draws, each once", () => {
    expect([...ICON_NAMES].sort()).toEqual(
      [
        "arrow",
        "bus",
        "car",
        "clock",
        "hold",
        "info",
        "locate",
        "metro",
        "pin",
        "retry",
        "search",
        "train",
        "tram",
        "turtle",
        "walk",
        "warning",
        "x",
      ].sort(),
    );
  });

  it.each(ICON_NAMES)("%s is a decorative 24px stroke drawing in the text colour", (name) => {
    const html = renderToStaticMarkup(<Icon name={name} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('fill="none"');
    // Something is actually drawn inside the svg.
    expect(html).toMatch(/<(path|circle|rect)\b/);
  });

  it("draws a different shape for every name", () => {
    const bodies = ICON_NAMES.map((name) =>
      renderToStaticMarkup(<Icon name={name} />).replace(/^<svg[^>]*>/, ""),
    );
    expect(new Set(bodies).size).toBe(ICON_NAMES.length);
  });

  it("passes size, stroke width and class through to the svg", () => {
    const html = renderToStaticMarkup(<Icon name="x" size={18} strokeWidth={1.5} className="text-red-500" />);
    expect(html).toContain('width="18"');
    expect(html).toContain('height="18"');
    expect(html).toContain('stroke-width="1.5"');
    expect(html).toContain('class="text-red-500"');
  });
});
