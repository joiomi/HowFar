import { expect, test, type Page } from "@playwright/test";
import { besidePin, expectBannerClear, expectNotCovered, openInfo, pickMode, search } from "./shell";
import { emptyAmenities } from "./amenity-fixtures";
import { longTrip, overlaps } from "./reach-fixtures";

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

// A 31-leg trip: its chips wrap onto so many rows that, unbounded, the card would reach
// the failure banner even at 800×600.
const TALL_TRIP = longTrip(31);

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
  await expect(page.getByTestId("reach-panel")).toContainText("Alege întâi o adresă");
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
  await expect(popup).toContainText("Cu transportul public");
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
  await expect(panel).toContainText("Cu transportul public");
  await expect(panel).toContainText("~57 min · 1 schimbare");
  // Each step is a chip: its short text on screen, the whole step as its name.
  await expect(panel.locator('li[data-step-mode][aria-label*="Autobuz 243 → Bd. Lacul Tei"]')).toHaveText("243");
  await expect(panel.locator('li[data-step-mode][aria-label^="Pe jos 9 min"]')).toHaveText("9");
  // The trip was fetched with both endpoints AND the selection's resolved
  // departure ISO (so the plan matches the painted rings' time).
  expect(reachCalls.length).toBeGreaterThan(0);
  expect(reachCalls[0]).toMatch(/fromLat=.*&fromLng=.*&toLat=.*&toLng=/);
  expect(decodeURIComponent(reachCalls[0])).toContain("departure=2026-07-29T05:30");
});

test("directions open the result sheet — it holds only the directions and the one Transitous credit, no reach popup, Închide closes it", async ({ page }) => {
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
  await expect(sheet.getByRole("region", { name: "Traseu" })).toBeVisible();
  // …and there is NO MapLibre reach popup covering the map.
  await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
  // The trip is Transitous data: its credit is in the sheet's footer, and the floating
  // one steps aside, so exactly one is on screen, readable.
  const credit = page.getByTestId("transitous-credit");
  await expect(credit).toHaveCount(1);
  await expect(sheet.getByTestId("reach-panel").getByTestId("transitous-credit")).toHaveCount(1);
  await expectNotCovered(credit);

  // ✕ clears the directions and closes the sheet; the place stays chosen.
  await page.getByRole("button", { name: "Închide" }).click();
  await expect(page.getByTestId("reach-panel")).toHaveCount(0);
  await expect(sheet).toHaveCount(0);
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  // The transit reach is still drawn, so the floating credit is back: still exactly one.
  await expect(credit).toHaveCount(1);
  await expectNotCovered(credit);
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
  await expect(page.getByTestId("reach-panel")).toContainText("Cu transportul public");
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
  await expect(page.getByTestId("reach-panel")).toContainText("Niciun traseu cu transportul public");
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

// From 768 px the directions are a card in the left column and a failure banner sits
// at the bottom centre. A right-click from walking switches to public transport; when
// that reach fails while the trip is shown, both are on screen at once. A trip this
// long would reach down into the banner: the card shortens while the banner shows, so
// neither covers the other's buttons.
for (const viewport of [
  { width: 800, height: 600 },
  { width: 844, height: 390 },
]) {
  test(`at ${viewport.width}×${viewport.height} a failure banner and a long directions card do not overlap`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/amenities**", (route) =>
      route.fulfill({ json: emptyAmenities({ lat: 44.4268, lng: 26.1025 }) }),
    );
    await page.route("**/api/geocode**", (route) =>
      route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
    );
    await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
    await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK }));
    await page.route("**/api/transit**", (route) => route.fulfill({ status: 502, json: { error: "upstream" } }));
    await page.route("**/api/reach**", (route) => route.fulfill({ json: TALL_TRIP }));
    await page.goto("/");
    const map = page.getByTestId("app-map");
    await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
    await searchAndWait(page, map);

    await rightClickBesidePin(page);
    await expect(map).toHaveAttribute("data-reach-state", "transit");
    const banner = page.getByTestId("error-banner");
    await expect(banner).toContainText("Nu am putut calcula zona cu transportul public.");
    await expect(page.getByTestId("reach-panel").locator("li[data-step-mode]")).toHaveCount(TALL_TRIP.legs.length);

    const sheet = page.getByTestId("result-sheet");
    await expect(sheet).toBeInViewport({ ratio: 1 });
    await expect(banner).toBeInViewport({ ratio: 1 });
    const [sheetBox, bannerBox, panelBox] = await Promise.all([
      sheet.boundingBox(),
      banner.boundingBox(),
      page.getByTestId("reach-panel").boundingBox(),
    ]);
    if (!sheetBox || !bannerBox || !panelBox) throw new Error("the directions card, its panel or the error banner has no box");
    // The trip is tall enough that its content alone would reach the banner: only the
    // card's shortened height keeps them apart.
    expect(panelBox.height, "the trip is long enough to reach the banner").toBeGreaterThan(bannerBox.y - sheetBox.y);
    expect(overlaps(sheetBox, bannerBox), "the directions card overlaps the error banner").toBe(false);
    await expectNotCovered(banner.getByTestId("banner-retry"));
    await expectNotCovered(banner.getByTestId("banner-walk"));
    await expectNotCovered(sheet.getByRole("button", { name: "Închide" }));
    await expectNotCovered(sheet.getByTestId("transitous-credit"));
  });
}

// At 768 px the left column (16 + 400 px) and the ⓘ popover at the top right share
// the width: the open popover narrows to stay clear of the directions card and its ✕.
test("at 768 px the open info popover stays clear of the directions card", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 800 });
  const { map } = await setup(page);
  await searchAndWait(page, map);
  await rightClickBesidePin(page);
  await expect(map).toHaveAttribute("data-reach-state", "transit");
  await expect(map).toHaveAttribute("data-reach-framed", "true", { timeout: 5000 });
  await expect(map).toHaveAttribute("data-camera-settled", "true");

  const popover = await openInfo(page);
  await expect(popover).toBeInViewport({ ratio: 1 });
  const sheet = page.getByTestId("result-sheet");
  const [popoverBox, sheetBox] = await Promise.all([popover.boundingBox(), sheet.boundingBox()]);
  if (!popoverBox || !sheetBox) throw new Error("the info popover or the directions card has no box");
  expect(overlaps(popoverBox, sheetBox), "the info popover overlaps the directions card").toBe(false);
  await expectNotCovered(sheet.getByRole("button", { name: "Închide" }));
});
