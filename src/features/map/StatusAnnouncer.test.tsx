import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import StatusAnnouncer from "@/features/map/StatusAnnouncer";

describe("StatusAnnouncer", () => {
  it("is a visually hidden polite live region carrying the given text", () => {
    const html = renderToStaticMarkup(<StatusAnnouncer text="Calculez zona…" />);
    expect(html).toMatch(/^<p[^>]*data-testid="status-announcer"/);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toMatch(/class="[^"]*\bsr-only\b/);
    expect(html).toContain("Calculez zona…");
  });

  it("stays in the page while silent, so the first announcement is heard", () => {
    const html = renderToStaticMarkup(<StatusAnnouncer text="" />);
    expect(html).toContain('role="status"');
    expect(html).toMatch(/<p[^>]*><\/p>/);
  });
});
