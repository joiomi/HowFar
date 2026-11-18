import { expect, test, type Page } from "@playwright/test";
import { besidePin, expectBannerClear, pickMode, search } from "./shell";
import { emptyAmenities } from "./amenity-fixtures";

// Right-click "how do I get there?". Provider calls stubbed by EXACT
// path. Walk reach is answered client-side (point-in-ring on the drawn rings);
// transit reach fetches a MOTIS trip plan from /api/reach (mocked here). The
// right-click is a native right-button click on the map canvas → contextmenu.

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
// Large rings so a click anywhere on the fitted viewport is deterministically
// inside the innermost (15-min) band — the point-in-ring result must not depend
// on exact camera projection (mock geometry, not realistic distances).
const WALK = { origin: { lat: 44.4268, lng: 26.1025 }, rings: [polyRing(10, 0.28), polyRing(20, 0.3)] };
const TRANSIT = {
  origin: { lat: 44.4268, lng: 26.1025 },
  rings: [polyRing(20, 0.28), polyRing(40, 0.3)],
  departure: "2026-07-29T05:30:00.000Z",
};
// Empty rings ⇒ point-in-ring is always null ⇒ transit right-click is
// "unreachable" with no /api/reach call.
const emptyRing = (minutes: number) => ({ minutes, geometry: { type: "MultiPolygon", coordinates: [] } });
const TRANSIT_EMPTY = { origin: { lat: 44.4268, lng: 26.1025 }, rings: [emptyRing(20), emptyRing(40)], departure: "2026-07-29T05:30:00.000Z" };
// Legs carry coords + decoded path (the server now surfaces these),
// so the popup text AND the on-map journey draw are both exercised.
const PLAN = {
  reachable: true,
  totalMinutes: 57,
  transfers: 1,
  legs: [
    { mode: "WALK", fromName: "START", toName: "Emil Racovita", minutes: 9, from: { lat: 44.4268, lng: 26.1025 }, to: { lat: 44.44, lng: 26.1 }, path: [[26.1025, 44.4268], [26.1, 44.44]] },
    { mode: "BUS", line: "243", headsign: "Bd. Lacul Tei", fromName: "Emil Racovita", toName: "Soseaua Colentina", minutes: 50, from: { lat: 44.44, lng: 26.1 }, to: { lat: 44.46, lng: 26.09 }, path: [[26.1, 44.44], [26.095, 44.45], [26.09, 44.46]] },
    { mode: "WALK", fromName: "Soseaua Colentina", toName: "END", minutes: 5, from: { lat: 44.46, lng: 26.09 }, to: { lat: 44.47, lng: 26.087 }, path: [[26.09, 44.46], [26.087, 44.47]] },
  ],
};

async function setup(page: Page) {
  const reachCalls: string[] = [];
  await page.route("**/api/amenities**", (route) =>
    route.fulfill({ json: emptyAmenities({ lat: 44.4268, lng: 26.1025 }) }),
  );
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK }));
  await page.route("**/api/transit**", (route) => route.fulfill({ json: TRANSIT }));
  await page.route("**/api/reach**", (route) => {
    reachCalls.push(route.request().url());
    route.fulfill({ json: PLAN });
  });
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  return { map, reachCalls };
}

async function searchAndWait(page: Page, map: ReturnType<Page["getByTestId"]>) {
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-isochrone-rings", "2");
}

// Native right-click near the centre of the map canvas (over the origin/rings).
async function rightClickCentre(page: Page) {
  const canvas = page.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  await canvas.click({ button: "right", position: { x: Math.round(box.width / 2), y: Math.round(box.height / 2) } });
}

// Native right-click on bare map beside the origin pin (the pin sits at the centre once a
// place is selected, and a press on it is the pin's, not the map's).
async function rightClickBesidePin(page: Page) {
  const at = await besidePin(page);
  await page.mouse.click(at.x, at.y, { button: "right" });
}

