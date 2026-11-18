import { expect, test, type Page } from "@playwright/test";
import { modeButton, pickMode, search, toggleDeparture, toggleSlowPace } from "./shell";
import { emptyAmenities } from "./amenity-fixtures";

// Slice-1 interactivity, provider calls STUBBED (CI has no ORS key / can't hit
// Nominatim). We stub ONLY the three provider routes by exact path — never
// `/api/**`, which would swallow `/api/tiles` and break the basemap.

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
const ISOCHRONE = {
  origin: { lat: 44.4268, lng: 26.1025 },
  rings: [ring(15, 0.01), ring(30, 0.02), ring(45, 0.03)],
};

async function stubIsochrone(page: Page) {
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: ISOCHRONE }));
}

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

test("search renders a marker, 3 isochrone rings, and the address label", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  // Typing now also fires /api/suggest (autocomplete) — stub it empty to keep
  // this test hermetic; submitting with Enter still exercises the geocode path.
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await stubIsochrone(page);

  const map = await waitForMap(page);
  await search(page, "Piata Unirii");

  await expect(map).toHaveAttribute("data-isochrone-rings", "3");
  await expect(map).toHaveAttribute("data-selection", /Piața Unirii/);
  await expect(page.getByText("Piața Unirii, București")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the clear button returns to first open", async ({ page }) => {
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  // Walk preset contours (10 and 20 min), so the reach is actually painted before the clear.
  const reachRequests: string[] = [];
  await page.route("**/api/isochrone**", (route) => {
    reachRequests.push(route.request().url());
    return route.fulfill({ json: { origin: ISOCHRONE.origin, rings: [ring(10, 0.01), ring(20, 0.02)] } });
  });
  await page.route("**/api/transit**", (route) => {
    reachRequests.push(route.request().url());
    return route.fulfill({
      json: { origin: ISOCHRONE.origin, rings: [ring(20, 0.03), ring(40, 0.06)], departure: "2026-07-29T05:30:00.000Z" },
    });
  });

  const map = await waitForMap(page);
  const combobox = page.getByRole("combobox");
  await search(page, "Piata Unirii");
  // The bar shows the resolved address, not the typed query.
  await expect(combobox).toHaveValue("Piața Unirii, București");
  await expect(map).toHaveAttribute("data-preset-contours", /\d/);

  await page.getByTestId("clear-address").click();
  await expect(map).not.toHaveAttribute("data-selection");
  await expect(map).not.toHaveAttribute("data-preset-contours");
  await expect(combobox).toHaveValue("");
  await expect(combobox).toHaveAttribute("placeholder", "Caută o adresă sau atinge harta");
  await expect(page.getByTestId("first-run")).toBeVisible();
  await expect(page.getByTestId("clear-address")).toHaveCount(0);

  // With no place left there is nothing to recompute: the turtle, a mode switch and the
  // clock only change the settings. No reach request goes out and no place comes back.
  const requestsAtClear = reachRequests.length;
  await toggleSlowPace(page);
  await expect(page.getByTestId("pace-toggle")).toHaveAttribute("aria-pressed", "true");
  await pickMode(page, "transit");
  await expect(modeButton(page, "transit")).toHaveAttribute("aria-pressed", "true");
  await toggleDeparture(page);
  await expect(page.getByTestId("time-toggle")).toHaveText("12:30");
  // A recompute would start on the tap itself; give its request time to show up.
  await page.waitForTimeout(500);
  expect(reachRequests.slice(requestsAtClear)).toEqual([]);
  await expect(map).not.toHaveAttribute("data-selection");
  await expect(page.locator(".hf-map-shell")).toHaveAttribute("data-sel-status", "idle");

  // Choosing the same place again is a fresh selection: the bar shows its address again,
  // and the reach is asked for with the settings chosen after the clear.
  await search(page, "Piata Unirii");
  await expect(combobox).toHaveValue("Piața Unirii, București");
  await expect(page.getByTestId("clear-address")).toHaveCount(1);
  await expect.poll(() => reachRequests.length - requestsAtClear).toBe(1);
  expect(reachRequests[reachRequests.length - 1]).toMatch(/\/api\/transit\?.*preset=quiet/);
});

test("clicking the map reverse-geocodes and renders the isochrone", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.route("**/api/reverse**", (route) =>
    route.fulfill({ json: { lat: 44.44, lng: 26.09, label: "A clicked spot, București" } }),
  );
  await stubIsochrone(page);

  const map = await waitForMap(page);
  // x clears the left-docked control column so this stays a bare-map click.
  await map.click({ position: { x: 760, y: 320 } });

  await expect(map).toHaveAttribute("data-isochrone-rings", "3");
  await expect(map).toHaveAttribute("data-selection", /clicked spot/i);
  expect(errors).toEqual([]);
});

test("a superseded slow selection never overwrites the newer one", async ({ page }) => {
  let call = 0;
  await page.route("**/api/reverse**", async (route) => {
    call += 1;
    const first = call === 1;
    if (first) await new Promise((r) => setTimeout(r, 700));
    route.fulfill({ json: { lat: 44.44, lng: 26.09, label: first ? "Spot A (slow)" : "Spot B (fast)" } });
  });
  await stubIsochrone(page);

  const map = await waitForMap(page);
  // Click in the LOWER half of the map: click A's 700 ms-delayed reverse can
  // resolve between the two clicks on a slow runner, summoning the amenity panel
  // over an upper click point and stalling click B's actionability. The lower
  // half is clear of the overlay — and x clears the left dock.
  await map.click({ position: { x: 710, y: 520 } });
  await map.click({ position: { x: 860, y: 560 } });

  // B resolves first (A is delayed + aborted); the map must end on B, not A.
  await expect(map).toHaveAttribute("data-selection", /Spot B/);
  await page.waitForTimeout(900); // let A's slow response arrive…
  await expect(map).toHaveAttribute("data-selection", /Spot B/); // …and be ignored
});
