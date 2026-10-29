import assert from "node:assert/strict";
import vm from "node:vm";
import { loadAppForTest } from "./app-test-harness.mjs";
import { createZeroErpSearch } from "../public/lib/zero-erp-search.js";

const data = {
  meta: { ratesEffectiveFrom: "2026-09-07" },
  groups: [{ id: "test", label: "Test gantry", gantryNos: ["test"] }],
  // Marker deliberately offset from the actual road, within the priced radius.
  gantries: [{ groupId: "test", gantryNo: "test", center: [1.35, 103.8005], directionDegrees: 180, isPriced: true }],
  baseRates: [{ groupId: "test", start: "08:00", end: "09:00", amount: 2 }], adjustments: [],
  calendar: { years: [2026], publicHolidays: [], eveCutoffDates: [], uncertainEveDates: [] },
};
const context = await loadAppForTest(data);
const { api } = context;
const at = (time) => new Date(`2026-10-30T${time}:00+08:00`);
const route = (seconds, lng = 103.8) => api.buildRouteCandidate({
  points: [{ lat: 1.36, lng }, { lat: 1.34, lng }], totalMeters: 3000,
  durationSeconds: seconds, efficiencyScore: seconds, provider: "test", providerRank: 0,
});
const fast = route(600), medium = route(1800), slow = route(3600), detour = route(2400, 103.81);
const makePlan = (overrides = {}) => ({
  startPoint: fast.points[0], endPoint: fast.points[1], tripMode: "single", timeMode: "depart",
  requestedDate: at("08:30"), returnDeparture: null, vehicleType: "car", outbound: [], return: [],
  zeroErp: { outbound: { status: "searching" }, return: { status: "searching" } }, ...overrides,
});
const evaluate = (r, plan, leg = "outbound") => api.evaluateZeroErpCandidate(r, plan, leg);

const arrivalPlan = makePlan({ requestedDate: at("09:15"), timeMode: "arrive" });
assert.equal(evaluate(slow, arrivalPlan).total, 2, "Longer arrive-by route crosses before the charging cutoff");
assert.equal(evaluate(medium, arrivalPlan).total, 0, "Same geometry can become free with different arrive-by duration");
assert.equal(evaluate(slow, arrivalPlan).option.trip.arrivalDate.getTime(), at("09:15").getTime());
const departurePlan = makePlan({ requestedDate: at("08:45") });
assert.equal(evaluate(fast, departurePlan).total, 2);
assert.equal(evaluate(medium, departurePlan).total, 0, "End-of-charge boundary is free at estimated crossing time");
assert.equal(evaluate(medium, departurePlan).option.trip.departureDate.getTime(), at("08:45").getTime());
assert.equal(evaluate(fast, makePlan({ requestedDate: at("07:55") })).total, 2, "Start-of-charge boundary is charged");
assert.equal(evaluate(fast, makePlan({ vehicleType: "motorcycle" })).total, 1);
assert.equal(evaluate(fast, makePlan({ vehicleType: "very-heavy" })).total, 4);
assert.equal(evaluate(detour, departurePlan).total, 0, "Geometrically distinct bypass avoids the gantry");
const reverse = api.buildRouteCandidate({ ...fast, points: [...fast.points].reverse() });
assert.equal(evaluate(reverse, departurePlan).total, 0, "Opposite direction does not inherit a gantry charge");
const charge = evaluate(fast, departurePlan).chargeLocations[0];
assert.equal(charge.lng, 103.8, "Exclusion uses travelled road, not offset marker longitude");
assert.ok(Math.abs(charge.lat - 1.35) < 1e-8);
assert.ok(Math.abs(charge.heading - 180) < 1e-8);
assert.equal(evaluate(medium, departurePlan).chargeLocations.length, 0, "Inactive crossings are not excluded");
assert.equal(api.routeLocationAtProgress(fast, 0).lat, fast.points[0].lat);
assert.equal(api.routeLocationAtProgress(fast, fast.cumulativeMeters.at(-1)).lat, fast.points.at(-1).lat);

const returnPlan = makePlan({ tripMode: "return", timeMode: "arrive", requestedDate: at("08:15"), returnDeparture: at("08:45") });
const returnEvaluation = evaluate(medium, returnPlan, "return");
assert.equal(returnEvaluation.option.trip.departureDate.getTime(), at("08:45").getTime(), "Return always departs at its own selected time");
assert.equal(returnEvaluation.total, 0, "Return uses its own crossing clock, not outbound arrival mode");
assert.equal(evaluate(slow, makePlan({ returnDeparture: at("09:00") })).eligible, false);
assert.equal(evaluate(medium, makePlan({ returnDeparture: at("09:00") })).eligible, false, "Exact return departure overlap is rejected");

