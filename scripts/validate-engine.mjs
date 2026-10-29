import assert from "node:assert/strict";
import { loadAppForTest } from "./app-test-harness.mjs";
import vm from "node:vm";
import { departureForMode, lookupErpRate } from "../public/lib/erp-engine.js";
import { createRouteService } from "../public/lib/route-service.js";
import { onRequestGet } from "../functions/api/routes/onemap.js";

const context = await loadAppForTest();
const data = {
  meta: { ratesEffectiveFrom: "2026-09-07" },
  groups: [{ id: "test", label: "Test gantry", gantryNos: ["test"] }],
  gantries: [{ groupId: "test", gantryNo: "test", center: [1.35, 103.8], directionDegrees: 180 }],
  baseRates: [{ groupId: "test", start: "08:00", end: "09:00", amount: 2 }], adjustments: [],
  calendar: { years: [2026, 2027], publicHolidays: ["2026-12-25"], eveCutoffDates: ["2026-12-24"], uncertainEveDates: ["2026-03-20"] },
};
context.api.setData(data);
const route = context.api.buildRouteCandidate({ points: [{ lat: 1.36, lng: 103.8 }, { lat: 1.34, lng: 103.8 }],
  totalMeters: 3000, durationSeconds: 1800, efficiencyScore: 1800 });
const selected = new Date("2026-10-30T09:00:00+08:00");
const arrive = context.api.buildLegOptions({ legKey: "outbound", legLabel: "Outbound", routes: [route], departureDate: selected, vehicleType: "car", timeMode: "arrive" })[0];
assert.equal(arrive.trip.arrivalDate.toISOString(), selected.toISOString(), "Arrive by uses route duration to calculate departure");
assert.equal(arrive.trip.departureDate.toISOString(), "2026-10-30T00:30:00.000Z");
assert.equal(arrive.trip.total, 2, "Charges reflect the crossing time before the requested arrival");
const departure = context.api.buildLegOptions({ legKey: "outbound", legLabel: "Outbound", routes: [route], departureDate: selected, vehicleType: "car" })[0];
assert.equal(departure.trip.total, 0, "Leave at has a different crossing time");
assert.equal(departure.trip.departureDate.toISOString(), selected.toISOString());
assert.equal(departureForMode(new Date("2026-10-30T00:10:00+08:00"), 1800, "arrive").toISOString(), "2026-10-29T15:40:00.000Z", "Arrival calculations cross midnight correctly");
const matches = context.api.matchGantriesToRoute(route);
assert.equal(matches.length, 1);
assert.ok(Math.abs(matches[0].progressRatio - 0.5) < 0.0001, "Crossing progress uses geometry length, not a mismatched provider distance");
assert.equal(context.api.matchGantriesToRoute(route), matches, "Geometry matches are reused");
const car = { multiplier: 1, label: "Car" };
assert.equal(lookupErpRate(data, "test", "2026-10-30", 480, car).amount, 2, "Start boundary is inclusive");
assert.equal(lookupErpRate(data, "test", "2026-10-30", 540, car).amount, 0, "End boundary is exclusive");
assert.equal(lookupErpRate(data, "test", "2026-12-25", 510, car).amount, 0, "Public holidays are free");
assert.equal(lookupErpRate(data, "test", "2026-10-31", 510, car).amount, 0, "Saturday is free");
assert.equal(lookupErpRate(data, "test", "2028-10-30", 510, car).estimated, true, "Unknown calendar year is qualified");
assert.equal(lookupErpRate(data, "test", "2026-09-04", 510, car).estimated, true, "Dates outside rate coverage are qualified");

