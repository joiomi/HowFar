import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { HOLD_HINT, HOLD_HINT_DESKTOP } from "@/features/map/copy";
import HoldToast from "@/features/map/HoldToast";

describe("HoldToast", () => {
  it("states the hold hint as a pointer-transparent status line", () => {
    const html = renderToStaticMarkup(<HoldToast text={HOLD_HINT} />);
    const root = html.match(/^<[a-z]+[^>]*>/)?.[0] ?? "";
    expect(root).toContain('data-testid="hold-toast"');
    expect(root).toContain('role="status"');
    expect(root).toMatch(/class="[^"]*\bpointer-events-none\b/);
    // No backdrop blur of its own: the ⓘ popover's blur would stack on it.
    expect(root).not.toContain("backdrop-blur");
    expect(html).toContain(HOLD_HINT);
  });

  it("says what it is given: the right-click wording on a wider screen", () => {
    const html = renderToStaticMarkup(<HoldToast text={HOLD_HINT_DESKTOP} />);
    expect(html).toContain(HOLD_HINT_DESKTOP);
    expect(html).not.toContain(HOLD_HINT);
  });
});
