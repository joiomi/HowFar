import { expect, test, type Page } from "@playwright/test";

import { emptyAmenities } from "./amenity-fixtures";

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

  test("blocked location shows the Romanian banner and the map still works", async ({ page }) => {
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
    await expect(page.getByTestId("banner-retry")).toBeVisible();
    // A locate failure is not a reach failure: walking is not offered.
    await expect(banner.getByRole("button")).toHaveCount(1);

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
    const combobox = page.getByRole("combobox");
    await combobox.fill("Piata Unirii");
    await combobox.press("Enter");
    await expect(page.getByTestId("app-map")).toHaveAttribute("data-selection", "Piața Unirii, București");
    await expect(page.getByTestId("error-banner")).toHaveCount(0);
  });
});
