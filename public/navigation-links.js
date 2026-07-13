const GOOGLE_MAPS_MAX_WAYPOINTS = 3;
const MAX_ROUTE_ENDPOINT_BUFFER_RATIO = 0.08;
const ROUTE_ENDPOINT_BUFFER_METERS = 250;
const MIN_ROUTE_DIVERGENCE_METERS = 25;

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

export function buildGoogleMapsNavigationUrl({
  origin,
  destination,
  routePoints = [],
  alternativeRoutePoints = [],
}) {
  const safeOrigin = normalizePoint(origin, "origin");
  const safeDestination = normalizePoint(destination, "destination");
  const url = new URL("https://www.google.com/maps/dir/");

  url.searchParams.set("api", "1");
  url.searchParams.set("origin", formatPoint(safeOrigin));
  url.searchParams.set("destination", formatPoint(safeDestination));
  url.searchParams.set("travelmode", "driving");
  url.searchParams.set("dir_action", "navigate");

  const endpointCoordinates = new Set([formatPoint(safeOrigin), formatPoint(safeDestination)]);
  const waypoints = selectRouteWaypoints(routePoints, { alternativeRoutePoints }).filter(
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

export function selectRouteWaypoints(
  routePoints,
  { alternativeRoutePoints = [], maxWaypoints = GOOGLE_MAPS_MAX_WAYPOINTS } = {},
) {
  const safePoints = sanitizeRoutePoints(routePoints);
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

  const alternatives = Array.isArray(alternativeRoutePoints)
    ? alternativeRoutePoints.map(sanitizeRoutePoints).filter((route) => route.length > 1)
    : [];
  const candidateCount = Math.min(400, Math.max(32, Math.ceil(totalMeters / 125)));
  const endpointBufferRatio = Math.min(
    MAX_ROUTE_ENDPOINT_BUFFER_RATIO,
    ROUTE_ENDPOINT_BUFFER_METERS / totalMeters,
  );
  const candidates = Array.from({ length: candidateCount }, (_, index) => {
    const progress =
      endpointBufferRatio +
      ((1 - endpointBufferRatio * 2) * index) / (candidateCount - 1);
    const point = pointAtRouteProgress(safePoints, cumulativeMeters, totalMeters, progress);
    return {
      point,
      progress,
      alternativeDistances: alternatives.map((route) => closestDistanceToPolylineMeters(point, route)),
      smoothedAlternativeDistances: [],
    };
  });
  const smoothingWindow = Math.min(0.06, 300 / totalMeters);
  candidates.forEach((candidate) => {
    candidate.smoothedAlternativeDistances = alternatives.map((_, alternativeIndex) => {
      const nearbyCandidates = candidates.filter(
        (item) => Math.abs(item.progress - candidate.progress) <= smoothingWindow,
      );
      return mean(
        nearbyCandidates.map((item) => item.alternativeDistances[alternativeIndex]),
      );
    });
  });

  const selected = [];
  const minimumSpacing = Math.min(0.24, 500 / totalMeters);

  for (let alternativeIndex = 0; alternativeIndex < alternatives.length; alternativeIndex += 1) {
    if (selected.length >= waypointCount) {
      break;
    }
    const best = highestScoringCandidate(
      candidates,
      selected,
      minimumSpacing,
      (candidate) => candidate.smoothedAlternativeDistances[alternativeIndex],
    );
    if (
      best &&
      best.smoothedAlternativeDistances[alternativeIndex] >= MIN_ROUTE_DIVERGENCE_METERS
    ) {
      selected.push(best);
    }
  }

  while (selected.length < waypointCount) {
    const best = highestScoringCandidate(
      candidates,
      selected,
      minimumSpacing,
      (candidate) => routeShapingScore(candidate, selected, safePoints, totalMeters),
    );
    if (best) {
      selected.push(best);
      continue;
    }
    const relaxedBest = highestScoringCandidate(
      candidates,
      selected,
      Math.min(0.06, minimumSpacing / 2),
      (candidate) => routeShapingScore(candidate, selected, safePoints, totalMeters),
    );
    if (!relaxedBest) {
      break;
    }
    selected.push(relaxedBest);
  }

  return selected
    .sort((a, b) => a.progress - b.progress)
    .map((candidate) => candidate.point);
}

function sanitizeRoutePoints(routePoints) {
  if (!Array.isArray(routePoints)) {
    return [];
  }
  const safePoints = [];
  for (const point of routePoints) {
    if (!isValidPoint(point)) {
      continue;
    }
    const normalized = normalizePoint(point, "route point");
    if (!safePoints.length || formatPoint(safePoints.at(-1)) !== formatPoint(normalized)) {
      safePoints.push(normalized);
    }
  }
  return safePoints;
}

function pointAtRouteProgress(routePoints, cumulativeMeters, totalMeters, progress) {
  const targetMeters = totalMeters * progress;
  const segmentEndIndex = cumulativeMeters.findIndex((distance) => distance >= targetMeters);
  const safeEndIndex = segmentEndIndex < 1 ? 1 : segmentEndIndex;
  const segmentStartIndex = safeEndIndex - 1;
  const segmentMeters = cumulativeMeters[safeEndIndex] - cumulativeMeters[segmentStartIndex];
  const segmentProgress = segmentMeters
    ? (targetMeters - cumulativeMeters[segmentStartIndex]) / segmentMeters
    : 0;
  return interpolatePoint(
    routePoints[segmentStartIndex],
    routePoints[safeEndIndex],
    segmentProgress,
  );
}

function highestScoringCandidate(candidates, selected, minimumSpacing, scoreCandidate) {
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (
      selected.includes(candidate) ||
      selected.some((item) => Math.abs(item.progress - candidate.progress) < minimumSpacing)
    ) {
      continue;
    }
    const score = scoreCandidate(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function routeShapingScore(candidate, selected, routePoints, totalMeters) {
  const anchors = [
    { point: routePoints[0], progress: 0 },
    ...selected,
    { point: routePoints.at(-1), progress: 1 },
  ].sort((a, b) => a.progress - b.progress);
  const nextAnchorIndex = anchors.findIndex((anchor) => anchor.progress > candidate.progress);
  const previousAnchor = anchors[Math.max(0, nextAnchorIndex - 1)];
  const nextAnchor = anchors[nextAnchorIndex];
  const shapeError = pointToSegmentDistanceMeters(
    candidate.point,
    previousAnchor.point,
    nextAnchor.point,
  );
  const coverageMeters =
    Math.min(...anchors.map((anchor) => Math.abs(anchor.progress - candidate.progress))) * totalMeters;
  const divergence = mean(candidate.smoothedAlternativeDistances);
  return shapeError + divergence * 1.5 + Math.min(coverageMeters, totalMeters / 4) * 0.2;
}

function closestDistanceToPolylineMeters(point, routePoints) {
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < routePoints.length - 1; index += 1) {
    closestDistance = Math.min(
      closestDistance,
      pointToSegmentDistanceMeters(point, routePoints[index], routePoints[index + 1]),
    );
  }
  return closestDistance;
}

function pointToSegmentDistanceMeters(point, segmentStart, segmentEnd) {
  const start = toLocalMeters(segmentStart, point);
  const end = toLocalMeters(segmentEnd, point);
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
  const progress = segmentLengthSquared
    ? Math.max(0, Math.min(1, (-start.x * segmentX - start.y * segmentY) / segmentLengthSquared))
    : 0;
  const closestX = start.x + segmentX * progress;
  const closestY = start.y + segmentY * progress;
  return Math.hypot(closestX, closestY);
}

function toLocalMeters(point, origin) {
  const earthRadiusMeters = 6371000;
  return {
    x:
      toRadians(point.lng - origin.lng) *
      earthRadiusMeters *
      Math.cos(toRadians((point.lat + origin.lat) / 2)),
    y: toRadians(point.lat - origin.lat) * earthRadiusMeters,
  };
}

function mean(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