context.api.state.currentPlan = { timeMode: "arrive", requestedDate: selected, vehicleType: "car", earlyFlexibility: 60 };
const arrivalSuggestions = context.api.findTimingSuggestions([arrive]);
assert.ok(arrivalSuggestions.before, "A cheaper earlier arrival is offered");
assert.ok(arrivalSuggestions.before.arrivalDate <= selected, "Recommendation respects the requested arrival deadline");
assert.equal(arrivalSuggestions.after, null, "Cheaper but late arrivals are excluded");
context.api.renderRecommendation([arrive]);
assert.match(context.api.els.recommendationCopy.textContent, /60 minutes before your 09:00 arrival target/);
assert.doesNotMatch(context.api.els.recommendationOptions.innerHTML, />Later</, "Arrive-by recommendations show only the valid earlier option");
const returnLeg = { trip: { total: 0, departureDate: new Date("2026-10-30T09:15:00+08:00") } };
context.api.state.currentPlan.timeMode = "depart";
const returnSuggestions = context.api.findTimingSuggestions([arrive, returnLeg]);
assert.equal(returnSuggestions.after, null, "A proposed outbound trip cannot overlap the return departure");
context.api.renderRecommendation([{ ...arrive, trip: { ...arrive.trip, total: 0 } }]);
assert.equal(context.api.els.recommendation.hidden, true, "A zero estimate is already shown in the route card without another success panel");
context.api.state.currentPlan = null;

let calls = 0;
let slowAborted = false;
const quick = async () => { calls++; return [{ id: "quick" }]; };
const slow = (_start, _end, { signal }) => new Promise((resolve, reject) => {
  calls++;
  const timer = setTimeout(() => resolve([{ id: "slow" }]), 1000);
  signal.addEventListener("abort", () => { slowAborted = true; clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); }, { once: true });
});
const service = createRouteService({ providers: [quick, slow], rank: (r) => r, collectWindowMs: 10 });
const start = { lat: 1.35, lng: 103.8 }, end = { lat: 1.3, lng: 103.85 };
const routes = await service(start, end);
assert.equal(routes[0].id, "quick");
assert.equal(slowAborted, true, "Slow providers are cancelled once usable results are collected");
assert.equal(await service(start, end), routes);
assert.equal(calls, 2, "Changing timing can reuse cached route geometry without network calls");
const fallback = createRouteService({ providers: [async () => { throw Error(); }, async () => [], quick], rank: (r) => r });
assert.equal((await fallback(start, end))[0].id, "quick", "Fallback starts after both primary engines fail");
const controller = new AbortController();
controller.abort();
await assert.rejects(service(start, end, { signal: controller.signal }), { name: "AbortError" });

// Request lifecycle regressions: edits invalidate in-flight work even before the first result.
vm.runInContext(`closeErpDetail = () => {}; renderInitialResults = () => {};
  syncTimingControls = () => {}; syncReturnDateIfBeforeDeparture = () => {};`, context);
const { state, els } = context.api;
state.routeRequestId = 7;
state.routeController = new AbortController();
const previousSignal = state.routeController.signal;
els.primaryButton.disabled = true;
context.api.clearCurrentEstimate("Updated");
assert.equal(previousSignal.aborted, true);
assert.equal(state.routeRequestId, 8, "An initial in-flight estimate is invalidated");
assert.equal(els.primaryButton.disabled, false, "Cancellation re-enables the estimate button immediately");
assert.equal(els.status.textContent, "Updated");
state.address = { start, destination: end };
els.primaryButton.disabled = true;
let resubmits = 0;
els.form.requestSubmit = () => { resubmits++; };
context.api.handleTimingChange();
await new Promise((resolve) => setTimeout(resolve, 210));
assert.equal(resubmits, 1, "Timing edits during an in-flight initial estimate restart with the new time");

