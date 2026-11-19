import { expect, test, type Page } from "@playwright/test";
import {
  besidePin,
  expectBasemapCredits,
  expectNotCovered,
  modeButton,
  openInfo,
  pickMode,
  pickPreset,
  expectBannerClear,
  sampleMapClearPercent,
  search,
  toggleDeparture,
  toggleSlowPace,
} from "./shell";
import { innerBandCounts, WALK_CLIP } from "./amenity-fixtures";

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

const ISOCHRONE = {
  origin: { lat: 44.4268, lng: 26.1025 },
  // The calibrated walk preset [10, 20] served on ?model=preset.
  rings: [ring(10, 0.01), ring(20, 0.02)],
};

const AMENITIES = {
  clip: WALK_CLIP,
  countsByBand: innerBandCounts({ groceries: 12, pharmacies: 8, parks: 5, schools: 7, transit: 14 }),
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

async function touchSwipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const session = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, radiusX: 3, radiusY: 3, force: 1, id: 1 }];
  // Dispatch the whole gesture WITHOUT awaiting each ack: under CPU contention a
  // per-step round-trip stretched the gap between touchStart and the first
  // touchMove past the 500ms long-press threshold, so the "swipe" read as a
  // stationary hold and fired the right-click reach action (observed:
  // 726ms to the first move). A real finger's moves stream continuously; the
  // burst keeps the emulated ones in one delivery window while staying ordered
  // (CDP processes queued input in dispatch order).
  const sends: Promise<unknown>[] = [
    session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.x, from.y) }),
  ];
  for (let step = 1; step <= 6; step += 1) {
    const progress = step / 6;
    sends.push(
      session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: point(from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress),
      }),
    );
  }
  sends.push(session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }));
  await Promise.all(sends);
  await session.detach();
}

// Skipped: this end-to-end touch journey pivots on amenity
// INSPECTION — the amenity count, category toggles, amenity browser, POI popup, and
// transit-stop line popup — the amenity subsystem the phone-first preset UI
// suppresses. The surviving touch-shell contracts (the map keeps the screen, state stays
// visible and editable) are covered by the "mobile shell: the floating mode pill leaves
// the map the screen" test below and by preset-render.spec.ts. Restore in the planned amenity pass.
test.skip("touch journey stays usable through selection, results, inspection, map gestures, and orientation", async ({
  page,
}) => {
  await page.route("**/api/suggest**", (route) =>
    route.fulfill({
      json: {
        suggestions: [
          ...Array.from({ length: 8 }, (_, index) => ({
            label: `Bulevardul Unirii ${index + 1}, București`,
            lat: 44.425 + index * 0.0001,
            lng: 26.1 + index * 0.0001,
          })),
          { label: "Piața Unirii, București", lat: 44.4268, lng: 26.1025 },
        ],
      },
    }),
  );
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: ISOCHRONE }));
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));
  await page.route("**/api/reverse**", (route) =>
    route.fulfill({ json: { lat: 44.427, lng: 26.11, label: "Touched map point" } }),
  );
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
            [26.118, 44.432],
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
  expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
  await expect(page.getByTestId("first-run")).toBeVisible();

  const search = page.getByRole("combobox");
  await search.tap();
  await search.fill("Unirii");
  const suggestionList = page.getByRole("listbox");
  await expect(page.getByRole("option")).toHaveCount(9);
  const suggestionListBox = await suggestionList.boundingBox();
  if (!suggestionListBox) throw new Error("mobile suggestion list has no box");
  const suggestScrollBefore = await suggestionList.evaluate((element) => element.scrollTop);
  await touchSwipe(
    page,
    { x: suggestionListBox.x + suggestionListBox.width / 2, y: suggestionListBox.y + suggestionListBox.height - 24 },
    { x: suggestionListBox.x + suggestionListBox.width / 2, y: suggestionListBox.y + 28 },
  );
  await expect.poll(() => suggestionList.evaluate((element) => element.scrollTop)).toBeGreaterThan(suggestScrollBefore);
  await expect(suggestionList).toBeVisible();
  await expect(map).not.toHaveAttribute("data-selection", /.*/);
  const suggestion = page.getByRole("option", { name: "Piața Unirii, București" });
  await expect(suggestion).toBeVisible();
  await suggestion.scrollIntoViewIfNeeded();
  await suggestion.tap();
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  await expect(map).toHaveAttribute("data-amenity-count", "5");

  // The sheet opens at PEEK on mobile — expand it before driving the
  // full result content (this tap is itself part of the new contract).
  await page.getByTestId("sheet-toggle").tap();
  await expect(page.locator(".hf-map-shell")).toHaveAttribute("data-sheet-state", "expanded");

  const sheet = page.getByTestId("result-sheet");
  const sheetBox = await sheet.boundingBox();
  if (!sheetBox) throw new Error("mobile result sheet has no box");
  const beforeScroll = await sheet.evaluate((element) => element.scrollTop);
  await touchSwipe(
    page,
    { x: sheetBox.x + sheetBox.width / 2, y: sheetBox.y + sheetBox.height - 18 },
    { x: sheetBox.x + sheetBox.width / 2, y: sheetBox.y + 24 },
  );
  await expect.poll(() => sheet.evaluate((element) => element.scrollTop)).toBeGreaterThan(beforeScroll);

  const parksToggle = page.getByRole("button", { name: /Parks & green: .* places/ });
  await parksToggle.scrollIntoViewIfNeeded();
  const parksToggleBox = await parksToggle.boundingBox();
  if (!parksToggleBox) throw new Error("mobile park toggle has no box");
  expect(parksToggleBox.height).toBeGreaterThanOrEqual(44);
  await parksToggle.tap();
  await expect(parksToggle).toHaveAttribute("aria-pressed", "false");
  await expect(map).toHaveAttribute("data-amenity-count", "4");
  await parksToggle.tap();
  // Anchor the re-enable on the toggle's own state before the count: a tap lost
  // under touch-emulation load fails here loudly rather than as a stuck count.
  await expect(parksToggle).toHaveAttribute("aria-pressed", "true");
  await expect(map).toHaveAttribute("data-amenity-count", "5");

  const browse = page.getByTestId("amenity-browser-trigger");
  await browse.scrollIntoViewIfNeeded();
  await browse.tap();
  const place = page.getByRole("button", { name: /Mega Image Unirii/ });
  await place.scrollIntoViewIfNeeded();
  await place.tap();
  await expect(page.locator('[data-testid="poi-popup"]').getByText("Mega Image Unirii")).toBeVisible();
  await page.locator(".maplibregl-popup-close-button").tap();

  await browse.tap();
  await page.getByPlaceholder("Filter places").fill("Piața Unirii 2");
  await page.getByRole("button", { name: /Piața Unirii 2/ }).tap();
  const stop = page.locator('[data-testid="stop-popup"]');
  await expect(stop).toHaveAttribute("data-state", "ready");
  await stop.getByRole("button", { name: /Bus 331/ }).tap();
  await expect(map).toHaveAttribute("data-route-path", "1776396");

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(map).toHaveAttribute("data-camera-pad-top", "168");
  await expect(map).toHaveAttribute("data-camera-pad-left", "12");
  await expect
    .poll(() =>
      map.evaluate((element) => ({
        framed: element.dataset.routeFramed,
        frame: element.dataset.routeFrame,
      })),
    )
    .toMatchObject({ framed: "true" });
  await expect(map).toHaveAttribute("data-route-corridor-height", /7[0-9]|[89][0-9]/);
  const [commandBox, landscapeSheetBox] = await Promise.all([
    page.getByTestId("command-surface").boundingBox(),
    sheet.boundingBox(),
  ]);
  if (!commandBox || !landscapeSheetBox) throw new Error("landscape shell has no boxes");
  expect(landscapeSheetBox.y + landscapeSheetBox.height).toBeLessThanOrEqual(390);
  expect(await sheet.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.locator(".maplibregl-ctrl-compass")).toBeHidden();
  for (const name of ["Zoom in", "Zoom out"]) {
    const control = page.getByRole("button", { name });
    const box = await control.boundingBox();
    if (!box) throw new Error(`${name} control has no box`);
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(center.y).toBeGreaterThan(commandBox.y + commandBox.height + 4);
    expect(center.y).toBeLessThan(landscapeSheetBox.y - 4);
    expect(
      await page.evaluate(
        ({ x, y, label }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label") === label,
        { ...center, label: name },
      ),
    ).toBe(true);
  }
  if (process.env.HOWFAR_CAPTURE_DIR) {
    await page.screenshot({
      path: `${process.env.HOWFAR_CAPTURE_DIR}/touch-landscape.png`,
      animations: "disabled",
    });
  }

  await page.setViewportSize({ width: 412, height: 839 });
  await page.locator(".maplibregl-popup-close-button").tap();

  const mapBox = await map.boundingBox();
  if (!mapBox) throw new Error("mobile map has no box");
  await touchSwipe(page, { x: mapBox.width * 0.52, y: 430 }, { x: mapBox.width * 0.68, y: 430 });
  await expect(map).toHaveAttribute("data-map-drag", "1");
  await page.touchscreen.tap(mapBox.width - 70, 430);
  await expect(map).toHaveAttribute("data-selection", "Touched map point");

  await expect(page.getByRole("link", { name: "Transitous" })).toBeVisible();
  await expect(page.locator(".maplibregl-ctrl-attrib")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);
});

