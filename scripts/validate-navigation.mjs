import assert from "node:assert/strict";

import {
  buildGoogleMapsNavigationUrl,
  buildWazeNavigationUrl,
  navigationEndpointsForLeg,
  sampleRouteWaypoints,
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
  buildGoogleMapsNavigationUrl({ origin, destination, routePoints }),
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

assert.deepEqual(sampleRouteWaypoints([origin, destination]), []);
assert.equal(sampleRouteWaypoints(routePoints, 20).length, 3);
const [distanceSpacedWaypoint] = sampleRouteWaypoints(
  [
    { lat: 1.3, lng: 103.8 },
    { lat: 1.3, lng: 103.8001 },
    { lat: 1.3, lng: 104.8 },
  ],
  1,
);
assert.ok(
  distanceSpacedWaypoint.lng > 104.29 && distanceSpacedWaypoint.lng < 104.31,
  "waypoints should be spaced by route distance rather than point index",
);
assert.deepEqual(
  sampleRouteWaypoints([
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
  sampleRouteWaypoints([origin, { lat: null, lng: null }, destination]),
  [],
  "invalid route points must be ignored instead of becoming 0,0",
);

console.log("Navigation link validation passed");
