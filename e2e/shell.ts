import { expect, type Locator, type Page } from "@playwright/test";

// Shared helpers for driving the search box, the mode buttons and the preset chips.
// Specs call these instead of repeating role/test-id selectors, so a change to the
// controls' markup is edited here once.

export type ShellMode = "walk" | "transit" | "car";

const MODE_NAME: Record<ShellMode, string> = {
  walk: "Walk",
  transit: "Public transport",
  car: "Car",
};

// Type the query into the address bar's combobox and submit it with Enter.
export async function search(page: Page, query: string): Promise<void> {
  const combobox = page.getByRole("combobox");
  await combobox.fill(query);
  await expect(combobox).toHaveValue(query); // controlled input committed
  await combobox.press("Enter");
}

export function modeButton(page: Page, mode: ShellMode): Locator {
  return page.getByRole("button", { name: MODE_NAME[mode], exact: true });
}

// Once a selection resolves, the phone dock collapses to a one-line state pill and
// hides the mode + preset bar. Tap the pill to re-expand it; a no-op where the dock
// stays open (or before the first selection).
async function revealControls(page: Page): Promise<void> {
  const pill = page.getByTestId("state-pill");
  if (await pill.isVisible().catch(() => false)) await pill.click();
}

export async function pickMode(page: Page, mode: ShellMode): Promise<void> {
  await revealControls(page);
  await modeButton(page, mode).click();
}

export async function pickPreset(page: Page, minutes: number): Promise<void> {
  await revealControls(page);
  await page.getByTestId(`preset-chip-${minutes}`).click();
}

// The shell root mirrors the selection status in `data-sel-status`: "loading" while a
// selection is in flight, "idle" once it settles or is abandoned.
export async function expectSearchBusy(page: Page): Promise<void> {
  await expect(page.locator(".hf-map-shell")).toHaveAttribute("data-sel-status", "loading", { timeout: 5000 });
}

export async function expectSearchIdle(page: Page): Promise<void> {
  await expect(page.locator(".hf-map-shell")).toHaveAttribute("data-sel-status", "idle", { timeout: 2000 });
}

// Point-sample a 20px grid over the viewport and return the percentage of points
// where the bare map (not a panel, sheet, card, dock, pill, or header) is on top.
export async function sampleMapClearPercent(page: Page): Promise<number> {
  return page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    const mapEl = document.querySelector(".maplibregl-map");
    let hits = 0;
    let total = 0;
    for (let x = 5; x < vw; x += 20)
      for (let y = 5; y < vh; y += 20) {
        total++;
        const el = document.elementFromPoint(x, y);
        if (
          el &&
          el.closest(".maplibregl-map") === mapEl &&
          !el.closest("[class*=panel],[class*=sheet],[class*=card],[class*=dock],[class*=pill],aside,header,nav,form")
        )
          hits++;
      }
    return Math.round((hits / total) * 100);
  });
}
