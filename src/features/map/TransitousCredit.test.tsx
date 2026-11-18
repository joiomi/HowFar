import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import TransitousCredit from "@/features/map/TransitousCredit";

describe("TransitousCredit", () => {
  it("is a visible link to the Transitous sources page, opened in a new tab", () => {
    const html = renderToStaticMarkup(<TransitousCredit />);
    expect(html).toMatch(/^<a[^>]*data-testid="transitous-credit"/);
    expect(html).toContain('href="https://transitous.org/sources/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain("© Transitous");
    expect(html).toMatch(/^<a[^>]*class="[^"]*\bhf-floating\b/);
  });
});