test("right-click with no selection shows the hint", async ({ page }) => {
  const { map } = await setup(page);
  await rightClickCentre(page);
  await expect(map).toHaveAttribute("data-reach-state", "hint");
  await expect(page.getByTestId("reach-panel")).toContainText("Pick a starting point");
});

test("a right-click on the origin pin opens no directions", async ({ page }) => {
  const { map, reachCalls } = await setup(page);
  await searchAndWait(page, map);
  const pin = await page.locator(".hf-origin-marker").boundingBox();
  if (!pin) throw new Error("the origin pin has no box");
  await page.mouse.click(pin.x + pin.width / 2, pin.y + pin.height / 2, { button: "right" });
  // The sentinel: a right-click on bare map beside the pin plans the trip. Once it has, a plan
  // for the pin would already have been requested; there is exactly the sentinel's.
  await rightClickBesidePin(page);
  await expect(map).toHaveAttribute("data-reach-state", "transit");
  expect(reachCalls).toHaveLength(1);
});

test("Escape closes the directions even after focus has left the panel", async ({ page }) => {
  const { map } = await setup(page);
  await searchAndWait(page, map);
  await rightClickBesidePin(page); // any-mode right-click → transit directions
  await expect(map).toHaveAttribute("data-reach-state", "transit");
  // Move focus off the panel to the map container (tabIndex=-1) — a panel-scoped
  // Escape handler would go dead here; the document-level one must still close.
  await page.getByTestId("app-map").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("reach-panel")).toHaveCount(0);
  await expect(map).not.toHaveAttribute("data-reach-state", /.+/);
});

test("walk mode: right-click auto-switches to Public transport and plans the trip", async ({ page }) => {
  const { map, reachCalls } = await setup(page);
  await searchAndWait(page, map); // walk mode
  await rightClickBesidePin(page);
  // No more walk-band answer — right-click always means "get me there by PT".
  await expect(map).toHaveAttribute("data-mode", "transit");
  await expect(map).toHaveAttribute("data-reach-state", "transit");
  const popup = page.getByTestId("reach-panel");
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("By public transport");
  expect(reachCalls).toHaveLength(1); // now a real MOTIS plan fetch
});

test("public-transport mode: right-click shows the planned trip with a specific line", async ({ page }) => {
  const { map, reachCalls } = await setup(page);
  await searchAndWait(page, map);
  await pickMode(page, "transit");
  await expect(map).toHaveAttribute("data-mode", "transit");

  await rightClickBesidePin(page);
  await expect(map).toHaveAttribute("data-reach-state", "transit");
  const panel = page.getByTestId("reach-panel");
  await expect(panel).toContainText("By public transport");
  await expect(panel).toContainText("~57 min · 1 transfer");
  await expect(panel).toContainText("Bus 243 → Bd. Lacul Tei");
  await expect(panel).toContainText("Walk 9 min");
  // The trip was fetched with both endpoints AND the selection's resolved
  // departure ISO (so the plan matches the painted rings' time).
  expect(reachCalls.length).toBeGreaterThan(0);
  expect(reachCalls[0]).toMatch(/fromLat=.*&fromLng=.*&toLat=.*&toLng=/);
  expect(decodeURIComponent(reachCalls[0])).toContain("departure=2026-07-29T05:30");
});

test("directions open the result sheet — it holds only the directions, no reach popup, Back closes it", async ({ page }) => {
  const { map } = await setup(page);
  await searchAndWait(page, map);
  await pickMode(page, "transit");
  await expect(map).toHaveAttribute("data-mode", "transit");
  const sheet = page.getByTestId("result-sheet");
  // Before the right-click: a chosen place opens no sheet.
  await expect(sheet).toHaveCount(0);

  await rightClickBesidePin(page);
  await expect(map).toHaveAttribute("data-reach-state", "transit");
  // The directions render IN the result sheet (not a map-anchored popup)…
  await expect(sheet.getByTestId("reach-panel")).toBeVisible();
  await expect(sheet).toHaveAttribute("aria-label", "Directions");
  // …and there is NO MapLibre reach popup covering the map.
  await expect(page.locator(".maplibregl-popup")).toHaveCount(0);

  // Back clears the directions and closes the sheet; the place stays chosen.
  await page.getByRole("button", { name: "Back to your area" }).click();
  await expect(page.getByTestId("reach-panel")).toHaveCount(0);
  await expect(sheet).toHaveCount(0);
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
});