// The floating mode pill must fit a narrow phone: every control is a ≥40px target,
// the whole pill stays inside the viewport with no horizontal scroll, and a phone shows
// no zoom buttons (pinch zooms there) — in its narrowest state (walk, with the turtle)
// and its widest (a non-walk mode showing the 12:30 departure).
test("mode pill: every button is ≥ 40 px, inside the viewport at 390 and 375 px, with no horizontal scroll, and the zoom buttons are hidden", async ({
  page,
}) => {
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });

  const pill = page.getByTestId("mode-pill");
  const zoomIn = page.locator(".maplibregl-ctrl-zoom-in");

  async function expectPillFits(viewport: { width: number; height: number }) {
    await page.setViewportSize(viewport);
    for (const mode of ["walk", "transit", "car"] as const) await expect(modeButton(page, mode)).toBeVisible();
    // 3 modes + the mode's 2 presets + 1 toggle.
    const buttons = pill.getByRole("button");
    await expect(buttons).toHaveCount(6);
    for (let i = 0; i < 6; i += 1) {
      const box = await buttons.nth(i).boundingBox();
      if (!box) throw new Error(`mode pill button ${i} has no box at ${viewport.width}px`);
      expect(box.height).toBeGreaterThanOrEqual(40);
      expect(box.width).toBeGreaterThanOrEqual(40);
    }
    const pb = await pill.boundingBox();
    if (!pb) throw new Error(`mode pill has no box at ${viewport.width}px`);
    expect(pb.x).toBeGreaterThanOrEqual(0);
    expect(pb.x + pb.width).toBeLessThanOrEqual(viewport.width);
    expect(pb.y).toBeGreaterThanOrEqual(0);
    expect(pb.y + pb.height).toBeLessThanOrEqual(viewport.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
    await expect(zoomIn).toBeHidden();
  }

  const phones = [
    { width: 390, height: 844 },
    { width: 375, height: 812 },
  ];
  // Narrowest: walk with the turtle (the first-open default).
  await expect(page.getByTestId("pace-toggle")).toBeVisible();
  for (const viewport of phones) await expectPillFits(viewport);

  // Widest: public transport with the 12:30 departure on the clock.
  await pickMode(page, "transit");
  await toggleDeparture(page);
  await expect(page.getByTestId("time-toggle")).toHaveText("12:30");
  for (const viewport of phones) await expectPillFits(viewport);
});

