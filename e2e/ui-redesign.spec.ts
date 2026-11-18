import { expect, test, type Page } from "@playwright/test";
import { expectBannerClear, expectNotCovered, search } from "./shell";
import { innerBandCounts, WALK_CLIP } from "./amenity-fixtures";

// After a responsive relayout, retry the REAL geometric predicate until it holds
// (rather than a stability proxy). A viewport change reprojects the origin marker
// and reflows the floating controls a few frames after `setPadding` — not a monotonic ease —
// and under CPU stall a "boxes stable across N samples" proxy can latch the
// pre-motion layout and let a non-retrying hard expect fail. Polling the actual
// assertion is the only thing that distinguishes "arrived at final" from "motion
// not started"; the wrapped hard expects (±3/±2) remain the final proof and are
// monotonic-to-final here (single reflow + reproject, no overshoot).
async function expectResultFramedAfterResize(page: Page) {
  await expect(async () => {
    await expectOriginMarkerAtCameraSubject(page);
    await expectSubjectClearOfUi(page);
  }).toPass({ timeout: 10_000 });
}

// Deterministic visual-state fixture for the responsive UI. Provider requests
// are stubbed by exact path so the real self-hosted basemap still renders.

async function captureRequested(page: Page, name: string) {
  const directory = process.env.HOWFAR_CAPTURE_DIR;
  if (!directory) return;
  await page.screenshot({ path: `${directory}/${name}.png`, animations: "disabled" });
}

function ring(minutes: number, distance: number) {
  return {
    minutes,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [26.1025 - distance, 44.4268 - distance],
          [26.1025 + distance, 44.4268 - distance],
          [26.1025 + distance, 44.4268 + distance],
          [26.1025 - distance, 44.4268 + distance],
          [26.1025 - distance, 44.4268 - distance],
        ],
      ],
    },
  };
}

const WALK = {
  origin: { lat: 44.4268, lng: 26.1025 },
  // The calibrated walk preset [10, 20] served on ?model=preset.
  rings: [ring(10, 0.01), ring(20, 0.02)],
};

const AMENITIES = {
  origin: { lat: 44.4268, lng: 26.1025 },
  clip: WALK_CLIP,
  countsByBand: innerBandCounts({ groceries: 62, pharmacies: 35, parks: 24, schools: 18, transit: 41 }),
  amenities: [
    { lat: 44.4268, lng: 26.1085, name: "Mega Image Unirii", category: "groceries", band: 15 },
    { lat: 44.428, lng: 26.101, name: "Farmacia Tei", category: "pharmacies", band: 15 },
    { lat: 44.426, lng: 26.104, name: "Parcul Unirii", category: "parks", band: 15 },
    { lat: 44.429, lng: 26.1, name: "Școala Gimnazială 79", category: "schools", band: 15 },
    {
      lat: 44.425,
      lng: 26.102,
      name: "Piața Unirii 2",
      category: "transit",
      osmType: "node",
      osmId: 582555685, band: 15 },
  ],
};

async function stubPopulatedState(page: Page, amenityPayload = AMENITIES) {
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: WALK }));
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: amenityPayload }));
}

async function loadPopulatedState(page: Page) {
  await stubPopulatedState(page);
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await search(page, "Piața Unirii");
  await expect(map).toHaveAttribute("data-isochrone-rings", "2");
  await expect(map).toHaveAttribute("data-camera-settled", "true", { timeout: 10_000 });
  return map;
}