test("public-transport mode: a point outside the drawn rings STILL plans the trip (no gate skips the fetch)", async ({ page }) => {
  const reachCalls: string[] = [];
  await page.route("**/api/amenities**", (route) =>
    route.fulfill({ json: emptyAmenities({ lat: 44.4268, lng: 26.1025 }) }),
  );
  await page.route("**/api/geocode**", (route) => route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii" } }));
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK }));
  await page.route("**/api/transit**", (route) => route.fulfill({ json: TRANSIT_EMPTY })); // no drawn reach area
  await page.route("**/api/reach**", (route) => {
    reachCalls.push(route.request().url());
    route.fulfill({ json: PLAN });
  });
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await searchAndWait(page, map);
  await pickMode(page, "transit");
  await expect(map).toHaveAttribute("data-mode", "transit");

  // Right-click ALWAYS shows the PT way. With no ring to fall
  // inside, the band defaults to the SELECTED transit preset (default chip = 20;
  // the client frames against the reach it actually draws, never a hidden 40/45
  // contour) and the planner IS called (honesty comes from the drawn path +
  // band-honesty copy, not a silent no-fetch).
  await rightClickBesidePin(page);
  await expect(map).toHaveAttribute("data-reach-state", "transit");
  await expect(page.getByTestId("reach-panel")).toContainText("By public transport");
  expect(reachCalls).toHaveLength(1);
  expect(decodeURIComponent(reachCalls[0])).toContain("maxMinutes=20");
});

test("public-transport mode: no route found is reported", async ({ page }) => {
  await page.route("**/api/amenities**", (route) =>
    route.fulfill({ json: emptyAmenities({ lat: 44.4268, lng: 26.1025 }) }),
  );
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii" } }),
  );
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK }));
  await page.route("**/api/transit**", (route) => route.fulfill({ json: TRANSIT }));
  await page.route("**/api/reach**", (route) => route.fulfill({ json: { reachable: false } }));
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await searchAndWait(page, map);
  await pickMode(page, "transit");
  await rightClickBesidePin(page);
  await expect(map).toHaveAttribute("data-reach-state", "none");
  await expect(page.getByTestId("reach-panel")).toContainText("No public-transport route");
});

test("a failed mode recompute clears the drawn reach and flags the mode — no '~N min' claim over a blank map", async ({ page }) => {
  // Desktop path (chromium project). A mode toggle whose recompute FAILS sets
  // status="error" (not "loading"), retains lastSelection, and clears the drawn
  // reach — nothing may keep claiming "~N min" over the now-blank map, and the
  // failed mode is flagged on its button. The phone path is covered in
  // preset-render.spec.ts.
  await page.route("**/api/amenities**", (route) =>
    route.fulfill({ json: emptyAmenities({ lat: 44.4268, lng: 26.1025 }) }),
  );
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK }));
  await page.route("**/api/transit**", (route) => route.fulfill({ status: 502, json: { error: "upstream" } }));
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await search(page, "Piata Unirii");
  // Walk resolved → a reach is drawn.
  await expect(map).toHaveAttribute("data-preset-contours", "10");

  // Toggle to Public transport → its recompute 502s → error banner, reach cleared.
  await pickMode(page, "transit");
  await expect(page.getByTestId("error-banner")).toContainText("Nu am putut calcula zona cu transportul public.");
  await expect(map).not.toHaveAttribute("data-preset-contours", /.*/);
  await expect(page.getByTestId("mode-icon-transit")).toHaveAccessibleName("Transport public (indisponibil)");
  await expect(page.getByTestId("result-sheet")).toHaveCount(0);
  await expectBannerClear(page);
});