// The right-click (long-press) transit directions must stay a COMPACT
// card on a phone — not a slab that blankets the map — and still draw the journey.
// Uses a RETRYING long-press (poll until the reach popup appears) so a single
// dropped touch gesture can't flake the run (the headless long-press caveat).
test("mobile: long-press transit directions show a compact card and draw the journey", async ({ page }) => {
  const rings = [ring(15, 0.28), ring(30, 0.3), ring(45, 0.32)]; // big → centre is deterministically in-band
  await page.route("**/api/suggest**", (route) =>
    route.fulfill({ json: { suggestions: [{ label: "Piața Unirii, București", lat: 44.4268, lng: 26.1025 }] } }),
  );
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: { origin: { lat: 44.4268, lng: 26.1025 }, rings } }));
  await page.route("**/api/transit**", (route) => route.fulfill({ json: { origin: { lat: 44.4268, lng: 26.1025 }, rings, departure: "2026-07-29T05:30:00.000Z" } }));
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));
  await page.route("**/api/reach**", (route) =>
    route.fulfill({
      json: {
        reachable: true,
        totalMinutes: 20,
        transfers: 0,
        legs: [
          { mode: "WALK", fromName: "START", toName: "Board", minutes: 4, from: { lat: 44.4268, lng: 26.1025 }, to: { lat: 44.435, lng: 26.105 }, path: [[26.1025, 44.4268], [26.105, 44.435]] },
          { mode: "TRAM", line: "1", headsign: "Nord", fromName: "Board", toName: "Alight", minutes: 16, from: { lat: 44.435, lng: 26.105 }, to: { lat: 44.45, lng: 26.07 }, path: [[26.105, 44.435], [26.07, 44.45]] },
        ],
      },
    }),
  );

  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-isochrone-rings", "3");
  // The mode pill floats over the map, so switching mode is one tap away.
  await pickMode(page, "transit");
  await expect(map).toHaveAttribute("data-mode", "transit");

  // Beside the origin pin: a press on the pin itself is the pin's, not the map's.
  const { x: cx, y: cy } = await besidePin(page);
  const session = await page.context().newCDPSession(page);
  const pt = (x: number, y: number) => [{ x, y, radiusX: 3, radiusY: 3, force: 1, id: 1 }];

  // Retry the long-press until the reach popup registers (robust to a dropped gesture).
  await expect(async () => {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(cx, cy) });
    await page.waitForTimeout(650); // > the long-press hold threshold, no move
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(map).toHaveAttribute("data-reach-state", "transit", { timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  // Directions open the result sheet at the bottom, capped at
  // min(30dvh,14.5rem) — never a full-screen slab (Pixel 7 is 412px wide). The
  // sheet scrolls; the panel is inside it.
  const panel = await page.getByTestId("reach-panel").boundingBox();
  expect(panel).not.toBeNull();
  const vh = await page.evaluate(() => window.innerHeight);
  expect(panel!.height).toBeLessThanOrEqual(vh * 0.7);
  // The journey drew AND the camera actually framed it on a phone-sized viewport
  // (guards the double-counted-padding Critical: the fit must not silently fail).
  await expect(map).toHaveAttribute("data-reach-journey", "2", { timeout: 5000 });
  await expect(map).toHaveAttribute("data-reach-framed", "true", { timeout: 5000 });
  // No horizontal overflow introduced by the card.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

// The long-press half of "right-click = get me there by public
// transport" — a long-press from WALK mode must auto-switch to transit, plan the
// trip (exactly one /api/reach), draw the journey, and NOT leave a trailing
// synthetic-click that reselects a new origin.
test("mobile: long-press from Walk auto-switches to Public transport and draws the journey", async ({ page }) => {
  const rings = [ring(15, 0.28), ring(30, 0.3), ring(45, 0.32)];
  const reachCalls: string[] = [];
  await page.route("**/api/geocode**", (route) => route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }));
  await page.route("**/api/suggest**", (route) =>
    route.fulfill({ json: { suggestions: [{ label: "Piața Unirii, București", lat: 44.4268, lng: 26.1025 }] } }),
  );
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: { origin: { lat: 44.4268, lng: 26.1025 }, rings } }));
  await page.route("**/api/transit**", (route) => route.fulfill({ json: { origin: { lat: 44.4268, lng: 26.1025 }, rings, departure: "2026-07-29T05:30:00.000Z" } }));
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));
  await page.route("**/api/reach**", (route) => {
    reachCalls.push(route.request().url());
    route.fulfill({
      json: {
        reachable: true,
        totalMinutes: 20,
        transfers: 0,
        legs: [
          { mode: "WALK", fromName: "START", toName: "Board", minutes: 4, from: { lat: 44.4268, lng: 26.1025 }, to: { lat: 44.435, lng: 26.105 }, path: [[26.1025, 44.4268], [26.105, 44.435]] },
          { mode: "TRAM", line: "1", headsign: "Nord", fromName: "Board", toName: "Alight", minutes: 16, from: { lat: 44.435, lng: 26.105 }, to: { lat: 44.45, lng: 26.07 }, path: [[26.105, 44.435], [26.07, 44.45]] },
        ],
      },
    });
  });

  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-isochrone-rings", "3");
  await expect(map).toHaveAttribute("data-mode", "walk"); // start in WALK — do NOT switch manually

  // Beside the origin pin: a press on the pin itself is the pin's, not the map's.
  const { x: cx, y: cy } = await besidePin(page);
  const session = await page.context().newCDPSession(page);
  const pt = (x: number, y: number) => [{ x, y, radiusX: 3, radiusY: 3, force: 1, id: 1 }];

  await expect(async () => {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(cx, cy) });
    await page.waitForTimeout(650); // > long-press hold threshold, no move
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    // The long-press flips Walk → Public transport (the unified right-click action).
    await expect(map).toHaveAttribute("data-mode", "transit", { timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  await expect(map).toHaveAttribute("data-reach-state", "transit");
  await expect(map).toHaveAttribute("data-reach-journey", "2", { timeout: 5000 });
  // Exactly one plan fetch, and the trailing synthetic click was suppressed — a
  // reselection would have geocoded a new origin (the label stays Piața Unirii).
  expect(reachCalls).toHaveLength(1);
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  // The directions open the result sheet, which holds them and nothing else.
  await expect(page.getByTestId("result-sheet").getByTestId("reach-panel")).toBeVisible();
});

