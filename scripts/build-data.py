import json
import re
from html import unescape
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
PUBLIC_DATA_DIR = ROOT / "public" / "data"
PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)

GROUP_LABELS = {
    "59": "Upper Boon Keng Road near Lorong 1 Geylang",
    "43,44": "Dunearn Road eastbound after Dunkirk Avenue",
    "58": "Geylang Bahru westbound after Geylang Bahru Terrace",
    "70": "Geylang Road westbound before Kallang River",
    "57": "Kallang Bahru from PIE",
    "40,71": "Bendemeer Road southbound after Woodsville Interchange / Woodsville Tunnel",
    "39": "Thomson Road southbound after Toa Payoh Rise",
    "56": "Lorong 6 Toa Payoh from Braddell Road",
    "55": "Upper Bukit Timah Road southbound after Hume Avenue",
    "36": "AYE before Alexandra Road towards City",
    "52,53,74": "Citybound AYE after Jurong Town Hall / Clementi Avenue 6 / Clementi Avenue 2",
    "41": "AYE after North Buona Vista towards Tuas",
    "54": "BKE between Dairy Farm Road and PIE",
    "31,33,34": "CTE after Braddell Road / Serangoon Road / Balestier slip road",
    "68": "CTE slip road to PIE (Changi) / Serangoon Road",
    "35": "CTE between Ang Mo Kio Avenue 1 and Braddell Road",
    "46,67": "Northbound CTE after PIE / before Braddell Road",
    "51": "CTE northbound between Jalan Bahagia and PIE",
    "30": "ECP towards City",
    "73": "ECP eastbound before KPE",
    "80": "KPE slip road into citybound ECP",
    "50": "KPE southbound after Defu Flyover",
    "90,91": "MCE westbound before exits to Central Boulevard and Maxwell Road",
    "92,93": "MCE eastbound after Maxwell Road / Marina Boulevard",
    "32,45": "PIE after Kallang Bahru exit / slip road into Bendemeer Road",
    "37,38": "PIE eastbound after Adam Road / Mount Pleasant slip road",
    "42": "PIE slip road into CTE",
    "65": "PIE westbound before Eunos Link",
}

GROUP_DIRECTIONS = {
    "43,44": 90,
    "58": 270,
    "70": 270,
    "40,71": 180,
    "39": 180,
    "55": 180,
    "36": 90,
    "52,53,74": 90,
    "41": 270,
    "31,33,34": 180,
    "35": 180,
    "46,67": 0,
    "51": 0,
    "30": 270,
    "73": 90,
    "50": 180,
    "90,91": 270,
    "92,93": 90,
    "32,45": 270,
    "37,38": 90,
    "65": 270,
}

JUNE_2026_ADJUSTMENTS = [
    {
        "groupId": "36",
        "start": "08:00",
        "end": "08:30",
        "amount": 0,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "52,53,74",
        "start": "09:00",
        "end": "09:30",
        "amount": 2,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "52,53,74",
        "start": "18:00",
        "end": "18:30",
        "amount": 0,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "35",
        "start": "07:00",
        "end": "07:30",
        "amount": 1,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "35",
        "start": "08:00",
        "end": "09:00",
        "amount": 2,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "50",
        "start": "07:00",
        "end": "07:30",
        "amount": 0,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "50",
        "start": "07:30",
        "end": "08:00",
        "amount": 3,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "50",
        "start": "08:00",
        "end": "08:30",
        "amount": 4,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "50",
        "start": "08:30",
        "end": "09:00",
        "amount": 5,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "50",
        "start": "09:00",
        "end": "09:30",
        "amount": 1,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "50",
        "start": "09:30",
        "end": "10:00",
        "amount": 0,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "65",
        "start": "07:30",
        "end": "08:00",
        "amount": 0,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "65",
        "start": "09:00",
        "end": "09:30",
        "amount": 0,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "46,67",
        "start": "18:00",
        "end": "19:00",
        "amount": 3,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "46,67",
        "start": "19:00",
        "end": "19:30",
        "amount": 2,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "46,67",
        "start": "19:30",
        "end": "20:00",
        "amount": 0,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "52,53,74",
        "start": "07:00",
        "end": "07:30",
        "amount": 1,
        "fromDate": "2026-06-29",
        "toDate": None,
        "reason": "ERP increase from 29 June 2026",
    },
    {
        "groupId": "52,53,74",
        "start": "07:30",
        "end": "08:00",
        "amount": 5,
        "fromDate": "2026-06-29",
        "toDate": None,
        "reason": "ERP increase from 29 June 2026",
    },
    {
        "groupId": "32,45",
        "start": "07:00",
        "end": "07:30",
        "amount": 1,
        "fromDate": "2026-06-29",
        "toDate": None,
        "reason": "ERP increase from 29 June 2026",
    },
    {
        "groupId": "32,45",
        "start": "07:30",
        "end": "08:30",
        "amount": 2,
        "fromDate": "2026-06-29",
        "toDate": None,
        "reason": "ERP increase from 29 June 2026",
    },
    {
        "groupId": "32,45",
        "start": "08:30",
        "end": "09:00",
        "amount": 4,
        "fromDate": "2026-06-29",
        "toDate": None,
        "reason": "ERP increase from 29 June 2026",
    },
]