let resolveAddress;
context.testAddressLookup = () => new Promise((resolve) => { resolveAddress = resolve; });
vm.runInContext("fetchAddressSuggestions = testAddressLookup", context);
state.address.start = null;
els.start.value = "old search";
const addressController = new AbortController();
const pendingAddress = context.api.requireConfirmedAddress("start", addressController.signal);
els.start.value = "new search";
addressController.abort();
resolveAddress([{ ...start, label: "Old search" }]);
await assert.rejects(pendingAddress, { name: "AbortError" });
assert.equal(state.address.start, null, "Stale address resolution never overwrites a newer edit");
let locationSuccess;
context.navigator = { geolocation: { getCurrentPosition(success) { locationSuccess = success; } } };
context.api.useCurrentLocation();
context.api.cancelLocationRequest();
locationSuccess({ coords: { latitude: 1.35, longitude: 103.8 } });
assert.equal(state.address.start, null, "A late geolocation callback is ignored after an edit or reset");
state.address = { start: { ...start, label: "Start", inputValue: "Start" }, destination: { ...end, label: "End", inputValue: "End" } };
els.start.value = "Start"; els.destination.value = "End";
state.suggestions = { start: [start], destination: [end] };
state.searchControllers = { start: new AbortController(), destination: new AbortController() };
const oldSearches = Object.values(state.searchControllers);
context.api.handleSwap();
assert.equal(els.start.value, "End");
assert.equal(state.address.start.inputValue, "End");
assert.ok(oldSearches.every((c) => c.signal.aborted));
assert.equal(state.suggestions.start.length, 0, "Swapping clears old-address suggestions");
context.api.bindAddressField("start");
state.suggestions.start = [{ ...start, label: "Keyboard choice" }];
state.activeSuggestions.start = -1;
els.start.setAttribute("aria-expanded", "true");
context.selectedSuggestion = null;
vm.runInContext("selectAddress = (type, point) => { selectedSuggestion = point; }", context);
els.start.events.keydown({ key: "ArrowDown", preventDefault() {} });
els.start.events.keydown({ key: "Enter", preventDefault() {} });
assert.equal(context.selectedSuggestion.label, "Keyboard choice", "Keyboard selection uses the highlighted address");

const originalFetch = globalThis.fetch;
const request = (query) => new Request(`https://example.com/api/routes/onemap?${query}`);
try {
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw Error("unexpected fetch"); };
  let response = await onRequestGet({ request: request("start=1.3,103.8,extra&end=1.4,103.9"), env: {} });
  assert.equal(response.status, 400);
  assert.equal(fetchCalls, 0, "Invalid coordinates are rejected before network access");
  response = await onRequestGet({ request: request("start=1.3,103.8&end=1.4,103.9"), env: {} });
  assert.equal(response.status, 503, "Missing credentials produce a controlled response");
  response = await onRequestGet({ request: new Request("https://example.com/api/routes/onemap?start=1.3,103.8&end=1.4,103.9", { headers: { "Sec-Fetch-Site": "cross-site" } }), env: {} });
  assert.equal(response.status, 403);
  let authCalls = 0, routeCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("getToken")) {
      authCalls++;
      return Response.json({ access_token: `token${authCalls}`, expiry_timestamp: Math.floor(Date.now() / 1000) + 3600 });
    }
    routeCalls++;
    if (routeCalls === 1) return Response.json({ error: "token expired" }, { status: 401 });
    assert.equal(options.headers.Authorization, "token2");
    return Response.json({ route_geometry: "abc", route_summary: {} });
  };
  response = await onRequestGet({ request: request("start=1.3,103.8&end=1.4,103.9"), env: { ONEMAP_EMAIL: "test@example.invalid", ONEMAP_PASSWORD: "test-only" } });
  assert.equal(response.status, 200);
  assert.equal(authCalls, 2, "An expired cached token is refreshed once");
  assert.equal(routeCalls, 2);
  globalThis.fetch = async () => { throw Error("network unavailable"); };
  response = await onRequestGet({ request: request("start=1.3,103.8&end=1.4,103.9"), env: { ONEMAP_API_TOKEN: "test-only" } });
  assert.equal(response.status, 504, "Upstream failure returns JSON, not an unhandled exception");
} finally { globalThis.fetch = originalFetch; }
console.log("Shipped engine, arrival mode, routing cache/cancellation, and OneMap proxy validation passed");