// Phones hide the compass with the rest of the navigation corner, so a twist or a tilt could
// not be undone: touch rotation and pitch are off, and a pinch still zooms. The two-finger
// gestures run through the real touch pipeline. MapLibre 5 has no public getter for touch
// rotation, so only pitch's handler state is read; rotation is proved by the twist.
test("mobile: the map stays north-up and flat under two fingers, and a pinch still zooms", async ({ page }) => {
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });

  type Gl = { getBearing(): number; getPitch(): number; getZoom(): number; touchPitch: { isEnabled(): boolean } };
  const read = () =>
    page.evaluate(() => {
      const m = (window as unknown as { __hfMap: Gl }).__hfMap;
      return {
        bearing: m.getBearing(),
        pitch: m.getPitch(),
        zoom: m.getZoom(),
        pitchOn: m.touchPitch.isEnabled(),
      };
    });
  const start = await read();
  expect(start.pitchOn).toBe(false);

  const box = await page.locator(".maplibregl-canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2 - 60;
  const session = await page.context().newCDPSession(page);
  const two = (a: [number, number], b: [number, number]) => [
    { x: a[0], y: a[1], radiusX: 3, radiusY: 3, force: 1, id: 1 },
    { x: b[0], y: b[1], radiusX: 3, radiusY: 3, force: 1, id: 2 },
  ];
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: ReturnType<typeof two> | []) =>
    session.send("Input.dispatchTouchEvent", { type, touchPoints: points });

  // Twist: both fingers circle the centre by 60 degrees at a constant spread.
  const r = 70;
  const at = (deg: number): ReturnType<typeof two> => {
    const t = (deg * Math.PI) / 180;
    return two([cx + r * Math.cos(t), cy + r * Math.sin(t)], [cx - r * Math.cos(t), cy - r * Math.sin(t)]);
  };
  await touch("touchStart", at(0));
  for (let deg = 6; deg <= 60; deg += 6) await touch("touchMove", at(deg));
  await touch("touchEnd", []);
  const twisted = await read();
  expect(twisted.bearing).toBeCloseTo(0, 5);
  expect(twisted.pitch).toBeCloseTo(0, 5);

  // Pinch: the fingers spread apart; the zoom changes. Retried, since a gesture can be dropped.
  await expect(async () => {
    await touch("touchStart", two([cx - 30, cy], [cx + 30, cy]));
    for (let d = 40; d <= 140; d += 10) await touch("touchMove", two([cx - d, cy], [cx + d, cy]));
    await touch("touchEnd", []);
    expect((await read()).zoom).toBeGreaterThan(start.zoom + 0.3);
  }).toPass({ timeout: 15_000 });
  expect((await read()).bearing).toBeCloseTo(0, 5);
});

// A press and hold on the origin pin begins a drag of the pin; it must not also open
// directions. A long press on bare map beside it afterwards does, and is the signal that the
// gesture works in this run: exactly one plan was fetched, and it was that one's.
test("mobile: a long press on the origin pin opens no directions", async ({ page }) => {
  const rings = [ring(15, 0.28), ring(30, 0.3), ring(45, 0.32)];
  const reachCalls: string[] = [];
  await page.route("**/api/geocode**", (route) => route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }));
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: { origin: { lat: 44.4268, lng: 26.1025 }, rings } }));
  await page.route("**/api/transit**", (route) => route.fulfill({ json: { origin: { lat: 44.4268, lng: 26.1025 }, rings, departure: "2026-07-29T05:30:00.000Z" } }));
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));
  await page.route("**/api/reach**", (route) => {
    reachCalls.push(route.request().url());
    route.fulfill({
      json: {
        reachable: true,
        totalMinutes: 20,
        transfers: 0,
        legs: [
          { mode: "WALK", fromName: "START", toName: "Board", minutes: 4, from: { lat: 44.4268, lng: 26.1025 }, to: { lat: 44.435, lng: 26.105 }, path: [[26.1025, 44.4268], [26.105, 44.435]] },
          { mode: "TRAM", line: "1", headsign: "Nord", fromName: "Board", toName: "Alight", minutes: 16, from: { lat: 44.435, lng: 26.105 }, to: { lat: 44.45, lng: 26.07 }, path: [[26.105, 44.435], [26.07, 44.45]] },
        ],
      },
    });
  });

  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-isochrone-rings", "3");

  const marker = await page.locator(".hf-origin-marker").boundingBox();
  if (!marker) throw new Error("the origin pin has no box");
  const session = await page.context().newCDPSession(page);
  const pt = (x: number, y: number) => [{ x, y, radiusX: 3, radiusY: 3, force: 1, id: 1 }];
  const hold = async (x: number, y: number) => {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(x, y) });
    await page.waitForTimeout(650); // > long-press hold threshold, no move
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };

  await hold(marker.x + marker.width / 2, marker.y + marker.height / 2);
  const beside = await besidePin(page);
  await expect(async () => {
    await hold(beside.x, beside.y);
    await expect(map).toHaveAttribute("data-mode", "transit", { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await expect(map).toHaveAttribute("data-reach-state", "transit");
  expect(reachCalls).toHaveLength(1);
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
});

// A long-press from Walk switches to public transport and plans the trip. When that
// transit reach fails, the trip is still on screen (Transitous data), so its credit
// stays, and the error banner shares the column above the mode pill with it: the
// banner sits beneath the credit and never covers it.
test("mobile: a failed transit reach under open directions keeps the Transitous credit clear of the banner", async ({ page }) => {
  const rings = [ring(15, 0.28), ring(30, 0.3), ring(45, 0.32)];
  await page.route("**/api/geocode**", (route) => route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }));
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: { origin: { lat: 44.4268, lng: 26.1025 }, rings } }));
  await page.route("**/api/transit**", (route) => route.fulfill({ status: 502, json: { error: "upstream" } }));
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));
  await page.route("**/api/reach**", (route) =>
    route.fulfill({
      json: {
        reachable: true,
        totalMinutes: 20,
        transfers: 0,
        legs: [
          { mode: "WALK", fromName: "START", toName: "Board", minutes: 4, from: { lat: 44.4268, lng: 26.1025 }, to: { lat: 44.435, lng: 26.105 }, path: [[26.1025, 44.4268], [26.105, 44.435]] },
          { mode: "TRAM", line: "1", headsign: "Nord", fromName: "Board", toName: "Alight", minutes: 16, from: { lat: 44.435, lng: 26.105 }, to: { lat: 44.45, lng: 26.07 }, path: [[26.105, 44.435], [26.07, 44.45]] },
        ],
      },
    }),
  );

  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-isochrone-rings", "3");
  await expect(map).toHaveAttribute("data-mode", "walk");

  // Beside the origin pin: a press on the pin itself is the pin's, not the map's.
  const { x: cx, y: cy } = await besidePin(page);
  const session = await page.context().newCDPSession(page);
  const pt = (x: number, y: number) => [{ x, y, radiusX: 3, radiusY: 3, force: 1, id: 1 }];
  // Retry the long-press until the directions register (robust to a dropped gesture).
  await expect(async () => {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(cx, cy) });
    await page.waitForTimeout(650); // > long-press hold threshold, no move
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(map).toHaveAttribute("data-reach-state", "transit", { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await expect(map).toHaveAttribute("data-reach-journey", "2", { timeout: 5000 });

  const banner = page.getByTestId("error-banner");
  const credit = page.getByTestId("transitous-credit");
  await expect(banner).toContainText("Nu am putut calcula zona cu transportul public.");
  await expect(page.getByTestId("mode-icon-transit")).toHaveAccessibleName("Transport public (indisponibil)");
  await expectNotCovered(credit);
  await expectBannerClear(page);
  const [creditBox, bannerBox] = await Promise.all([credit.boundingBox(), banner.boundingBox()]);
  if (!creditBox || !bannerBox) throw new Error("the credit or the error banner has no box");
  expect(creditBox.y + creditBox.height).toBeLessThanOrEqual(bannerBox.y);
});

