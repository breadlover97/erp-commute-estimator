# ERP dataset and refresh procedure

Verified **29 October 2026** against official sources. The published rate table is effective **7 September 2026**. `sources.json` records the exact URLs, effective dates, sizes and SHA-256 hashes of retained source files. `public/data/erp-data.json` is generated from these sources; it is not a live LTA feed.

## Rates

- [OneMotoring full September rate table](https://onemotoring.lta.gov.sg/content/dam/onemotoring/Driving/ERP/ERP_rates_tables/2026.09.03-20260626-1PCU_ERP_Rates_Report.20260623170433.pdf): retained as `erp-rates.pdf`. All 294 nonblank cells on its first four pages are extracted. Repeated CBD tariffs are assigned to individual charging locations. Adjacent equal-price periods are merged into 158 equivalent intervals without losing the five-minute transition rates. Vehicle multipliers are on page 5: motorcycles 0.5, cars/taxis/light goods 1, heavy goods/small buses 1.5, very heavy goods/big buses 2.
- [LTA revision announced 31 August](https://www.lta.gov.sg/content/ltagov/en/newsroom/2026/8/news-releases/revised-erp-rates-from-7-september-2026.html): Orchard Cordon resumed weekday charging from 7 September across 11 locations, with other previously announced rates unchanged. The detailed PDF includes $0.50 shoulder periods at 11:00–11:05 and 18:55–19:00; the $1 headline rate applies between them.
- [OneMotoring operating rules](https://onemotoring.lta.gov.sg/content/onemotoring/home/driving/ERP/ERP.html), page updated 27 October: no ERP on Saturdays, Sundays or public holidays. Slot starts are inclusive and ends exclusive. The Saturday columns in the current PDF are blank.

The previous March base table plus June overrides has been replaced with the complete current table. Those overrides incorrectly flattened transition rates and did not include Orchard. This dataset does not claim historical coverage before 7 September, or knowledge of unpublished future reviews. Projections use the currently verified schedule and must be labelled accordingly.

## Locations

- [OneMotoring ERP marker KML](https://onemotoring.lta.gov.sg/mapapp/kml/erp-kml/erp-kml-0.kml), downloaded 29 October: 78 official map markers.
- [LTA DataMall September gantry shapefile](https://datamall.lta.gov.sg/content/dam/datamall/datasets/Geospatial/ERPGantry_Sep2026.zip), listed on the [DataMall static datasets page](https://datamall.lta.gov.sg/content/datamall/en/static-data.html): converted from its supplied SVY21 projection to WGS84. The archive also includes non-ERP gantries with overlapping numbers, so conversion retains **type P only**, giving 106 ERP line features. `lta-gantry.geojson` is the reproducible conversion.
- Every gantry with a positive published tariff has a marker: **33 active charging locations**, including all 11 Orchard entries. `isPriced` denotes a positive tariff somewhere in the current schedule; `groupId` also identifies published groups with no charge. Seven active CTE/KPE markers lack a matching numbered line in the geometry source; these retain authoritative KML coordinates and the existing direction-aware route approximation. No missing lines or direction values are invented.
- [LTA's September ERP 2 transition release](https://www.lta.gov.sg/content/ltagov/en/newsroom/2026/9/news-releases/new-road-markings-signs-erp-2-transition-oct-26.html) corroborates 33 operational locations. Physical gantries begin to be removed during transition; this must not be mistaken for removal of an ERP charging location. It places the next rate review in mid-November 2026.

Route matching is an estimate: map geometry, routing-provider road alignment, nearby parallel roads and estimated crossing time can affect results. Shared Orchard tariffs are kept as separate charging groups so distinct cordon entries are not automatically collapsed into a single charge. Expressway sets retain their published grouping.

## Calendar

`calendar.json` transcribes [MOM's published 2026 and 2027 holidays](https://www.mom.gov.sg/employment-practices/public-holidays), including observed Mondays, and supplies the same calendar to the actual runtime and tests. Confirmed 13:00 holiday-eve cutoffs include Chinese New Year, Deepavali, Christmas and New Year's Eve (including 31 December, previously missing).

**Source conflict:** OneMotoring's summary names Hari Raya Haji for the 13:00 eve cutoff, but its detailed operating-hours section names Hari Raya Puasa. Both sets of dates are recorded in `uncertainEveDates`, excluded from automatic free-ERP dates, and shown as standard-rate estimates with a warning after 13:00. This avoids silently asserting either conflicting rule is confirmed. Published holiday dates themselves are unaffected.

## Reproduce and update

The website has no runtime Python dependency. Python is only needed when maintaining source data:

```sh
python3 -m venv .venv-data
.venv-data/bin/pip install -r scripts/requirements-data.txt
npm run fetch:gantries
.venv-data/bin/python scripts/convert-gantries.py
.venv-data/bin/python scripts/build-data.py
npm run validate:data
```

Despite its legacy name, `fetch:gantries` now retrieves all three reviewed raw sources (PDF, shapefile archive and KML), checks file signatures and hashes before writing, and fails if the upstream bytes differ. It never silently advances the verification date. To adopt a new release:

1. Review the current OneMotoring and DataMall listings, latest LTA release, PDF pages and MOM calendar. Download the official new files and update `sources.json` with their URL, effective date, verification date and hash.
2. Update the converter archive filename if the dataset month changes. Review parser headers, gantry references, rate effective date and source-cell count in `build-data.py`. The parser deliberately stops on an unexpected layout or new Saturday rates.
3. Update `calendar.json` and source-grounded assertions in `validate-data.mjs`, regenerate, then run the full app checks. Validate new locations and rate boundaries before publishing. Do not relabel a download attempt as verified data without reviewing it.

`validate-data.mjs` checks retained-source integrity, unique and complete active marker coverage, coordinate bounds, non-overlapping time bands, holiday coverage and 91 independently read rate/boundary cases. `validate-calculations.mjs` tests the actual shared calculation engine.