def text_items(page):
    items = []

    def visitor(text, cm, tm, font_dict, font_size):
        clean = " ".join(text.split())
        if clean:
            items.append({"x": round(tm[4], 2), "y": round(tm[5], 2), "text": clean})

    page.extract_text(visitor_text=visitor)
    return items


def extract_base_rates():
    reader = PdfReader(DATA_DIR / "erp-rates.pdf")
    rates = []
    for page_number in (2, 3):
        items = text_items(reader.pages[page_number])
        columns = [
            item
            for item in items
            if item["y"] == 663 and re.fullmatch(r"\d+(?:,\d+)*", item["text"])
        ]
        columns.sort(key=lambda item: item["x"])
        rows = [
            item
            for item in items
            if re.fullmatch(r"\d{2}:\d{2} - \d{2}:\d{2}", item["text"])
        ]

        for row in rows:
            row_y = row["y"]
            amount_items = [
                item for item in items if item["y"] == row_y and item["text"].startswith("$")
            ]
            for amount_item in amount_items:
                column = min(columns, key=lambda item: abs(item["x"] - amount_item["x"]))
                if abs(column["x"] - amount_item["x"]) > 16:
                    continue
                start, end = row["text"].split(" - ")
                amount = float(amount_item["text"].replace("$", ""))
                rates.append(
                    {
                        "groupId": column["text"],
                        "start": start,
                        "end": end,
                        "amount": amount,
                    }
                )

    return rates


def extract_field(description, field_name):
    pattern = rf"<th>{re.escape(field_name)}</th>\s*<td>(.*?)</td>"
    match = re.search(pattern, description)
    if not match:
        return None
    value = re.sub(r"<.*?>", "", match.group(1)).strip()
    return value or None


def normalize_gantry_no(value):
    if not value:
        return None
    match = re.fullmatch(r"OS0*(\d+)", value)
    if match:
        return match.group(1)
    return value


def strip_markup(value):
    return re.sub(r"\s+", " ", re.sub(r"<.*?>", " ", unescape(value))).strip()


def midpoint(coordinates):
    lon = sum(point[0] for point in coordinates) / len(coordinates)
    lat = sum(point[1] for point in coordinates) / len(coordinates)
    return [round(lat, 8), round(lon, 8)]


def build_geojson_lines_by_gantry():
    source = json.loads((DATA_DIR / "lta-gantry.geojson").read_text())
    lines_by_gantry = {}
    for feature in source["features"]:
        description = feature["properties"].get("Description", "")
        raw_gantry_no = extract_field(description, "GNTRY_NUM")
        if raw_gantry_no in {"UNK", ""}:
            raw_gantry_no = None
        gantry_no = normalize_gantry_no(raw_gantry_no)
        if not gantry_no:
            continue
        coordinates = feature["geometry"]["coordinates"]
        lines_by_gantry.setdefault(
            gantry_no,
            [[round(point[1], 8), round(point[0], 8)] for point in coordinates],
        )
    return lines_by_gantry


def child_text(element, local_name):
    for child in element.iter():
        if child.tag == local_name or child.tag.endswith(f"}}{local_name}"):
            return child.text or ""
    return ""


