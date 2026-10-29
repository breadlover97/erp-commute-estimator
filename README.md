# ERP Calculator

A lightweight Singapore commute planner, published at https://erp-commute-estimator.pages.dev.

## Plan a trip

A fresh visit defaults to **arrive by 9:00 am tomorrow**, in Singapore time. Search by postal code, building or street, select a matching address (or use the keyboard), and estimate. Current location, recent places, swap, Today/Tomorrow shortcuts, time presets and a five-minute slider reduce repeat entry. Vehicle and return-trip settings are optional. Changing timing after an estimate recalculates automatically using cached route geometry.

Results show estimated departure/arrival times, route options, ERP charges, timing comparisons and individual gantry details. Every estimate also searches for a **S$0 ERP route at the selected time**. Normal results appear first; a qualifying free option stays visible even if it is slower than the three usual alternatives. Outbound and return legs are searched separately. If none is found, the result says so clearly; a routing-service failure is reported separately. The share action includes the selected addresses and coordinates in the URL. Recent locations are stored only in the browser; current geolocation is not added to that history.

## Architecture

- Plain HTML, CSS and ES modules; no frontend build framework or package installation required.
- `public/app.js`: interface, route rendering and directional gantry matching.
- `public/planner-utils.js`: Singapore dates and normalized address data.
- `public/lib/erp-engine.js`: indexed tariff/calendar calculations.
- `public/lib/route-service.js`: cancellable provider selection and bounded ten-minute route cache; retains the full candidate pool for ERP evaluation.
- `public/lib/zero-erp-search.js`: bounded, cancellable search that evaluates each candidate at its actual estimated crossing times.
- `public/lib/avoidance-provider.js`: shared Valhalla adapter with toll preference, directed road exclusions, request pacing and a geometry-only cache.
- `functions/api/search.js`: authenticated OneMap address search, validation and bounded cache.
- `functions/api/routes/onemap.js`: OneMap driving route proxy.
- `functions/_lib/onemap.js`: shared server-side token refresh and bounded requests.
- Pinned Leaflet and Lucide assets are served locally, with their licenses retained under `public/vendor`.

Slow routing providers are cancelled after usable alternatives arrive. The app caches route matching, calculates gantry details only when opened, rejects stale requests and keeps time calculations in Singapore time regardless of the visitor's timezone.

## S$0 ERP route search

The search checks all collected normal candidates before display pruning, then requests Valhalla alternatives with `use_tolls: 0`. That setting is only a preference: every result is checked against the same current ERP table and directional gantry matcher as the displayed routes. If charges remain, the search excludes the projected road crossing and its travel heading, then retries with updated exclusions. Inactive gantries do not need to be avoided. For arrive-by journeys, each candidate's departure is calculated from its own duration; return-trip candidates must fit the selected return schedule.

Each leg has a six-request, 18-second search budget. Public Valhalla requests are serialized and spaced by at least 1.1 seconds. Only geometry is cached; ERP is recalculated when the date, time, vehicle or mode changes. Timing/location changes cancel prior work and late responses cannot overwrite the new trip. No S$0 result is a proof that no free path exists: the result explicitly states that no option was found among checked routes, and notes incomplete searches. A S$0 label is an estimate under the published rates, not a live-traffic or toll guarantee.

Provider references: [Valhalla route API](https://valhalla.github.io/valhalla/api/route/api-reference/), [FOSSGIS public routing service](https://routing.openstreetmap.de/about.html). OneMap's normal driving routes remain preferred for quick initial results.

## Data and limitations

Rates are the complete OneMotoring table effective **7 September 2026**, checked **29 October 2026**. The dataset contains **78 official locations**, including **33 with active charges**, and the 2026/2027 MOM holiday calendars. Orchard's 11 charging locations and exact five-minute transition bands are included. See [data/SOURCES.md](data/SOURCES.md) for primary sources, provenance, caveats and refresh instructions.

This remains a planning estimate. Travel times do not include live traffic. Road direction and gantry crossings are inferred from public route geometry; actual charges may differ. Future rate reviews and school-holiday concessions require a refresh. Historical dates use the current table with a visible qualification. Conflicting official guidance for Hari Raya holiday eves is flagged rather than assumed free. ERP 2 physical gantry removal does not itself remove a charging location.

## Run and verify

```sh
npm run check
npm run build
npm run dev
```

`dev` requires Wrangler 4 and serves on `http://127.0.0.1:4173`. Copy `.dev.vars.example` to `.dev.vars` and fill in local OneMap credentials for authenticated address/routing APIs; never commit credentials. `npm run serve` offers a static-only preview without Pages Functions.

Validation runs independent official-rate checks, geometry regressions against the shipped matcher, current-rate and crossing calculations, arrival/midnight and request-lifecycle tests, route cache/cancellation tests, mocked OneMap proxy/search tests, and dedicated zero-ERP search/provider/integration regressions (candidate diversity, exclusion retries, failures, arrival boundaries, return legs and stale completions). The tests use Node's built-in APIs and do not send real credentials.

## Deployment

The existing Cloudflare Pages project is `erp-commute-estimator`, production branch `main`, assets `public/`, Functions `functions/`.

Production OneMap secrets: `ONEMAP_EMAIL` and `ONEMAP_PASSWORD`. `ONEMAP_API_TOKEN` remains a fallback if refresh credentials are unavailable. Credentials never enter the browser.

```sh
npm run check
wrangler pages deploy public --project-name erp-commute-estimator --branch main
```

Preview environment secrets are separate from production. Verify search and routing in the destination environment. An authenticated Cloudflare Pages Direct Upload API deployment is also supported: compile the Pages Functions with Wrangler, upload assets using the project upload token, and deploy the matching manifest, worker and headers.
