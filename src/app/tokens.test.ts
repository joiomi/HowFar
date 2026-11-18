import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The two secondary text colours sit on the shell's dark surfaces everywhere
// (panel #0d110e, canvas #080b09); both must meet WCAG AA for body text (4.5:1).
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!match) throw new Error(`--${name} is not a 6-digit hex colour in globals.css`);
  return match[1]!.toLowerCase();
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("secondary text tokens", () => {
  it("the contrast helper reproduces WCAG reference ratios", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    // #767676 on white is the darkest grey that passes AA (4.54:1).
    expect(contrast("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("muted and subtle text meet 4.5:1 on the panel and the canvas", () => {
    const muted = token("hf-muted");
    const subtle = token("hf-subtle");
    expect(muted).toBe("#a3b0a6");
    expect(subtle).toBe("#7d8a80");
    for (const fg of [muted, subtle])
      for (const bg of ["#0d110e", "#080b09"]) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