def build_gantries():
    gantry_to_group = {}
    for group_id in GROUP_LABELS:
        for number in group_id.split(","):
            gantry_to_group[number] = group_id

    lines_by_gantry = build_geojson_lines_by_gantry()
    gantries = []
    kml_root = ET.parse(DATA_DIR / "onemotoring-erp.kml").getroot()
    for index, placemark in enumerate(kml_root.findall(".//{*}Placemark"), start=1):
        name_text = strip_markup(child_text(placemark, "name"))
        number_match = re.search(r"\((\d+)\)\s*$", name_text)
        if not number_match:
            continue
        gantry_no = number_match.group(1)
        location_label = re.sub(r"\s*\(\d+\)\s*$", "", name_text).strip()
        coordinate_text = child_text(placemark, "coordinates").strip()
        lon, lat, *_ = [float(part) for part in coordinate_text.split(",")]
        group_id = gantry_to_group.get(gantry_no)
        gantries.append(
            {
                "id": f"g{index}",
                "gantryNo": gantry_no,
                "rawGantryNo": gantry_no,
                "uniqueId": None,
                "groupId": group_id,
                "label": GROUP_LABELS.get(group_id, location_label),
                "directionDegrees": GROUP_DIRECTIONS.get(group_id),
                "center": [round(lat, 8), round(lon, 8)],
                "line": lines_by_gantry.get(gantry_no, []),
                "isPriced": group_id is not None,
            }
        )
    return gantries


def main():
    groups = [
        {"id": group_id, "label": label, "gantryNos": group_id.split(",")}
        for group_id, label in GROUP_LABELS.items()
    ]
    payload = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "vehicleClass": "Passenger cars, taxis and light goods vehicles",
            "baseRateSource": "OneMotoring ERP Rates PDF, with effect from 23 Mar 2026",
            "latestAdjustmentSource": "LTA news release, Revised ERP Rates from 2 June 2026, published 25 May 2026",
            "gantrySource": "OneMotoring ERP KML marker layer, with data.gov.sg LTA Gantry GeoJSON line geometry where available",
            "sourceLinks": {
                "oneMotoringErpRatesPdf": "https://onemotoring.lta.gov.sg/content/dam/onemotoring/Driving/ERP/ERP%20Rates.pdf",
                "oneMotoringJune2026RatesPdf": "https://onemotoring.lta.gov.sg/content/dam/onemotoring/Driving/ERP/ERP_rates_tables/2026.05.28-ERP%20Rates%20%28Eff.%202%20Jun%202026%20-%2028%20Jun%202026%29.pdf",
                "ltaJune2026Revision": "https://www.lta.gov.sg/content/ltagov/en/newsroom/2026/5/news-releases/revised-erp-rates-2-jun-26.html",
                "oneMotoringErpGuide": "https://onemotoring.lta.gov.sg/content/onemotoring/home/driving/ERP/ERP.html",
                "oneMotoringErpKml": "https://onemotoring.lta.gov.sg/mapapp/kml/erp-kml/erp-kml-0.kml",
                "ltaGantryGeoJson": "https://data.gov.sg/collections/lta-gantry/view",
                "momPublicHolidays2026": "https://www.mom.gov.sg/newsroom/press-releases/2025/0616-public-holidays-for-2026",
            },
            "notes": [
                "Weekday expressway rates are modelled for passenger cars, taxis and light goods vehicles.",
                "Sundays, 2026 Singapore public holidays, and post-1pm eves of major public holidays are treated as zero ERP.",
                "Where LTA defines a set of gantries, the app charges at most once for the set.",
                "Route matching uses proximity plus direction checks against official ERP marker coordinates and should be treated as an estimate.",
            ],
        },
        "groups": groups,
        "gantries": build_gantries(),
        "baseRates": extract_base_rates(),
        "adjustments": JUNE_2026_ADJUSTMENTS,
    }
    (PUBLIC_DATA_DIR / "erp-data.json").write_text(json.dumps(payload, indent=2))
    print(
        f"wrote public/data/erp-data.json with {len(payload['gantries'])} gantries, "
        f"{len(payload['baseRates'])} base rates, {len(payload['adjustments'])} adjustments"
    )


if __name__ == "__main__":
    main()
