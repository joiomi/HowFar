# Architecture

HowFar is a single Next.js (App Router) app: the map UI, the API routes and the data-provider
clients live in one repo, backed by PostgreSQL/PostGIS, plus an amenity importer
(`npm run amenities:refresh`) that uses the same code. There is no deployment. The app runs
locally with `npm run dev` (public data providers) or `npm run dev:selfhost` (local Nominatim,
Photon and OpenRouteService engines; see `docs/SELFHOST.md`). Two rules shape everything:

1. **No external data call from the browser.** Every provider request runs server-side, is
   rate-limited per provider (bucket `provider@host`), and is cached in PostgreSQL where
   appropriate; the browser talks to `/api/*` for all data. The only provider secret is the
   OpenRouteService key, which only the public ORS host needs. One exception: the basemap's font
   glyphs and sprite are keyless static files fetched from `protomaps.github.io`
   (`features/map/map-setup.ts`); self-hosting them is an open item (see `docs/PROVIDERS.md`).
2. **The core flow must survive degradation.** A dead cache degrades to uncached (slower, still
   correct); a dead provider degrades to a clear 502; a dead database keeps `/api/health` alive
   while `/api/ready` reports 503.

## The reach model

The UI is phone-first and **preset-only**. Each mode offers two calibrated presets: walk 10/20,
transit 20/40 and car 10/25 minutes (`features/isochrones/preset-reach.ts`). The client always
requests the reach routes with `?model=preset` (`isochroneUrl` in `features/map/selection-flow.ts`).
Each response carries both contours of the mode, so switching between the two presets
repaints without a refetch. Walk also takes a pace (Slow 3 km/h, Normal 5 km/h; the mode pill's
turtle toggle, pressed = Slow); transit and car take a departure context (`crowded` = weekday
rush, shown as 8:30, the default; `quiet` = weekday midday, shown as 12:30; the mode pill's clock
toggle flips between them).