async function clickEastAmenity(page: Page) {
  const map = page.getByTestId("app-map");
  const box = await map.boundingBox();
  if (!box) throw new Error("map has no box");
  const left = Number((await map.getAttribute("data-camera-pad-left")) ?? "0");
  const right = Number((await map.getAttribute("data-camera-pad-right")) ?? "0");
  const top = Number((await map.getAttribute("data-camera-pad-top")) ?? "0");
  const bottom = Number((await map.getAttribute("data-camera-pad-bottom")) ?? "0");
  const worldSize = 512 * 2 ** 13;
  const dx = ((26.1085 - 26.1025) / 360) * worldSize;
  const x = (box.width + left - right) / 2 + dx;
  const y = (box.height + top - bottom) / 2;
  // The click hits a raw pixel that must land on the PAINTED East amenity marker.
  // The hover stamp (data-amenity-hover) recomputes only on a real mousemove and
  // the marker paints asynchronously after setData, so a single move fired before
  // paint would leave the stamp unarmed forever under CPU stall. Retry the
  // STIMULUS: nudge the pointer across the pixel until the stamp arms (proving a
  // pickable feature is rendered there via the same pick path the click uses),
  // then click. The popup assertion downstream proves it is the right amenity.
  let nudge = 0;
  await expect(async () => {
    nudge = nudge === 0 ? 1 : 0;
    await page.mouse.move(box.x + x + nudge, box.y + y);
    await expect(map).toHaveAttribute("data-amenity-hover", /.+/, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await map.click({ position: { x, y } });
}

async function amenityPixel(page: Page, lng: number, lat: number) {
  const map = page.getByTestId("app-map");
  const box = await map.boundingBox();
  if (!box) throw new Error("map has no box");
  const attr = async (edge: "top" | "right" | "bottom" | "left") =>
    Number((await map.getAttribute(`data-camera-pad-${edge}`)) ?? "0");
  const [top, right, bottom, left] = await Promise.all([
    attr("top"),
    attr("right"),
    attr("bottom"),
    attr("left"),
  ]);
  const worldSize = 512 * 2 ** 13;
  const mercY = (value: number) => {
    const s = Math.sin((value * Math.PI) / 180);
    return (worldSize / 2) * (1 - Math.log((1 + s) / (1 - s)) / (2 * Math.PI));
  };
  return {
    x: (box.width + left - right) / 2 + ((lng - 26.1025) / 360) * worldSize,
    y: (box.height + top - bottom) / 2 + mercY(lat) - mercY(44.4268),
  };
}

async function cameraSubjectPixel(page: Page) {
  const map = page.getByTestId("app-map");
  const box = await map.boundingBox();
  if (!box) throw new Error("map has no box");
  const attr = async (edge: "top" | "right" | "bottom" | "left") =>
    Number((await map.getAttribute(`data-camera-pad-${edge}`)) ?? "0");
  const [top, right, bottom, left] = await Promise.all([
    attr("top"),
    attr("right"),
    attr("bottom"),
    attr("left"),
  ]);
  return { x: (box.width + left - right) / 2, y: (box.height + top - bottom) / 2 };
}

async function expectSubjectClearOfUi(page: Page) {
  const point = await cameraSubjectPixel(page);
  const viewport = page.viewportSize();
  // The address bar is the top surface on a phone and heads the left column on
  // desktop; the mode pill is the bottom surface on a phone — the chrome the
  // framed subject must clear.
  const topBar = await page.getByTestId("top-bar").boundingBox();
  const modePill = await page.getByTestId("mode-pill").boundingBox();
  if (!viewport || !topBar || !modePill) throw new Error("responsive shell has no measurable boxes");
  if (viewport.width >= 768) {
    expect(point.x).toBeGreaterThan(topBar.x + topBar.width + 16);
  } else {
    expect(point.y).toBeGreaterThan(topBar.y + topBar.height + 16);
    expect(point.y).toBeLessThan(modePill.y - 16);
  }
}

async function expectOriginMarkerAtCameraSubject(page: Page) {
  const point = await cameraSubjectPixel(page);
  // Scoped to the ORIGIN marker's own class: cluster donuts are
  // also MapLibre DOM markers, so a bare `.maplibregl-marker` matches several.
  const marker = await page.locator(".hf-origin-marker").boundingBox();
  if (!marker) throw new Error("origin marker has no box");
  expect(Math.abs(marker.x + marker.width / 2 - point.x)).toBeLessThanOrEqual(3);
  expect(Math.abs(marker.y + marker.height / 2 - point.y)).toBeLessThanOrEqual(3);
}

function boxesOverlap(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function expectInfoButtonClear(page: Page) {
  // The ⓘ button holds the basemap credits in every state, so it must stay on screen,
  // uncovered, and clear of every other floating surface: the address bar and the mode
  // pill (a chosen place opens no result sheet). (The Transitous credit is mode-gated to
  // transit; its presence in transit and ABSENCE in walk/car is proven in
  // preset-render.spec.ts.)
  const info = page.getByTestId("info-button");
  await expect(info).toBeInViewport();
  await expectNotCovered(info);
  const [infoBox, ...otherBoxes] = await Promise.all(
    [info, page.getByTestId("top-bar"), page.getByTestId("mode-pill")].map((l) => l.boundingBox()),
  );
  if (!infoBox || otherBoxes.some((box) => !box)) throw new Error("info button or shell boxes unavailable");
  for (const box of otherBoxes) expect(boxesOverlap(infoBox, box!)).toBe(false);
}

// Skipped: asserts the old staged ring reveal
// (`data-ring-reveal*`), amenity encoding, and the old "Within a 15-min walk" copy —
// all replaced by the preset render (proven in preset-render.spec.ts).
test.skip("deterministic populated fixture renders the complete map result", async ({ page }, testInfo) => {
  const map = await loadPopulatedState(page);
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  await expect(map).toHaveAttribute("data-ring-reveal-sequence", "15");
  await expect(map).toHaveAttribute("data-ring-reveal", "settled");
  await expect(map).toHaveAttribute("data-camera-motion", "animated");
  // Category is encoded as colour + a real per-category ICON, replacing
  // the single-letter glyphs. The stamp lands only once every sprite image is
  // registered, so this asserts the encoding is actually available.
  await expect(map).toHaveAttribute("data-amenity-encoding", "color+icon");
  await expect(page.getByText("Within a 15-min walk")).toBeVisible();
  await expect(page.getByText("Mega Image Unirii")).toHaveCount(0); // map marker, popup remains on demand
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("Geist");
  await expectSubjectClearOfUi(page);
  await captureRequested(page, "populated-desktop");

  await testInfo.attach("populated-ui", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

// Skipped: the staged 45→30→15 ring reveal + `data-ring-paint*`
// trace + the 15/30/45/All ring control no longer exist; the preset render paints shells +
// contour lines directly (preset-render.spec.ts).
test.skip("staged ring reveal changes the live MapLibre paint before settling", async ({ page }) => {
  await stubPopulatedState(page);
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("combobox").fill("Piața Unirii");
  await page.getByRole("button", { name: "Go" }).click();
  // Assert the cumulative paint TRACE after settle — each stage stamps live
  // MapLibre fill-opacity read-backs (45,30,15 order). Racing a ~280ms stage
  // with expect.poll was a proven flake.
  await expect(map).toHaveAttribute("data-ring-reveal", "settled", { timeout: 15_000 });
  await expect(map).toHaveAttribute("data-ring-reveal-sequence", "45,30,15");
  await expect(map).toHaveAttribute("data-ring-paint45", "0.2");
  await expect(map).toHaveAttribute("data-ring-paint30", "0.2");
  await expect(map).toHaveAttribute("data-ring-paint15", "0.2");
  const trace = (await map.getAttribute("data-ring-paint-trace")) ?? "";
  // Outer band alone, then outer+middle, then all three — prove the staged path.
  expect(trace).toContain("45:0.2,0,0");
  expect(trace).toContain("30:0.2,0.2,0");
  expect(trace).toContain("15:0.2,0.2,0.2");
  expect(trace).toMatch(/settled:0\.2,0\.2,0\.2$/);
});

test("mobile shell keeps the subject between top bar and mode pill", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadPopulatedState(page);
  await expectSubjectClearOfUi(page);
  await expectOriginMarkerAtCameraSubject(page);
  // A chosen place is the pin, the reach and the address in the bar: no result sheet
  // or card covers the map.
  await expect(page.getByTestId("result-sheet")).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveValue("Piața Unirii, București");
  await expect(page.getByTestId("app-map")).toHaveAttribute("data-selection", "Piața Unirii, București");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);
  await captureRequested(page, "populated-mobile");
});

test("camera reframes an existing result across desktop and mobile breakpoints", async ({ page }) => {
  await loadPopulatedState(page);
  const map = page.getByTestId("app-map");
  // loadPopulatedState already waited for the selection camera to settle.
  await expectOriginMarkerAtCameraSubject(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(map).toHaveAttribute("data-camera-pad-left", "12");
  // Crossing into mobile with a resolved selection frames the map between the address
  // bar on top and the mode pill below.
  await expect(map).toHaveAttribute("data-camera-pad-top", "76");
  await expect(map).toHaveAttribute("data-camera-pad-bottom", "70");
  await expectResultFramedAfterResize(page);

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(map).toHaveAttribute("data-camera-pad-left", "432");
  await expectResultFramedAfterResize(page);
});

test("the info button stays on screen, uncovered and clear of the address bar, mode pill and results at every shell size", async ({ page }) => {
  await loadPopulatedState(page);
  await expectInfoButtonClear(page);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 390, height: 600 },
    { width: 1024, height: 600 },
  ]) {
    await page.setViewportSize(viewport);
    // Retry the real non-overlap predicate until the reflow settles (not a proxy).
    await expect(async () => {
      await expectInfoButtonClear(page);
    }).toPass({ timeout: 10_000 });
  }
});

test("short-mobile autocomplete stays anchored, unclipped, and dismisses with Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.route("**/api/suggest**", (route) =>
    route.fulfill({
      json: {
        suggestions: [
          { label: "Piața Unirii, Sector 3", lat: 44.4268, lng: 26.1025 },
          { label: "Unirea Shopping Center, Sector 3", lat: 44.427, lng: 26.103 },
          { label: "Bulevardul Unirii, București", lat: 44.425, lng: 26.11 },
        ],
      },
    }),
  );
  await page.goto("/");
  const input = page.getByRole("combobox");
  const field = page.getByTestId("search-field");
  await input.fill("Unirii");
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  // Measure only after the 280ms surface-entry transition finishes — retry the
  // real anchor predicate (poll the actual geometry) instead of a fixed sleep.
  // The list hangs 8px under the whole search field, aligned to its left edge.
  await expect(async () => {
    const [fieldBox, listBox] = await Promise.all([field.boundingBox(), list.boundingBox()]);
    if (!fieldBox || !listBox) throw new Error("autocomplete boxes unavailable");
    expect(Math.abs(listBox.x - fieldBox.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(listBox.y - (fieldBox.y + fieldBox.height + 8))).toBeLessThanOrEqual(2);
    expect(listBox.y + listBox.height).toBeLessThanOrEqual(600);
  }).toPass({ timeout: 10_000 });
  await expect(page.getByRole("option")).toHaveCount(3);
  await captureRequested(page, "autocomplete-short-mobile");
  await input.press("Escape");
  await expect(list).toHaveCount(0);
});

test("the focused address field shows one accent ring, on the whole field", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("combobox");
  await page.keyboard.press("Tab"); // the address search is first in tab order
  await expect(input).toBeFocused();
  const outline = (locator: typeof input) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor };
    });
  expect(await outline(page.getByTestId("search-field"))).toEqual({
    style: "solid",
    width: "3px",
    color: "rgb(199, 243, 107)",
  });
  // The bare input draws no second ring inside the field's.
  expect((await outline(input)).style).toBe("none");
});

