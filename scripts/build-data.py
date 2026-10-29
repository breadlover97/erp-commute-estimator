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

# CBD rows share tariffs, but entering at separate gantries is charged separately.
# Do not deduplicate all of Orchard as if it were an expressway gantry set.
CBD_GROUPS = {
    "1": "Victoria Street", "2": "Nicoll Highway", "9": "Bencoolen Street",
    "10": "Queen Street", "11": "North Bridge Road", "16": "Beach Road",
    "17": "Temasek Boulevard", "18": "Republic Boulevard", "23": "River Valley Road",
    "3": "Eu Tong Sen Street", "5": "Lim Teck Kim Road", "6": "Anson Road",
    "7": "Tanjong Pagar Road", "19": "Havelock Road / Clemenceau Avenue",
    "20": "Havelock Road / CTE exit", "24": "Merchant Road / Clemenceau Avenue",
    "25": "Merchant Road / CTE exit", "28": "Central Boulevard",
    "29": "MCE westbound slip road towards Maxwell Road", "72": "Sheares Avenue towards Sheares Link",
    "4": "Orchard Link", "12": "Oxley Road", "13": "Orchard Road",
    "14": "Orchard Turn", "15": "Killiney Road", "21": "Buyong Road",
    "22": "Kramat Road", "26": "Clemenceau Avenue", "27": "Cairnhill Road",
    "47": "Orchard Road at YMCA", "49": "Fort Canning Tunnel", "48": "Handy Road",
    "61": "New Bridge Road", "62": "South Bridge Road",
    "64": "Fullerton Road southbound", "69": "Bayfront Avenue southbound",
    "60": "Eu Tong Sen Street at Central", "63": "Fullerton Road northbound",
    "66": "Bayfront Avenue northbound",
}
GROUP_LABELS.update(CBD_GROUPS)
PDF_REFERENCES = {
    "Refer to 1": ["1", "2", "9", "10", "11", "16", "17", "18", "23"],
    "Refer to 2": ["3", "5", "6", "7", "19", "20", "24", "25", "28", "29", "72"],
    "Refer to 3": ["4", "12", "13", "14", "15", "21", "22", "26", "27"],
}


def text_items(page):
    items = []

    def visitor(text, cm, tm, font_dict, font_size):
        clean = " ".join(text.split())
        if clean:
            items.append({"x": round(tm[4], 2), "y": round(tm[5], 2), "text": clean})

    page.extract_text(visitor_text=visitor)
    return items


def extract_base_rates():
    """Extract every nonblank rate cell, failing closed if the PDF layout changes."""
    reader = PdfReader(DATA_DIR / "erp-rates.pdf")
    if len(reader.pages) != 5 or "07 Sep 2026" not in reader.pages[0].extract_text():
        raise ValueError("Review the new source PDF and update its expected effective date/layout first")
    rates = []
    source_cell_count = 0
    for page_number in range(4):
        items = text_items(reader.pages[page_number])
        header_y = 685 if page_number < 2 else 663
        columns = [item for item in items if item["y"] == header_y and (
            re.fullmatch(r"\d+(?:,\d+)*", item["text"]) or item["text"] in PDF_REFERENCES
        )]
        columns.sort(key=lambda item: item["x"])
        expected_columns = 14 if page_number < 2 else 28
        if len(columns) != expected_columns:
            raise ValueError(f"Unexpected columns on PDF page {page_number + 1}")
        rows = {item["y"]: item for item in items
                if re.fullmatch(r"\d{2}:\d{2} - \d{2}:\d{2}", item["text"])}
        for amount_item in (item for item in items if item["text"].startswith("$")):
            row = rows.get(amount_item["y"])
            if not row:
                raise ValueError(f"Unmatched amount row on PDF page {page_number + 1}")
            column = min(columns, key=lambda item: abs(item["x"] - amount_item["x"]))
            if abs(column["x"] - amount_item["x"]) > 16:
                raise ValueError(f"Unmatched amount column on PDF page {page_number + 1}")
            if page_number < 2 and columns.index(column) >= 7:
                raise ValueError("Saturday rates added: update the calculation engine before publishing")
            start, end = row["text"].split(" - ")
            amount = float(amount_item["text"].removeprefix("$"))
            group_ids = (PDF_REFERENCES.get(column["text"], column["text"].split(","))
                         if page_number < 2 else [column["text"]])
            for group_id in group_ids:
                if group_id not in GROUP_LABELS:
                    raise ValueError(f"Unmapped rate group: {group_id}")
                rates.append({"groupId": group_id, "start": start, "end": end, "amount": amount})
            source_cell_count += 1
    if source_cell_count != 294:
        raise ValueError(f"Expected 294 nonblank source cells, extracted {source_cell_count}")
    # Adjacent equal-price intervals are equivalent and need no extra runtime lookup.
    compact = []
    for rate in sorted(rates, key=lambda rate: (rate["groupId"], rate["start"])):
        if compact and all(compact[-1][key] == rate[key] for key in ("groupId", "amount")) and compact[-1]["end"] == rate["start"]:
            compact[-1]["end"] = rate["end"]
        else:
            compact.append(rate.copy())
    return compact


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
        raw_gantry_no = feature["properties"].get("GNTRY_NUM") or extract_field(description, "GNTRY_NUM")
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


