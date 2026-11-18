import { expect, test, type Page } from "@playwright/test";
import { openInfo, pickMode, pickPreset, search, toggleDeparture } from "./shell";
import { emptyAmenities } from "./amenity-fixtures";

// Car travel mode on the phone-first preset client.
// The client sends `&model=preset`, so /api/car answers the CALIBRATED car preset
// [10, 25]. Car has NO pace and NO per-minute ring-filter; its departure clock (8:30 rush / 12:30) still
// reshapes the reach for traffic realism. Providers are stubbed by EXACT path so
// the real self-hosted basemap tiles still load. The reach is drawn as the preset
// shells + contour lines (`preset-reach-fill`/`-line` sources), and the read-back
// oracle is the `data-preset-*` stamps — the same contract preset-render.spec proves.

function polyRing(minutes: number, d: number) {
  return {
    minutes,
    geometry: {
      type: "MultiPolygon",
      coordinates: [[[
        [26.1025 - d, 44.4268 - d],
        [26.1025 + d, 44.4268 - d],
        [26.1025 + d, 44.4268 + d],
        [26.1025 - d, 44.4268 + d],
        [26.1025 - d, 44.4268 - d],
      ]]],
    },
  };
}
// Car response carries the calibrated [10, 25] preset. The outer (25-min) ring
// ~0.32° exceeds the Bucharest maxBounds (~0.6°×0.5°), so this fixture also
// exercises off-map clipping — not a viewport-tiny mock. The `car` meta block
// mirrors the real /api/car payload.
const CAR_META = { basis: "estimate", slotId: "am-peak", slotLabel: "weekday morning rush" };
const CAR = { origin: { lat: 44.4268, lng: 26.1025 }, rings: [polyRing(10, 0.3), polyRing(25, 0.32)], car: CAR_META };
const WALK = { origin: { lat: 44.4268, lng: 26.1025 }, rings: [polyRing(10, 0.28), polyRing(20, 0.3)] };

async function setup(page: Page, carBody: unknown = CAR) {
  const reachCalls: string[] = [];
  const carCalls: string[] = [];
  await page.route("**/api/amenities**", (route) =>
    route.fulfill({ json: emptyAmenities({ lat: 44.4268, lng: 26.1025 }) }),
  );
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK }));
  await page.route("**/api/car**", (route) => {
    carCalls.push(route.request().url());
    route.fulfill({ json: carBody });
  });
  await page.route("**/api/reach**", (route) => {
    reachCalls.push(route.request().url());
    route.fulfill({ json: { reachable: false } });
  });
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  return { map, reachCalls, carCalls };
}

async function selectCar(page: Page, map: ReturnType<Page["getByTestId"]>) {
  await search(page, "Piata Unirii");
  // Walk preset renders first — two calibrated contours [10, 20].
  await expect(map).toHaveAttribute("data-isochrone-rings", "2");
  await pickMode(page, "car");
  await expect(map).toHaveAttribute("data-mode", "car");
  // Car preset renders its two calibrated contours [10, 25].
  await expect(map).toHaveAttribute("data-isochrone-rings", "2");
  await expect(map).toHaveAttribute("data-camera-settled", "true", { timeout: 10_000 });
}

test("Car mode fetches /api/car with the preset model + time context, NO pace, and draws the [10, 25] preset", async ({ page }) => {
  const { map, carCalls } = await setup(page);
  await selectCar(page, map);

  // The car request carries the preset model AND the time context (car
  // reach is time-aware for traffic realism) but NEVER pace (a walk concept).
  expect(carCalls.length).toBeGreaterThan(0);
  const carUrl = carCalls[carCalls.length - 1]!;
  expect(carUrl).toContain("model=preset");
  expect(carUrl).toMatch(/lat=.*&lng=/);
  expect(carUrl).not.toMatch(/pace/);
  expect(carUrl).toContain("preset=crowded"); // default time context (8:30 rush)

  // The reach draws the calibrated car preset: default chip is the SMALLER (10-min)
  // contour; selecting the 25 chip adds the 10-min interior line (render-midpoint
  // honesty), and neither triggers a refetch (client-side visibility of the served set).
  await expect(map).toHaveAttribute("data-selected-preset", "10");
  await expect(map).toHaveAttribute("data-preset-contours", "10");
  const carCallsBefore = carCalls.length;
  await pickPreset(page, 25);
  await expect(map).toHaveAttribute("data-preset-contours", "10,25");
  await expect(map).toHaveAttribute("data-interior-lines", "10");
  expect(carCalls.length).toBe(carCallsBefore); // chip change is pure visibility, no refetch
});

