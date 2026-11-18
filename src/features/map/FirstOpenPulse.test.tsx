import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import FirstOpenPulse from "@/features/map/FirstOpenPulse";

/** The opening tag of the element carrying `data-testid`, or "" when absent. */
function openTag(html: string, testId: string): string {
  return html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";
}

describe("FirstOpenPulse", () => {
  it("is a decorative, pointer-transparent pulsing dot at the framed map centre", () => {
    const html = renderToStaticMarkup(<FirstOpenPulse />);
    const root = openTag(html, "first-open-pulse");
    expect(root).not.toBe("");
    // Decoration only: hidden from assistive tech, and a tap on it reaches the map.
    expect(root).toContain('aria-hidden="true"');
    expect(root).toMatch(/class="[^"]*\bpointer-events-none\b/);
    // The phone centre, and from md the centre of the map beside the 432 px column
    // (half of 432 − 24).
    expect(root).toMatch(/class="[^"]*\bleft-1\/2\b/);
    expect(root).toMatch(/class="[^"]*\btop-1\/2\b/);
    expect(root).toContain("md:left-[calc(50%+204px)]");
    // Its ring runs the shared pulse, which reduced motion stops.
    expect(html).toMatch(/class="[^"]*\bhf-pulse\b/);
  });
});
