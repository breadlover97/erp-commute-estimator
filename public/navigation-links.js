const GOOGLE_MAPS_MAX_WAYPOINTS = 3;

export function navigationEndpointsForLeg(startPoint, endPoint, legKey) {
  const safeStart = normalizePoint(startPoint, "start point");
  const safeEnd = normalizePoint(endPoint, "end point");
  if (legKey === "outbound") {
    return { origin: safeStart, destination: safeEnd };
  }
  if (legKey === "return") {
    return { origin: safeEnd, destination: safeStart };
  }
  throw new RangeError('leg key must be either "outbound" or "return".');
}

export function buildGoogleMapsNavigationUrl({ origin, destination, routePoints = [] }) {
  const safeOrigin = normalizePoint(origin, "origin");
  const safeDestination = normalizePoint(destination, "destination");
  const url = new URL("https://www.google.com/maps/dir/");

  url.searchParams.set("api", "1");
  url.searchParams.set("origin", formatPoint(safeOrigin));
  url.searchParams.set("destination", formatPoint(safeDestination));
  url.searchParams.set("travelmode", "driving");
  url.searchParams.set("dir_action", "navigate");

  const endpointCoordinates = new Set([formatPoint(safeOrigin), formatPoint(safeDestination)]);
  const waypoints = sampleRouteWaypoints(routePoints).filter(
    (point) => !endpointCoordinates.has(formatPoint(point)),
  );
  if (waypoints.length) {
    url.searchParams.set("waypoints", waypoints.map(formatPoint).join("|"));
  }

  return url.toString();
}

export function buildWazeNavigationUrl(destination) {
  const safeDestination = normalizePoint(destination, "destination");
  const url = new URL("https://waze.com/ul");

  url.searchParams.set("ll", formatPoint(safeDestination));
  url.searchParams.set("navigate", "yes");
  url.searchParams.set("utm_source", "erp_commute_estimator");

  return url.toString();
}

export function sampleRouteWaypoints(routePoints, maxWaypoints = GOOGLE_MAPS_MAX_WAYPOINTS) {
  const safePoints = Array.isArray(routePoints)
    ? routePoints.filter(isValidPoint).map((point) => normalizePoint(point, "route point"))
    : [];
  const availableInteriorPoints = Math.max(0, safePoints.length - 2);
  const requestedCount = Number.isInteger(maxWaypoints) ? maxWaypoints : GOOGLE_MAPS_MAX_WAYPOINTS;
  const waypointCount = Math.min(
    GOOGLE_MAPS_MAX_WAYPOINTS,
    availableInteriorPoints,
    Math.max(0, requestedCount),
  );

  if (!waypointCount) {
    return [];
  }

  const cumulativeMeters = [0];
  for (let index = 1; index < safePoints.length; index += 1) {
    cumulativeMeters[index] =
      cumulativeMeters[index - 1] + haversineMeters(safePoints[index - 1], safePoints[index]);
  }
  const totalMeters = cumulativeMeters.at(-1);
  if (!totalMeters) {
    return [];
  }

  const sampled = [];
  const seen = new Set();
  for (let position = 1; position <= waypointCount; position += 1) {
    const targetMeters = (totalMeters * position) / (waypointCount + 1);
    const segmentEndIndex = cumulativeMeters.findIndex((distance) => distance >= targetMeters);
    const segmentStartIndex = Math.max(0, segmentEndIndex - 1);
    const segmentMeters = cumulativeMeters[segmentEndIndex] - cumulativeMeters[segmentStartIndex];
    const segmentProgress = segmentMeters
      ? (targetMeters - cumulativeMeters[segmentStartIndex]) / segmentMeters
      : 0;
    const point = interpolatePoint(
      safePoints[segmentStartIndex],
      safePoints[segmentEndIndex],
      segmentProgress,
    );
    const key = formatPoint(point);
    if (!seen.has(key)) {
      sampled.push(point);
      seen.add(key);
    }
  }
  return sampled;
}

function isValidPoint(point) {
  const lat = point?.lat;
  const lng = point?.lng;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function normalizePoint(point, label) {
  if (!isValidPoint(point)) {
    throw new TypeError(`${label} must contain a valid latitude and longitude.`);
  }
  return {
    lat: point.lat,
    lng: point.lng,
  };
}

function formatPoint(point) {
  return `${formatCoordinate(point.lat)},${formatCoordinate(point.lng)}`;
}

function formatCoordinate(value) {
  const coordinate = Math.abs(value) < 0.0000005 ? 0 : value;
  return coordinate.toFixed(6);
}

function interpolatePoint(start, end, progress) {
  return {
    lat: start.lat + (end.lat - start.lat) * progress,
    lng: start.lng + (end.lng - start.lng) * progress,
  };
}

function haversineMeters(start, end) {
  const earthRadiusMeters = 6371000;
  const startLat = toRadians(start.lat);
  const endLat = toRadians(end.lat);
  const deltaLat = toRadians(end.lat - start.lat);
  const deltaLng = toRadians(end.lng - start.lng);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2;
  const clampedHaversine = Math.min(1, Math.max(0, haversine));
  return (
    earthRadiusMeters *
    2 *
    Math.atan2(Math.sqrt(clampedHaversine), Math.sqrt(1 - clampedHaversine))
  );
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}
