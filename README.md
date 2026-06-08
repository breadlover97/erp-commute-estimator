# ERP Commute Estimator

A static web app for estimating Singapore ERP charges for a driving commute.

## What It Does

- Searches a start point and destination in Singapore.
- Draws the driving route on a Leaflet/OpenStreetMap map.
- Shows official LTA gantry locations from data.gov.sg.
- Highlights gantries near the driving route.
- Calculates weekday ERP cost for passenger cars, taxis and light goods vehicles.
- Compares ERP cost across nearby departure times.
- Suggests a lower-cost or ERP-free departure time where one is found.

## Data Sources

- Gantry geometry: data.gov.sg `LTA Gantry (GEOJSON)`, dataset `d_753090823cc9920ac41efaa6530c5893`.
- Base rates: OneMotoring `ERP Rates.pdf`, with effect from 23 Mar 2026.
- Latest adjustments: LTA news release, `Revised ERP Rates from 2 June 2026`, published 25 May 2026.

The checked-in app data is in `public/data/erp-data.json`.

## Known Limits

- This is an estimate. Route-to-gantry matching is based on proximity to official gantry geometry.
- Public holidays and eve-of-public-holiday early cut-offs are not modelled in this first version.
- The app uses public Nominatim and OSRM endpoints for geocoding and route geometry. A production version should move to a dedicated routing provider or a server-side proxy with proper credentials and quotas.
- ERP directionality is estimated from the route geometry and gantry position, not from an authoritative lane-level routing engine.

## Local Commands

```bash
npm run validate
npm run serve
```

Open `http://localhost:4173`.

## Refreshing Source Data

```bash
npm run fetch:gantries
/Users/ngimtaizhi/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/build-data.py
npm run validate
```

## Deploy

Cloudflare Pages can serve the static `public/` directory directly.

```bash
wrangler pages deploy public --project-name erp-commute-estimator --branch main
```