test("the top strip beside the top bar is live map", async ({ page }) => {
  await stubPopulatedState(page);
  await page.route("**/api/reverse**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Header gap point" } }),
  );
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  expect(
    await page.evaluate(() => document.elementFromPoint(640, 40)?.closest('[data-testid="app-map"]') !== null),
  ).toBe(true);
  await page.mouse.click(640, 40);
  await expect(map).toHaveAttribute("data-selection", "Header gap point");
});

test("first open shows a pointer-transparent pulse at the map centre; a tap there selects and the pulse goes", async ({
  page,
}) => {
  await stubPopulatedState(page);
  await page.route("**/api/reverse**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Onboarding map point" } }),
  );
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  // No first-run card: the placeholder invites the map tap, and a pulse marks the centre
  // of the framed map.
  await expect(page.getByRole("combobox")).toHaveAttribute("placeholder", "Caută o adresă sau atinge harta");
  const pulse = page.getByTestId("first-open-pulse");
  await expect(pulse).toBeVisible();
  await captureRequested(page, "idle-desktop");
  const [box, mapBox] = await Promise.all([pulse.boundingBox(), map.boundingBox()]);
  if (!box || !mapBox) throw new Error("the first-open pulse or the map has no box");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const subject = await cameraSubjectPixel(page);
  expect(Math.abs(centre.x - (mapBox.x + subject.x))).toBeLessThanOrEqual(8);
  expect(Math.abs(centre.y - (mapBox.y + subject.y))).toBeLessThanOrEqual(8);
  // Pointer-transparent: the map is what a tap there hits.
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="app-map"]') !== null,
      centre,
    ),
  ).toBe(true);
  await page.mouse.click(centre.x, centre.y);
  await expect(map).toHaveAttribute("data-selection", "Onboarding map point");
  await expect(pulse).toHaveCount(0);
  // Clearing the address returns to first open, pulse included.
  await page.getByTestId("clear-address").click();
  await expect(map).not.toHaveAttribute("data-selection");
  await expect(pulse).toBeVisible();
});