def build_gantries(active_group_ids):
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
                "id": f"gantry-{gantry_no}",
                "gantryNo": gantry_no,
                "rawGantryNo": gantry_no,
                "uniqueId": None,
                "groupId": group_id,
                "label": GROUP_LABELS.get(group_id, location_label),
                "directionDegrees": GROUP_DIRECTIONS.get(group_id),
                "center": [round(lat, 8), round(lon, 8)],
                "line": lines_by_gantry.get(gantry_no, []),
                "isPriced": group_id in active_group_ids,
            }
        )
    return gantries


def main():
    groups = [
        {"id": group_id, "label": label, "gantryNos": group_id.split(",")}
        for group_id, label in GROUP_LABELS.items()
    ]
    rates = extract_base_rates()
    active_group_ids = {rate["groupId"] for rate in rates if rate["amount"] > 0}
    manifest = json.loads((DATA_DIR / "sources.json").read_text())
    payload = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "verifiedOn": manifest["verifiedOn"],
            "ratesEffectiveFrom": "2026-09-07",
            "ratesVerifiedThrough": manifest["verifiedOn"],
            "nextReviewNote": "LTA expects its next rate review in mid-November 2026.",
            "vehicleClass": "Passenger cars, taxis and light goods vehicles",
            "baseRateSource": "OneMotoring full ERP rate table, effective 7 September 2026",
            "latestAdjustmentSource": "Full September 2026 rate table includes Orchard Cordon and June expressway revisions",
            "gantrySource": "OneMotoring ERP markers retrieved 29 October 2026; LTA DataMall September 2026 ERP gantry geometry",
            "sourceLinks": {key: source["url"] for key, source in manifest["sources"].items()},
            "notes": [
                "All published weekday rates, including Orchard, and exact five-minute transition bands are included.",
                "Saturdays, Sundays and published Singapore public holidays have no ERP charges under this verified schedule.",
                "Holiday-eve closure is applied at 13:00 for New Year, Chinese New Year, Deepavali and Christmas; conflicting LTA guidance on Hari Raya eves is flagged.",
                "Orchard gantries share a tariff but are separate charging locations; expressway gantry sets are counted once per trip.",
                "Routes and crossing times are estimates. Physical gantry removal does not establish removal of an ERP charging location.",
                "Dates outside the verified schedule use the current table as a projection; future quarterly and school-holiday changes are not yet known.",
            ],
        },
        "calendar": json.loads((DATA_DIR / "calendar.json").read_text()),
        "groups": groups,
        "gantries": build_gantries(active_group_ids),
        "baseRates": rates,
        "adjustments": [],
    }
    (PUBLIC_DATA_DIR / "erp-data.json").write_text(json.dumps(payload, indent=2) + "\n")
    print(
        f"wrote public/data/erp-data.json with {len(payload['gantries'])} gantries, "
        f"{len(payload['baseRates'])} base rates, {len(payload['adjustments'])} adjustments"
    )


if __name__ == "__main__":
    main()
