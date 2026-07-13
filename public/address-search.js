const SINGAPORE_BOUNDS = {
  minLat: 1.13,
  maxLat: 1.49,
  minLng: 103.58,
  maxLng: 104.12,
};

const ADDRESS_ABBREVIATIONS = new Map([
  ["AVENUE", "Ave"],
  ["BOULEVARD", "Blvd"],
  ["CLOSE", "Cl"],
  ["CRESCENT", "Cres"],
  ["DRIVE", "Dr"],
  ["EXPRESSWAY", "Expwy"],
  ["HIGHWAY", "Hwy"],
  ["PLACE", "Pl"],
  ["ROAD", "Rd"],
  ["STREET", "St"],
  ["TERRACE", "Terr"],
]);

const ADDRESS_ACRONYMS = new Set([
  "AYE",
  "BKE",
  "CBD",
  "CTE",
  "ECP",
  "HDB",
  "ITE",
  "KPE",
  "LRT",
  "MRT",
  "NIL",
  "NUS",
  "NTU",
  "PIE",
  "SLE",
  "SMU",
  "TPE",
]);

export function normalizeOneMapAddressResults(payload, query, limit = 5) {
  if (!Array.isArray(payload?.results)) {
    return [];
  }

  const normalizedQuery = String(query || "").trim();
  const isPostalQuery = isSingaporePostalCode(normalizedQuery);
  const exactPostalResults = isPostalQuery
    ? payload.results.filter((result) => String(result?.POSTAL || "").trim() === normalizedQuery)
    : [];
  const candidates = isPostalQuery ? exactPostalResults : payload.results;
  const rankedCandidates = [...candidates].sort((a, b) => {
    if (!isPostalQuery) {
      return 0;
    }
    return neutralBuildingRank(a) - neutralBuildingRank(b);
  });

  const suggestions = [];
  const seen = new Set();
  for (const result of rankedCandidates) {
    const lat = Number(result?.LATITUDE);
    const lng = Number(result?.LONGITUDE);
    if (!isSingaporeCoordinate(lat, lng)) {
      continue;
    }
    const label = formatOneMapAddress(result);
    if (!label) {
      continue;
    }
    const key = `${lat.toFixed(7)},${lng.toFixed(7)}|${label.toLocaleLowerCase("en-SG")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    suggestions.push({ lat, lng, label, source: "onemap" });
    if (suggestions.length >= limit) {
      break;
    }
  }
  return suggestions;
}

export function isSingaporePostalCode(value) {
  return /^\d{6}$/.test(String(value || "").trim());
}

export function createConfirmedAddress(point, inputValue = null) {
  const lat = point?.lat;
  const lng = point?.lng;
  const label = cleanAddressText(point?.label);
  if (!isSingaporeCoordinate(lat, lng) || !label) {
    throw new TypeError("Confirmed address must contain Singapore coordinates and a label.");
  }
  const resolvedInputValue = inputValue === null ? label : cleanAddressText(inputValue);
  return {
    lat,
    lng,
    label,
    inputValue: resolvedInputValue || label,
  };
}

export function confirmedAddressFromSharedParams(params, prefix) {
  const lat = Number(params?.get?.(`${prefix}lat`));
  const lng = Number(params?.get?.(`${prefix}lng`));
  const label = params?.get?.(`${prefix}label`);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !label) {
    return null;
  }
  try {
    return createConfirmedAddress({ lat, lng, label });
  } catch {
    return null;
  }
}

export function formatOneMapAddress(result) {
  const officialAddress = cleanAddressText(
    result?.ADDRESS ||
      [result?.BLK_NO, result?.ROAD_NAME, neutralBuildingName(result), "SINGAPORE", result?.POSTAL]
        .filter(Boolean)
        .join(" "),
  );
  return officialAddress
    .split(" ")
    .map(formatAddressToken)
    .join(" ");
}

function neutralBuildingRank(result) {
  return neutralBuildingName(result) ? 1 : 0;
}

function neutralBuildingName(result) {
  const building = cleanAddressText(result?.BUILDING);
  return building && building.toUpperCase() !== "NIL" ? building : "";
}

function formatAddressToken(token) {
  const upper = token.toUpperCase();
  if (ADDRESS_ABBREVIATIONS.has(upper)) {
    return ADDRESS_ABBREVIATIONS.get(upper);
  }
  if (ADDRESS_ACRONYMS.has(upper) || /\d/.test(upper)) {
    return upper;
  }
  return upper
    .toLocaleLowerCase("en-SG")
    .replace(/(^|[-'])\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-SG"));
}

function cleanAddressText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isSingaporeCoordinate(lat, lng) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= SINGAPORE_BOUNDS.minLat &&
    lat <= SINGAPORE_BOUNDS.maxLat &&
    lng >= SINGAPORE_BOUNDS.minLng &&
    lng <= SINGAPORE_BOUNDS.maxLng
  );
}