// Skipped: asserts the old 15/30/45/All ring control +
// the amenity browser trigger. Touch-size/search-first focus of the SURVIVING preset
// controls (mode+preset bar) is covered by preset-render.spec.ts + ui-mobile.spec.ts.
test.skip("core controls meet touch-size, search-first focus, and live-state contracts", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));
  await page.route("**/api/isochrone**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({ json: WALK });
  });
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });

  await page.keyboard.press("Tab");
  const search = page.getByRole("combobox");
  await expect(search).toBeFocused();
  const focus = await search.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle, color: style.outlineColor };
  });
  expect(focus.width).toBeGreaterThanOrEqual(3);
  expect(focus.style).toBe("solid");
  expect(focus.color).toBe("rgb(199, 243, 107)");

  for (const control of [
    search,
    page.getByRole("button", { name: "Go" }),
    page.getByRole("button", { name: "Walk" }),
    page.getByRole("button", { name: "Public transport", exact: true }),
    page.getByRole("button", { name: "15 min" }),
    page.getByRole("button", { name: "30 min" }),
    page.getByRole("button", { name: "45 min" }),
    page.getByRole("button", { name: "All", exact: true }),
  ]) {
    const box = await control.boundingBox();
    if (!box) throw new Error("core control has no box");
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  for (const name of ["15 min", "30 min", "45 min", "All"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    if (!box) throw new Error(`${name} has no box`);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }

  await search.fill("Piața Unirii");
  await search.press("Enter");
  // A fresh search keeps the dock expanded and the focused combobox
  // itself carries the live busy state (the amenity live region now sits
  // behind the sheet's peek bar until expanded).
  await expect(search).toHaveAttribute("aria-busy", "true");
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  // The resolution collapses the dock to the ≥44px state pill; the full
  // command region is one activation away, and the sheet opens at peek.
  const pill = page.getByTestId("state-pill");
  await expect(pill).toBeVisible();
  await expect(page.getByRole("region", { name: "Location result" })).toBeVisible();
  const pillBox = await pill.boundingBox();
  if (!pillBox) throw new Error("state pill has no box");
  expect(pillBox.height).toBeGreaterThanOrEqual(44);
  await pill.click();
  await expect(page.getByRole("region", { name: "Explore a location" })).toBeVisible();
  // Expand the sheet before measuring its inner controls (peek hides content).
  await page.getByTestId("sheet-toggle").click();
  const browseBox = await page.getByTestId("amenity-browser-trigger").boundingBox();
  if (!browseBox) throw new Error("browse control has no box");
  expect(browseBox.height).toBeGreaterThanOrEqual(44);

  await expect(map).toHaveAttribute("data-ring-reveal", "settled");
  // Ensure the focusable controls that make up the tab order are all mounted
  // before counting Tab stops — a shifting tab order mid-loop is the thing the
  // old fixed sleep hid. Wait on the concrete stops the loop walks, not a timer.
  await expect(page.getByRole("combobox")).toBeVisible();
  await expect(page.getByTestId("amenity-browser-trigger")).toBeVisible();
  await expect(page.getByRole("button", { name: "All", exact: true })).toBeVisible();
  const canvas = page.locator(".maplibregl-canvas");
  const authAction = page.getByRole("button", { name: /Sign in|Sign out/ }).first();
  const hasAuthAction = (await authAction.count()) > 0;
  let passedAuthAction = false;
  // Budget covers the search + mode/ring chrome, the amenity browser/tiles, AND
  // the reach refinements (pace + transit departure) now in the result
  // sheet, before the map canvas becomes the focus target.
  for (let step = 0; step < 28 && !(await canvas.evaluate((element) => element === document.activeElement)); step += 1) {
    await page.keyboard.press("Tab");
    if (hasAuthAction && (await authAction.evaluate((element) => element === document.activeElement))) {
      passedAuthAction = true;
    }
  }
  await expect(canvas).toBeFocused();
  if (hasAuthAction) expect(passedAuthAction).toBe(true);
  const centerBefore = await map.getAttribute("data-camera-center");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => map.getAttribute("data-camera-center")).not.toBe(centerBefore);
});