// Below md the shell hands the screen to the map — the address bar stays at the
// top and the mode pill floats at the bottom, with no result sheet or card for a
// chosen place — so every piece of state (address, mode, preset, pace) stays visible
// and one tap from its control.
test("mobile shell: the floating mode pill leaves the map the screen; state stays visible and editable", async ({
  page,
}) => {
  await page.route("**/api/suggest**", (route) =>
    route.fulfill({ json: { suggestions: [{ label: "Piața Unirii, București", lat: 44.4268, lng: 26.1025 }] } }),
  );
  let failIsochrone = false;
  const isoUrls: string[] = [];
  await page.route("**/api/isochrone**", (route) => {
    isoUrls.push(route.request().url());
    return failIsochrone ? route.fulfill({ status: 500, json: { error: "boom" } }) : route.fulfill({ json: ISOCHRONE });
  });
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));

  await page.goto("/");
  const map = page.getByTestId("app-map");
  const shell = page.locator(".hf-map-shell");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });

  // Pre-selection: the mode pill is already on screen, nothing to open first.
  await expect(page.getByTestId("mode-pill")).toBeVisible();
  await expect(modeButton(page, "walk")).toHaveAttribute("aria-pressed", "true");

  const search = page.getByRole("combobox");
  await search.tap();
  await search.fill("Unirii");
  await page.getByRole("option", { name: "Piața Unirii, București" }).tap();
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");

  // A chosen place opens no sheet, and the camera insets describe the floating
  // controls: the address bar on top, the mode pill below.
  await expect(page.getByTestId("result-sheet")).toHaveCount(0);
  await expect(map).toHaveAttribute("data-camera-pad-top", "76");
  await expect(map).toHaveAttribute("data-camera-pad-bottom", "70");
  // The state stays visible: the address in the bar; mode, preset and pace in the pill.
  await expect(search).toHaveValue("Piața Unirii, București");
  await expect(modeButton(page, "walk")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("preset-chip-10")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("pace-toggle")).toHaveAttribute("aria-pressed", "false");

  // The camera settled on the origin — the padding commit did not cancel the
  // selection flyTo.
  await expect
    .poll(async () => {
      const center = await map.getAttribute("data-camera-center");
      if (!center) return null;
      const [lng, lat] = center.split(",").map(Number);
      return Math.abs(lng - 26.1025) < 0.01 && Math.abs(lat - 44.4268) < 0.01;
    })
    .toBe(true);

  // Map strip: the contiguous unobstructed corridor between the address bar and the
  // mode pill is the majority of the screen.
  const viewport = page.viewportSize()!;
  const [topBarBox, pillBox] = await Promise.all([
    page.getByTestId("top-bar").boundingBox(),
    page.getByTestId("mode-pill").boundingBox(),
  ]);
  if (!topBarBox || !pillBox) throw new Error("top bar or mode pill has no box");
  const strip = pillBox.y - (topBarBox.y + topBarBox.height);
  expect(strip / viewport.height).toBeGreaterThanOrEqual(0.55);
  // Point-sample the same 20px grid the live inspection used (CHECKPOINT-B
  // method): unobstructed map ≥ 60%.
  const sampled = await sampleMapClearPercent(page);
  expect(sampled).toBeGreaterThanOrEqual(60);

  // The basemap credits live behind the ⓘ button, which stays on screen in this state
  // too. Opened, the licence-required ESA WorldCover credit must be ACTUALLY READABLE
  // at phone width: a link nothing sits on top of, not merely present. (The Transitous
  // credit is transit-gated; per mode it is proven in preset-render.spec.ts.)
  await expect(page.getByTestId("info-button")).toBeInViewport();
  const info = await openInfo(page);
  await expectNotCovered(info.getByRole("link", { name: "ESA WorldCover" }));

  // Change the reach preset straight from the pill (the larger 20-min chip): a pure
  // client-side repaint, the route already returned both contours.
  const isoBeforePreset = isoUrls.length;
  await pickPreset(page, 20);
  await expect(map).toHaveAttribute("data-selected-preset", "20");
  await expect(page.getByTestId("preset-chip-20")).toHaveAttribute("aria-pressed", "true");
  expect(isoUrls.length).toBe(isoBeforePreset);

  // CHANGE the pace from the pill: a same-origin recompute at the slow pace, which
  // keeps the 20-min preset and still opens no sheet.
  const isoBeforePace = isoUrls.length;
  await toggleSlowPace(page);
  await expect(page.getByTestId("pace-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => isoUrls.length).toBeGreaterThan(isoBeforePace);
  expect(isoUrls[isoUrls.length - 1]).toContain("pace=slow");
  await expect(shell).toHaveAttribute("data-sel-status", "idle");
  await expect(map).toHaveAttribute("data-selected-preset", "20");
  await expect(page.getByTestId("result-sheet")).toHaveCount(0);

  // Touch never sees hover chrome: taps synthesize mousemove, but
  // the hover grow + preview are gated on a real fine pointer — no preview
  // panel may ever have appeared in this touch-only session.
  await expect(page.getByTestId("cluster-preview")).toHaveCount(0);

  // Error path: a failed selection is a compact banner above the mode pill, never a
  // takeover — no sheet opens, the map keeps the screen — and the pill flags the
  // failed mode.
  failIsochrone = true;
  await search.tap();
  await search.fill("Unirii");
  await page.getByRole("option", { name: "Piața Unirii, București" }).tap();
  const banner = page.getByTestId("error-banner");
  await expect(banner).toContainText("Nu am putut calcula zona pe jos.");
  await expect(page.getByTestId("result-sheet")).toHaveCount(0);
  await expect(page.getByTestId("mode-icon-walk")).toHaveAccessibleName("Pe jos (indisponibil)");
  await expectBannerClear(page);
  // Directly above the pill, which stays at the bottom of the screen.
  const [bannerBox, errorPillBox] = await Promise.all([banner.boundingBox(), page.getByTestId("mode-pill").boundingBox()]);
  if (!bannerBox || !errorPillBox) throw new Error("the error banner or the mode pill has no box");
  expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(errorPillBox.y);
  expect(errorPillBox.y - (bannerBox.y + bannerBox.height)).toBeLessThan(24);
});

