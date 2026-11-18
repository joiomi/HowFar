# HowFar — Neighborhood Livability Explorer

Pick a Bucharest address (search for it, or tap the map) and HowFar shows how far you can get from
there: **walking 10 or 20 minutes, public transport 20 or 40 minutes, or driving 10 or 25 minutes**.
The reach areas are computed server-side from free, public data, and calibrated and checked
against measured travel times. Once a place is selected, right-click (long-press on touch) any
point for a public-transport trip to it. Air quality and a livability score are planned, not
built.

> **Status: runs locally only — there is no deployment.** Run it with `npm run dev` against the
> public data providers, or with `npm run dev:selfhost` against the local self-host provider stack
> ([`docs/SELFHOST.md`](docs/SELFHOST.md)). The nearby-amenities UI is hidden in the current
> phone-first UI and parked until the amenity redesign (see
> [Parked code](docs/ARCHITECTURE.md#parked-code)).
>
> Docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (code tour, parked code, provider checklist) ·
> [`docs/PROVIDERS.md`](docs/PROVIDERS.md) (data-provider decisions and calibration) ·
> [`docs/SELFHOST.md`](docs/SELFHOST.md) (self-host provider stack).

## Stack

TypeScript (strict) · Next.js 16 (App Router, one full-stack repo) · React 19 · Tailwind CSS 4 ·
MapLibre GL + self-served [Protomaps](https://protomaps.com) tiles · PostgreSQL 17/PostGIS 3.5 +
Prisma 7 · Auth.js v5 (parked; not shown in the UI) · Vitest + Playwright

Data sources, all called server-side: Nominatim (geocoding) · Photon (type-ahead) ·
OpenRouteService (walking and driving reach, and the walking part of transit reach) ·
[Transitous](https://transitous.org) / MOTIS (public-transport reach and trip planning) ·
Overpass (the OSM amenity snapshot that `npm run amenities:refresh` imports into PostGIS, and
transit stop/route lookups). Basemap tiles come from a 25 MB Bucharest extract that the app serves
itself. The browser holds no API keys and calls no data provider; its only external requests are
the basemap's keyless font glyphs and sprite from `protomaps.github.io`.

## Local development

Requirements: Node 24.x (`.nvmrc`), Docker.

```bash
nvm use                     # Node 24.x (see .nvmrc)
npm ci                      # also runs prisma generate
docker compose up -d db     # PostgreSQL 17 + PostGIS 3.5 on localhost:5433
cp .env.example .env        # fill AUTH_SECRET (npx auth secret); defaults fit the compose DB
npx prisma migrate deploy   # create tables
npm run amenities:refresh -- --snapshot scripts/amenities/fixtures/catalogue-overpass.json # optional fixture seed
npm run tiles:fetch         # one-time ~25MB Bucharest basemap extract
npm run dev                 # http://localhost:3000
```

Reach in every mode needs OpenRouteService (the public-transport reach includes a walking union
and fails closed without it), so against the public ORS host set `ORS_API_KEY` in `.env`. To run
against local engines instead, do the one-time setup in [`docs/SELFHOST.md`](docs/SELFHOST.md),
then use `npm run dev:selfhost`.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server / production build / serve the build |
| `npm run dev:selfhost` · `dev:selfhost:down` | Start the self-host provider stack and run the app against it · stop the stack |
| `npm run check` | Credential scan, lint, typecheck, unit suite, perf-classifier and self-host self-tests — the local loop |
| `npm run check:ci` | Credential scan, lint, typecheck, unit suite with coverage thresholds, production build, enforced perf budget, self-host self-tests (no e2e) |
| `npm run lint` · `npm run typecheck` | ESLint · `tsc --noEmit` |
| `npm test` · `npm run test:coverage` | Vitest unit suite · same with enforced coverage thresholds |
| `npm run test:db` | PostGIS integration tests (needs the compose DB) |
| `npm run test:e2e` | Playwright e2e against the production build (run `npm run build` first; needs the DB) |
| `npm run tiles:fetch [YYYYMMDD]` | (Re)fetch the Bucharest basemap extract |
| `npm run amenities:refresh` | Fetch, validate and atomically publish the Bucharest OSM amenity catalogue |
| `npm run reap:cache` | Delete expired provider-cache rows |
| `npm run security:google-keys` | Value-safe credential scan of the working tree, Git index and full history |
| `npm run perf:budget` | Enforced initial-JS budget: rebuilds, serves a plain `next start` on :3010 (`PERF_BUDGET_PORT` to change), asserts — see [Performance budgets](#performance-budgets) |
| `npm run perf:budget:test` | Unit tests for the bundle classifier (zero deps) |
| `npm run perf:lighthouse` · `npm run perf:shell` | Lighthouse mobile score/TTI · shell-interactive and map-visible timings (need `scripts/perf` deps and a running server) |
| `npm run selfhost:harness-selftest` · `selfhost:script-check` | Hermetic self-tests of the self-host parity harness and the `dev:selfhost` scripts |

### Secret safety

Keep real credentials only in ignored `.env` files. Google credentials must remain server-side and
must never use a `NEXT_PUBLIC_` name. The repository ships a pre-commit credential scanner; enable
it in a clone with `git config core.hooksPath .githooks`. CI repeats the scan against the complete
Git history.

### Health endpoints

- `GET /api/health` — liveness: always 200, reports `{ ok, db }` (DB probe bounded at 2 s).
- `GET /api/ready` — readiness: 200 when PostgreSQL, PostGIS and the migration history are
  available, the provider/region configuration parses, and any active amenity catalogue matches
  the configured map extent. A missing catalogue does not fail readiness (that is
  `/api/catalogue-status`'s concern); a present catalogue whose region mismatches or cannot be
  verified does (datasets that predate region recording are accepted only under the default
  extent). Not checked here: with the public ORS host and `ORS_API_KEY` unset, readiness passes
  and every reach request returns 502.
- `GET /api/catalogue-status` — 200 for a fresh active amenity snapshot; 503 if missing, stale
  (>10 days), unavailable, or built for a different region than the configured map extent (then
  the body carries `reason: "region-mismatch"` and the dataset fields are suppressed).
- `GET /api/catalogue-export?limit=500&after=…` — paginated GeoJSON export of only the
  OSM-derived catalogue.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and on pull requests, in two jobs:

- **checks:** credential scan (files and full history) → lint → typecheck → unit suite with
  coverage thresholds (lines 95 / branches 93 / functions 92 / statements 95) → production build →
  perf-classifier tests and the enforced perf budget → self-host harness and script self-tests.
- **e2e:** a PostGIS 3.5 service, migrations on an empty database, the PostGIS integration tests
  (`test:db`), a cached basemap extract, and Playwright against the production build.

Locally, `npm run check:ci` covers the checks job; e2e is `npm run build && npm run test:e2e`.

## Performance budgets

The harness in `scripts/perf` measures the mobile map flow (runbook:
[`scripts/perf/README.md`](scripts/perf/README.md), including a one-command real-Android run). One
budget is enforced; the others are measured and reported, and are never made green by gaming the
metric.

**Enforced: initial-route JS ≤ 350 KB gz** (`npm run perf:budget`; runs in `check:ci` and CI). On
the production build served by a plain `next start`, "initial" is the JS the browser requests
before the page emits its `hf:interactive` mark (set once the search shell is hydrated and usable,
before the map engine loads). MapLibre GL (~268 KB gz) and pmtiles are dynamically imported on the
first idle slot after that mark, so they count as lazy. Current initial JS: **205 KB gz**
(2026-11-18). The gate also fails if MapLibre is missing from the lazy set: the map is off the
critical path, not removed, and it loads on its own with no interaction. The gate needs no provider
stack (it only counts JS bytes) and fails closed: a page that will not load, a missing browser or
missing `scripts/perf` deps all fail it.

**Measured, not gated.** Latest emulated runs 2026-08-29/30 (Lighthouse "mobile": Moto G-class,
4× CPU, Slow 4G, on a host with software WebGL); not yet re-taken on the current UI or on a real
device.

| Metric | Target | Latest |
| --- | --- | --- |
| Shell-interactive (search usable) | ≤ 2.5 s | ~1.84 s ✓ |
| Map visible, no interaction | ≤ 4 s | ~6.9–9.7 s (software WebGL) |
| Lighthouse mobile score · TTI | ≥ 90 · ≤ 2.5 s | ~65 · ~7.9 s ✗ |
| Pan/zoom median fps | ≥ 55 | ~15 (software WebGL) ✗ |
| API cold p95: amenities (`mode=walk`) · isochrone | ≤ 400 ms · ≤ 800 ms | ~335 ms · ~175 ms ✓ |

Lighthouse's TTI counts the MapLibre parse on the throttled main thread. The only way to turn it
green is to load the map after a user interaction, which Lighthouse never performs; that would
satisfy the auditor while giving real users a map that waits for a tap, so this project does not
do it. Shell-interactive is the number that matches the budget's intent ("the user can act within
2.5 s"). Suggest and geocode cold p95 sit marginally over their budgets at n=30; the cause
(prefix-search cost vs. warmth) is unconfirmed, so no fix has been applied. The API latency harness
requests the routes without `?model=preset`, so its isochrone number times the parked 15/30/45
path, not the preset path the UI uses.

## Attribution

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors ·
Basemap tiles: [Protomaps](https://protomaps.com) ·
Basemap landcover © [ESA WorldCover](https://esa-worldcover.org/en/data-access) project ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) — contains modified Copernicus Sentinel data processed by the ESA WorldCover consortium — vectorised and distributed via [Daylight](https://daylightmap.org) ·
[Natural Earth](https://www.naturalearthdata.com) (public domain) ·
Basemap POI icons derived from [tangrams/icons](https://github.com/tangrams/icons) © 2017 Mapzen, Linux Foundation ([MIT](https://opensource.org/license/mit)) ·
Transit routing: [Transitous](https://transitous.org/sources/) ·
Geocoding: [Nominatim](https://nominatim.org)

The exact ESA WorldCover vintage (e.g. 2020 v100 vs 2021 v200) is not pinned in the current
[self-hosted tile build](docs/SELFHOST.md); pin it from the Daylight landcover dataset and add the
year to the acknowledgement.

The amenity catalogue is a Derived Database made from OpenStreetMap data and is available as
machine-readable GeoJSON through `/api/catalogue-export`. It is distributed under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/); application/auth/cache
tables are deliberately excluded.