// Skipped: the "nearby browser" is the amenity browser,
// suppressed in preset mode (deferred to the planned amenity pass).
test.skip("nearby browser starts clean when a new location replaces the result", async ({ page }) => {
  await page.route("**/api/geocode**", (route) => {
    const second = new URL(route.request().url()).searchParams.get("q")?.includes("Second");
    route.fulfill({
      json: second
        ? { lat: 44.4368, lng: 26.1125, label: "Second address" }
        : { lat: 44.4268, lng: 26.1025, label: "First address" },
    });
  });
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/isochrone**", (route) => {
    const url = new URL(route.request().url());
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    route.fulfill({ json: { ...WALK, origin: { lat, lng } } });
  });
  await page.route("**/api/amenities**", (route) => {
    const second = new URL(route.request().url()).searchParams.get("lat")?.startsWith("44.4368");
    const item = second
      ? { lat: 44.4368, lng: 26.113, name: "Lidl Tineretului", category: "groceries", band: 15 }
      : { lat: 44.4268, lng: 26.103, name: "Mega Image Unirii", category: "groceries", band: 15 };
    route.fulfill({
      json: {
        clip: WALK_CLIP,
        countsByBand: innerBandCounts({ groceries: 1, pharmacies: 0, parks: 0, schools: 0, transit: 0 }),
        amenities: [item],
      },
    });
  });

  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  const search = page.getByRole("combobox");
  await search.fill("First");
  await search.press("Enter");
  await expect(map).toHaveAttribute("data-selection", "First address");
  await expect(map).toHaveAttribute("data-amenity-count", "1");
  await page.getByTestId("amenity-browser-trigger").click();
  await page.getByPlaceholder("Filter places").fill("Mega");
  await expect(page.getByTestId("amenity-browser")).toBeVisible();

  await search.fill("Second");
  await search.press("Enter");
  await expect(page.getByTestId("amenity-browser")).toHaveCount(0);
  await expect(map).toHaveAttribute("data-selection", "Second address");
  await expect(map).toHaveAttribute("data-amenity-count", "1");
  await page.getByTestId("amenity-browser-trigger").click();
  await expect(page.getByPlaceholder("Filter places")).toHaveValue("");
  await expect(page.getByRole("button", { name: /Lidl Tineretului/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Mega Image Unirii/ })).toHaveCount(0);
});

