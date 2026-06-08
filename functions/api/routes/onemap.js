const ONEMAP_ROUTE_ENDPOINT = "https://www.onemap.gov.sg/api/public/routingsvc/route";
const SINGAPORE_BOUNDS = {
  minLat: 1.13,
  maxLat: 1.49,
  minLng: 103.58,
  maxLng: 104.12,
};

export async function onRequestGet(context) {
  const token = context.env.ONEMAP_API_TOKEN;
  if (!token) {
    return jsonResponse(
      {
        error: "OneMap routing is not configured.",
        code: "missing_onemap_token",
      },
      503,
    );
  }

  const requestUrl = new URL(context.request.url);
  const start = parseCoordinatePair(requestUrl.searchParams.get("start"));
  const end = parseCoordinatePair(requestUrl.searchParams.get("end"));

  if (!start || !end) {
    return jsonResponse(
      {
        error: "Both start and end query parameters must be WGS84 latitude,longitude pairs.",
        code: "invalid_coordinates",
      },
      400,
    );
  }

  if (!isInSingapore(start) || !isInSingapore(end)) {
    return jsonResponse(
      {
        error: "OneMap routing only supports Singapore coordinates.",
        code: "outside_singapore",
      },
      400,
    );
  }

  const oneMapUrl = new URL(ONEMAP_ROUTE_ENDPOINT);
  oneMapUrl.searchParams.set("start", `${start.lat},${start.lng}`);
  oneMapUrl.searchParams.set("end", `${end.lat},${end.lng}`);
  oneMapUrl.searchParams.set("routeType", "drive");

  const response = await fetch(oneMapUrl.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: token,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return jsonResponse(
      {
        error: "OneMap could not calculate this driving route.",
        code: "onemap_route_failed",
        status: response.status,
        details: summarizeOneMapError(payload),
      },
      response.status,
    );
  }

  return jsonResponse(payload, 200);
}

function parseCoordinatePair(value) {
  if (!value) {
    return null;
  }
  const [latRaw, lngRaw] = value.split(",");
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

function isInSingapore(point) {
  return (
    point.lat >= SINGAPORE_BOUNDS.minLat &&
    point.lat <= SINGAPORE_BOUNDS.maxLat &&
    point.lng >= SINGAPORE_BOUNDS.minLng &&
    point.lng <= SINGAPORE_BOUNDS.maxLng
  );
}

function summarizeOneMapError(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return payload.error || payload.message || payload.Message || payload.status_message || null;
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