test("Car mode shows NO walking-pace turtle, but DOES show the departure clock", async ({ page }) => {
  const { map } = await setup(page);
  await selectCar(page, map);
  // Pace is a walk concept — NOT PRESENT (count 0), not merely CSS-hidden (a
  // rendered-then-hidden turtle would still be a regression: the pill renders
  // exactly one toggle per mode).
  await expect(page.getByTestId("pace-toggle")).toHaveCount(0);
  // Car reach IS time-aware: the departure clock is present, at the 8:30 rush default.
  const clock = page.getByTestId("time-toggle");
  await expect(clock).toBeVisible();
  await expect(clock).toHaveAccessibleName("Plecare la 8:30 (ora de vârf)");
  await expect(clock).toHaveText("8:30");
});

// Rendered lng/lat span of the DRAWN preset reach — NOT viewport-clipped
// (querySourceFeatures), so it measures the actual drawn contour size regardless
// of camera fit. Proves the core claim: peak reach is smaller than weekend.
async function presetReachSpan(page: Page): Promise<number> {
  return page.evaluate(() => {
    const m = (window as unknown as { __hfMap?: { querySourceFeatures: (s: string) => { geometry: { type: string; coordinates: unknown } }[] } }).__hfMap;
    if (!m) return -1;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    const grow = (lng: number, lat: number) => { minLng = Math.min(minLng, lng); minLat = Math.min(minLat, lat); maxLng = Math.max(maxLng, lng); maxLat = Math.max(maxLat, lat); };
    const walk = (c: unknown) => {
      if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") grow(c[0], c[1]);
      else if (Array.isArray(c)) for (const x of c) walk(x);
    };
    // The drawn reach lives in the preset line source (edge + interior contours).
    for (const f of m.querySourceFeatures("preset-reach-line")) walk(f.geometry.coordinates);
    return Number.isFinite(minLng) ? (maxLng - minLng) * (maxLat - minLat) : -1;
  });
}

test("Car time-of-day actually changes reach: 8:30 rush rings are strictly smaller than 12:30", async ({ page }) => {
  // Distinct geometry per traffic slot — small at am-peak (8:30), large at
  // midday (12:30) — so this proves the RENDERED reach shrinks at peak, not
  // just that a request fired. A regression
  // that ignored time and painted one fixed size would fail the span comparison.
  const carCalls: string[] = [];
  const small = { origin: { lat: 44.4268, lng: 26.1025 }, rings: [polyRing(10, 0.03), polyRing(25, 0.05)], car: { basis: "estimate", slotId: "am-peak", slotLabel: "weekday morning rush" } };
  const large = { origin: { lat: 44.4268, lng: 26.1025 }, rings: [polyRing(10, 0.12), polyRing(25, 0.2)], car: { basis: "estimate", slotId: "midday", slotLabel: "weekday midday" } };
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: emptyAmenities({ lat: 44.4268, lng: 26.1025 }) }));
  await page.route("**/api/geocode**", (route) => route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii" } }));
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK }));
  await page.route("**/api/car**", (route) => {
    const url = route.request().url();
    carCalls.push(url);
    route.fulfill({ json: /preset=quiet/.test(url) ? large : small });
  });
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await selectCar(page, map);

  // Default 8:30 rush → small (am-peak) rings.
  const peakSpan = await presetReachSpan(page);
  expect(peakSpan).toBeGreaterThan(0);

  // Switch the clock to 12:30 → larger rings.
  const before = carCalls.length;
  await toggleDeparture(page);
  await expect(page.getByTestId("time-toggle")).toHaveAccessibleName("Plecare la 12:30");
  await expect.poll(() => carCalls.length).toBeGreaterThan(before);
  expect(carCalls[carCalls.length - 1]!).toContain("preset=quiet");
  await expect(map).toHaveAttribute("data-isochrone-rings", "2");
  // The rendered reach GREW going 8:30 → 12:30 (i.e. peak reach is smaller).
  await expect.poll(() => presetReachSpan(page)).toBeGreaterThan(peakSpan * 2);
});

test("car ⓘ states the traffic assumption", async ({ page }) => {
  const { map } = await setup(page);
  await selectCar(page, map);
  // The car reach assumes typical traffic for the chosen departure, never live
  // traffic, and the ⓘ popover says so; car has no transit note.
  const info = await openInfo(page);
  await expect(info).toContainText("Trafic obișnuit pentru ora aleasă, nu trafic în timp real.");
  await expect(info).not.toContainText("Metroul");
});

// Right-click never produces a car drive-band answer — in EVERY
// mode it auto-switches to Public transport and draws the journey. That unified
// behavior (incl. from car mode) is covered end-to-end in reach-journey.spec.ts
// ("car-mode right-click AUTO-SWITCHES…"), which has the transit + plan fixtures
// this car-only setup deliberately omits. No car-specific right-click spec remains.
