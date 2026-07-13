import assert from "node:assert/strict";

import {
  buildGoogleMapsNavigationUrl,
  buildWazeNavigationUrl,
  navigationEndpointsForLeg,
  selectRouteWaypoints,
} from "../public/navigation-links.js";

const origin = { lat: 1.3001234, lng: 103.8005678 };
const destination = { lat: 1.3609876, lng: 103.9004321 };
const routePoints = [
  origin,
  { lat: 1.312, lng: 103.82 },
  { lat: 1.323, lng: 103.84 },
  { lat: 1.335, lng: 103.86 },
  { lat: 1.348, lng: 103.88 },
  destination,
];

assert.deepEqual(navigationEndpointsForLeg(origin, destination, "outbound"), {
  origin,
  destination,
});
assert.deepEqual(navigationEndpointsForLeg(origin, destination, "return"), {
  origin: destination,
  destination: origin,
});
assert.throws(
  () => navigationEndpointsForLeg(origin, destination, "side-trip"),
  /leg key must be either/,
);

const googleMapsUrl = new URL(
  buildGoogleMapsNavigationUrl({
    origin,
    destination,
    routePoints,
    alternativeRoutePoints: [
      [
        origin,
        { lat: 1.302, lng: 103.84 },
        { lat: 1.32, lng: 103.88 },
        destination,
      ],
    ],
  }),
);
assert.equal(googleMapsUrl.origin, "https://www.google.com");
assert.equal(googleMapsUrl.pathname, "/maps/dir/");
assert.equal(googleMapsUrl.searchParams.get("api"), "1");
assert.equal(googleMapsUrl.searchParams.get("origin"), "1.300123,103.800568");
assert.equal(googleMapsUrl.searchParams.get("destination"), "1.360988,103.900432");
assert.equal(googleMapsUrl.searchParams.get("travelmode"), "driving");
assert.equal(googleMapsUrl.searchParams.get("dir_action"), "navigate");
assert.equal(googleMapsUrl.searchParams.get("waypoints").split("|").length, 3);
assert.ok(googleMapsUrl.toString().length < 2048, "Google Maps URL must stay below its URL limit");

const wazeUrl = new URL(buildWazeNavigationUrl(destination));
assert.equal(wazeUrl.origin, "https://waze.com");
assert.equal(wazeUrl.pathname, "/ul");
assert.equal(wazeUrl.searchParams.get("ll"), "1.360988,103.900432");
assert.equal(wazeUrl.searchParams.get("navigate"), "yes");
assert.equal(wazeUrl.searchParams.get("utm_source"), "erp_commute_estimator");

assert.deepEqual(selectRouteWaypoints([origin, destination]), []);
assert.equal(selectRouteWaypoints(routePoints, { maxWaypoints: 20 }).length, 3);

const branchOrigin = { lat: 1.3, lng: 103.8 };
const branchDestination = { lat: 1.3, lng: 103.9 };
const selectedBranch = [
  branchOrigin,
  { lat: 1.3, lng: 103.82 },
  { lat: 1.308, lng: 103.835 },
  { lat: 1.308, lng: 103.855 },
  { lat: 1.3, lng: 103.87 },
  branchDestination,
];
const straightAlternative = [
  branchOrigin,
  { lat: 1.3, lng: 103.84 },
  { lat: 1.3, lng: 103.88 },
  branchDestination,
];
const branchWaypoints = selectRouteWaypoints(selectedBranch, {
  alternativeRoutePoints: [straightAlternative],
});
assert.equal(branchWaypoints.length, 3);
assert.ok(
  branchWaypoints.some((point) => point.lat > 1.306),
  "route handoff should anchor the selected route's distinct corridor",
);
assert.ok(
  branchWaypoints.every((point, index) => index === 0 || point.lng > branchWaypoints[index - 1].lng),
  "route-shaping waypoints must remain in travel order",
);

const longRouteOrigin = { lat: 1.3, lng: 103.7 };
const longRouteDestination = { lat: 1.3, lng: 103.88 };
const entranceDivergenceRoute = [
  longRouteOrigin,
  { lat: 1.3005, lng: 103.7023 },
  { lat: 1.3005, lng: 103.7036 },
  { lat: 1.3, lng: 103.7045 },
  longRouteDestination,
];
const longStraightAlternative = [
  longRouteOrigin,
  { lat: 1.3, lng: 103.76 },
  { lat: 1.3, lng: 103.82 },
  longRouteDestination,
];
const entranceWaypoints = selectRouteWaypoints(entranceDivergenceRoute, {
  alternativeRoutePoints: [longStraightAlternative],
});
assert.ok(
  entranceWaypoints.some((point) => point.lat > 1.30035 && point.lng < 103.705),
  "route handoff should retain a brief distinguishing entrance near the start of a long route",
);

const thirtyKilometreOrigin = { lat: 1.2, lng: 103.6 };
const thirtyKilometreDestination = { lat: 1.2, lng: 103.87 };
const briefBranchRoute = [
  thirtyKilometreOrigin,
  { lat: 1.2, lng: 103.6085 },
  { lat: 1.2018, lng: 103.609 },
  { lat: 1.2018, lng: 103.6108 },
  { lat: 1.2, lng: 103.6115 },
  thirtyKilometreDestination,
];
const thirtyKilometreStraightAlternative = [
  thirtyKilometreOrigin,
  { lat: 1.2, lng: 103.69 },
  { lat: 1.2, lng: 103.78 },
  thirtyKilometreDestination,
];
const briefBranchWaypoints = selectRouteWaypoints(briefBranchRoute, {
  alternativeRoutePoints: [thirtyKilometreStraightAlternative],
});
assert.ok(
  briefBranchWaypoints.some((point) => point.lat > 1.2012 && point.lng < 103.6115),
  "route handoff should retain a short off-corridor branch on a 30 km route",
);

assert.deepEqual(
  selectRouteWaypoints([
    { lat: 1.3, lng: 103.8 },
    { lat: 1.3, lng: 103.8 },
    { lat: 1.3, lng: 103.8 },
  ]),
  [],
);
assert.throws(
  () => buildWazeNavigationUrl({ lat: 91, lng: 103.8 }),
  /valid latitude and longitude/,
);
for (const invalidDestination of [
  { lat: null, lng: null },
  { lat: "", lng: " " },
  { lat: false, lng: true },
]) {
  assert.throws(
    () => buildWazeNavigationUrl(invalidDestination),
    /valid latitude and longitude/,
  );
}
assert.deepEqual(
  selectRouteWaypoints([origin, { lat: null, lng: null }, destination]),
  [],
  "invalid route points must be ignored instead of becoming 0,0",
);

console.log("Navigation link validation passed");
