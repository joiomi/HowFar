import { expect, test, type Page } from "@playwright/test";
import { pickMode, pickPreset, search } from "./shell";
import { emptyAmenities } from "./amenity-fixtures";

/**
 * Phone-first deterministic read-back oracle. The BINDING proof of the
 * phone-first preset render is NOT a WebGL pixel diff (cross-machine raster flake)
 * but the `data-*` stamps the render writes: the served preset contours,
 * the calibrated interior-line minutes (the render-midpoint honesty), the chip →
 * painted-contour mapping (pure client visibility, no refetch), amenity
 * suppression, the first-paint placeholder, and the transit attribution.
 *
 * The client is preset-only, so every stub returns the CALIBRATED preset contours
 * (walk [10,20], transit [20,40], car [10,25]) — the shapes the server serves on
 * `?model=preset`. 390×844 (a phone viewport) is set in the project config; this
 * suite asserts semantics, and the visual look is reviewed live.
 */

// Pin the exact phone viewport the phone-first design targets (390×844). This spec
// is routed to the mobile project (playwright.config.ts); the viewport override
// makes the size deterministic regardless of the project's device default.
test.use({ viewport: { width: 390, height: 844 } });

const ORIGIN = { lat: 44.4268, lng: 26.1025 };

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

const WALK_PRESET = { origin: ORIGIN, rings: [ring(10, 0.01), ring(20, 0.02)] };
const TRANSIT_PRESET = { origin: ORIGIN, rings: [ring(20, 0.03), ring(40, 0.06)] };
const CAR_PRESET = {
  origin: ORIGIN,
  rings: [ring(10, 0.2), ring(25, 0.35)],
  car: { basis: "estimate", slotId: "am-peak", slotLabel: "weekday morning rush" },
};

async function baseStubs(page: Page) {
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { ...ORIGIN, label: "Piața Unirii, București" } }),
  );
}

async function waitForMap(page: Page) {
  // Navigate AFTER the caller has registered its route stubs (every test sets up
  // page.route(...) before calling this), then wait for MapLibre to finish loading.
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  return map;
}

test("walk preset: default chip 10 draws only the 10-min contour, the 20 chip adds the calibrated 10-min interior line — no refetch", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  await baseStubs(page);
  let isoCalls = 0;
  let amenityCalls = 0;
  await page.route("**/api/isochrone**", (route) => {
    isoCalls += 1;
    // The client MUST send the preset model.
    expect(route.request().url()).toContain("model=preset");
    route.fulfill({ json: WALK_PRESET });
  });
  await page.route("**/api/amenities**", (route) => {
    amenityCalls += 1;
    route.fulfill({ json: emptyAmenities(ORIGIN) });
  });

  const map = await waitForMap(page);
  await search(page, "Piata Unirii");

  // Default is Walk · 10: the outer contour is 10, no interior line.
  await expect(map).toHaveAttribute("data-mode", "walk");
  await expect(map).toHaveAttribute("data-selected-preset", "10");
  await expect(map).toHaveAttribute("data-preset-contours", "10");
  await expect(map).toHaveAttribute("data-interior-lines", "");
  await expect(map).toHaveAttribute("data-isochrone-rings", "2");

  // Select the 20-min chip: the outer contour becomes 20 and the calibrated
  // 10-min interior line appears — the render-midpoint honesty.
  await pickPreset(page, 20);
  await expect(map).toHaveAttribute("data-selected-preset", "20");
  await expect(map).toHaveAttribute("data-preset-contours", "10,20");
  await expect(map).toHaveAttribute("data-interior-lines", "10");

  // The chip is pure client-side visibility: the route returned BOTH contours,
  // so the chip change must NOT trigger a second isochrone flight.
  expect(isoCalls).toBe(1);
  // Amenities are DEFERRED in preset mode (by design): ZERO fetches.
  expect(amenityCalls).toBe(0);
  expect(errors).toEqual([]);
});

test("transit preset: default 20, the 40 chip adds the calibrated 20-min interior line, and the Transitous credit is present", async ({
  page,
}) => {
  await baseStubs(page);
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK_PRESET }));
  await page.route("**/api/transit**", (route) => {
    expect(route.request().url()).toContain("model=preset");
    route.fulfill({ json: TRANSIT_PRESET });
  });
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: emptyAmenities(ORIGIN) }));

  const map = await waitForMap(page);
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-mode", "walk");

  await pickMode(page, "transit");
  await expect(map).toHaveAttribute("data-mode", "transit");
  await expect(map).toHaveAttribute("data-selected-preset", "20");
  await expect(map).toHaveAttribute("data-preset-contours", "20");
  await expect(map).toHaveAttribute("data-interior-lines", "");

  // Transitous provider credit is present on the transit state (phone-first design).
  await expect(page.getByRole("link", { name: "Transitous" })).toBeVisible();

  await pickPreset(page, 40);
  await expect(map).toHaveAttribute("data-selected-preset", "40");
  await expect(map).toHaveAttribute("data-preset-contours", "20,40");
  await expect(map).toHaveAttribute("data-interior-lines", "20");
});