// The ⓘ popover opens by itself when the map first loads, so the data credits are on
// screen with no tap, and it gives way to the first thing the user does: a tap on the
// address field closes it, and so does a tap on the map, which still picks that place.
test("the auto-opened info popover yields to the first tap", async ({ page }) => {
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/reverse**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Punctul atins" } }),
  );
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: ISOCHRONE }));
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));
  const map = page.getByTestId("app-map");
  const popover = page.getByTestId("info-popover");
  // The popover closes by itself 5 s after it opens, so each close below must come
  // within a second of the tap, and well before that self-close could explain it.
  async function expectClosedByTap(tap: () => Promise<void>) {
    await expect(popover).toBeVisible();
    const shownAt = Date.now();
    await tap();
    await expect(popover).toBeHidden({ timeout: 1000 });
    expect(Date.now() - shownAt).toBeLessThan(4000);
  }

  await page.goto("/");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await expectClosedByTap(() => page.getByRole("combobox").tap());

  await page.reload();
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  const box = await map.boundingBox();
  if (!box) throw new Error("map has no box");
  await expectClosedByTap(() => page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2));
  await expect(map).toHaveAttribute("data-selection", "Punctul atins");
});

// Someone already typing an address when the map appears is not interrupted: the
// first-load popover waits until the address field loses focus, then shows the credits
// and closes itself as usual. A tap on ⓘ that is what takes focus from the field opens
// the popover for good (the press must not open it and then close it again).
test("the first-load info popover waits for the address field to lose focus", async ({ page }) => {
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  // Hold the basemap archive back, so the field has focus before the map can load.
  let releaseTiles: () => void = () => {};
  let tilesHeld = Promise.resolve();
  const holdTiles = () => {
    tilesHeld = new Promise<void>((resolve) => {
      releaseTiles = resolve;
    });
  };
  await page.route("**/api/tiles**", async (route) => {
    await tilesHeld;
    await route.continue();
  });
  const map = page.getByTestId("app-map");
  const field = page.getByRole("combobox");
  const button = page.getByTestId("info-button");
  const popover = page.getByTestId("info-popover");

  async function loadWithFieldFocused() {
    holdTiles();
    await page.goto("/");
    await field.tap();
    await expect(field).toBeFocused();
    await expect(map).not.toHaveAttribute("data-map-loaded", "true");
    releaseTiles();
    await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
    await expect(page.getByTestId("map-placeholder")).toHaveAttribute("data-map-placeholder", "covered");
    // The popover would open as the map loads; wait past that, then check once,
    // without retrying: a retrying check would also pass once a wrongly opened
    // popover closed itself 5 s later.
    await page.waitForTimeout(500);
    expect(await button.getAttribute("aria-expanded")).toBe("false");
    expect(await popover.count()).toBe(0);
    await expect(field).toBeFocused();
  }

  // The field lets go: the first-load popover opens, then closes by itself.
  await loadWithFieldFocused();
  await field.blur();
  await expect(popover).toBeVisible();
  await expect(popover).toBeHidden({ timeout: 8_000 });

  // A tap on ⓘ takes focus from the field: the popover opens and stays open past the
  // first-load timer.
  await loadWithFieldFocused();
  await button.tap();
  await expect(popover).toBeVisible();
  await page.waitForTimeout(5_500);
  expect(await button.getAttribute("aria-expanded")).toBe("true");
  expect(await popover.count()).toBe(1);
});

