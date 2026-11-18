# Providers: verification, calibration and decisions

Provider quotas and terms below were verified against the live sources on **2026-07-14** unless
another date is given; quotes are from the linked pages as fetched that day. Re-verify before any
major traffic change. Calibration results carry the date they were measured.

## What one fresh selection costs

The UI requests every reach route with `?model=preset` (see `docs/ARCHITECTURE.md`, "The reach
model"). Each response carries both preset contours of its mode, so switching chips costs nothing.

| Need | Provider call | Calls per fresh address |
| --- | --- | --- |
| Autocomplete while typing | Photon `/api` (≥3 chars, debounced) | 1 per settled query |
| Address submit · map-click label | Nominatim `/search` · `/reverse` | 1 |
| Walk reach, one pace | ORS `foot-walking`, one request for [10, 20, 40] min | 1 |
| Transit reach, one time context | Transitous `one-to-all` (max 45 min) + the walk request above | 1 (+1 if the walk request is not cached) |
| Car reach, one time context | ORS `driving-car`, one request for [10, 25] min | 1 |
| Transit directions (right-click) | Transitous `/api/v1/plan` | 1 |
| Amenities (UI parked) | Local PostGIS catalogue | 0 |

Responses are cached in PostgreSQL with expiry (ORS and transit rings 7 days), so a repeat address
costs 0 external calls. Go/no-go bar: ≥100 fresh addresses/day of headroom on every provider.
**All picks clear it.**

---

## Verified evidence

### Geocoding — Nominatim (OSM Foundation) ✅ PICKED
- Policy: <https://operations.osmfoundation.org/policies/nominatim/>
- "Maximum of 1 request per second"; long-running/regular scripts limited to 4 req/min.
- A valid **HTTP Referer or User-Agent** identifying the app is required; **results must be
  cached** on our side (they are, in PostgreSQL); attribution required.
- No key. Apps whose *primary* function is geocoding must self-host; HowFar is not that.
- Verdict: fine for our volume (1 call per fresh address, server-side, spaced ≥1.1 s).
- **Photon** (photon.komoot.io) is the autocomplete source, because Nominatim's policy forbids
  per-keystroke search. Keyless, "reasonable limit" policy, throttling for extensive use, no SLA
  (<https://photon.komoot.io/>). Bbox-constrained to Bucharest, debounced client-side, minimum 3
  characters, cached. Nominatim still does submit-time geocoding and reverse lookup.

### Walking + car isochrones — OpenRouteService ✅ PICKED
- Restrictions: <https://openrouteservice.org/restrictions/> — isochrones: "Locations: 5",
  "Intervals: 10", "Range time (Foot profiles): 20 h". Profiles = foot / cycling / driving.
- **No public-transport profile exists** (confirmed on the restrictions page); transit comes from
  Transitous (below).
- Free "Standard" plan quotas (via <https://account.heigit.org/info/plans>, corroborated by
  <https://apispine.com/openrouteserviceorg/pricing>): "Isochrones V2 (2500 / 40)", i.e. ~2,500
  isochrone requests/day at 40/min. The page is JS-rendered; **re-read the exact numbers at key
  signup** (even the historical 500/day floor is 5× our bar). Walk and car share this one daily
  budget and the same rate limiter.
- Free API key required, server-side only, and only for the public host; a self-hosted ORS is
  keyless. One request covers every range of a selection via `range`.
- **Walk** (`foot-walking`): the preset walk request is one call for [10, 20, 40] minutes (10/20 are
  the chips; 40 feeds the transit walk union), calibrated as below. The parked legacy path requests
  15/30/45.
- **Car** (`driving-car`): presets 10/25 (parked legacy path: 10/20/30). Car minutes are kept short
  because a 45-minute drive from central Bucharest covers ~3.5× the tiled map extent; a 3-origin
  probe put 10- and 20-minute rings fully inside the map and 30-minute rings 80–98% inside. Car
  reach is **time-aware**: the nominal free-flow seconds are divided by a per-time-of-day congestion
  factor before the request (see "Car traffic realism"). The UI labels car reach an estimate
  (typical congestion, not live traffic).

### Transit isochrones — Transitous (MOTIS) ✅ PICKED — **verified live**
- API: `https://api.transitous.org/api/v6/one-to-all?one=<lat>,<lon>&maxTravelTime=<min>`
  (MOTIS OpenAPI: <https://github.com/motis-project/motis/blob/master/openapi.yaml>).
- **Live probe 2026-07-14**: Piața Unirii (44.4268, 26.1025), maxTravelTime=30 → HTTP 200,
  **1,436 reachable stops** with per-stop `arrival`/`duration`, 463 KB in 2.9 s. Bucharest
  coverage confirmed (Transitous `feeds/ro.json` includes Bucuresti-Ilfov mobility-database
  feeds mdb-2098 + GTFS-RT, plus national railway).
- We build the isochrone polygons ourselves, server-side: a reachability field is rasterized over
  the map bbox (`NEXT_PUBLIC_MAP_BBOX`) and contours are extracted with marching squares (~40 ms;
  nesting is guaranteed by construction). The field is always built to 45 minutes; the preset path
  extracts the 20/40 contours, the parked legacy path 15/30/45. Buffering each stop and unioning
  the discs was tried and rejected: ~65 s on a real 2,509-stop payload. See
  `src/features/isochrones/server/transit-grid.ts`.
- Usage policy (<https://transitous.org/api/>): free, community-run; "not intended for commercial
  or for-profit purposes" (HowFar is non-commercial: no ads, no subscriptions); open-source clients
  must publish source (the repo is public); send an identifying `User-Agent` with contact (done);
  attribution: link <https://transitous.org/sources/> + OSM (done). The policy also asks clients
  to **"contact before … difficult to calculate requests (such as routing, isochrones)"**. No
  courtesy contact was sent: an accepted risk, given the use is non-commercial, cached,
  Bucharest-only and low-volume.
- **Journey directions (`/api/v1/plan`):** right-clicking (or long-pressing) a point after a
  selection plans a trip with the same engine's point-to-point planner (cached, single-flighted).
  Each leg carries a `legGeometry.points` encoded polyline **at precision 7 (1e7 scale), not the
  format's usual precision 5**; decode with the leg's own `legGeometry.precision`, or the path lands
  ~100× out of range. Legs also carry `from`/`to` `lat`/`lon` (board/alight stops) and
  `intermediateStops`. **Street-leg limits must match the painted reach** (2026-07-29): MOTIS
  defaults `maxPreTransitTime`/`maxPostTransitTime` to **900 s**, while the reach field's egress may
  walk for the whole remaining time, so `/plan` answered "no itineraries" for points the map painted
  reachable (verified live: 6/40 random Bucharest points; all revive with a raised post limit). We
  send `maxPostTransitTime=2700` (the 45-minute field maximum) + `pedestrianSpeed=1.389` (the
  Normal pace) + `useRoutedTransfers=true` (the same walking contract as the one-to-all request);
  the pre limit deliberately stays at the default, matching the field's own ingress. Values are
  capped server-side by Transitous's `street_routing_max_prepost_transit_seconds` (≥2700 as of
  2026-07-29). A zero-itinerary answer is retried once; both calls stay behind the same `transit`
  rate spacing (default 1.5 s, `TRANSIT_MIN_INTERVAL_MS`).
- Fallback if Transitous asks us to stop: TravelTime (docs.traveltime.com): after a 2-week trial,
  "a limit of 5 hits per minute applies"; isochrone detail capped at Medium on free; Romania
  transit coverage listed only behind account login (**unverified**). Plan B, not the pick.

### Rejected for isochrones — Geoapify ❌
- Pricing (<https://www.geoapify.com/pricing/>): free plan 3,000 credits/day **but "Isochrones up
  to 15 min"**, so the free tier cannot serve the 20–40-minute presets. Transit mode is also not
  confirmed in the Isoline API docs.

### Calibration of the walking reach and transit egress (2026-07-17)

Both isochrone constructions are **calibrated against street-network measurements**, and the
methodology is re-runnable whenever providers or the city data change (`scripts/calibrate/`).

- **Ruler:** MOTIS `one-to-many` (`mode=WALK`, `withDistance=true`) returns street-routed
  **distance**, so measurements do not depend on any speed assumption; minutes are distances at a
  walking speed. Distance is the ruler everywhere (durations depend on the router's own speed
  constant).
- **Anchor vs product speed (important).** Walk ranges are fitted at an **80 m/min calibration
  anchor**. The product paces are Slow 3 km/h (50 m/min) and Normal 5 km/h (83.3 m/min), so **no
  pace walks at the anchor**: it is a measurement ruler only. Each pace requests the anchor ranges
  rescaled by `speed / 80` (distance calibration is speed-independent); re-deriving the scale from
  a pace's own speed would silently move every ring. Constants: `pace.ts`
  (`CALIBRATION_SPEED_M_PER_MIN`, `CALIBRATED_RANGES_S_AT_80`) and `preset-reach.ts`
  (`WALK_PRESET_RANGES_S_AT_80`).
- **Walking rings (ORS), 15/30/45 fit** (what the parked legacy path requests, and the baseline the
  preset fit is judged against): ORS foot-walking boundaries are systematically generous. Boundary
  audits at three diverse origins (Unirii central / Grozăvești river barrier / Berceni periphery)
  put the nominal 900/1800/2700 s boundaries at 1.265/1.164/1.123 × their labels; part of that is
  ORS's own faster speed constant, the rest boundary/hull generosity. The fix is cause-agnostic:
  ranges fitted in two passes (the factor grows as ranges shrink), anchor triple
  `[827, 1674, 2528]` s at 80 m/min, then re-audited: corrected boundaries sit at ≈ nominal (15-ring
  median exactly 15.0 min; residuals within ±10%). Per-pace requests: Slow `[517, 1046, 1580]`,
  Normal `[861, 1744, 2633]` (both accepted and echoed exactly by ORS, verified live 2026-07-29).
- **Transit egress:** crow-fly understates Bucharest street distance by a measured median
  **1.402×** (143 routed-vs-straight pairs, 6 origins; p25 1.29, p75 1.54, p90 1.82, worst at
  river/rail barriers). Stop egress is stamped at **the request's pace speed / 1.402**: 59.4 m/min
  at Normal, 35.7 m/min at Slow. The UI always requests transit at Normal pace (`effectivePace` in
  `selection-flow.ts`). This is a **calibrated approximation**: anisotropy (a river beside the
  stop) is documented, not modeled.
- **Walking-speed audit at Slow (2026-07-29).** 3 km/h sits 37.5% below the anchor, further than
  any previously validated pace, so the linear rescale was re-measured with the ruler above:
  3 origins × 3 bands, 8 boundary points per ring. All 9 ratios inside ±10%, **overall median
  1.012** (worst cell +3.2%): the scale holds; no measured triple needed.
- **Origin walk component:** the transit reach unions in the street-routed, boundary-calibrated
  ORS walk rings per threshold and skips the radial origin stamp. The union is all-or-nothing with a
  superset guard. If it cannot be formed, the preset path **fails closed** (502, no cache write);
  the parked legacy path rebuilds the whole family with the radial stamp (never a mixed family).
- **Validation (15/30/45 rings vs `one-to-many-intermodal` ground truth, 252 points, 3 origins):**
  over-claiming (painted ≤T but really >T+5 min) fell from up to **75%** (15-minute threshold at the
  barrier origin) to **0–6%** everywhere, with **zero** under-claiming beyond the symmetric
  ±5-minute tolerance band, before or after (sub-5-minute deviations are inside the band by
  definition and not counted either way).
- **Fair use:** calibration runs are bounded campaigns (the 2026-07 campaign used ~35
  `one-to-many`/intermodal calls in total; the 2026-07-29 walking-speed audit ~12), each call ≤128
  locations, ≥2 s spacing, identifying User-Agent with contact email. Runtime traffic is unchanged by
  calibration. For other travel modes, `one-to-many` also supports `mode=BIKE|CAR` (same instrument,
  same budget discipline).

#### Re-audit of all modes with independent rulers (2026-07-24)

All three modes were re-measured against **independent** routing engines (not ORS against ORS,
which is circular), 3 diverse origins × 3 bands, medians of ~5–10 boundary points per band:

- **Car (`driving-car`):** ruler = public **OSRM `driving`** (a separate engine) + an ORS-Matrix
  self-consistency check. Boundary drive durations landed at ORS-route 0.999–1.091× and OSRM
  0.921–1.035× the labels: the two rulers **straddle 1.0** with no directional bias, i.e. within ±5%
  (free-flow measurement noise). Both rulers are **free-flow only** (neither models congestion), so
  this proves free-flow accuracy and nothing more. Real Bucharest driving is 1.5–2.2× slower at
  peak, which is why the congestion factor ("Car traffic realism") scales these free-flow ranges.
- **Walk (`foot-walking`):** ruler = **MOTIS `/plan` direct-walk distance** (a real pedestrian
  engine, independent of ORS), converted at the 80 m/min anchor. All 9 (origin × band) ratios
  0.978–1.049, **median 0.999**: the anchor triple `[827, 1674, 2528]` sits almost exactly at its
  labelled walking minutes *at the anchor speed*. This validates the anchor, so it holds for every
  pace (each pace requests the same triple rescaled, and the rescale itself was audited at Slow).
  *Ruler caveat: the public OSRM demo's `/foot/` profile is NOT pedestrian; it returns car speeds
  (~35 km/h). An early walk pass using it showed a spurious 1.8× (car detours in the dense centre)
  and was discarded. Validate a ruler's profile and units before trusting a ratio.*
- **Transit:** ruler = **MOTIS `/plan` journeys** to the transit-ring boundaries (2 origins × 3
  bands). Ratios 0.833–1.000 (median ~0.91): the rings are consistently **conservative** (a
  boundary point is reachable in slightly *less* than its labelled minutes; reach is never
  over-claimed). That is the safe direction and within the ±10% egress calibration above. The
  measurement is semi-circular (MOTIS journeys against a MOTIS-built isochrone), so it is a
  consistency check, not a fully independent one.

**Verdict (2026-07-24): no free-flow calibration change to any mode.** Walk is accurate within ±5%;
transit is mildly conservative (safe); car free-flow is accurate within ±5%, and car reach is scaled
by the congestion factor on top.

### Preset reach calibration (2026-09-02, served-path measurements 2026-09-03)

The UI shows one selected preset per mode — **walk 10 / 20, transit 20 / 40, car 10 / 25** — and the
larger chip also shows the smaller one as an inner contour. The walk minutes are not on the 15/30/45
fit, so they were calibrated separately; car and transit needed no new fit. Constants:
`src/features/isochrones/preset-reach.ts`; measurement harness and receipts: `scripts/calibrate/`.

**How the presets are served:** the isochrone / car / transit routes serve them for
`?model=preset` (absent ⇒ the parked legacy path; any other value ⇒ 400 before any provider call).
The walk preset issues ONE ORS request for [10, 20, 40], cached under `iso:foot:preset:v1:`, and
slices it (the walk route returns 10/20; the transit street-walk union takes 20/40). Car is
time-of-day-aware (`scaledCarRangesS` over the free-flow nominal, keyed
`iso:car:preset:v1:{frev}:est:{slotId}:…`). Preset transit extracts contours at [20, 40] from a field
built to 45 and **fails closed** (502, no cache write) rather than serve the radial fallback. Each
preset was measured on the serving code against the rulers below (walk against the served
pace-rescaled ranges, transit through `transitPresetIsochrone`). The one inference is car: the
free-flow ranges are measured directly, and the traffic scaling, which only shrinks the reach, is
unit-tested rather than re-measured per slot. Two walk cells reached only 11/12 coverage (see
below), so those are lower-bound samples.

- **Walk (new fit, 2026-09-02).** The requested-seconds → real-street-minutes map is empirical and
  non-linear, so 10/20/40 cannot be interpolated. Ruler = MOTIS `one-to-many` (`mode=WALK`,
  `withDistance=true`) street distance ÷ the 80 m/min anchor; 3 origins (Unirii central /
  Grozăvești river barrier / Berceni periphery), 12 bearings split even = FIT / odd = HELD-OUT,
  boundary sampled by ray-march on the ORS polygon. **Acceptance metric** (same as the 2026-07
  calibration): median within ±10% AND over-claim rate (painted ≤T but really > T+5 min) ≤ the
  15/30/45 baseline. A same-run CONTROL of the anchor showed that baseline is **0–6%** (a symmetric
  per-sector ±10% is stricter than the 15/30/45 rings meet at barriers). Result, anchor-speed ORS
  ranges: **10 → 524 s, 20 → 1090 s, 40 → 2073 s** (pooled held-out medians 9.78 / 19.67 / 39.12,
  conservative; pooled over-claim 6 / 0 / 6 %). Each pace requests the anchor range × speed/80. The
  40-minute range exists because the transit street-walk union needs a walk ring of the same minute
  as each transit threshold. The rescale transfers to the serving request shape (an ORS isochrone
  for a range is vertex-identical whether requested alone or with other ranges), and the smallest
  served range, Slow walk-10 = 328 s (below the swept range), was measured DIRECTLY (508 / 545 /
  497 m street = 10.2 / 10.9 / 9.9 Slow-minutes at the three origins). **Per-origin honesty (the
  pooled figure hides this):** walk-20 is clean at all three origins (0 % over-claim). walk-10 and
  walk-40 are conservative in the median at every origin, but each has ONE barrier/periphery origin
  with a single over-claiming sector: walk-10 at Grozăvești (river barrier, worst +7.9 min, 1/6) and
  walk-40 at Berceni (periphery, worst **+13.1 min**, 1/6). This is the same street-network
  anisotropy the 15/30/45 rings show (the 45 control's worst sector was +5.9 min); walk-40's
  periphery tail is materially larger. Receipt: `scripts/calibrate/receipts/walk-2026-09-02.json`
  (`acceptance.perTarget[*].perOrigin`).
- **Walk (served-range re-measurement, 2026-09-03).** The app requests the pace-RESCALED ranges, not
  the 80 m/min anchor (default `normal` pace: 10 → 546 s, 20 → 1135 s, 40 → 2159 s). Those exact
  ranges were measured against the same MOTIS street-distance ruler ÷ the `normal` pace speed
  (5 km/h), on a fresh bearing set (offset 15° from the fit) and a 4th origin the fit never used
  (Militari, west). Result on the served chips (10 / 20): **clean at Unirii, Berceni and Militari**
  (0 % over-claim); the ONE origin over the ±10 % / +8-min per-origin bar is **Grozăvești** (river
  barrier): 10 min +9.9 / 18 % and 20 min +10.8 / 17 %. Same anisotropy **class** as the 15/30/45
  rings (a street detour around a river/rail barrier), but a LARGER magnitude at 10/20 (worst +10.8)
  than the 45-minute control's +5.9-minute worst sector, and not re-measured against a same-run
  15/30/45 control on this bearing set. It is an **accepted, documented limitation**: the walk
  reach caveat in the UI (the info popover) says times are estimated along streets and that near a
  river or rail line the trip can take longer than the map shows (`presetReachCaveat` in
  `preset-view.ts`). The 40-minute range is not a served walk reach (it exists only for the
  transit union); its lone over-bar sector, Militari +13.5 / 8 %, is the western rail + A1
  corridor (the same barrier class), and its transit role is validated directly below. Two cells (Unirii / Grozăvești at 10 min, 11/12
  samples) drop a boundary point that falls in a network-unroutable void; both reproduce identically
  across independent runs (structural, not noise), so Grozăvești's 10-minute 18 % over-claim is over
  n=11. The sampling instrument marches to the OUTERMOST reachable point across every MultiPolygon
  component and hole, never stopping at the first exit crossing, so a notch-then-lobe barrier
  geometry cannot hide an over-claim; re-running under it left every number above unchanged.
  Receipt: `scripts/calibrate/receipts/walk-served-2026-09-03.json`.
- **Car (no new fit; spot-checked on the served free-flow ranges, 2026-09-03).** Car ranges are
  nominal free-flow (`minutes × 60`); 25 → 1500 s interpolates within the 2026-07 audited 10/20/30
  band. An OSRM `driving` spot-check (3 origins, Unirii / Berceni / Militari, × 8 bearings) found the
  ORS driving isochrone at 600 s / 1500 s **inside** the OSRM ruler's reach at every sampled sector:
  median OSRM drive time at the 10-minute boundary 9.2 / 8.4 / 9.2 min, at the 25-minute boundary
  22.2 / 22.1 / 22.7 min, **0 % over-claim**, mostly conservative, coverage complete. The congestion
  factor applies on top and only shrinks the served reach, so served ⊆ free-flow ⊆ ruler. Receipt:
  `scripts/calibrate/receipts/car-spotcheck-2026-09-03.json`.
- **Transit (no new fit; 20/40 measured directly, 2026-09-03).** Transit contours are levels of one
  monotone field; the preset extracts [20, 40] from a field built to 45, so its 40-contour is
  byte-identical to the 45-field's 40-level (20 is an interior level). Both were measured against
  MOTIS `/plan` best-journey ground truth on the preset code (street-routed walk union, never the
  radial fallback) at **4 origins**, including Militari (the west/A1 barrier corridor): **Unirii
  20/40 = 0 % / 0 % over-claim** (medians 18 / 35.5 min), **Grozăvești 0 % / 0 %** (18 / 36.5),
  **Berceni 20 min 0 %, 40 min 13 %** (one SE sector really ~33 min over the label), **Militari
  20 min 0 %, 40 min 13 %** (worst sector +6 min: the transit-40 walk union across the western
  rail/A1 corridor, measured directly). Pooled: 20 min 0 %, 40 min 6 % (n=32); the pre-declared
  central-origin bar held; coverage complete. **Known limitation:** at the periphery, in specific
  directions with infrequent service, a reachability contour can be optimistic against a specific
  departure's journey. The Berceni SE and Militari tails are that; it is a property of the transit
  field at every threshold, not of the 20/40 presets. The transit caveat in the UI (the info
  popover) says that at the city's edge the trip can take longer than the map shows. A
  transit-field re-calibration across more peripheral origins has not been done. Receipt:
  `scripts/calibrate/receipts/transit-2026-09-03.json`.

### Car traffic realism — calibrated congestion factor over ORS free-flow ✅ PICKED

Bucharest is one of Europe's most congested cities (public **TomTom Traffic Index 2025**: 62.5%
congestion, 18.5 km/h average, ~4.6 km per 15 min), so ORS **free-flow** driving times over-claim
reach by roughly 1.5–2.2× at peak. Car reach is therefore **time-aware**: the nominal free-flow
ranges (preset `[600, 1500]` s; parked legacy `[600, 1200, 1800]` s) are **divided by a
per-time-of-day congestion factor**, so a "25-minute" contour paints the area actually reachable in
25 real minutes. Implementation: the pure `features/isochrones/car-traffic.ts` (`carTrafficSlot` →
`{slotId, label, factor}`; `scaledCarRangesS`), consumed by `ors.ts` and the `/api/car` route, which
parses the same two-option time context as transit (`preset=crowded|quiet`; the retired
`weekday`/`time` parameters are rejected with 400). The response carries `car: {basis: "estimate", …}`
and the UI labels it typical congestion, **not live traffic**.

**Provider decision matrix (why a calibrated factor, not a live-traffic API):**
- **TomTom Routing / `calculateReachableRange`** (free 2,500/month, no card, traffic-aware): **not
  usable in production.** Its Portal (Docs) Terms & Conditions **§2.2 license the free tier for
  "Evaluation Use only"** ("internal evaluation and testing by you of the Licensed Products"); a
  public app is not that. Production needs §2.1 (paid License Fees + a Subscription Plan accepted by
  TomTom + a "Permitted Solution", *defined* as requiring Asset Management Functionality, which
  HowFar does not have). Also **§11.4** bars caching Results server-side "for the purpose of scaling
  results to serve multiple clients or users"; **§11.6.1** bars building a "secondary or derived
  database/product" from the Results (a baked factor table from `calculateRoute` would be exactly
  that); **§20.2.3** bars combining Licensed content with copyleft/open data, and our basemap and
  amenity data are **ODbL** (a Copyleft License by the T&C's own definition). Verified 2026-07-24
  against those T&C. Technically it works well (a dev-time Evaluation-Use probe showed peak reach =
  0.275× night area, 100%-nesting polygons), but it cannot ship.
- **Mapbox Isochrone** (`driving-traffic` + `depart_at`): **disqualified**; results "must be
  displayed on a Mapbox map", and HowFar renders MapLibre + self-hosted Protomaps (it also needs a
  card on file).
- **HERE Isoline v8**: traffic-aware, but the no-card plan ended 2025-08-31 and the Base plan
  requires a card on file (a standing billing risk). Not used; a documented alternative.
- **Chosen:** ORS free-flow (no new provider) **÷ a congestion factor grounded in the PUBLIC TomTom
  Traffic Index** (published editorial statistics, freely citable, NOT API Results) plus peak/off-peak
  traffic literature. Deliberately conservative (under- rather than over-claims).

**Factor table (revision `c1`, embedded in the cache key as `{frev}`):**

| Period (weekday) | Hours | Factor | | Weekend | Factor |
|---|---|---|---|---|---|
| overnight | 23–06 | ×1.05 | | daytime 10–22 | ×1.30 |
| early morning (shoulder) | 06–07 | ×1.40 | | off-peak (else) | ×1.10 |
| **AM peak** | 07–10 | **×2.10** | | | |
| midday | 10–16 | ×1.50 | | | |
| **PM peak** | 16–20 | **×2.20** | | | |
| evening | 20–23 | ×1.25 | | | |

The two time presets map through `departureFields`: `crowded` (Wednesday 08:30) → AM peak ×2.10;
`quiet` (Wednesday 12:30) → midday ×1.50. The table resolves any instant, but only those two
presets are exposed. Factors clamp to [1.0, 4.0]; scaled ranges are guaranteed strictly ascending,
distinct and ≥60 s.

**Provenance and re-run:** the factors are grounded in the **public TomTom Traffic Index** plus
peak/off-peak congestion literature, set deliberately conservative (≥ typical measured congestion,
so reach under- rather than over-claims). A developer MAY sanity-check them against a private,
dev-time Routing campaign under TomTom's Evaluation-Use licence (internal testing only), but **no
TomTom-derived figures are published or shipped**; this doc keeps only public-source provenance, per
the licence analysis above. **If you change the factors, you MUST bump `CAR_FACTOR_REVISION` in
`car-traffic.ts`**: it is part of both 7-day car cache keys (`iso:car:preset:v1:{frev}:est:{slotId}:…`
and the legacy `iso:car:v2:{frev}:est:{slotId}:…`), so without the bump, rings computed with the old
factors silently survive. Unit tests pin the factor table, the revision token and its place in the
key (`car-traffic.test.ts`, `ors.test.ts`).

**Env:** `TOM_TOM_API_KEY` / `CAR_TRAFFIC_LAYER2` are **not used** by the app (TomTom is out per the
T&C above); a live TomTom layer would need a paid Permitted-Solution licence.

### Amenities / POIs — OSM catalogue in PostGIS ✅ PICKED

The amenity UI is hidden and parked (see `docs/ARCHITECTURE.md`, "Parked code"); the server side
below still works.

- Overpass commons/fair use (<https://dev.overpass-api.de/overpass-doc/en/preface/commons.html>,
  wiki): guideline ≈ "10,000 requests per day and … download volume below about 1 GB per day".
- Mirror: <https://overpass.kumi.systems/> ("free and unlimited access … trusts its users to share
  resources fairly") is in both default host pools.
- No key. `npm run amenities:refresh` runs one bounded, sequential-host, full-Bucharest `out geom`
  request, validates it, and atomically publishes into the isolated `osm_catalogue` schema. The
  importer is designed for a weekly cadence; nothing schedules it today. `/api/amenities` makes no
  Overpass request: the **reach rings of the selected travel mode** bound the query, and PostGIS
  intersects them with the active dataset. The ring provider is mode-dependent (ORS `foot-walking`,
  **Transitous one-to-all**, ORS `driving-car` traffic-adjusted) through the legacy 15/30/45 path,
  reusing the cached ring response. **A ring-provider failure fails the amenity request** rather
  than falling back to a walking ring: places for the wrong area would be a quieter, worse error
  than an honest retry. The last good snapshot survives fetch, validation or publication failure;
  `/api/catalogue-status` becomes 503 after 10 days.
- The importer excludes lifecycle/private park features and unnamed generic gardens, then
  conservatively deduplicates contained and overlapping representations. Full polygon geometry is
  retained so a park crossing a reach ring is included even when its centroid is outside.
- OpenStreetMap attribution and ODbL apply. `/api/catalogue-export` offers the active Derived
  Database as paginated GeoJSON and strictly excludes public-schema auth/cache data.
- **Transit stop lines and direction** (`/api/stop-lines`; opens only from an amenity marker, so it
  is unreachable in the current UI): the lines serving a stop come from OSM `type=route` relations,
  on demand, cached 30 days (1 day when empty). **Two-stage, direct-first** (probed live
  2026-07-17): stage 1 asks for the routes the stop is a DIRECT member of
  (`<seed>(id);(rel(bn|bw|br)[type=route];)`), which is correct and per-platform accurate for
  bus/tram stops. Only if that is empty (a metro/rail *station* node, which is not a direct route
  member) does stage 2 expand via the station's `public_transport=stop_area` to the
  platform/`stop_position` member nodes and take THEIR routes. Direct-first is essential: an
  always-expand query over-reaches at interchanges (verified live: a Piața Unirii bus stop with 1
  real route gained 8 unrelated sibling-platform tram routes under the area hop). Direction is the
  `to` (destination) headsign, never `from`. It uses the interactive endpoint race with
  `treatEmptyAsFailure: false` (a stop with no mapped routes legitimately returns `[]`, and the race
  prefers a non-empty host so a fast degraded mirror's `[]` cannot cache a false "no lines"). The
  route rejects out-of-area coordinates (keeping casual off-area traffic off the community
  servers), but the real fair-use bound is the per-provider (`provider@host`) rate limiter +
  single-flight + TTL'd cache, not the geo-guard (which does not bind id → coordinates).

### Air quality + climate — Open-Meteo (chosen, not built)

No air-quality or climate code exists yet. If it is built, this is the pick:
- Terms/pricing (<https://open-meteo.com/en/terms>, <https://open-meteo.com/en/pricing>): free for
  **non-commercial** use, "less than 10,000 API calls per day, 5,000 per hour and 600 per minute",
  no key, **CC-BY 4.0 attribution required**.
- Air Quality API (<https://open-meteo.com/en/docs/air-quality-api>): hourly pollutants + European
  AQI, same free terms, so one provider covers both air and climate.
- Optional alongside it: OpenAQ v3 (free API key, 60 req/min,
  <https://docs.openaq.org/using-the-api/rate-limits>) for *measured* station values next to
  Open-Meteo's model values.

### Map tiles — Protomaps, self-hosted ✅ PICKED (MapTiler rejected)
- MapTiler free (<https://www.maptiler.com/cloud/pricing/>): 100,000 requests/month,
  non-commercial + R&D only, maps **suspended** for the rest of the month at the cap, and the tile
  key is used from the browser (their account even auto-creates a domain-unrestricted key if all
  keys are restricted). That breaks the rule that external API keys stay server-side. ❌
- Protomaps (<https://docs.protomaps.com/basemaps/downloads>, <https://docs.protomaps.com/pmtiles/cli>):
  daily planet builds (~120 GB) at maps.protomaps.com/builds; `pmtiles extract <build-url>
  out.pmtiles --bbox=…` pulls a Bucharest-region extract efficiently over HTTP (tens of MB). Served
  by the app itself (one static file + an HTTP Range route, `/api/tiles`): **keyless, quota-less,
  zero client credentials**, full styling control, no extra server. Basemap style from
  `@protomaps/basemaps`.
- **Attribution obligation (not just OSM):** the Protomaps basemap bundles more than OpenStreetMap:
  **ESA WorldCover landcover under CC BY 4.0** (via Daylight; requires a visible credit + licence
  link + a "modified" indication), Natural Earth (public domain), and the Mapzen/`tangrams/icons` POI
  sprite (MIT). The map's info popover (`src/features/map/InfoControl.tsx`, links from
  `src/features/map/credits.ts`, which the style attribution in `map-setup.ts` also uses) shows
  them in every map state and opens by itself for 5 s when the map first loads (if the address
  field has focus at that moment, once it loses focus; the rules are in `info-controller.ts`);
  MapLibre's own attribution control is off. They are also in the README. A tile-source or extent change must
  re-check them. Details and the remaining gaps (raw-archive metadata, exact ESA vintage) are in
  `docs/SELFHOST.md`, "Caveats".
- **Open item: glyphs and sprite are not self-hosted.** The basemap's font glyphs and sprite are
  fetched by the browser from `protomaps.github.io/basemaps-assets` (`map-setup.ts` `glyphs` /
  `sprite`). They are keyless static files, so no key reaches the client, but they are the one
  external call the browser makes, and a third-party availability dependency. They are referenced,
  not redistributed, so no notice obligation attaches today. Self-hosting them in `public/` would
  make them redistributed, and their licences (the sprite's Mapzen MIT, and the fonts' own licence,
  to be confirmed then) would have to be carried too.

---

## Decisions

| Question | Decision |
| --- | --- |
| Free-tier quotas verified? | Yes: evidence above, dated 2026-07-14 |
| Geocoder | **Nominatim** (server-side, PostgreSQL-cached, ≤1 rps, User-Agent set); **Photon** for autocomplete |
| Map tiles | **Self-hosted Protomaps** Bucharest extract (keyless) |
| Travel modes | **Walk** (ORS), **public transport** (Transitous one-to-all), **car** (ORS free-flow ÷ congestion factor) |
| Live traffic | **No** live-traffic API; a public-source congestion factor (see "Car traffic realism") |
| Air quality | **Open-Meteo** if built (also climate); OpenAQ optional |
| Transitous courtesy contact | **Not sent** (accepted risk: non-commercial, cached, Bucharest-only, low-volume) |
| Source code | **Public** on GitHub (Transitous requires open-source clients to publish source) |

## Env vars created by these picks

| Var | Needed | Secret? |
| --- | --- | --- |
| `ORS_API_KEY` | walking/car isochrones, **only when `ORS_BASE_URL` is the public default**; a self-hosted ORS is keyless | yes, server only |
| (none) | Nominatim, Photon, Overpass, Transitous, tiles | keyless (User-Agent/Referer set in code) |

> **Self-host provider knobs.** Besides the `*_BASE_URL`, endpoint-pool and extent vars, each
> provider's rate-limit spacing is tunable via `NOMINATIM_MIN_INTERVAL_MS` /
> `PHOTON_MIN_INTERVAL_MS` / `ORS_MIN_INTERVAL_MS` / `TRANSIT_MIN_INTERVAL_MS` /
> `OVERPASS_MIN_INTERVAL_MS`. The defaults are each client's ToS-derived (Nominatim, ORS) or
> conservative fair-use (Photon, Overpass, Transitous) spacing; `0` disables throttling on a box you
> own. A below-default interval is rejected at startup (an `/api/ready` 503) unless that provider's
> base or pool is off the public host, so a stray edit cannot get the app's IP fair-use-banned. The
> public-host check is a best-effort allowlist of the known defaults; another public mirror is the
> operator's responsibility. `PROVIDER_DATA_REVISION` is an optional token folded into the cache
> namespace: bump it when you rebuild a self-hosted ORS/MOTIS graph from a newer OSM extract so
> stale rings are not served. The old namespace's rows stay until their TTL expires and
> `npm run reap:cache` removes them (see `.env.example`). Everything defaults to the public
> providers, so an unset environment behaves exactly as before.
