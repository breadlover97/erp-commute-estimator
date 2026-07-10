# ERP Calculator

A static web app for estimating Singapore ERP charges for a driving commute.

## What It Does

- Searches a start point and destination in Singapore.
- Confirms address suggestions before routing, including postal-code searches.
- Draws ranked driving route alternatives on an interactive Leaflet map.
- Shows official OneMotoring ERP marker locations.
- Highlights ERP gantries along the selected route with rate tooltips.
- Calculates ERP cost for motorcycles, cars/taxis/light goods vehicles, heavy goods vehicles and very heavy vehicles.
- Supports one-way and return commute estimates.
- Supports both leave-at and arrive-by planning.
- Compares ERP cost across nearby departure times and route alternatives.
- Suggests a lower-cost or ERP-free departure time where one is found.
- Creates a shareable commute URL.
- Uses a mobile-first planner, responsive route map and accessible result states.

## Data Sources

- ERP marker locations: OneMotoring ERP KML marker layer.
- Gantry line geometry where available: data.gov.sg `LTA Gantry (GEOJSON)`, dataset `d_753090823cc9920ac41efaa6530c5893`.
- Current rates: OneMotoring ERP rate table, with effect from 29 Jun 2026.
- Previous rates: OneMotoring ERP rate table, with effect from 23 Mar 2026, retained as the source for exact pre-29 Jun shoulder rates.
- Historical June adjustments: LTA news release, `Revised ERP Rates from 2 June 2026`, published 25 May 2026.
- Public holidays: MOM 2026 and 2027 Singapore public holidays.
- Route geometry: OneMap drive routing when configured, with OpenStreetMap/FOSSGIS OSRM, Valhalla and OSRM demo fallback providers.

The checked-in app data is in `public/data/erp-data.json`.

## Known Limits

- This is an estimate. Route-to-gantry matching is based on proximity to official ERP marker coordinates or gantry line geometry plus a directional check.
- 2026 and 2027 public holidays and major public-holiday eve cut-offs are modelled; later years need a public-holiday data refresh.
- The app uses public Nominatim for geocoding and a multi-engine routing stack for route geometry. OneMap drive routing is tried first when `ONEMAP_EMAIL` and `ONEMAP_PASSWORD` Cloudflare Pages secrets are configured. OpenStreetMap/FOSSGIS OSRM, Valhalla, and the OSRM project demo remain as fallbacks.
- Public demo routing services are rate-limited and do not include live traffic. OneMap is Singapore-specific, but still depends on OneMap service availability, token access and quota limits.
- ERP directionality is estimated from the route geometry and gantry position, not from an authoritative lane-level routing engine.
- Shared commute URLs include the entered address labels and route coordinates. Only share a link when you are comfortable sharing those locations.
- The validation script includes regression cases for common opposite-direction false positives, but live route geometry still depends on the public routing provider.

## Local Commands

```bash
npm run build
npm run validate
npm run serve
```

Open `http://localhost:4173`.

## OneMap Routing

The OneMap routing proxy lives at `functions/api/routes/onemap.js`, which Cloudflare Pages deploys as `/api/routes/onemap`.

Set the OneMap login credentials as Cloudflare Pages secrets named `ONEMAP_EMAIL` and `ONEMAP_PASSWORD`. The proxy exchanges them for a OneMap access token server-side and refreshes it before expiry. `ONEMAP_API_TOKEN` is still supported as a fallback, but direct tokens expire after about 3 days.

For local Wrangler testing, copy `.dev.vars.example` to `.dev.vars` and fill in the credentials. The checked-in `.dev.vars.example` is only a template; do not commit real secrets.

## Refreshing Source Data

```bash
curl -fL 'https://onemotoring.lta.gov.sg/content/dam/onemotoring/Driving/ERP/ERP_rates_tables/20260626-1PCU_ERP_Rates_Report.20260623170433.pdf' -o data/erp-rates.pdf
npm run fetch:gantries
/Users/ngimtaizhi/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/build-data.py
npm run validate
```

Confirm the effective date and PDF layout before replacing the checked-in rate table; the parser reads the two weekday expressway pages by position.

## Deploy

Cloudflare Pages can serve the static `public/` directory directly.

- Build command: `npm run build`
- Output directory: `public`
- Functions directory: `functions`
- Required production secrets for OneMap routing: `ONEMAP_EMAIL`, `ONEMAP_PASSWORD`

```bash
wrangler pages deploy public --project-name erp-commute-estimator --branch main
```
