import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const data = JSON.parse(await readFile(new URL("../public/data/erp-data.json", import.meta.url), "utf8"));

const GANTRY_POINT_MATCH_THRESHOLD_METERS = 115;
const GANTRY_LINE_MATCH_THRESHOLD_METERS = 70;
const DIRECTION_TOLERANCE_DEGREES = 75;

const routeCases = [
  {
    gantryNo: "35",
    groupId: "35",
    bearing: 180,
    reverseBearing: 0,
    label: "CTE southbound before Braddell Road",
  },
  {
    gantryNo: "50",
    groupId: "50",
    bearing: 180,
    reverseBearing: 0,
    label: "KPE southbound after Defu Flyover",
  },
  {
    gantryNo: "46",
    groupId: "46,67",
    bearing: 0,
    reverseBearing: 180,
    label: "CTE northbound after PIE",
  },
  {
    gantryNo: "67",
    groupId: "46,67",
    bearing: 0,
    reverseBearing: 180,
    label: "CTE northbound slip road into CTE",
  },
  {
    gantryNo: "65",
    groupId: "65",
    bearing: 270,
    reverseBearing: 90,
    label: "PIE westbound before Eunos Link",
    matchType: "line",
  },
];

for (const routeCase of routeCases) {
  const gantry = data.gantries.find((item) => item.gantryNo === routeCase.gantryNo);
  assert.ok(gantry, `Missing gantry ${routeCase.gantryNo}`);
  assert.equal(gantry.groupId, routeCase.groupId, `${routeCase.label} has the wrong priced group`);
  assert.ok(
    Number.isFinite(gantry.directionDegrees),
    `${routeCase.label} must have an explicit travel direction`,
  );

  const forwardRoute = syntheticRouteThrough(gantry, routeCase.bearing);
  const forwardMatch = matchGantriesToRoute(forwardRoute).find(
    (match) => match.gantry.gantryNo === routeCase.gantryNo,
  );
  assert.ok(forwardMatch, `${routeCase.label} did not match in the charged direction`);
  assert.equal(forwardMatch.gantry.groupId, routeCase.groupId);
  assert.ok(
    forwardMatch.distanceMeters <= GANTRY_POINT_MATCH_THRESHOLD_METERS,
    `${routeCase.label} matched too far from gantry`,
  );
  if (routeCase.matchType) {
    assert.equal(forwardMatch.matchType, routeCase.matchType, `${routeCase.label} should match line geometry`);
  }

  const reverseRoute = syntheticRouteThrough(gantry, routeCase.reverseBearing);
  const reverseMatch = matchGantriesToRoute(reverseRoute).find(
    (match) => match.gantry.gantryNo === routeCase.gantryNo,
  );
  assert.equal(reverseMatch, undefined, `${routeCase.label} matched in the opposite direction`);
}

console.log("ERP route matching validation passed");

function matchGantriesToRoute(route) {
  const matches = [];
  for (const gantry of data.gantries) {
    const closest = closestProgressToGantry(gantry, route);
    const threshold =
      closest.matchType === "line" ? GANTRY_LINE_MATCH_THRESHOLD_METERS : GANTRY_POINT_MATCH_THRESHOLD_METERS;
    if (
      closest.distanceMeters <= threshold &&
      routeDirectionMatchesGantry(closest.routeBearingDegrees, gantry.directionDegrees)
    ) {
      matches.push({
        gantry,
        distanceMeters: closest.distanceMeters,
        directionDelta: directionDelta(closest.routeBearingDegrees, gantry.directionDegrees),
        progressMeters: closest.progressMeters,
        progressRatio: route.totalMeters > 0 ? closest.progressMeters / route.totalMeters : 0,
        matchType: closest.matchType,
      });
    }
  }
  return matches.sort((a, b) => a.progressMeters - b.progressMeters);
}

function closestProgressToGantry(gantry, route) {
  if (gantry.line?.length > 1) {
    return closestProgressToGantryLine(
      gantry.line.map(([lat, lng]) => ({ lat, lng })),
      route.points,
      route.cumulativeMeters,
    );
  }
  return {
    ...closestProgressOnRoute({ lat: gantry.center[0], lng: gantry.center[1] }, route.points, route.cumulativeMeters),
    matchType: "marker",
  };
}

function closestProgressToGantryLine(linePoints, routePoints, cumulativeMeters) {
  let best = {
    distanceMeters: Number.POSITIVE_INFINITY,
    progressMeters: 0,
    routeBearingDegrees: null,
    matchType: "line",
  };
  const originLat = linePoints[0].lat;

  for (let routeIndex = 0; routeIndex < routePoints.length - 1; routeIndex += 1) {
    const routeStart = routePoints[routeIndex];
    const routeEnd = routePoints[routeIndex + 1];
    const routeStartMeters = toMeters(routeStart, originLat);
    const routeEndMeters = toMeters(routeEnd, originLat);

    for (let lineIndex = 0; lineIndex < linePoints.length - 1; lineIndex += 1) {
      const gantryStartMeters = toMeters(linePoints[lineIndex], originLat);
      const gantryEndMeters = toMeters(linePoints[lineIndex + 1], originLat);
      const closest = closestSegmentDistance(routeStartMeters, routeEndMeters, gantryStartMeters, gantryEndMeters);
      if (closest.distanceMeters < best.distanceMeters) {
        const segmentMeters = haversineMeters(routeStart, routeEnd);
        best = {
          distanceMeters: closest.distanceMeters,
          progressMeters: cumulativeMeters[routeIndex] + segmentMeters * closest.routeT,
          routeBearingDegrees: bearingDegrees(routeStart, routeEnd),
          matchType: "line",
        };
      }
    }
  }

  return best;
}

