import { expect, test, type Page } from "@playwright/test";
import { expectBannerClear, expectNotCovered, expectSearchBusy, expectSearchIdle, pickMode, search } from "./shell";
import { emptyAmenities } from "./amenity-fixtures";

// Transit slice: Walk/Transit toggle. Provider calls STUBBED by EXACT path
// (never `/api/**`, which would swallow `/api/tiles` and break the basemap).
// The initial search hits /api/isochrone (walk); toggling re-requests the SAME
// origin against /api/transit with no second geocode.

function polyRing(minutes: number, d: number) {
  return {
    minutes,
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [26.1025 - d, 44.4268 - d],
            [26.1025 + d, 44.4268 - d],
            [26.1025 + d, 44.4268 + d],
            [26.1025 - d, 44.4268 + d],
            [26.1025 - d, 44.4268 - d],
          ],
        ],
      ],
    },
  };
}
const WALK = { origin: { lat: 44.4268, lng: 26.1025 }, rings: [polyRing(15, 0.01), polyRing(30, 0.02), polyRing(45, 0.03)] };
// Transit reaches further (bigger rings) — the whole point of the mode.
const TRANSIT = { origin: { lat: 44.4268, lng: 26.1025 }, rings: [polyRing(15, 0.03), polyRing(30, 0.06), polyRing(45, 0.09)] };

async function waitForMap(page: Page) {
  // Every selection now also fetches amenities — stub it so CI never hits live
  // Overpass/ORS (this suite asserts nothing about amenities).
  await page.route("**/api/amenities**", (route) =>
    route.fulfill({ json: emptyAmenities({ lat: 44.4268, lng: 26.1025 }) }),
  );
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  return map;
}

test("toggling Walk→Transit re-renders transit rings for the same origin without re-geocoding", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  const counts = { geocode: 0, isochrone: 0, transit: 0, reverse: 0 };
  await page.route("**/api/geocode**", (route) => {
    counts.geocode += 1;
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } });
  });
  await page.route("**/api/reverse**", (route) => {
    counts.reverse += 1;
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } });
  });
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/isochrone**", (route) => {
    counts.isochrone += 1;
    route.fulfill({ json: WALK });
  });
  await page.route("**/api/transit**", (route) => {
    counts.transit += 1;
    route.fulfill({ json: TRANSIT });
  });

  const map = await waitForMap(page);

  // 1. Search → walking isochrone (default mode).
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-isochrone-rings", "3");
  await expect(map).toHaveAttribute("data-mode", "walk");

  // 2. Toggle to Transit → transit isochrone for the SAME origin.
  await pickMode(page, "transit");
  await expect(map).toHaveAttribute("data-mode", "transit");
  await expect(map).toHaveAttribute("data-isochrone-rings", "3");
  // The legend reflects the mode (scope to the legend — the toggle button now
  // also reads "Public transport" after the mode rename).
  await expect(page.getByTestId("ring-legend").getByText("Public transport")).toBeVisible();

  // Call accounting: exactly one walk call, one transit call, and NO second
  // geocode/reverse triggered by the toggle.
  expect(counts.transit).toBe(1);
  expect(counts.isochrone).toBe(1);
  expect(counts.geocode).toBe(1);
  expect(counts.reverse).toBe(0);

  // Attribution: a readable "© Transitous" link (nothing on top of it) to the
  // Transitous sources page.
  const attribution = page.getByTestId("transitous-credit");
  await expectNotCovered(attribution);
  await expect(attribution).toHaveText("© Transitous");
  await expect(attribution).toHaveAttribute("href", "https://transitous.org/sources/");

  expect(errors).toEqual([]);
});

test("a transit provider error surfaces a friendly message, not a crash", async ({ page }) => {
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK }));
  await page.route("**/api/transit**", (route) => route.fulfill({ status: 502, json: { error: "Upstream provider error" } }));

  const map = await waitForMap(page);
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-mode", "walk");

  await pickMode(page, "transit");
  await expect(page.getByTestId("error-banner")).toContainText("Nu am putut calcula zona cu transportul public.");
  // A failed transit reach shows nothing from Transitous, so no Transitous credit.
  await expect(page.getByTestId("transitous-credit")).toHaveCount(0);
  await expectBannerClear(page);
});

test("toggling mode while the first search is still loading does not strand the UI", async ({ page }) => {
  // Long isochrone delay so recovery-within-2s proves the abort/reset ran, not
  // the request simply finishing.
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/isochrone**", async (route) => {
    await new Promise((r) => setTimeout(r, 5000));
    route.fulfill({ json: WALK });
  });
  await page.route("**/api/transit**", (route) => route.fulfill({ json: TRANSIT }));

  await waitForMap(page);
  await search(page, "Piata Unirii");

  // Loading: the shell reports the selection as loading. Wait for it so the
  // toggle is genuinely mid-flight (no prior selection to fall back on).
  await expectSearchBusy(page);
  await pickMode(page, "transit");

  // Aborting the in-flight search must return the UI to idle immediately — well
  // before the 5 s isochrone would resolve.
  await expectSearchIdle(page);
});