test("car preset: 10/25 contours, and NO Transitous credit on a non-transit state", async ({ page }) => {
  await baseStubs(page);
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK_PRESET }));
  await page.route("**/api/car**", (route) => {
    expect(route.request().url()).toContain("model=preset");
    route.fulfill({ json: CAR_PRESET });
  });
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: emptyAmenities(ORIGIN) }));

  const map = await waitForMap(page);
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-mode", "walk");
  await pickMode(page, "car");
  await expect(map).toHaveAttribute("data-mode", "car");
  await expect(map).toHaveAttribute("data-selected-preset", "10");
  await expect(map).toHaveAttribute("data-preset-contours", "10");

  await pickPreset(page, 25);
  await expect(map).toHaveAttribute("data-preset-contours", "10,25");
  await expect(map).toHaveAttribute("data-interior-lines", "10");

  // Transit credit must NOT appear on a car state (it would imply transit data).
  await expect(page.getByRole("link", { name: "Transitous" })).toHaveCount(0);
});

test("first paint shows a realistic map placeholder, never a dark void", async ({ page }) => {
  await baseStubs(page);
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK_PRESET }));
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: emptyAmenities(ORIGIN) }));

  // Navigate, then assert the placeholder is in the DOM from first paint (an
  // inline SVG map texture) BEFORE the live map has a chance to load — the "no
  // dark void" contract. (Not via waitForMap, which would first wait for load.)
  await page.goto("/");
  const placeholder = page.getByTestId("map-placeholder");
  await expect(placeholder).toBeAttached();
  const map = page.getByTestId("app-map");
  // BEFORE the live map loads the placeholder must be VISIBLE (not merely attached) —
  // the "no dark void" contract is that its texture actually shows at first paint. A
  // placeholder that initialised hidden would pass a bare attachment check, so
  // assert the visible state (and toBeVisible) while the map is still loading.
  await expect(map).not.toHaveAttribute("data-map-loaded", "true"); // still loading
  await expect(placeholder).toHaveAttribute("data-map-placeholder", "visible");
  await expect(placeholder).toBeVisible();
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  // After the live map loads, the placeholder is marked covered.
  await expect(placeholder).toHaveAttribute("data-map-placeholder", "covered");
});

test("degraded reach: a failed isochrone shows the error inline and keeps the map alive (no takeover, no void)", async ({
  page,
}) => {
  await baseStubs(page);
  await page.route("**/api/isochrone**", (route) => route.fulfill({ status: 502, json: { error: "upstream" } }));
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: emptyAmenities(ORIGIN) }));

  const map = await waitForMap(page);
  await search(page, "Piata Unirii");

  // The failure surfaces as an inline message; the map container stays present
  // and loaded (the reach failed, the app did not).
  await expect(page.getByText(/Could not compute walking reach/i)).toBeVisible();
  await expect(map).toHaveAttribute("data-map-loaded", "true");
  // No reach was drawn — the preset stamps stay unset.
  await expect(map).not.toHaveAttribute("data-selected-preset", /.*/);
});

test("a FAILED recompute hides the reach legend + hint — no reach claim over a blank map", async ({ page }) => {
  await baseStubs(page);
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK_PRESET }));
  // Transit recompute fails: status becomes "error" (not "loading"), lastSelection is
  // retained and the drawn reach is cleared. The LegendPill/RingHint honesty surfaces
  // must NOT keep claiming "~N min" over the now-blank map.
  await page.route("**/api/transit**", (route) => route.fulfill({ status: 502, json: { error: "upstream" } }));
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: emptyAmenities(ORIGIN) }));

  const map = await waitForMap(page);
  await search(page, "Piata Unirii");
  // Walk resolved: a reach is drawn, so the legend is shown.
  await expect(map).toHaveAttribute("data-preset-contours", "10");
  await expect(page.getByTestId("legend-pill")).toBeVisible();

  // Toggle to Public transport, whose recompute fails. On failure the render is
  // cleared (status="error"), so the preset/mode stamps are UNSET — not "transit".
  await pickMode(page, "transit");

  // The failure surfaces, the reach is cleared, and NO honesty surface lingers over
  // the blank map — the legend and the mobile hint are both gone in the error state.
  await expect(page.getByText(/Could not compute/i)).toBeVisible();
  await expect(map).not.toHaveAttribute("data-preset-contours", /.*/);
  await expect(map).not.toHaveAttribute("data-mode", /.*/);
  await expect(page.getByTestId("legend-pill")).toHaveCount(0);
  await expect(page.getByTestId("ring-hint")).toHaveCount(0);
});
