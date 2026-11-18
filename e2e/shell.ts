import { expect, type Locator, type Page } from "@playwright/test";

// Shared helpers for driving the search box, the mode pill (mode buttons, preset chips,
// the walking-pace turtle and the departure clock) and the ⓘ popover, and for checking
// that a credit can be read (nothing on top of it). Specs call these instead of
// repeating role/test-id selectors, so a change to the controls' markup is edited here
// once.

export type ShellMode = "walk" | "transit" | "car";

// The mode buttons' accessible names, spelled out here rather than imported: the
// specs check the shipped strings, not whatever the app code currently says.
const MODE_NAME: Record<ShellMode, string> = {
  walk: "Pe jos",
  transit: "Transport public",
  car: "Mașina",
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

// The mode pill floats over the map in every state, so its controls are always one
// click away.
export async function pickMode(page: Page, mode: ShellMode): Promise<void> {
  await modeButton(page, mode).click();
}

export async function pickPreset(page: Page, minutes: number): Promise<void> {
  await page.getByTestId(`preset-chip-${minutes}`).click();
}

// Walk only: the turtle toggles between Normal and Slow pace.
export async function toggleSlowPace(page: Page): Promise<void> {
  await page.getByTestId("pace-toggle").click();
}

// Transit and car only: the clock toggles the departure between 8:30 and 12:30.
export async function toggleDeparture(page: Page): Promise<void> {
  await page.getByTestId("time-toggle").click();
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

// Fails unless a tap at the element's centre would land on it: the element itself or
// something inside it is the topmost thing there. Visibility alone passes for a credit
// another floating control sits on top of; this proves it can be read and tapped.
export async function expectNotCovered(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit !== null && element.contains(hit);
      }),
    )
    .toBe(true);
}

// Open the ⓘ popover with its button and return it. A popover that is already open may be
// the one the first map load opens, which closes itself after a few seconds: close it and
// open it again, so it stays open for the assertions that follow.
export async function openInfo(page: Page): Promise<Locator> {
  const button = page.getByTestId("info-button");
  const popover = page.getByTestId("info-popover");
  if ((await button.getAttribute("aria-expanded")) === "true") {
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "false");
  }
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(popover).toBeVisible();
  return popover;
}

// The basemap credits every map state carries in the ⓘ popover, by link text: each link,
// its target, and that nothing covers it.
const BASEMAP_CREDIT_LINKS: ReadonlyArray<readonly [string, string]> = [
  ["OpenStreetMap", "https://www.openstreetmap.org/copyright"],
  ["ESA WorldCover", "https://esa-worldcover.org/en/data-access"],
  ["CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"],
  ["Daylight", "https://daylightmap.org"],
  ["Natural Earth", "https://www.naturalearthdata.com"],
];

export async function expectBasemapCredits(popover: Locator): Promise<void> {
  for (const [name, href] of BASEMAP_CREDIT_LINKS) {
    const link = popover.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", href);
    await expectNotCovered(link);
  }
}