// Exercise the real search with the real app evaluator: a toll preference alone
// cannot turn a paid route into a zero route, and route durations stay distinct.
const search = createZeroErpSearch({ providers: [{ id: "test", route: async () => [slow, medium] }] });
const result = await search(fast.points[0], fast.points[1], { routes: [slow], evaluate: (r) => evaluate(r, arrivalPlan) });
assert.equal(result.status, "found");
assert.equal(result.route, medium);
assert.equal(result.evaluation.option.trip.arrivalDate.getTime(), arrivalPlan.requestedDate.getTime());
const paidSearch = createZeroErpSearch({ providers: [{ id: "test", route: async () => [fast] }] });
assert.equal((await paidSearch(fast.points[0], fast.points[1], { routes: [fast], evaluate: (r) => evaluate(r, departurePlan) })).status, "not-found");
const failedSearch = createZeroErpSearch({ providers: [{ id: "test", route: async () => { throw Error("offline"); } }] });
assert.equal((await failedSearch(fast.points[0], fast.points[1], { routes: [fast], evaluate: (r) => evaluate(r, departurePlan) })).status, "unavailable");
const overlapSearch = createZeroErpSearch({ providers: [{ id: "test", route: async () => [detour] }] });
const tightReturn = makePlan({ returnDeparture: at("09:00") });
assert.equal((await overlapSearch(fast.points[0], fast.points[1], { routes: [fast], evaluate: (r) => evaluate(r, tightReturn) })).status,
  "not-found", "A successful search finding only ineligible zero routes is not a routing outage");

const plan = makePlan();
plan.outbound = api.buildLegOptions({ legKey: "outbound", legLabel: "Outbound", routes: [fast, medium, slow], departureDate: plan.requestedDate, vehicleType: "car" });
api.state.currentPlan = plan;
api.state.selectedRoutes = { outbound: 1, return: 0 };
const originalOptions = [...plan.outbound];
const freeResult = { status: "found", route: detour, evaluation: evaluate(detour, plan) };
api.applyZeroErpResult(plan, "outbound", freeResult);
assert.equal(plan.outbound.length, 4, "Free route survives the three-route ordinary display limit");
assert.equal(api.state.selectedRoutes.outbound, 1, "Progressive result preserves user selection");
originalOptions.forEach((option, index) => assert.equal(plan.outbound[index], option, "Ordinary options retain order and identity"));
assert.equal(plan.outbound[3].trip.total, 0);
assert.equal(plan.outbound[3].zeroErp, true);
assert.equal(plan.outbound[3].id, "outbound-3");
assert.ok(Number.isFinite(plan.outbound[3].route.efficiencyScore));
api.applyZeroErpResult(plan, "outbound", freeResult);
assert.equal(plan.outbound.length, 4, "Repeated equivalent result marks the existing option without duplication");
for (const [status, expected] of [
  ["searching", /Searching for a S\$0 ERP route/],
  ["not-found", /No S\$0 ERP route found for this timing/], ["unavailable", /S\$0 ERP search unavailable/],
]) {
  plan.zeroErp.outbound = { status };
  const markup = api.zeroErpStatusTemplate("outbound");
  assert.match(markup, expected);
  assert.match(markup, /aria-live="polite"/);
  if (status === "not-found") assert.match(markup, /A free route may still exist/);
}
plan.zeroErp.outbound = { status: "found" };
assert.match(api.zeroErpStatusTemplate("outbound"), /class="sr-only"/, "The free card replaces a visible duplicate success banner while announcing completion");
plan.zeroErp.outbound = { status: "not-found", partial: true };
assert.match(api.zeroErpStatusTemplate("outbound"), /search was limited/);

// A shared zero route is a semantic choice: it can arrive as option four, or
// already exist among ordinary options. Restore once, never over a manual choice.
const shared = makePlan({ outbound: [...originalOptions], restoreZeroRoutes: { outbound: true } });
api.state.currentPlan = shared;
api.state.selectedRoutes.outbound = 0;
api.applyZeroErpResult(shared, "outbound", freeResult);
assert.equal(api.state.selectedRoutes.outbound, 3, "Shared zero choice restores after async append");
assert.equal(shared.restoreZeroRoutes.outbound, false);
api.state.selectedRoutes.outbound = 0;
shared.restoreZeroRoutes.outbound = true;
api.applyZeroErpResult(shared, "outbound", freeResult);
assert.equal(api.state.selectedRoutes.outbound, 3, "Shared zero choice also restores an existing option");
api.state.selectedRoutes.outbound = 1;
api.applyZeroErpResult(shared, "outbound", freeResult);
assert.equal(api.state.selectedRoutes.outbound, 1, "Consumed restore cannot override a later manual choice");
for (const status of ["not-found", "unavailable"]) {
  shared.restoreZeroRoutes.outbound = true;
  api.applyZeroErpResult(shared, "outbound", { status });
  assert.equal(shared.restoreZeroRoutes.outbound, false, `${status} clears pending semantic restoration`);
}
context.window.location.search = "?outRoute=3&retRoute=3&outZero=1&retZero=1";
vm.runInContext("hydrateFromUrl()", context);
assert.equal(api.state.routeSelectionToRestore.zeroOutbound, true);
assert.equal(api.state.routeSelectionToRestore.zeroReturn, true);
assert.equal(api.state.routeSelectionToRestore.outbound, "3");
context.window.location.href = "https://example.com/?outZero=1";
context.FormData = class { get() { return "depart"; } };
shared.restoreZeroRoutes.outbound = true;
assert.equal(new URL(vm.runInContext("buildShareUrl()", context)).searchParams.get("outZero"), "1", "Initial URL rewrite preserves pending semantic selection");
shared.restoreZeroRoutes.outbound = false;
assert.equal(new URL(vm.runInContext("buildShareUrl()", context)).searchParams.get("outZero"), null, "An ordinary selection clears the semantic flag");
api.state.selectedRoutes.outbound = 3;
assert.equal(new URL(vm.runInContext("buildShareUrl()", context)).searchParams.get("outZero"), "1", "Chosen zero option shares by meaning as well as index");