// Skipped: the keyboard place browser drives amenity POIs +
// transit stops (the amenity subsystem), suppressed in preset mode.
test.skip("keyboard-only place browser opens a POI, transit stop, and route with focus return", async ({ page }) => {
  await stubPopulatedState(page);
  await page.route("**/api/stop-lines**", (route) =>
    route.fulfill({
      json: {
        name: "Piața Unirii 2",
        lines: [{ mode: "bus", ref: "331", direction: "Cartier Dămăroaia", relationId: 1776396 }],
      },
    }),
  );
  await page.route("**/api/route-path**", (route) =>
    route.fulfill({
      json: {
        segments: [
          [
            [26.102, 44.425],
            [26.12, 44.43],
            [26.13, 44.44],
          ],
        ],
        stops: [
          { lat: 44.425, lng: 26.102, name: "Piața Unirii 2" },
          { lat: 44.44, lng: 26.13, name: "Cartier Dămăroaia" },
        ],
      },
    }),
  );
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  const search = page.getByRole("combobox");
  await search.fill("Piața Unirii");
  await search.press("Enter");
  await expect(map).toHaveAttribute("data-amenity-count", "5");

  const browserTrigger = page.getByTestId("amenity-browser-trigger");
  for (let step = 0; step < 12 && !(await browserTrigger.evaluate((element) => element === document.activeElement)); step += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(browserTrigger).toBeFocused();
  await page.keyboard.press("Enter");
  const filter = page.getByPlaceholder("Filter places");
  await expect(filter).toBeFocused();
  await filter.fill("Mega Image");
  const mega = page.getByRole("button", { name: /Mega Image Unirii/ });
  await expect(mega).toBeVisible();
  await page.keyboard.press("Tab"); // close browser
  await page.keyboard.press("Tab"); // filtered place
  await expect(mega).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(map).toHaveAttribute("data-amenity-inspect", "Mega Image Unirii");
  const poi = page.locator('[data-testid="poi-popup"]');
  await expect(poi.getByText("Mega Image Unirii")).toBeVisible();
  await expect(page.locator(".maplibregl-popup-close-button")).toBeFocused();
  await captureRequested(page, "poi-popup-desktop");
  await page.keyboard.press("Escape");
  await expect(poi).toHaveCount(0);
  await expect(browserTrigger).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(filter).toBeFocused();
  await filter.fill("Piața Unirii 2");
  const transitPlace = page.getByRole("button", { name: /Piața Unirii 2/ });
  await expect(transitPlace).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(transitPlace).toBeFocused();
  await page.keyboard.press("Enter");
  const stop = page.locator('[data-testid="stop-popup"]');
  await expect(stop).toHaveAttribute("data-state", "ready");
  const route = stop.getByRole("button", { name: /Bus 331/ });
  await expect(page.locator(".maplibregl-popup-close-button")).toBeFocused();
  await captureRequested(page, "stop-popup-desktop");
  await page.keyboard.press("Tab");
  await expect(route).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(map).toHaveAttribute("data-route-path", "1776396");
  await captureRequested(page, "route-desktop");
  await page.keyboard.press("Escape");
  await expect(stop).toHaveCount(0);
  await expect(map).not.toHaveAttribute("data-route-path", /.*/);
  await expect(browserTrigger).toBeFocused();
});

test("selection failure remains understandable and composed", async ({ page }) => {
  await page.route("**/api/geocode**", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await search(page, "Piața Romană");
  // The failed lookup is announced as an alert: the error banner, on screen.
  const alert = page.getByRole("alert").filter({ hasText: "Nu am putut căuta adresa." });
  await expect(alert).toHaveAttribute("data-testid", "error-banner");
  await expect(alert).toBeInViewport();
  // A failed address lookup is not the travel mode's fault: walking stays unflagged,
  // and no result sheet takes the screen.
  await expect(page.getByTestId("mode-icon-walk")).toHaveAccessibleName("Pe jos");
  await expect(page.getByTestId("result-sheet")).toHaveCount(0);
  await expectBannerClear(page);
  await captureRequested(page, "selection-error-desktop");
});

// Skipped: pivots on clicking a west-side amenity marker +
// its poi-popup (the amenity subsystem, suppressed in preset mode). The map-drag guard
// rides on that marker's pixel, so it cannot run standalone here.
test.skip("desktop rail gaps preserve map drag and west-side amenity inspection", async ({ page }) => {
  const west = { lat: 44.4296, lng: 26.0475, name: "West-side park", category: "parks", band: 15 };
  await stubPopulatedState(page, {
    ...AMENITIES,
    countsByBand: innerBandCounts({ groceries: 0, pharmacies: 0, parks: 1, schools: 0, transit: 0 }),
    amenities: [west],
  });
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await page.getByRole("combobox").fill("Piața Unirii");
  await page.getByRole("button", { name: "Go" }).click();
  await expect(map).toHaveAttribute("data-amenity-count", "1");
  await expect(map).toHaveAttribute("data-camera-settled", "true", { timeout: 10_000 });

  const point = await amenityPixel(page, west.lng, west.lat);
  const command = await page.getByTestId("command-surface").boundingBox();
  const results = await page.getByTestId("result-sheet").boundingBox();
  if (!command || !results) throw new Error("rail surfaces have no boxes");
  expect(point.x).toBeGreaterThan(command.x);
  expect(point.x).toBeLessThan(command.x + command.width);
  expect(point.y).toBeGreaterThan(command.y + command.height);
  expect(point.y).toBeLessThan(results.y);
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="app-map"]') !== null,
      point,
    ),
  ).toBe(true);

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 18, point.y + 8, { steps: 4 });
  await page.mouse.up();
  await expect(map).toHaveAttribute("data-map-drag", "1");

  // A fresh selection restores the deterministic camera after the drag.
  await page.getByRole("combobox").fill("Piața Unirii");
  await page.getByRole("button", { name: "Go" }).click();
  await expect(map).toHaveAttribute("data-amenity-count", "1");
  await expect(map).toHaveAttribute("data-camera-settled", "true", { timeout: 10_000 });
  const restored = await amenityPixel(page, west.lng, west.lat);
  await map.click({ position: restored });
  await expect(page.locator('[data-testid="poi-popup"]').getByText("West-side park")).toBeVisible();
});

