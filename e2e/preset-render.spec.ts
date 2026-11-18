import { expect, test, type Page } from "@playwright/test";
import { expectBannerClear, expectBasemapCredits, expectNotCovered, openInfo, pickMode, pickPreset, search } from "./shell";
import { emptyAmenities } from "./amenity-fixtures";

/**
 * Phone-first deterministic read-back oracle. The BINDING proof of the
 * phone-first preset render is NOT a WebGL pixel diff (cross-machine raster flake)
 * but the `data-*` stamps the render writes: the served preset contours,
 * the calibrated interior-line minutes (the render-midpoint honesty), the chip →
 * painted-contour mapping (pure client visibility, no refetch), amenity
 * suppression, the first-paint placeholder, and the data credits in the ⓘ popover
 * (the basemap credits in every mode, Transitous on transit only).
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

test("walk preset: default chip 10 draws only the 10-min contour, the 20 chip adds the calibrated 10-min interior line — no refetch; the info popover credits the basemap, not Transitous", async ({
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

  // The ⓘ popover credits the basemap, readable; a walk state shows no Transitous
  // credit anywhere (it would imply transit data that isn't there).
  const info = await openInfo(page);
  await expectBasemapCredits(info);
  await expect(info.getByRole("link", { name: "Transitous" })).toHaveCount(0);
  await expect(page.getByTestId("transitous-credit")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("transit preset: default 20, the 40 chip adds the calibrated 20-min interior line, and Transitous is credited floating and in the info popover", async ({
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

  // The Transitous credit floats on the transit state, readable (nothing on top of it).
  await expectNotCovered(page.getByTestId("transitous-credit"));

  await pickPreset(page, 40);
  await expect(map).toHaveAttribute("data-selected-preset", "40");
  await expect(map).toHaveAttribute("data-preset-contours", "20,40");
  await expect(map).toHaveAttribute("data-interior-lines", "20");

  // The ⓘ popover credits the basemap and, on transit, Transitous too.
  const info = await openInfo(page);
  await expectBasemapCredits(info);
  const transitous = info.getByRole("link", { name: "Transitous", exact: true });
  await expect(transitous).toHaveAttribute("href", "https://transitous.org/sources/");
  await expectNotCovered(transitous);
  await expectNotCovered(page.getByTestId("transitous-credit"));
});

test("car preset: 10/25 contours, the basemap credits in the info popover, and NO Transitous credit on a non-transit state", async ({ page }) => {
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

  // The ⓘ popover credits the basemap; the Transitous credit must NOT appear on a car
  // state, in the popover or floating (it would imply transit data).
  const info = await openInfo(page);
  await expectBasemapCredits(info);
  await expect(info.getByRole("link", { name: "Transitous" })).toHaveCount(0);
  await expect(page.getByTestId("transitous-credit")).toHaveCount(0);
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
  // After the live map loads, the placeholder is marked covered, and the ⓘ button
  // (the data credits) is on screen.
  await expect(placeholder).toHaveAttribute("data-map-placeholder", "covered");
  await expect(page.getByTestId("info-button")).toBeVisible();
});

test("degraded reach: a failed isochrone shows a compact banner over the live map (no takeover, no void), and ↻ retries it", async ({
  page,
}) => {
  await baseStubs(page);
  let walkFails = true;
  await page.route("**/api/isochrone**", (route) =>
    walkFails ? route.fulfill({ status: 502, json: { error: "upstream" } }) : route.fulfill({ json: WALK_PRESET }),
  );
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: emptyAmenities(ORIGIN) }));

  const map = await waitForMap(page);
  await search(page, "Piata Unirii");

  // The failure is one compact alert row over the map: the walking sentence and a ↻,
  // no walk switch (walking is what failed). No sheet or first-open pulse takes the
  // screen; the map stays loaded (the reach failed, the app did not).
  const banner = page.getByTestId("error-banner");
  await expect(banner).toHaveAttribute("role", "alert");
  await expect(banner).toContainText("Nu am putut calcula zona pe jos.");
  await expect(page.getByTestId("banner-walk")).toHaveCount(0);
  await expect(page.getByTestId("result-sheet")).toHaveCount(0);
  await expect(page.getByTestId("first-open-pulse")).toHaveCount(0);
  await expect(map).toHaveAttribute("data-map-loaded", "true");
  await expectBannerClear(page);
  // No reach was drawn — the preset stamps stay unset.
  await expect(map).not.toHaveAttribute("data-selected-preset", /.*/);
  await expect(page.getByTestId("mode-icon-walk")).toHaveAccessibleName("Pe jos (indisponibil)");

  // ↻ runs the same search again; once the service answers, the reach is drawn.
  walkFails = false;
  await page.getByTestId("banner-retry").click();
  await expect(map).toHaveAttribute("data-preset-contours", "10");
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId("mode-icon-walk")).toHaveAccessibleName("Pe jos");
});

