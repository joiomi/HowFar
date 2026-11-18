import { expect, test, type Page } from "@playwright/test";
import { emptyAmenities } from "./amenity-fixtures";
import { besidePin, expectNotCovered, search } from "./shell";

// Pointer gestures on the map itself: dragging the origin pin to choose a new point, tapping
// the pin (which is not a selection), and the floating controls fading while the map pans.
// Provider calls are stubbed by exact path; the reverse stub echoes the requested point under
// the label "Mutat" so a request can be traced to the gesture that made it.

const ORIGIN = { lat: 44.4268, lng: 26.1025 };

function ring(minutes: number, d: number) {
  return {
    minutes,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [ORIGIN.lng - d, ORIGIN.lat - d],
          [ORIGIN.lng + d, ORIGIN.lat - d],
          [ORIGIN.lng + d, ORIGIN.lat + d],
          [ORIGIN.lng - d, ORIGIN.lat + d],
          [ORIGIN.lng - d, ORIGIN.lat - d],
        ],
      ],
    },
  };
}

type Point = { lat: number; lng: number };

function pointOf(url: string): Point {
  const params = new URL(url).searchParams;
  return { lat: Number(params.get("lat")), lng: Number(params.get("lng")) };
}

async function setup(page: Page) {
  const reverse: Point[] = [];
  const reach: Point[] = [];
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { ...ORIGIN, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/reverse**", (route) => {
    const at = pointOf(route.request().url());
    reverse.push(at);
    return route.fulfill({ json: { ...at, label: "Mutat" } });
  });
  await page.route("**/api/isochrone**", (route) => {
    const at = pointOf(route.request().url());
    reach.push(at);
    return route.fulfill({ json: { origin: at, rings: [ring(10, 0.01), ring(20, 0.02)] } });
  });
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: emptyAmenities(ORIGIN) }));
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  await expect(map).toHaveAttribute("data-isochrone-rings", "2");
  return { map, reverse, reach };
}

async function markerCentre(page: Page) {
  const marker = page.locator(".hf-origin-marker");
  await expect(marker).toBeVisible();
  const box = await marker.boundingBox();
  if (!box) throw new Error("the origin pin has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("dragging the origin pin selects the dropped point", async ({ page }) => {
  const { map, reverse } = await setup(page);
  const from = await markerCentre(page);
  expect(reverse).toEqual([]);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 120, from.y + 40, { steps: 10 });
  await page.mouse.up();

  await expect(map).toHaveAttribute("data-selection", "Mutat");
  const dropped = reverse[reverse.length - 1];
  expect(Math.abs(dropped.lat - ORIGIN.lat) + Math.abs(dropped.lng - ORIGIN.lng)).toBeGreaterThan(1e-4);
});

test("a tap on the origin pin is not a new selection", async ({ page }) => {
  const { map, reverse, reach } = await setup(page);
  const tap = await markerCentre(page);
  const reachBefore = reach.length;

  await page.mouse.click(tap.x, tap.y);
  // The sentinel: a tap on bare map. Once it has been selected, anything the pin tap had
  // started would have arrived before it or been superseded by it.
  const sentinel = await besidePin(page);
  await page.mouse.click(sentinel.x, sentinel.y);
  await expect(map).toHaveAttribute("data-selection", "Mutat");

  expect(reverse).toHaveLength(1);
  expect(reach.length - reachBefore).toBe(1);
  expect(reach[reach.length - 1]).toEqual(reverse[0]);
  // The pin tap's point would have been the origin itself.
  expect(Math.abs(reverse[0].lat - ORIGIN.lat) + Math.abs(reverse[0].lng - ORIGIN.lng)).toBeGreaterThan(1e-4);
});

test("panning fades the floating controls and restores them on release", async ({ page }) => {
  await setup(page);
  const start = await besidePin(page);
  const opacity = (id: string) => page.getByTestId(id).evaluate((el) => getComputedStyle(el).opacity);

  await page.mouse.move(start.x, start.y + 120);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 270, { steps: 10 });
  for (const id of ["mode-pill", "info-button"]) {
    await expect.poll(async () => Number(await opacity(id))).toBeLessThan(0.4);
  }

  await page.mouse.up();
  for (const id of ["mode-pill", "info-button"]) await expect.poll(() => opacity(id)).toBe("1");
});

test("a control faded by a pan fails the not-covered check instead of passing it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-map")).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  const pill = page.getByTestId("mode-pill");
  await expectNotCovered(pill);

  // The pill is faded through its own style here; an ancestor's opacity counts the same way.
  await pill.evaluate((el) => {
    el.style.opacity = "0.3";
  });
  // The fade is a 0.2 s transition; the check reads the settled value.
  await expect.poll(() => pill.evaluate((el) => getComputedStyle(el).opacity)).toBe("0.3");
  await expect(expectNotCovered(pill)).rejects.toThrow(/faded \(opacity 0\.3\)/);
  await pill.evaluate((el) => {
    el.style.opacity = "1";
  });
  await expectNotCovered(pill);
});
