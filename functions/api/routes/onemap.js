import { fetchOneMapJson } from "../../_lib/onemap.js";

const ONEMAP_ROUTE_ENDPOINT = "https://www.onemap.gov.sg/api/public/routingsvc/route";
const JSON_RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  Vary: "Sec-Fetch-Site",
};

export async function onRequestGet({ request, env }) {
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return jsonResponse({ error: "Cross-site requests are not allowed.", code: "cross_site_request_blocked" }, 403);
  }
  const url = new URL(request.url);
  const start = parseCoordinatePair(url.searchParams.get("start"));
  const end = parseCoordinatePair(url.searchParams.get("end"));
  if (!start || !end) {
    return jsonResponse({ error: "Provide valid latitude,longitude pairs.", code: "invalid_coordinates" }, 400);
  }
  if (![start, end].every(isInSingapore)) {
    return jsonResponse({ error: "OneMap routing only supports Singapore.", code: "outside_singapore" }, 400);
  }
  const routeUrl = new URL(ONEMAP_ROUTE_ENDPOINT);
  routeUrl.search = new URLSearchParams({ start: `${start.lat},${start.lng}`, end: `${end.lat},${end.lng}`, routeType: "drive" });
  try {
    const { response, payload } = await fetchOneMapJson(routeUrl, { env, signal: request.signal });
    if (!response.ok || !payload || payload.error) {
      return jsonResponse({ error: "OneMap could not calculate this route.", code: payload?.code || "onemap_route_failed" }, response.ok ? 502 : response.status);
    }
    return jsonResponse(payload, 200);
  } catch (error) {
    return jsonResponse({ error: "OneMap is temporarily unavailable.", code: error.name === "AbortError" ? "onemap_timeout" : "onemap_unavailable" }, 504);
  }
}

function parseCoordinatePair(value) {
  if (!value || !/^[+-]?\d+(?:\.\d+)?,[+-]?\d+(?:\.\d+)?$/.test(value)) return null;
  const [lat, lng] = value.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function isInSingapore({ lat, lng }) {
  return lat >= 1.13 && lat <= 1.49 && lng >= 103.58 && lng <= 104.12;
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_RESPONSE_HEADERS });
}