function closestSegmentDistance(a, b, c, d) {
  const intersection = segmentIntersectionParameter(a, b, c, d);
  if (intersection !== null) {
    return {
      distanceMeters: 0,
      routeT: intersection,
    };
  }

  const candidates = [
    { distanceMeters: pointToSegmentDistance(a, c, d).distanceMeters, routeT: 0 },
    { distanceMeters: pointToSegmentDistance(b, c, d).distanceMeters, routeT: 1 },
  ];
  const cToRoute = pointToSegmentDistance(c, a, b);
  const dToRoute = pointToSegmentDistance(d, a, b);
  candidates.push({ distanceMeters: cToRoute.distanceMeters, routeT: cToRoute.t });
  candidates.push({ distanceMeters: dToRoute.distanceMeters, routeT: dToRoute.t });
  return candidates.reduce((best, item) => (item.distanceMeters < best.distanceMeters ? item : best));
}

function segmentIntersectionParameter(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-9) {
    return null;
  }
  const cMinusA = { x: c.x - a.x, y: c.y - a.y };
  const t = cross(cMinusA, s) / denominator;
  const u = cross(cMinusA, r) / denominator;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return t;
  }
  return null;
}

function pointToSegmentDistance(point, start, end) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) {
    return {
      distanceMeters: Math.hypot(point.x - start.x, point.y - start.y),
      t: 0,
    };
  }
  const t = clamp(((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared, 0, 1);
  const closest = {
    x: start.x + segmentX * t,
    y: start.y + segmentY * t,
  };
  return {
    distanceMeters: Math.hypot(point.x - closest.x, point.y - closest.y),
    t,
  };
}

function syntheticRouteThrough(gantry, bearing) {
  const center = gantry.line?.length > 1 ? lineMidpoint(gantry.line) : { lat: gantry.center[0], lng: gantry.center[1] };
  const points = [
    destinationPoint(center, (bearing + 180) % 360, 240),
    center,
    destinationPoint(center, bearing, 240),
  ];
  const cumulativeMeters = buildCumulativeDistances(points);
  return {
    points,
    cumulativeMeters,
    totalMeters: cumulativeMeters.at(-1),
    durationSeconds: 90,
  };
}

function lineMidpoint(line) {
  const middleIndex = Math.floor((line.length - 1) / 2);
  if (line.length === 2) {
    return {
      lat: (line[0][0] + line[1][0]) / 2,
      lng: (line[0][1] + line[1][1]) / 2,
    };
  }
  return { lat: line[middleIndex][0], lng: line[middleIndex][1] };
}

function buildCumulativeDistances(points) {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative[index] = cumulative[index - 1] + haversineMeters(points[index - 1], points[index]);
  }
  return cumulative;
}

function closestProgressOnRoute(point, routePoints, cumulativeMeters) {
  let best = {
    distanceMeters: Number.POSITIVE_INFINITY,
    progressMeters: 0,
    routeBearingDegrees: null,
  };
  const originLat = point.lat;
  const pointXY = toMeters(point, originLat);

  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const start = toMeters(routePoints[index], originLat);
    const end = toMeters(routePoints[index + 1], originLat);
    const closest = pointToSegmentDistance(pointXY, start, end);
    if (closest.distanceMeters < best.distanceMeters) {
      const segmentMeters = haversineMeters(routePoints[index], routePoints[index + 1]);
      best = {
        distanceMeters: closest.distanceMeters,
        progressMeters: cumulativeMeters[index] + segmentMeters * closest.t,
        routeBearingDegrees: bearingDegrees(routePoints[index], routePoints[index + 1]),
      };
    }
  }

  return best;
}

function routeDirectionMatchesGantry(routeBearingDegrees, gantryDirectionDegrees) {
  if (!Number.isFinite(gantryDirectionDegrees) || !Number.isFinite(routeBearingDegrees)) {
    return true;
  }
  return directionDelta(routeBearingDegrees, gantryDirectionDegrees) <= DIRECTION_TOLERANCE_DEGREES;
}

function directionDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  return Math.round(Math.abs((((a - b) % 360) + 540) % 360 - 180));
}

function bearingDegrees(a, b) {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function haversineMeters(a, b) {
  const radius = 6371000;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function destinationPoint(start, bearing, distanceMeters) {
  const radius = 6371000;
  const angularDistance = distanceMeters / radius;
  const bearingRadians = toRadians(bearing);
  const lat1 = toRadians(start.lat);
  const lng1 = toRadians(start.lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRadians),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );
  return {
    lat: toDegrees(lat2),
    lng: ((toDegrees(lng2) + 540) % 360) - 180,
  };
}

function toMeters(point, originLat) {
  const radius = 6371000;
  return {
    x: toRadians(point.lng) * radius * Math.cos(toRadians(originLat)),
    y: toRadians(point.lat) * radius,
  };
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}