test("reduced motion suppresses decorative surface, spinner and pulse animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const map = await loadPopulatedState(page);
  // The staged ring reveal no longer exists (the preset render paints its shells + contour
  // lines directly); under reduced motion the camera settles instantly and the
  // reach is drawn without animation — assert the instant camera + the fully-painted
  // preset contours rather than reveal stamps.
  await expect(map).toHaveAttribute("data-camera-motion", "instant");
  await expect(map).toHaveAttribute("data-preset-contours", "10");
  const motion = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "hf-spinner hf-surface-in hf-pulse";
    document.body.appendChild(probe);
    const style = getComputedStyle(probe);
    const result = { animationName: style.animationName, iterationCount: style.animationIterationCount };
    probe.remove();
    return result;
  });
  expect(motion.animationName).toBe("none");
  expect(motion.iterationCount).toBe("1");
});

// Skipped: opens the amenity POI popup (`poi-popup`) to
// inspect the MapLibre popup chrome; amenity markers/popups are suppressed in preset
// mode. Restore when the amenity popup returns in the planned amenity pass.
test.skip("MapLibre popup keeps the redesigned dark chrome after CSS bundling", async ({ page }) => {
  await loadPopulatedState(page);
  await clickEastAmenity(page);
  const popup = page.locator('[data-testid="poi-popup"]');
  await expect(popup.getByText("Mega Image Unirii")).toBeVisible();
  const chrome = await page.locator(".maplibregl-popup-content").evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, radius: Number.parseFloat(style.borderRadius) };
  });
  expect(chrome.background).toBe("rgba(12, 16, 13, 0.97)");
  expect(chrome.radius).toBeGreaterThanOrEqual(16);
});
