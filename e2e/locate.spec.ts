import { expect, test, type Page } from "@playwright/test";

import { emptyAmenities } from "./amenity-fixtures";
import { modeButton, pickMode, search } from "./shell";

test.use({ viewport: { width: 390, height: 844 } });

function square(minutes: number, d: number) {
  const [lng, lat] = [26.1025, 44.4268];
  return {
    minutes,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [lng - d, lat - d],
          [lng + d, lat - d],
          [lng + d, lat + d],
          [lng - d, lat + d],
          [lng - d, lat - d],
        ],
      ],
    },
  };
}

const WALK = { origin: { lat: 44.4268, lng: 26.1025 }, rings: [square(10, 0.01), square(20, 0.02)] };

async function openMap(page: Page, reverse: Parameters<Page["route"]>[1]) {
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/amenities**", (route) =>
    route.fulfill({ json: emptyAmenities({ lat: 44.4268, lng: 26.1025 }) }),
  );
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK }));
  await page.route("**/api/reverse**", reverse);
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  return map;
}

test.describe("my location", () => {
  test("my location selects where the phone is", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 44.4268, longitude: 26.1025 });
    const map = await openMap(page, (route) =>
      route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Strada Doamnei 1" } }),
    );
    await page.getByTestId("locate").click();
    await expect(map).toHaveAttribute("data-selection", "Strada Doamnei 1");
    await expect(page.getByRole("combobox")).toHaveValue("Strada Doamnei 1");
  });

  // The second fix is the cached one (a fix up to a minute old is accepted), so it lands on
  // exactly the coordinates of the first: it is still a new choice, and the bar must name it.
  test("my location again after a search that found nothing puts the address back in the bar", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 44.4268, longitude: 26.1025 });
    await openMap(page, (route) => route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Strada Doamnei 1" } }));
    await page.route("**/api/geocode**", (route) => route.fulfill({ status: 404, json: { error: "not found" } }));
    const combobox = page.getByRole("combobox");
    const status = page.getByTestId("status-announcer");

    await page.getByTestId("locate").click();
    await expect(status).toHaveText("Strada Doamnei 1: circa 10 minute pe jos");
    await expect(combobox).toHaveValue("Strada Doamnei 1");

    await search(page, "Strada Inexistentă 99");
    await expect(page.getByTestId("error-banner")).toContainText("Nu am găsit adresa.");
    await expect(combobox).toHaveValue("Strada Inexistentă 99");

    await page.getByTestId("locate").click();
    await expect(status).toHaveText("Strada Doamnei 1: circa 10 minute pe jos");
    await expect(combobox).toHaveValue("Strada Doamnei 1");
  });

  test("blocked location shows the Romanian banner with no retry, and the map still works", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
        configurable: true,
        value: (_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1 } as GeolocationPositionError),
      });
    });
    const map = await openMap(page, (route) =>
      route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Strada Doamnei 1" } }),
    );
    await page.getByTestId("locate").click();
    const banner = page.getByTestId("error-banner");
    await expect(banner).toContainText("Locația e blocată în browser.");
    // Asking again cannot succeed while the browser refuses, so there is no ↻; and a locate
    // failure is not a reach failure, so walking is not offered either.
    await expect(banner.getByRole("button")).toHaveCount(0);

    // The map is still live: a tap selects and the banner goes.
    await map.click({ position: { x: 195, y: 420 } });
    await expect(map).toHaveAttribute("data-selection", "Strada Doamnei 1");
    await expect(banner).toHaveCount(0);
  });

  test("my location outside Bucharest ends in the out-of-area banner", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 46.7712, longitude: 23.6236 });
    const map = await openMap(page, (route) => route.fulfill({ status: 422, json: { error: "outside" } }));
    await page.getByTestId("locate").click();
    await expect(page.getByTestId("error-banner")).toContainText("Locul e în afara Bucureștiului.");
    await expect(map).not.toHaveAttribute("data-selection");
    await expect(page.locator(".hf-map-shell")).toHaveAttribute("data-sel-status", "error");
    // The pin rests under the banner: its aura does not pulse.
    const aura = page.locator(".hf-origin-marker__aura");
    await expect(aura).toHaveCount(1);
    expect(await aura.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  });

  test("a second tap while the position is pending asks nothing more", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __asked: number; __answer: PositionCallback | null };
      w.__asked = 0;
      w.__answer = null;
      Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
        configurable: true,
        value: (ok: PositionCallback) => {
          w.__asked += 1;
          w.__answer = ok;
        },
      });
    });
    const map = await openMap(page, (route) =>
      route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Strada Doamnei 1" } }),
    );
    const locate = page.getByTestId("locate");
    await locate.click();
    await expect(locate).toHaveAttribute("aria-busy", "true");
    await locate.click();
    expect(await page.evaluate(() => (window as unknown as { __asked: number }).__asked)).toBe(1);
    await page.evaluate(() =>
      (window as unknown as { __answer: PositionCallback }).__answer({
        coords: { latitude: 44.4268, longitude: 26.1025 },
      } as GeolocationPosition),
    );
    await expect(map).toHaveAttribute("data-selection", "Strada Doamnei 1");
    await expect(locate).toHaveAttribute("aria-busy", "false");
  });

  test("a new search clears the location banner", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
        configurable: true,
        value: (_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 2 } as GeolocationPositionError),
      });
    });
    await openMap(page, (route) => route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "x" } }));
    await page.route("**/api/geocode**", (route) =>
      route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
    );
    await page.getByTestId("locate").click();
    await expect(page.getByTestId("error-banner")).toContainText("Nu am putut afla locația ta.");
    // No fix this time: the next try may get one, so ↻ asks again.
    await expect(page.getByTestId("banner-retry")).toBeVisible();
    const combobox = page.getByRole("combobox");
    await combobox.fill("Piata Unirii");
    await combobox.press("Enter");
    await expect(page.getByTestId("app-map")).toHaveAttribute("data-selection", "Piața Unirii, București");
    await expect(page.getByTestId("error-banner")).toHaveCount(0);
  });

  // Position requests the page makes are held until the test answers them in order.
  async function holdFixes(page: Page) {
    await page.addInitScript(() => {
      const w = window as unknown as { __asked: number; __held: PositionCallback[] };
      w.__asked = 0;
      w.__held = [];
      Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
        configurable: true,
        value: (ok: PositionCallback) => {
          w.__asked += 1;
          w.__held.push(ok);
        },
      });
    });
  }
  const asked = (page: Page) => page.evaluate(() => (window as unknown as { __asked: number }).__asked);
  const answer = (page: Page, index: number, latitude: number, longitude: number) =>
    page.evaluate(
      ([i, lat, lng]) =>
        (window as unknown as { __held: PositionCallback[] }).__held[i]({
          coords: { latitude: lat, longitude: lng },
        } as GeolocationPosition),
      [index, latitude, longitude],
    );

  // Reverse answers by coordinates, and remembers which coordinates were asked about.
  async function openWithPlaces(page: Page) {
    const reversed: number[] = [];
    await page.route("**/api/geocode**", (route) =>
      route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
    );
    await page.route("**/api/transit**", (route) => route.fulfill({ json: WALK }));
    const map = await openMap(page, (route) => {
      const lat = Number(new URL(route.request().url()).searchParams.get("lat"));
      reversed.push(lat);
      route.fulfill({
        json: lat > 44.5 ? { lat, lng: 26.0, label: "Vechea locație" } : { lat, lng: 26.1025, label: "Strada Doamnei 1" },
      });
    });
    return { map, reversed };
  }

  test("a blocked location after a failed transit reach offers neither retry nor the walk switch", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
        configurable: true,
        value: (_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1 } as GeolocationPositionError),
      });
    });
    const map = await openMap(page, (route) =>
      route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Strada Doamnei 1" } }),
    );
    await page.route("**/api/transit**", (route) => route.fulfill({ status: 502, json: { error: "upstream" } }));
    await map.click({ position: { x: 195, y: 420 } });
    await expect(map).toHaveAttribute("data-selection", "Strada Doamnei 1");
    await pickMode(page, "transit");
    // The failed reach offers the walk switch, so its absence below is meaningful.
    await expect(page.getByTestId("banner-walk")).toBeVisible();
    await page.getByTestId("locate").click();
    await expect(page.getByTestId("error-banner")).toContainText("Locația e blocată în browser.");
    await expect(page.getByTestId("error-banner").getByRole("button")).toHaveCount(0);
  });

  test("a mode change clears a stored location failure", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
        configurable: true,
        value: (_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1 } as GeolocationPositionError),
      });
    });
    await openMap(page, (route) => route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Strada Doamnei 1" } }));
    await page.getByTestId("locate").click();
    const banner = page.getByTestId("error-banner");
    await expect(banner).toContainText("Locația e blocată în browser.");
    await pickMode(page, "transit");
    await expect(modeButton(page, "transit")).toHaveAttribute("aria-pressed", "true");
    await expect(banner).toHaveCount(0);
  });

  for (const newer of ["a newer search", "the clear button"] as const) {
    test(`${newer} frees the location button and drops the old fix`, async ({ page }) => {
      await holdFixes(page);
      const { map, reversed } = await openWithPlaces(page);
      await search(page, "Piata Unirii");
      await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
      const locate = page.getByTestId("locate");
      await locate.click();
      await expect(locate).toHaveAttribute("aria-busy", "true");
      if (newer === "the clear button") {
        await page.getByTestId("clear-address").click();
        await expect(map).not.toHaveAttribute("data-selection");
      } else {
        await search(page, "Piata Unirii 2");
        await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
      }
      // The pending request no longer holds the button: a fresh tap asks again.
      await expect(locate).toHaveAttribute("aria-busy", "false");
      await locate.click();
      await expect.poll(() => asked(page)).toBe(2);
      // The retired fix (far away) arrives first and is dropped; the live one selects.
      await answer(page, 0, 46.7712, 23.6236);
      // Settling the retired request leaves the live one's hold in place.
      await expect(locate).toHaveAttribute("aria-busy", "true");
      await answer(page, 1, 44.4268, 26.1025);
      await expect(map).toHaveAttribute("data-selection", "Strada Doamnei 1");
      await expect(locate).toHaveAttribute("aria-busy", "false");
      expect(reversed.filter((lat) => lat > 44.5)).toEqual([]);
    });
  }

  test("a mode change does not cancel a pending location request", async ({ page }) => {
    await holdFixes(page);
    const { map } = await openWithPlaces(page);
    await search(page, "Piata Unirii");
    await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
    const locate = page.getByTestId("locate");
    await locate.click();
    await expect(locate).toHaveAttribute("aria-busy", "true");
    const transit = page.waitForRequest("**/api/transit**");
    await pickMode(page, "transit");
    await transit;
    await expect(locate).toHaveAttribute("aria-busy", "true");
    await answer(page, 0, 44.4268, 26.1025);
    await expect(map).toHaveAttribute("data-selection", "Strada Doamnei 1");
  });
});
