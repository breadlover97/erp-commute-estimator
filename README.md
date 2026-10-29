# ERP Calculator

A lightweight Singapore commute planner, published at https://erp-commute-estimator.pages.dev.

## Plan a trip

A fresh visit defaults to **arrive by 9:00 am tomorrow**, in Singapore time. Search by postal code, building or street, select a matching address (or use the keyboard), and estimate. Current location, recent places, swap, Today/Tomorrow shortcuts, time presets and a five-minute slider reduce repeat entry. Vehicle and return-trip settings are optional. Changing timing after an estimate recalculates automatically using cached route geometry.

Results show estimated departure/arrival times, route options, ERP charges, timing comparisons and individual gantry details. The share action includes the selected addresses and coordinates in the URL. Recent locations are stored only in the browser; current geolocation is not added to that history.

## Architecture

- Plain HTML, CSS and ES modules; no frontend build framework or package installation required.
- `public/app.js`: interface, route rendering and directional gantry matching.
- `public/planner-utils.js`: Singapore dates and normalized address data.
- `public/lib/erp-engine.js`: indexed tariff/calendar calculations.
- `public/lib/route-service.js`: cancellable provider selection and bounded ten-minute route cache.
- `functions/api/search.js`: authenticated OneMap address search, validation and bounded cache.
- `functions/api/routes/onemap.js`: OneMap driving route proxy.
- `functions/_lib/onemap.js`: shared server-side token refresh and bounded requests.
- Pinned Leaflet and Lucide assets are served locally, with their licenses retained under `public/vendor`.

Slow routing providers are cancelled after usable alternatives arrive. The app caches route matching, calculates gantry details only when opened, rejects stale requests and keeps time calculations in Singapore time regardless of the visitor's timezone.

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

Validation runs independent official-rate checks, geometry regressions against the shipped matcher, current-rate and crossing calculations, arrival/midnight and request-lifecycle tests, route cache/cancellation tests, and mocked OneMap proxy/search tests. The tests use Node's built-in APIs and do not send real credentials.

## Deployment

The existing Cloudflare Pages project is `erp-commute-estimator`, production branch `main`, assets `public/`, Functions `functions/`.

Production OneMap secrets: `ONEMAP_EMAIL` and `ONEMAP_PASSWORD`. `ONEMAP_API_TOKEN` remains a fallback if refresh credentials are unavailable. Credentials never enter the browser.

```sh
npm run check
wrangler pages deploy public --project-name erp-commute-estimator --branch main
```

Preview environment secrets are separate from production. Verify search and routing in the destination environment. An authenticated Cloudflare Pages Direct Upload API deployment is also supported: compile the Pages Functions with Wrangler, upload assets using the project upload token, and deploy the matching manifest, worker and headers.
