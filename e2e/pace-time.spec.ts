import { expect, test, type Page } from "@playwright/test";
import { openInfo, pickMode, search, toggleDeparture, toggleSlowPace } from "./shell";
import { emptyAmenities } from "./amenity-fixtures";

// The mode pill's pace turtle (walk) and departure clock (transit/car) on the
// phone-first preset client. Providers are stubbed by EXACT path. The mock cannot prove
// the server ring→count coupling (that lives in unit + integration tests + the live
// calibration); what e2e proves is that the toggles SEND the right params, show
// their state, and that the transit state keeps its honesty note in the ⓘ popover. The
// preset client suppresses amenity markers (deferred to the planned amenity pass), so the
// pace/time re-render is proven by the REQUEST it drives (a new reach flight carrying the
// changed param), not by an amenity count.
// Waits are on data-* stamps + captured URLs, never sleeps.

function ring(minutes: number, d: number) {
  return {
    minutes,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [26.1025 - d, 44.4268 - d],
          [26.1025 + d, 44.4268 - d],
          [26.1025 + d, 44.4268 + d],
          [26.1025 - d, 44.4268 + d],
          [26.1025 - d, 44.4268 - d],
        ],
      ],
    },
  };
}
// Walk answers the calibrated preset [10, 20].
const WALK = { origin: { lat: 44.4268, lng: 26.1025 }, rings: [ring(10, 0.01), ring(20, 0.02)] };

// Captured outgoing request URLs, so we can assert the exact query the controls send.
interface Captured {
  iso: string[];
  transit: string[];
}

async function stubBase(page: Page): Promise<Captured> {
  const cap: Captured = { iso: [], transit: [] };
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/isochrone**", (route) => {
    cap.iso.push(route.request().url());
    route.fulfill({ json: WALK });
  });
  await page.route("**/api/transit**", (route) => {
    cap.transit.push(route.request().url());
    // Echo the resolved departure, as the real route does.
    route.fulfill({ json: { ...WALK, departure: "2026-07-29T05:30:00.000Z" } });
  });
  // Preset mode fetches no amenities; keep a defensive empty stub so a stray call
  // never reaches the network (it should never fire — see the count assertions).
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: emptyAmenities({ lat: 44.4268, lng: 26.1025 }) }));
  return cap;
}

async function loadAndSearch(page: Page) {
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-isochrone-rings", "2");
  return map;
}

test("defaults: the walk turtle is unpressed (Normal pace); walk request is pace=normal with NO leaked time params", async ({ page }) => {
  const cap = await stubBase(page);
  await loadAndSearch(page);
  // One two-state toggle: unpressed = Normal, pressed = Slow (there is no third pace).
  const turtle = page.getByTestId("pace-toggle");
  await expect(turtle).toBeVisible();
  await expect(turtle).toHaveAccessibleName("Mers încet");
  await expect(turtle).toHaveAttribute("aria-pressed", "false");
  // Walk has no departure clock.
  await expect(page.getByTestId("time-toggle")).toHaveCount(0);
  expect(cap.iso.some((u) => /pace=normal/.test(u))).toBe(true);
  // Walk mode must never carry transit-only departure params (regression guard).
  expect(cap.iso.every((u) => !/[?&](preset|weekday|time)=/.test(u))).toBe(true);
});

test("the turtle switches to Slow: a fresh reach flight carries pace=slow and the turtle reads pressed", async ({ page }) => {
  const cap = await stubBase(page);
  await loadAndSearch(page);
  const isoBefore = cap.iso.length;
  await toggleSlowPace(page);
  await expect(page.getByTestId("pace-toggle")).toHaveAttribute("aria-pressed", "true");
  // The pace change drives a fresh reach flight carrying pace=slow — the re-render
  // proof now that amenity markers (the old count proof) are deferred to the planned amenity pass.
  await expect.poll(() => cap.iso.length).toBeGreaterThan(isoBefore);
  expect(cap.iso.some((u) => /pace=slow/.test(u))).toBe(true);
});

test("the turtle is Walk-only; Public transport shows the clock instead and requests Normal even after Slow", async ({ page }) => {
  const cap = await stubBase(page);
  await loadAndSearch(page);
  // Walk: the turtle is present. Slow → a fresh reach flight carries pace=slow.
  await expect(page.getByTestId("pace-toggle")).toBeVisible();
  await toggleSlowPace(page);
  await expect.poll(() => cap.iso.some((u) => /pace=slow/.test(u))).toBe(true);

  // Switch to Public transport: the turtle is GONE (pace is walk-only) and the
  // departure clock takes its place…
  await pickMode(page, "transit");
  await expect(page.getByTestId("pace-toggle")).toHaveCount(0);
  await expect(page.getByTestId("time-toggle")).toBeVisible();
  // …and the transit reach used Normal, not the remembered Slow — the regression
  // guard for effective pace (not sel.pace): every transit request is pace=normal.
  await expect.poll(() => cap.transit.length).toBeGreaterThan(0);
  expect(cap.transit.every((u) => /pace=normal/.test(u))).toBe(true);
  expect(cap.transit.some((u) => /pace=slow/.test(u))).toBe(false);
});

test("the clock: departs at 8:30 rush by default (preset=crowded); a tap switches to 12:30 (preset=quiet) and back", async ({ page }) => {
  const cap = await stubBase(page);
  await loadAndSearch(page);
  // Walk mode: no departure clock.
  await expect(page.getByTestId("time-toggle")).toHaveCount(0);
  await pickMode(page, "transit");
  const clock = page.getByTestId("time-toggle");
  await expect(clock).toBeVisible();
  await expect(clock).toHaveAccessibleName("Plecare la 8:30 (ora de vârf)");
  await expect(clock).toHaveText("8:30");
  await expect.poll(() => cap.transit.some((u) => /preset=crowded/.test(u))).toBe(true);
  // No Custom editor (removed for a least-necessary UI).
  await expect(page.getByRole("button", { name: "Custom…" })).toHaveCount(0);
  // Peak-honesty note in the ⓘ popover: the metro is immune to road traffic, buses and
  // trams can run late at rush hour.
  const info = await openInfo(page);
  await expect(info).toContainText("Metroul nu depinde de trafic; autobuzul și tramvaiul pot întârzia la aglomerație.");

  const before = cap.transit.length;
  await toggleDeparture(page);
  await expect(clock).toHaveAccessibleName("Plecare la 12:30");
  await expect(clock).toHaveText("12:30");
  await expect.poll(() => cap.transit.length).toBeGreaterThan(before);
  expect(cap.transit[cap.transit.length - 1]).toMatch(/preset=quiet/);

  // A second tap flips back to the 8:30 rush departure.
  const beforeBack = cap.transit.length;
  await toggleDeparture(page);
  await expect(clock).toHaveAccessibleName("Plecare la 8:30 (ora de vârf)");
  await expect.poll(() => cap.transit.length).toBeGreaterThan(beforeBack);
  expect(cap.transit[cap.transit.length - 1]).toMatch(/preset=crowded/);
});

test("keyboard: the turtle is reachable and operable with the keyboard", async ({ page }) => {
  const cap = await stubBase(page);
  await loadAndSearch(page);
  const turtle = page.getByTestId("pace-toggle");
  await turtle.focus();
  await expect(turtle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(turtle).toHaveAttribute("aria-pressed", "true");
  // Operable ⇒ it drove a fresh reach flight carrying pace=slow.
  await expect.poll(() => cap.iso.some((u) => /pace=slow/.test(u))).toBe(true);
});