test("a FAILED recompute clears the reach and flags the mode as unavailable — no reach claim over a blank map", async ({ page }) => {
  await baseStubs(page);
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK_PRESET }));
  // Transit recompute fails: status becomes "error" (not "loading"), lastSelection is
  // retained and the drawn reach is cleared — nothing may keep claiming "~N min"
  // over the now-blank map, and the failed mode says it is unavailable.
  await page.route("**/api/transit**", (route) => route.fulfill({ status: 502, json: { error: "upstream" } }));
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: emptyAmenities(ORIGIN) }));

  const map = await waitForMap(page);
  await search(page, "Piata Unirii");
  // Walk resolved: a reach is drawn.
  await expect(map).toHaveAttribute("data-preset-contours", "10");

  // Toggle to Public transport, whose recompute fails. On failure the render is
  // cleared (status="error"), so the preset/mode stamps are UNSET — not "transit".
  await pickMode(page, "transit");

  // The failure surfaces as the banner, the reach is cleared, and the failed mode is
  // flagged on its own button in the mode pill (a degraded state, never a takeover).
  await expect(page.getByTestId("error-banner")).toContainText("Nu am putut calcula zona cu transportul public.");
  await expect(map).not.toHaveAttribute("data-preset-contours", /.*/);
  await expect(map).not.toHaveAttribute("data-mode", /.*/);
  await expect(page.getByTestId("mode-icon-transit")).toHaveAccessibleName("Transport public (indisponibil)");
  await expect(page.getByTestId("mode-icon-walk")).toHaveAccessibleName("Pe jos");
  // Nothing from Transitous is on screen, so no Transitous credit; the ⓘ stays readable.
  await expect(page.getByTestId("transitous-credit")).toHaveCount(0);
  await expectBannerClear(page);
});

test("a failed transit reach offers retry and a switch to walking; a failed address lookup offers only retry", async ({
  page,
}) => {
  await baseStubs(page);
  // The address lookup is down at first. Registered after baseStubs, so it is asked first;
  // once the lookup is back it falls through to baseStubs' answer.
  let geocodeFails = true;
  await page.route("**/api/geocode**", (route) =>
    geocodeFails ? route.fulfill({ status: 503, json: { error: "unavailable" } }) : route.fallback(),
  );
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK_PRESET }));
  let transitFails = true;
  await page.route("**/api/transit**", (route) =>
    transitFails
      ? route.fulfill({ status: 502, json: { error: "upstream" } })
      : route.fulfill({ json: TRANSIT_PRESET }),
  );
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: emptyAmenities(ORIGIN) }));

  const map = await waitForMap(page);
  // Public transport is chosen before the first search, so nothing is drawn yet when it fails.
  await pickMode(page, "transit");
  await search(page, "Piata Unirii");

  // A failed address lookup is no fault of public transport: ↻ only, no walk switch, no flag.
  const banner = page.getByTestId("error-banner");
  await expect(banner).toContainText("Nu am putut căuta adresa.");
  await expect(page.getByTestId("banner-walk")).toHaveCount(0);
  await expect(page.getByTestId("mode-icon-transit")).toHaveAccessibleName("Transport public");
  await expectBannerClear(page);

  // ↻ once the lookup is back: the address resolves, and now the transit reach itself fails.
  geocodeFails = false;
  await page.getByTestId("banner-retry").click();
  await expect(banner).toContainText("Nu am putut calcula zona cu transportul public.");
  await expect(page.getByTestId("mode-icon-transit")).toHaveAccessibleName("Transport public (indisponibil)");
  await expect(page.getByTestId("transitous-credit")).toHaveCount(0);
  await expect(page.getByTestId("banner-walk")).toHaveAttribute("aria-label", "Treci la mersul pe jos");
  await expectBannerClear(page);

  // Switching to walking answers for the same address, and the flag goes.
  await page.getByTestId("banner-walk").click();
  await expect(map).toHaveAttribute("data-mode", "walk");
  await expect(map).toHaveAttribute("data-preset-contours", "10");
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId("mode-icon-transit")).toHaveAccessibleName("Transport public");

  // Back to public transport while it still fails: the banner returns. Once the
  // service is back, ↻ draws the transit reach and its credit.
  await pickMode(page, "transit");
  await expect(banner).toContainText("Nu am putut calcula zona cu transportul public.");
  transitFails = false;
  await page.getByTestId("banner-retry").click();
  await expect(map).toHaveAttribute("data-mode", "transit");
  await expect(map).toHaveAttribute("data-preset-contours", "20");
  await expect(banner).toHaveCount(0);
  await expectNotCovered(page.getByTestId("transitous-credit"));
});
