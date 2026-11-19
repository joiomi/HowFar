import { expect, test } from "@playwright/test";
import { expectBasemapCredits, openInfo } from "./shell";

// Prod-shaped smoke: requires `npm run build` beforehand and the PostGIS
// container up + migrated (docker compose up -d db; prisma migrate deploy).

test("liveness and readiness report a connected database", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true, db: true });

  const ready = await request.get("/api/ready");
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ ready: true });
});

test("auth endpoint serves without OAuth credentials configured", async ({ request }) => {
  const providers = await request.get("/api/auth/providers");
  expect(providers.status()).toBe(200);
});

test("tile route serves the pmtiles archive via byte ranges", async ({ request }) => {
  const response = await request.get("/api/tiles", { headers: { Range: "bytes=0-127" } });
  expect(response.status()).toBe(206);
  expect(response.headers()["content-range"]).toMatch(/^bytes 0-127\/\d+$/);
  expect(response.headers()["etag"]).toMatch(/^".+"$/); // cache validator present
  const body = await response.body();
  expect(body.length).toBe(128);
  expect(body.subarray(0, 7).toString("ascii")).toBe("PMTiles");

  const overCap = await request.get("/api/tiles", { headers: { Range: "bytes=0-" } });
  expect(overCap.status()).toBe(416); // whole-archive range exceeds the DoS cap
});

test("tile route answers HEAD and rejects malformed ranges", async ({ request }) => {
  const head = await request.fetch("/api/tiles", { method: "HEAD" });
  expect(head.status()).toBe(200);
  expect(head.headers()["accept-ranges"]).toBe("bytes");
  expect(Number(head.headers()["content-length"])).toBeGreaterThan(0);

  const malformed = await request.get("/api/tiles", { headers: { Range: "bytes=abc" } });
  expect(malformed.status()).toBe(416);
  expect(malformed.headers()["content-range"]).toMatch(/^bytes \*\/\d+$/); // RFC 9110 unsatisfied-range form
});

test("landing page renders the map shell and finishes loading tiles", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "HowFar" })).toHaveCount(1);

  const map = page.getByTestId("app-map");
  await expect(map).toBeVisible();

  // MapLibre `load` fired = style parsed + self-hosted pmtiles served via /api/tiles.
  await expect(map).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });

  // Attribution is a licence requirement, and MapLibre's own attribution control is
  // off: the ⓘ popover carries the credits, and it opens by itself when the map first
  // loads, so they are on screen with no tap. OSM (ODbL); ESA WorldCover landcover
  // credited with its licence name + link and a "modificat" (modified) indication
  // (CC BY 4.0, distributed via Daylight — the tiles bundle it); Natural Earth
  // (public-domain, shown deliberately). The opened-by-itself popover closes after 5 s,
  // so it gets one quick look: open, with the credits in order.
  const popover = page.getByTestId("info-popover");
  await expect(popover).toBeVisible();
  // The "modificat" indication must sit ON the ESA credit, between ESA WorldCover /
  // CC BY 4.0 and Daylight — not just anywhere in the popover (which a rewrite could
  // satisfy while stripping it off the ESA credit).
  await expect(popover).toContainText(/ESA WorldCover.*CC BY 4\.0.*modificat.*Daylight/);
  await expect(page.locator(".maplibregl-ctrl-attrib")).toHaveCount(0);
  // It then closes by itself; the ⓘ button keeps the credits one tap away.
  await expect(popover).toBeHidden({ timeout: 8_000 });
  // The link checks poll, and could outlast that timer under load, so they run on a
  // popover the user opened, which stays open. Each credit must be a real link with the
  // right name↔href pairing, not plain text, and nothing may sit on top of it — the
  // DOM-level counterpart of the unit tests.
  const opened = await openInfo(page);
  await expect(opened).toContainText(/ESA WorldCover.*CC BY 4\.0.*modificat.*Daylight/);
  await expectBasemapCredits(opened);

  // The zoom buttons are hidden below 768 px (pinch zooms there); on a desktop they stay.
  await expect(page.getByRole("button", { name: "Mărește" })).toBeVisible();

  await expect(page.locator("html")).toHaveAttribute("lang", "ro");
  await expect(page).toHaveTitle("HowFar — până unde ajungi în București");

  // MapLibre reports tile/source failures via console.error — a "loaded" map
  // that errored on sources must fail here, not pass silently.
  expect(consoleErrors).toEqual([]);

  await page.screenshot({ path: "e2e/artifacts/landing.png", fullPage: true });
});

test("landing page shows no sign-in control", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.goto("/");
  await expect(page.getByTestId("app-map")).toHaveAttribute("data-map-loaded", "true", { timeout: 30_000 });

  // Auth is parked: the page mounts neither sign-in form (a provider button when
  // OAuth env is configured, the "unavailable" note when it is not). The auth
  // route itself stays covered by the /api/auth/providers check above.
  await expect(page.locator("text=/Sign in with|Sign-in unavailable/")).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});
