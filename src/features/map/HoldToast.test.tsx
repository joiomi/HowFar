import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { HOLD_HINT } from "@/features/map/copy";
import HoldToast from "@/features/map/HoldToast";

describe("HoldToast", () => {
  it("states the hold hint as a pointer-transparent status line", () => {
    const html = renderToStaticMarkup(<HoldToast />);
    const root = html.match(/^<[a-z]+[^>]*>/)?.[0] ?? "";
    expect(root).toContain('data-testid="hold-toast"');
    expect(root).toContain('role="status"');
    expect(root).toMatch(/class="[^"]*\bpointer-events-none\b/);
    // No backdrop blur of its own: the ⓘ popover's blur would stack on it.
    expect(root).not.toContain("backdrop-blur");
    expect(html).toContain(HOLD_HINT);
  });
});