When `?model` is absent, the same routes serve the older fixed-band model (walk/transit 15/30/45,
car 10/20/30). The UI never requests it; it stays only because the amenity clip depends on it, and
it is **parked** (see [Parked code](#parked-code)). Any other `?model` value is a 400.

## Request flow

```
address text ──► /api/suggest ──► Photon                (type-ahead)
     │
     ▼
/api/geocode ──► Nominatim                              (search submit)
map click   ──► /api/reverse ──► Nominatim              (label only; the click IS the origin)
     │
     ▼  every reach request carries ?model=preset
/api/isochrone ──► ORS foot-walking                     walk 10/20
/api/transit   ──► Transitous one-to-all ──► transit-grid, ∪ ORS walk reach   transit 20/40
/api/car       ──► ORS driving-car, ranges ÷ time-of-day congestion factor    car 10/25
     │
     ▼
selection-render paints the selected preset: decorative light→dark shells plus the
calibrated contour lines (preset-view.ts), and the origin marker

right-click / long-press ──► /api/reach ──► Transitous /plan ──► directions in the result
                                                                  sheet + journey on the map
/api/tiles ──► self-served PMTiles basemap (HTTP Range)
```

Each provider route follows the same skeleton: parse/validate input (`lib/api-util.ts`) →
geofence to the launch area (`lib/bounds.ts`, 422 outside) → call the provider client → map
errors (`errorResponse`, which logs the cause and returns a generic 502/500).

## Module map

Source is organised feature-first: each folder under `src/features/` is one product concern,
holding its client logic at the feature root and its server-only modules (provider clients and
anything touching secrets, Prisma or node builtins) in a `server/` subfolder. `src/lib/` keeps
only shared platform plumbing.

**Import rule:** client components and client-side modules may import feature *root* modules and
the client-safe lib pair (`bounds`, `timeout`), never anything under a `server/` folder or the
rest of `lib/` (db, env, api-cache, api-util, health, provider-http, byte-range), which exist for
API routes and server code only.

Rows marked **(parked)** are kept but not live; see [Parked code](#parked-code).

| Path | Role |
| --- | --- |
| `src/app/api/*/route.ts` | Thin HTTP glue: status codes only, no business logic |
| `src/app/api/tiles/route.ts` | Serves the self-hosted PMTiles basemap with HTTP Range semantics |
| `src/features/map/AppMap.tsx` | Client shell: holds render state, creates the controllers below in dependency order, wires the map event handlers, renders the shell. No business logic of its own. Still constructs and wires the parked amenity controllers |
| `src/features/map/{camera,hover,popup,route-path,select-flow,clear-address,info,reach-directions,reach-journey}-controller.ts`, `selection-render.ts` | Single-responsibility controllers, each `create*(...) → { …methods, dispose }`. One shared `load-state.ts` cell carries style-load readiness and the pre-`load` replay buffers; teardown disposes them in reverse create order, then removes the map last (`teardown.ts`). `selection-render` paints the preset reach and the origin marker. `reach-directions-controller` owns the right-click state machine and the `/api/reach` fetch (generation, abort, deadline), drives `reach-journey-controller` (trip and destination pin in one `reach-path` source), and renders into the result-sheet dock (`ReachPanel`), replacing the selection card while active. The directions and the map popup are mutually exclusive surfaces; each closes the other through injected callbacks. `clear-address-controller` is the address bar's ✕ (back to first open, keeping mode, pace and time) plus the origin tracker that tells a new place from a recompute; pure over injected callbacks and unit-tested. `info-controller` holds the ⓘ popover's open/close rules: the first-load opening (once; deferred until the address field loses focus if it has focus then; left alone if the user already opened it), its 5 s timed close, which any user open or close cancels, and the closes on address-field focus, a map tap and a camera move the user starts; pure over a callback, a focus probe and timers, unit-tested with fake timers |
| `src/features/map/{ring-reveal,amenities,amenity-cluster,amenity-spider}-controller.ts`, `AmenityPanel.tsx`, `ModeToggle.tsx`, `RingSelector.tsx` | **(parked)** Legacy ring reveal and the amenity UI, plus the old mode toggle and ring selector (nothing in the live shell imports `ModeToggle.tsx` or `RingSelector.tsx`) |
| `src/features/map/{route-framing,long-press,marker-pick,query-features,cluster-expand,shell-state,camera}.ts` | Pure or near-pure helpers pulled out of the controllers: route-fit corridor math, the touch long-press recognizer (iOS never fires `contextmenu`), marker hit targets, a guarded `queryRenderedFeatures`, cluster expansion, the mobile shell state, the shared camera padding (unit-tested) |
| `src/features/map/map-runtime.ts` | Holder for the dynamically imported `maplibre-gl` module. MapLibre and pmtiles load after the `hf:interactive` mark, so the controllers use `import type` plus this accessor |
| `src/features/map/selection-flow.ts` | Selection state machine (token staleness, mode snapshot, failure mapping) and the reach request URL (`isochroneUrl`); owns the `Mode`/`Ring`/`Origin` types |
| `src/features/map/map-setup.ts` | Pure basemap style plus source/layer specs (unit-tested) |
| `src/features/map/reach.ts` | Pure right-click helpers: point-in-ring banding and MOTIS trip → display steps |
| `src/features/map/{TopBar,SuggestList,ModePill,InfoControl,SelectionCard,ReachPanel,EmptyState,MapPlaceholder,TransitousCredit}.tsx`, `icons.tsx`, `copy.ts`, `credits.ts` | Presentation leaves of the phone-first shell. `TopBar` is the address bar (search combobox, suggestions, clear); `ModePill` is the floating mode pill (three modes, the mode's two presets, and the turtle pace toggle or the departure clock); `InfoControl` is the ⓘ button and popover in every map state: the mode's caveat, the transit note, and the data credits (MapLibre's attribution control is off; the popover opens by itself for 5 s on the first map load, see `info-controller`; open, it sits above every other floating control); `SelectionCard` is the place's label, legend and explainer; `TransitousCredit` is the "© Transitous" link shown on transit states; `icons.tsx` is the shared 24px stroke icon set; `copy.ts` holds Romanian strings used in more than one place, including the popover's copy (`infoContent`); `credits.ts` is the one list of credit links, shared by the popover and the map style's attribution |
| `src/features/search/combobox.ts`, `search-suggest-controller.ts` | Autocomplete state machine (generation staleness, keyboard nav); debounce plus fetch/abort glue |
| `src/features/search/server/{nominatim,photon}.ts` | Geocode/reverse and type-ahead provider clients |
| `src/features/isochrones/preset-reach.ts` | Calibrated preset minutes, the pure range generator, and the strict `?model` parser |
| `src/features/isochrones/preset-view.ts` | Pure preset render model: per-mode gradient shells (decorative) and the calibrated contour lines (the actual claim) |
| `src/features/isochrones/pace.ts` | Walking-pace model and the 80 m/min calibration anchor |
| `src/features/isochrones/time-context.ts` | Transit/car departure context (the two presets, their clock text and accessible names), shared by the mode pill's clock and the routes |
| `src/features/isochrones/car-traffic.ts` | Pure Bucharest traffic model: time of day → congestion factor; `CAR_FACTOR_REVISION` feeds the car cache key |
| `src/features/isochrones/server/{ors,transit}.ts` | Walking/car (ORS) and transit (Transitous one-to-all) reach clients, each with a preset entry point and a parked legacy one |
| `src/features/isochrones/server/transit-grid.ts` | Pure geometry: reachability grid, marching-squares contours, and the walk-reach union (`unionRings`) |
| `src/features/isochrones/server/transit-plan.ts`, `transit-classify.ts`, `polyline.ts` | Right-click trip planning via MOTIS `/plan`; "has a transit leg" classification; precision-7 polyline decoding |
| `src/features/isochrones/{bands,isochrone-view}.ts` | Fixed-band primitives and the three-band colour ramp. The ramp is **(parked)**; `bands.ts` also feeds the amenity clip |
| `src/features/isochrones/calibration-acceptance.ts` | Pure acceptance and coverage policy for the calibration scripts in `scripts/calibrate/` |
| `src/features/amenities/amenities.ts` | Shared category config/classifier for the importer, the API DTOs and the UI |
| `src/features/amenities/{amenity-selection,amenities-flow,amenity-cluster,amenity-spider,amenity-icons,stop-lines,stop-popup,route-path}.ts` | Client-side amenity, transit-stop and line-path models for the parked amenity UI |
| `src/features/amenities/server/catalogue.ts` | The amenity clip behind `/api/amenities`: the selected mode's reach (legacy path) ∩ the active PostGIS snapshot, banded |
| `src/features/amenities/server/catalogue-{import,normalize,store,query,status,export,region}.ts` | Weekly ingestion and quality checks, immutable publication, spatial reads, the status/export surfaces and the region cross-check |
| `src/features/amenities/server/{bulk-overpass,overpass-client,stop-lines,route-path,merge-transit-stops}.ts` | Importer-only Overpass snapshot transport; interactive Overpass for stop lines and route paths; read-time fusion of coincident stop markers |
| `src/features/amenities/server/warmup.ts`, `src/instrumentation.ts` | Process-start warmup of the ORS engine and the catalogue (`HOWFAR_DISABLE_WARMUP` turns it off) |
| `src/features/auth/**`, `src/auth.ts` | **(parked)** Auth.js wiring and the sign-in control; decisions live in `auth-view.ts` / `auth-config.ts` |
| `src/lib/provider-http.ts` | Shared provider plumbing: per-provider (`provider@host`) rate limiter, abortable timeout, `ProviderError`, cache-key helpers |
| `src/lib/api-cache.ts` | PostgreSQL-backed provider cache; strict accessors plus best-effort `*Safe` variants; `deleteExpired` (run by `npm run reap:cache`) |
| `src/lib/api-util.ts` | Route helpers: param parsing, geofence guard, error → status mapping |
| `src/lib/env.ts` | Env validation and the provider config (`*_BASE_URL`, rate intervals, the cache-key config tag) |
| `src/lib/{db,health,timeout,bounds,byte-range,dev-origins}.ts` | Prisma pool, DB probe, deadline helper, launch bbox, Range parsing, LAN dev origins |
| `scripts/` | Amenity importer, tile fetch, cache reaper, credential scan, calibration campaigns and receipts (`calibrate/`), perf harness (`perf/`) |
| `docker/selfhost/` | Self-host provider stack, `dev:selfhost` scripts, parity harness, run manifest |
| `e2e/` | Playwright specs against the production build (desktop Chromium and a Pixel 7 project; see Testing) |

**Deliberate cross-feature edges** (documented so nobody "fixes" them): amenities → isochrones
(`server/catalogue.ts` calls the mode's legacy reach client in `server/ors.ts` or
`server/transit.ts` for the "inside the reach area" geometry, and shares the pure band
primitives in `bands.ts`); isochrones → map (`isochrone-view.ts` and `preset-view.ts` import the
`Mode`/`Ring`/`Origin` types from `selection-flow.ts`, type-only); every feature → `lib/`.
`features/map` is the **composition root**: it may import any feature's root modules (and does:
combobox, preset-reach, preset-view, isochrone-view, pace, time-context, the amenity modules),
which makes map ↔ isochrones look bidirectional. The cycle is type-only and would dissolve if
those types moved to a `features/isochrones/types.ts`.

## The provider-client template

The interactive clients (nominatim, photon, ors, transit and the stop/route Overpass clients,
plus the tiles route's Range serving as a degenerate case) share one shape. Read
`src/features/isochrones/server/ors.ts` once and the rest follow:

1. A constants block: `TIMEOUT_MS` and cache TTL live in code, next to the client. The
   endpoint/host and the rate-limit interval come from config: `providerConfig()` in
   `src/lib/env.ts` (`*_BASE_URL` / pools and `*_MIN_INTERVAL_MS`, each defaulting to the public
   provider). The client passes `provider` + `new URL(base).host` + the configured interval to
   `providerFetch`, whose bucket is keyed `provider@host` (so providers behind one self-hosted
   domain don't serialize together; interval `0` disables the throttle).
2. Typed interfaces for the provider's raw response (only the fields we read).
3. A pure `normalize` function that defensively validates every field it touches: coordinates
   coerced to finite numbers, geometry shape checked, out-of-area rows dropped. Garbage from a
   provider must become a 502 here, never a client-side MapLibre error.
4. Cache-first flow: `getCachedSafe` → `providerFetch` (rate-limited, timed, identifying
   `User-Agent`) → `normalize` → `setCachedSafe`. Keys go through `taggedCacheKey`, which
   prefixes a provider-config tag so a different provider setup (or a bumped
   `PROVIDER_DATA_REVISION`) never reads another setup's rows.
5. Every failure wrapped in `ProviderError` (bad status, timeout, garbled body) so routes can map
   it to 502; anything else is a genuine 500.

### Adding a provider (checklist)

Copy this for every new data source (air quality, reviews, …):

- [ ] Placement rule: the client lives WITH the feature it serves —
      `src/features/<feature>/server/<name>.ts` (create the feature folder if
      the data source starts a new concern; never a shared providers/ folder).
      Follow the five points above; cache key `"<domain>:<discriminator>"`
      (hash free-text with `sha256Hex`, round coordinates with `roundCoord` so
      key, request and rendered origin agree).
- [ ] Colocated `<name>.test.ts`: happy-path normalize, malformed/garbled body
      → `ProviderError`, non-ok status → `ProviderError`, network failure
      wrapped, cache hit issues zero fetches, provider-specific edge rows
      dropped. Mock `@/lib/api-cache` and `providerFetch` (see any existing
      provider test); use `beforeEach(() => { mock.mockReset(); })` — braces
      matter, a function returned from `beforeEach` runs as a teardown.
- [ ] `src/app/api/<name>/route.ts` using `parseLatLng` / `outOfAreaGuard` /
      `errorResponse(err, "<name>")`, plus a colocated `route.test.ts` pinning
      the full status table below, including the 502 log line.
- [ ] e2e: stub **the exact route** (`page.route("**/api/<name>**", …)`) —
      never a blanket `**/api/**`, which would also intercept the map's tile
      requests and break rendering.
- [ ] ToS: identifying `User-Agent` (`USER_AGENT` in `lib/provider-http.ts`),
      visible attribution in the UI if required, quotas noted in
      `docs/PROVIDERS.md`.

### API status contract

| Status | Meaning | Where |
| --- | --- | --- |
| 400 | missing/blank/non-numeric/out-of-range params, unknown `model`/`pace`/`mode`/time preset | `parseLatLng`, per-route query checks |
| 404 | provider answered, nothing found | route (`null` result) |
| 422 | valid point outside the Bucharest launch area | `outOfAreaGuard` |
| 502 | upstream provider failed (status/timeout/garbage) | `errorResponse` on `ProviderError` |
| 500 | anything else | `errorResponse` fallback |
| 200 + empty | legitimate empty (e.g. suggest under 3 chars) | route |

Errors are logged server-side as `[api:<route>] <name>: <message>`: one line, no stacks, no
upstream payloads. The response body stays generic.

## Testing

- **Unit (Vitest, `src/**/*.test.ts`)**: colocated with the module they pin; each test names the
  invariant it protects. Pure logic is extracted from components precisely so it can be tested
  here. Property-based tests (fast-check) cover algebraic contracts (`byte-range`, `bounds`).
- **DB integration (`npm run test:db`)**: runs against a real PostGIS: PostGIS presence, model
  round trips, the cache reaper, the catalogue store and import.
- **e2e (Playwright, `e2e/`)**: runs against the production build (`next start` on port 3799,
  reused locally if already running, so rebuild and free the port before a run) with a real PostGIS
  and the real tile archive; provider routes are stubbed per endpoint. This suite owns the
  rendering/wiring glue that unit tests exclude. Specs synchronise on `data-*` read-back stamps
  the map writes rather than fixed sleeps: `data-map-loaded`, `data-selection`,
  `data-selected-preset`, `data-preset-contours`, `data-camera-settled` (stamped when the selection
  flyTo settles; cleared while a new selection is in flight) and `data-reach-state` /
  `data-reach-journey` for directions. Wait for the stamp, then project.
- **Coverage**: `npm run test:coverage` includes *all* of `src/`, so a file with no tests reports
  0% instead of disappearing; deliberate exclusions are listed with reasons in `vitest.config.ts`.
  Thresholds gate CI.
- Local loop: `npm run check` (credential scan, lint, typecheck, unit and the self-tests);
  `npm run check:ci` adds coverage, the production build and the perf budget.

## Load-bearing invariants

- Coordinates: ORS wants `[lng, lat]`; Nominatim returns lat/lon as *strings*; Photon and
  Nominatim use different bbox parameter orders. Each quirk is commented at its call site.
- Reach minutes mean real travel minutes, not provider-nominal values:
  - Walk: ORS `range` seconds are calibrated at an 80 m/min *calibration anchor* (a measuring
    ruler, not a walking speed) and rescaled per pace. Presets use `WALK_PRESET_RANGES_S_AT_80`
    in `preset-reach.ts` (10/20, plus 40 used only for the transit walk union); the parked bands
    use `CALIBRATED_RANGES_S_AT_80` in `pace.ts`.
  - Car: nominal free-flow minutes, shrunk by the departure's congestion factor (`car-traffic.ts`).
  - Transit: contour thresholds of one transit travel-time field; egress walking runs at a
    measured, detour-deflated speed (`STREET_DETOUR` in `pace.ts`).
  - Methodology and numbers: `docs/PROVIDERS.md`; receipts: `scripts/calibrate/receipts/`. Do not
    change a calibrated number without re-running the calibration.
  - Known limitation: walk reach can overstate near river or rail barriers, and transit reach at
    the city's edges. The info popover says so (honesty copy in `preset-view.ts`).
- Contours nest by construction: transit thresholds are cut from one monotonic field
  (`transit-grid.ts`; the preset path cuts 20/40 from the same 45-minute field). The only union is
  the per-threshold merge with the street-routed walk reach (`unionRings`), all-or-nothing with a
  superset check. The preset transit path **fails closed**: if the walk reach is unavailable, slow
  or cannot be merged, the response is a 502 with no cache write. (The parked legacy path instead
  rebuilds the whole family around a radial origin stamp.)
- The preset walk set [10,20,40] is fetched once per origin and pace under one cache key and
  sliced per consumer: `/api/isochrone` returns only the 10/20 chips (40 never leaves as a labelled
  walk reach), and the transit union takes 20/40. One fetch avoids two range sets colliding on one
  key.
- Cache keys are versioned, and the legacy and preset paths use separate namespaces
  (`iso:foot:v4`, `iso:car:v2`, `transit:v5` vs `iso:foot:preset:v1`, `iso:car:preset:v1`,
  `transit:preset:v1`), so reach built under an older calibration, speed or factor revision is
  never served.
- Transit/car time context is a two-option choice, `crowded` (weekday rush at 8:30, the default)
  or `quiet` (weekday midday at 12:30), pinned to a representative upcoming instant so reach is
  comparable and cacheable (`representativeDeparture`). The response's `departure` field carries
  that instant so the UI can qualify the claim. `weekday`/`time` params are rejected with a 400.
- Negative geocode results are cached under a sentinel, so repeat misses cost zero upstream calls.
- The tile route caps Range slices (DoS guard) and never buffers the whole archive. The map's
  `maxBounds`, the geofence and the tile extract share one bbox, `NEXT_PUBLIC_MAP_BBOX`
  (`lib/bounds.ts`, `scripts/fetch-tiles.sh`; defaults to Bucharest + Ilfov).

## Parked code

"Parked" means kept on purpose but **not part of the live product**: the current UI does not use
it (auth is the one visible piece, and signing in does nothing yet). It stays until the planned
amenity pass (the amenity redesign) removes or replaces it, or, for auth and `SavedSearch`, until a
decision on accounts. Do not build on it, and do not remove it piecemeal outside that pass.

- **The legacy 15/30/45 serving path.** `walkingIsochrone`, `drivingIsochrone` (`server/ors.ts`)
  and `transitIsochrone` (`server/transit.ts`), served by `/api/isochrone`, `/api/transit` and
  `/api/car` when `?model` is absent (car labels 10/20/30). The UI never sends that request. Kept
  because the amenity clip in `amenities/server/catalogue.ts` still computes its reach area
  through these functions. Three other callers: the process-start warmup (`warmup.ts`) primes ORS
  through `walkingIsochrone`/`drivingIsochrone`, the perf API harness (`scripts/perf`) requests
  the routes without `?model`, and so does the self-host parity check
  (`docker/selfhost/parity-check.mjs`, `/api/isochrone` and `/api/car`).
- **Legacy client pieces.** `ModeToggle` (the component and its icon/label constants),
  `RingSelector`, `ring-reveal-controller` (still constructed by `AppMap`, but drives band layers
  that stay empty), and the three-band ramp in `isochrone-view.ts`. Replaced by the mode pill and
  the preset render; kept for the amenity pass.
- **The amenity UI.** `AmenityPanel` and the cluster, spider and amenities controllers, with their
  wiring in `AppMap`. The controllers are constructed but dormant: the preset UI runs no amenity
  fetch, so no markers are drawn. The server side (`/api/amenities`, the importer, the catalogue
  status and export) still works. The transit-stop popups and line paths (`popup-controller`,
  `route-path-controller`, `/api/stop-lines`, `/api/route-path`) are not parked themselves, but
  they open only from amenity markers, so they are unreachable in the current UI.
- **Quarantined e2e specs.** `amenities`, `amenity-legibility`, `ring-filter` and `stop-lines`
  are skipped whole, and individual tests in `reach-journey`, `ui-mobile` and `ui-redesign` are
  skipped. All are kept as-is apart from comments so the amenity pass can re-enable them.
- **Auth and `SavedSearch`.** Auth.js with optional Google/GitHub sign-in and the `SavedSearch`
  table. The page renders no sign-in control (`AuthControl` is kept but not mounted); the
  `/api/auth` routes still serve. Signing in unlocks nothing yet, and no code reads or writes
  `SavedSearch`. Kept until a decision on accounts.
