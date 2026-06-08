import json
import re
from datetime import datetime, timezone
from pathlib import Path

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
        "groupId": "31,33,34",
        "start": "07:00",
        "end": "07:30",
        "amount": 1,
        "fromDate": "2026-06-02",
        "toDate": "2026-06-28",
        "reason": "June 2026 school holiday reduction",
    },
    {
        "groupId": "31,33,34",
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


def midpoint(coordinates):
    lon = sum(point[0] for point in coordinates) / len(coordinates)
    lat = sum(point[1] for point in coordinates) / len(coordinates)
    return [round(lat, 8), round(lon, 8)]


def build_gantries():
    source = json.loads((DATA_DIR / "lta-gantry.geojson").read_text())
    gantry_to_group = {}
    for group_id in GROUP_LABELS:
        for number in group_id.split(","):
            gantry_to_group[number] = group_id

    gantries = []
    for index, feature in enumerate(source["features"], start=1):
        description = feature["properties"].get("Description", "")
        gantry_no = extract_field(description, "GNTRY_NUM")
        if gantry_no in {"UNK", ""}:
            gantry_no = None
        unique_id = extract_field(description, "UNIQUE_ID")
        coordinates = feature["geometry"]["coordinates"]
        lat_lng_line = [[round(point[1], 8), round(point[0], 8)] for point in coordinates]
        group_id = gantry_to_group.get(gantry_no)
        gantries.append(
            {
                "id": f"g{index}",
                "gantryNo": gantry_no,
                "uniqueId": unique_id,
                "groupId": group_id,
                "label": GROUP_LABELS.get(group_id, f"Gantry {gantry_no}" if gantry_no else "Unnumbered gantry"),
                "center": midpoint(coordinates),
                "line": lat_lng_line,
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
            "gantrySource": "data.gov.sg LTA Gantry (GEOJSON), last updated 06 Jun 2024",
            "notes": [
                "Weekday rates are modelled. Saturdays and Sundays are treated as zero ERP in this app.",
                "Public holidays and eve-of-public-holiday early cut-offs are not modelled in this first version.",
                "Where LTA defines a set of gantries, the app charges at most once for the set.",
                "Route matching uses proximity to the official gantry line geometry and should be treated as an estimate.",
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