// Controllable provider for out-of-order completion. Keep the production
// search orchestration intact and replace only its injected service + rendering.
const pending = [];
const lifecycle = await loadAppForTest(data, {
  createZeroErpSearch: () => (start, end, options) => new Promise((resolve, reject) => pending.push({ start, end, options, resolve, reject })),
});
vm.runInContext(`globalThis.renders = []; globalThis.shares = 0;
  renderPlan = (options) => renders.push(options); replaceUrlWithShareState = () => shares++;
  closeErpDetail = () => {}; clearRouteLayers = () => {}; renderInitialResults = () => {};`, lifecycle);
const live = lifecycle.api;
const activate = (p) => { live.state.currentPlan = p; live.state.routeRequestId += 1; return live.state.routeRequestId; };
const startSearch = (p, controller = new AbortController()) => live.searchPlanForZeroErp(p, {
  signal: controller.signal, requestId: activate(p), candidates: { outbound: [fast], return: [reverse] },
});
const both = makePlan({ tripMode: "return", returnDeparture: at("10:00"), restoreZeroRoutes: { outbound: true } });
const bothTask = startSearch(both);
assert.equal(pending.length, 2, "Both legs search independently");
assert.equal(pending[1].start, both.endPoint);
assert.equal(pending[1].end, both.startPoint);
pending[1].resolve({ status: "not-found" });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(both.zeroErp.return.status, "not-found");
assert.equal(both.zeroErp.outbound.status, "searching");
assert.equal(lifecycle.renders.length, 1, "Completed return leg renders before outbound finishes");
pending[0].reject(Error("unavailable"));
await bothTask;
assert.equal(both.zeroErp.outbound.status, "unavailable", "Async provider failure has a distinct usable UI state");
assert.equal(both.restoreZeroRoutes.outbound, false, "Thrown service failures clear pending shared-zero restoration");
assert.ok(lifecycle.renders.every((options) => options.fitMap === false), "Progressive updates preserve current map viewport");

for (const invalidation of ["aborted", "request-id", "plan-identity", "clear-estimate"]) {
  const stale = makePlan();
  const controller = new AbortController();
  const task = startSearch(stale, controller);
  const request = pending.at(-1);
  const priorRenders = lifecycle.renders.length, priorShares = lifecycle.shares;
  if (invalidation === "aborted") controller.abort();
  if (invalidation === "request-id") live.state.routeRequestId += 1;
  if (invalidation === "plan-identity") live.state.currentPlan = makePlan();
  if (invalidation === "clear-estimate") { live.state.routeController = controller; live.clearCurrentEstimate("Updated"); }
  request.resolve({ status: "found", route: detour, evaluation: evaluate(detour, stale) });
  await task;
  assert.equal(stale.zeroErp.outbound.status, "searching", `${invalidation}: late result cannot update old plan`);
  assert.equal(stale.outbound.length, 0);
  assert.equal(lifecycle.renders.length, priorRenders);
  assert.equal(lifecycle.shares, priorShares);
}

// Exercise the bound vehicle event, including a change while the background
// search is still pending. It must trigger a new selected-time evaluation.
vm.runInContext(`document.addEventListener = () => {}; renderAllGantries = () => {};
  syncTimingControls = () => {}; syncReturnDateIfBeforeDeparture = () => {}; bindEvents();`, lifecycle);
const oldVehiclePlan = makePlan();
const vehicleController = new AbortController();
const vehicleTask = startSearch(oldVehiclePlan, vehicleController);
live.state.routeController = vehicleController;
live.state.address = { start: oldVehiclePlan.startPoint, destination: oldVehiclePlan.endPoint };
let submissions = 0;
live.els.form.requestSubmit = () => { submissions += 1; };
live.els.vehicleType.value = "motorcycle";
live.els.vehicleType.events.change();
assert.equal(vehicleController.signal.aborted, true, "Vehicle edit aborts the old zero-route search");
assert.equal(live.state.currentPlan, null, "Old vehicle badges disappear immediately");
pending.at(-1).reject(Error("late provider rejection"));
await vehicleTask;
assert.equal(oldVehiclePlan.zeroErp.outbound.status, "searching", "Stale rejection cannot replace new vehicle UI");
await new Promise((resolve) => setTimeout(resolve, 210));
assert.equal(submissions, 1, "Vehicle edit schedules one fresh estimate");
console.log("Zero ERP integration passed: selected-time geometry/clock/vehicle evaluation, return constraints, fourth option, honest status copy, progressive legs and stale completion guards");
