import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { loadAppForTest } from "./app-test-harness.mjs";

const data = JSON.parse(await readFile(new URL("../public/data/erp-data.json", import.meta.url), "utf8"));

const { api } = await loadAppForTest(data);
const { matchGantriesToRoute, buildCumulativeDistances, bearingDegrees, haversineMeters } = api;
const GANTRY_POINT_MATCH_THRESHOLD_METERS = 115;

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

const cteBraddellRoute = syntheticRouteThrough(
  data.gantries.find((item) => item.gantryNo === "31"),
  180,
);
const cteBraddellGroups = matchGantriesToRoute(cteBraddellRoute)
  .map((match) => match.gantry.groupId)
  .filter(Boolean);
assert.ok(
  cteBraddellGroups.includes("31,33,34"),
  "CTE after Braddell should keep the direct mainline gantry group",
);
assert.ok(
  !cteBraddellGroups.includes("68"),
  "CTE after Braddell should not also charge the side-by-side slip-road gantry",
);

const victoriaEndpointRoute = syntheticRouteEndingNearLineEndpoint(data.gantries.find((item) => item.gantryNo === "1"));
const victoriaEndpointMatch = matchGantriesToRoute(victoriaEndpointRoute).find(
  (match) => match.gantry.gantryNo === "1",
);
assert.equal(
  victoriaEndpointMatch,
  undefined,
  "Victoria Street should not match when a route ends near the gantry line endpoint without crossing it",
);

const bencoolenNearRoute = syntheticRouteNearMarker(data.gantries.find((item) => item.gantryNo === "9"), 80);
const bencoolenNearMatch = matchGantriesToRoute(bencoolenNearRoute).find(
  (match) => match.gantry.gantryNo === "9",
);
assert.equal(
  bencoolenNearMatch,
  undefined,
  "Unpriced marker-only gantries should not match routes that pass nearby but not through the marker",
);

console.log("ERP route matching validation passed");

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

function syntheticRouteEndingNearLineEndpoint(gantry) {
  assert.ok(gantry?.line?.length > 1, "Synthetic line endpoint route requires gantry line geometry");
  const endpoint = { lat: gantry.line[0][0], lng: gantry.line[0][1] };
  const otherEndpoint = { lat: gantry.line[1][0], lng: gantry.line[1][1] };
  const awayBearing = (bearingDegrees(endpoint, otherEndpoint) + 180) % 360;
  const points = [destinationPoint(endpoint, awayBearing, 90), destinationPoint(endpoint, awayBearing, 8)];
  const cumulativeMeters = buildCumulativeDistances(points);
  return {
    points,
    cumulativeMeters,
    totalMeters: cumulativeMeters.at(-1),
    durationSeconds: 25,
  };
}

function syntheticRouteNearMarker(gantry, offsetMeters) {
  assert.ok(gantry?.center, "Synthetic marker route requires gantry center geometry");
  const center = { lat: gantry.center[0], lng: gantry.center[1] };
  const shifted = destinationPoint(center, 0, offsetMeters);
  const points = [destinationPoint(shifted, 270, 120), destinationPoint(shifted, 90, 120)];
  const cumulativeMeters = buildCumulativeDistances(points);
  return {
    points,
    cumulativeMeters,
    totalMeters: cumulativeMeters.at(-1),
    durationSeconds: 50,
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

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}