// The reach caveat must reach a phone user: with a place chosen, the ⓘ popover states the
// drawn mode's caveat word for word, and switching to public transport brings the transit
// caveat, the note on bus and tram delays, and the Transitous credit.
test("the info popover states the drawn mode's caveat on a phone", async ({ page }) => {
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: ISOCHRONE }));
  await page.route("**/api/transit**", (route) =>
    route.fulfill({
      json: { origin: ISOCHRONE.origin, rings: [ring(20, 0.03), ring(40, 0.06)], departure: "2026-07-29T05:30:00.000Z" },
    }),
  );
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));

  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  await expect(map).toHaveAttribute("data-preset-contours", "10");

  const walkCaveat =
    "Timpi estimați pe străzi. Lângă râu sau calea ferată drumul poate fi mai lung decât arată harta.";
  const transitCaveat =
    "Timpi după orarele publicate, cu mersul pe jos până la stații. La marginea orașului drumul poate fi mai lung decât arată harta.";
  const transitNote = "Metroul nu depinde de trafic; autobuzul și tramvaiul pot întârzia la aglomerație.";

  const info = await openInfo(page);
  await expect(info).toContainText(walkCaveat);
  await expect(info).not.toContainText(transitNote);
  await expect(info.getByRole("link", { name: "Transitous" })).toHaveCount(0);

  // The open popover follows the mode.
  await pickMode(page, "transit");
  await expect(map).toHaveAttribute("data-mode", "transit");
  await expect(map).toHaveAttribute("data-preset-contours", "20");
  await expect(info).toContainText(transitCaveat);
  await expect(info).toContainText(transitNote);
  await expect(info).not.toContainText(walkCaveat);
  await expectNotCovered(info.getByRole("link", { name: "Transitous", exact: true }));
  await expectNotCovered(page.getByTestId("transitous-credit"));
});

// On a short phone the floating Transitous credit and the mode pill sit where the open
// ⓘ popover's credit line is. The open popover must be the topmost surface: every
// credit link in it, Transitous included, can be read and tapped. With the popover
// closed, the floating credit itself must be readable too.
test("the open info popover stays on top of the floating controls on short phones", async ({ page }) => {
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: ISOCHRONE }));
  await page.route("**/api/transit**", (route) =>
    route.fulfill({
      json: { origin: ISOCHRONE.origin, rings: [ring(20, 0.03), ring(40, 0.06)], departure: "2026-07-29T05:30:00.000Z" },
    }),
  );
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));

  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  await pickMode(page, "transit");
  await expect(map).toHaveAttribute("data-mode", "transit");

  for (const viewport of [
    { width: 390, height: 600 },
    { width: 375, height: 548 },
  ]) {
    await page.setViewportSize(viewport);
    const button = page.getByTestId("info-button");
    if ((await button.getAttribute("aria-expanded")) === "true") await button.click();
    await expect(page.getByTestId("info-popover")).toHaveCount(0);
    await expectNotCovered(page.getByTestId("transitous-credit"));
    const info = await openInfo(page);
    await expectBasemapCredits(info);
    await expectNotCovered(info.getByRole("link", { name: "Transitous", exact: true }));
  }
});

// The address bar never leaves the phone screen, so after a search the field must
// give up focus: otherwise the on-screen keyboard stays up over the reach that was
// just framed, and the next keystroke appends to the shown address.
test("mobile: a search or a picked suggestion releases the address field so the keyboard closes", async ({
  page,
}) => {
  await page.route("**/api/suggest**", (route) =>
    route.fulfill({ json: { suggestions: [{ label: "Piața Unirii, București", lat: 44.4268, lng: 26.1025 }] } }),
  );
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Romană, București" } }),
  );
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: ISOCHRONE }));
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));

  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  const field = page.getByRole("combobox");

  // Enter submits the typed address.
  await search(page, "Piata Romana");
  await expect(map).toHaveAttribute("data-selection", "Piața Romană, București");
  await expect(field).not.toBeFocused();

  // A tapped suggestion.
  await field.tap();
  await expect(field).toBeFocused();
  await field.fill("Unirii");
  await page.getByRole("option", { name: "Piața Unirii, București" }).tap();
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  await expect(field).not.toBeFocused();
});

test("a long address keeps the clear and locate buttons on screen at 360 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const label =
    "Strada Aleea Lacul Morii nr. 12, bloc 4, scara B, Sectorul 6, București, Ilfov, România — lângă Parcul Drumul Taberei";
  await page.route("**/api/suggest**", (route) =>
    route.fulfill({ json: { suggestions: [{ label, lat: 44.4268, lng: 26.1025 }] } }),
  );
  await page.route("**/api/reverse**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label } }),
  );
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: ISOCHRONE }));
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));

  await page.goto("/");
  const map = page.getByTestId("app-map");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  const field = page.getByRole("combobox");
  await field.tap();
  await field.fill("Lacul Morii");
  await page.getByRole("option", { name: label }).tap();
  await expect(map).toHaveAttribute("data-selection", label);

  for (const id of ["clear-address", "locate"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, id).not.toBeNull();
    expect(box!.width, id).toBeGreaterThanOrEqual(44);
    expect(box!.height, id).toBeGreaterThanOrEqual(44);
    expect(box!.x, id).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, id).toBeLessThanOrEqual(360);
  }
  // The long label scrolls inside the field instead of pushing the buttons out.
  expect(await field.evaluate((input) => input.scrollWidth > input.clientWidth)).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);
});

// After the first place resolves, a one-time hint says a long press on the map plans
// a trip there. It hides itself after a few seconds — a mode tap's re-render does not
// keep it up — and the device remembers it was shown, so a reload brings no hint.
test("the hold hint shows once", async ({ page }) => {
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: ISOCHRONE }));
  await page.route("**/api/transit**", (route) =>
    route.fulfill({
      json: { origin: ISOCHRONE.origin, rings: [ring(20, 0.03), ring(40, 0.06)], departure: "2026-07-29T05:30:00.000Z" },
    }),
  );
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));

  await page.goto("/");
  const map = page.getByTestId("app-map");
  const toast = page.getByTestId("hold-toast");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await expect(toast).toHaveCount(0);
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  await expect(toast).toHaveText("Ține apăsat pe hartă: cât faci cu transportul până acolo");
  const shownAt = Date.now();
  expect(await page.evaluate(() => window.localStorage.getItem("hf:hold-hint:v1"))).toBe("1");

  // A mode tap re-renders the shell and resolves again; the hint keeps its own clock.
  await pickMode(page, "transit");
  await expect(map).toHaveAttribute("data-mode", "transit");
  await expect(toast).toHaveCount(0, { timeout: 6_000 });
  expect(Date.now() - shownAt).toBeLessThan(6_000);

  // Remembered on this device: after a reload a new place brings no hint.
  await page.reload();
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  await page.waitForTimeout(1_000);
  // Checked once, without retrying: a retrying check would also pass once a wrongly
  // shown hint hid itself.
  expect(await toast.count()).toBe(0);
});

// A browser that refuses storage (a private window, blocked site data) must not break
// the app: it loads, a place still resolves, and the hint shows — once for the page,
// since it cannot be remembered.
test("blocked storage still loads, selects and shows the hint once", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
  });
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/reverse**", (route) =>
    route.fulfill({ json: { lat: 44.43, lng: 26.11, label: "Al doilea punct" } }),
  );
  await page.route("**/api/isochrone**", (route) => route.fulfill({ json: ISOCHRONE }));
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));

  await page.goto("/");
  const map = page.getByTestId("app-map");
  const toast = page.getByTestId("hold-toast");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  // The page really cannot reach storage.
  expect(
    await page.evaluate(() => {
      try {
        void window.localStorage;
        return "reachable";
      } catch {
        return "blocked";
      }
    }),
  ).toBe("blocked");
  await search(page, "Piata Unirii");
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCount(0, { timeout: 6_000 });

  // A second place in the same page brings no second hint.
  const second = await besidePin(page);
  await page.touchscreen.tap(second.x, second.y);
  await expect(map).toHaveAttribute("data-selection", "Al doilea punct");
  await page.waitForTimeout(1_000);
  expect(await toast.count()).toBe(0);
  expect(errors).toEqual([]);
});

// The ⓘ popover opens over the spot where the hint shows. When the first place
// resolves with the popover open (here: a failed search, ⓘ opened, then ↻), the hint
// waits: it is not drawn, not marked seen and its clock does not run, however long
// the popover stays open. Closing the popover shows it, for its full time.
test("the hold hint waits while the info popover is open", async ({ page }) => {
  let reachFails = true;
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/isochrone**", (route) =>
    reachFails ? route.fulfill({ status: 502, json: { error: "upstream" } }) : route.fulfill({ json: ISOCHRONE }),
  );
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));

  await page.goto("/");
  const map = page.getByTestId("app-map");
  const toast = page.getByTestId("hold-toast");
  const seen = () => page.evaluate(() => window.localStorage.getItem("hf:hold-hint:v1"));
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await search(page, "Piata Unirii");
  await expect(page.getByTestId("error-banner")).toContainText("Nu am putut calcula zona pe jos.");

  await openInfo(page);
  reachFails = false;
  await page.getByTestId("banner-retry").click();
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  // The status line is set in the same render as the hint, so once it reads the
  // resolved place, the hint has been decided.
  await expect(page.getByTestId("status-announcer")).toHaveText("Piața Unirii, București: circa 10 minute pe jos");
  await expect(page.getByTestId("info-popover")).toBeVisible();
  // Checked once each, without retrying.
  expect(await toast.count()).toBe(0);
  expect(await seen()).toBeNull();

  // Longer than the hint's own time (4 s): still waiting, still not marked seen.
  await page.waitForTimeout(4_500);
  await expect(page.getByTestId("info-popover")).toBeVisible();
  expect(await toast.count()).toBe(0);
  expect(await seen()).toBeNull();

  // The popover closes: now the hint shows, is marked seen, and hides on its own clock.
  await page.getByTestId("info-button").click();
  await expect(page.getByTestId("info-popover")).toHaveCount(0);
  await expect(toast).toBeVisible();
  expect(await seen()).toBe("1");
  await expect(toast).toHaveCount(0, { timeout: 6_000 });
});

// While a reach loads, the origin pin is already on the map and pulses, with no text
// card; once the reach is drawn the pin rests. The screen-reader status line follows
// the same states.
test("the pin pulses while the reach loads", async ({ page }) => {
  let releaseReach: () => void = () => {};
  const reachHeld = new Promise<void>((resolve) => {
    releaseReach = resolve;
  });
  await page.route("**/api/suggest**", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/geocode**", (route) =>
    route.fulfill({ json: { lat: 44.4268, lng: 26.1025, label: "Piața Unirii, București" } }),
  );
  await page.route("**/api/isochrone**", async (route) => {
    await reachHeld;
    await route.fulfill({ json: ISOCHRONE });
  });
  await page.route("**/api/amenities**", (route) => route.fulfill({ json: AMENITIES }));

  await page.goto("/");
  const map = page.getByTestId("app-map");
  const shell = page.locator(".hf-map-shell");
  const status = page.getByTestId("status-announcer");
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });
  await expect(status).toHaveText("");
  await search(page, "Piata Unirii");

  // Loading: the pin is up and its aura pulses; no card says so.
  await expect(shell).toHaveAttribute("data-sel-status", "loading");
  const aura = page.locator(".hf-origin-marker__aura");
  await expect(page.locator(".hf-origin-marker")).toBeVisible();
  const auraAnimation = () => aura.evaluate((element) => getComputedStyle(element).animationName);
  expect(await auraAnimation()).toBe("hf-pulse");
  await expect(page.getByTestId("result-sheet")).toHaveCount(0);
  await expect(status).toHaveText("Calculez zona…");

  // Resolved: the reach is drawn and the same pin rests.
  releaseReach();
  await expect(map).toHaveAttribute("data-selection", "Piața Unirii, București");
  await expect(shell).toHaveAttribute("data-sel-status", "idle");
  await expect(page.locator(".hf-origin-marker")).toHaveCount(1);
  await expect.poll(auraAnimation).toBe("none");
  await expect(status).toHaveText("Piața Unirii, București: circa 10 minute pe jos");
});
