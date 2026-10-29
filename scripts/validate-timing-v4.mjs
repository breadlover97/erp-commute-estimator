import assert from "node:assert/strict";
import vm from "node:vm";
import { loadAppForTest } from "./app-test-harness.mjs";

const data = {
  meta: { ratesEffectiveFrom: "2026-09-07" },
  groups: [{ id: "timing", label: "Timing boundary", gantryNos: ["test"] }],
  gantries: [{ groupId: "timing", gantryNo: "test", center: [1.35, 103.8], directionDegrees: 180 }],
  baseRates: [{ groupId: "timing", start: "08:40", end: "09:00", amount: 3 }], adjustments: [],
  calendar: { years: [2026, 2027], publicHolidays: [], eveCutoffDates: [], uncertainEveDates: [] },
};
const context = await loadAppForTest(data);
const { api } = context;
const timing = vm.runInContext("({ buildTimingComparison, renderTimingChart, selectedRouteTimingTemplate, renderRecommendationOption, timingComparisonSettings })", context);
const date = (clock, day = "2026-10-30") => new Date(`${day}T${clock}:00+08:00`);
const route = (durationSeconds = 1200) => api.buildRouteCandidate({
  points: [{ lat: 1.36, lng: 103.8 }, { lat: 1.34, lng: 103.8 }],
  totalMeters: 2400, durationSeconds, efficiencyScore: durationSeconds, providerRank: 0,
});
const option = (requested, timeMode = "arrive", durationSeconds = 1200) => api.buildLegOptions({
  legKey: "outbound", legLabel: "Outbound", routes: [route(durationSeconds)], departureDate: requested,
  vehicleType: "car", timeMode,
})[0];
function plan(outbound, extras = {}) {
  api.state.currentPlan = {
    timeMode: "arrive", requestedDate: date("09:00"), effectiveArrivalDate: date("09:00"),
    arrivalBuffer: 0, earlyFlexibility: 30, vehicleType: "car", outbound: [outbound], return: [], ...extras,
  };
  api.state.selectedRoutes = { outbound: 0, return: 0 };
}

const outbound = option(date("09:00"));
assert.equal(outbound.trip.total, 3);
plan(outbound, { earlyFlexibility: 15 });
let suggestions = api.findTimingSuggestions([outbound]);
assert.equal(suggestions.before.arrivalDate.getTime(), date("08:45").getTime());
assert.equal(suggestions.before.departureDate.getTime(), date("08:25").getTime());
assert.equal(suggestions.before.saving, 3);
assert.equal(suggestions.before.shiftMinutes, 15);
assert.equal(suggestions.after, null, "A cheaper late arrival is never offered.");
api.renderRecommendation([outbound]);
assert.equal(api.els.recommendation.hidden, false);
assert.match(api.els.recommendationOptions.innerHTML, /data-use-time="08:45"/);
assert.match(api.els.recommendationOptions.innerHTML, /data-use-date="2026-10-30"/);
assert.match(api.els.recommendationOptions.innerHTML, /Arrive 15 min earlier/);
assert.match(api.els.recommendationOptions.innerHTML, /Use this time/);

plan(outbound, { earlyFlexibility: 0 });
suggestions = api.findTimingSuggestions([outbound]);
assert.equal(suggestions.before, null);
assert.equal(suggestions.after, null);
api.renderRecommendation([outbound]);
assert.equal(api.els.recommendation.hidden, true, "No repeated card appears when no timing savings are possible.");
assert.equal(timing.buildTimingComparison([outbound]).selectedRows.length, 1);

// An earlier saving outside the chosen flexibility must stay outside suggestions.
const laterOption = option(date("09:10"));
plan(laterOption, { requestedDate: date("09:10"), effectiveArrivalDate: date("09:10"), earlyFlexibility: 15 });
assert.equal(api.findTimingSuggestions([laterOption]).before, null);

// Buffer is applied to the calculation once and retained when applying a suggestion.
const buffered = option(date("08:55"));
plan(buffered, { arrivalBuffer: 5, effectiveArrivalDate: date("08:55"), earlyFlexibility: 15 });
suggestions = api.findTimingSuggestions([buffered]);
assert.equal(suggestions.before.arrivalDate.getTime(), date("08:40").getTime());
api.renderRecommendation([buffered]);
assert.match(api.els.recommendationOptions.innerHTML, /data-use-time="08:45"/, "Suggested input retains the five-minute arrival buffer.");
assert.match(api.els.recommendationCopy.textContent, /5-minute buffer/);

// The chart compares routes at common arrival times, never common departure
// times that would make slower alternatives miss the chosen deadline.
const slow = { ...option(date("08:55"), "arrive", 2400), index: 1, id: "outbound-1" };
api.state.currentPlan.outbound = [buffered, slow];
let comparison = timing.buildTimingComparison([buffered]);
assert.equal(comparison.routeSeries.length, 2);
for (const series of comparison.routeSeries) {
  assert.equal(series.rows.length, 2);
  assert.deepEqual(Array.from(series.rows, (row) => row.arrivalDate.getTime()), [date("08:40").getTime(), date("08:55").getTime()]);
  assert.ok(series.rows.every((row) => row.arrivalDate <= date("08:55")));
}
assert.notEqual(comparison.routeSeries[0].currentRow.departureDate.getTime(), comparison.routeSeries[1].currentRow.departureDate.getTime());
const chart = { innerHTML: "" };
timing.renderTimingChart(comparison.routeSeries, buffered.trip.departureDate, chart);
assert.match(chart.innerHTML, /Arrival time/);
assert.doesNotMatch(chart.innerHTML, /NaN|Infinity/);
assert.doesNotMatch(chart.innerHTML, />09:10</, "Chart does not display a late-arrival saving.");
assert.match(timing.selectedRouteTimingTemplate(), /<details class="timing-disclosure">/);
assert.doesNotMatch(timing.selectedRouteTimingTemplate(), /<details[^>]+\bopen\b/);

// Leave-at users can move in either direction; the return leg bounds feasibility.
const leave = option(date("08:40"), "depart");
plan(leave, { timeMode: "depart", requestedDate: date("08:40"), effectiveArrivalDate: null, earlyFlexibility: 15 });
suggestions = api.findTimingSuggestions([leave]);
assert.ok(suggestions.before);
assert.ok(suggestions.after);
assert.equal(suggestions.after.departureDate.getTime(), date("08:55").getTime());
const returnLeg = { trip: { departureDate: date("09:05"), total: 1, entries: [] } };
suggestions = api.findTimingSuggestions([leave, returnLeg]);
assert.equal(suggestions.after, null, "A later departure cannot overlap a return journey.");
comparison = timing.buildTimingComparison([leave, returnLeg]);
assert.ok(comparison.selectedRows.every((row) => row.arrivalDate < returnLeg.trip.departureDate));
assert.ok(comparison.selectedRows.every((row) => row.total >= 1), "The return cost remains fixed in every comparison.");

// A flexibility window crosses midnight as dates, not a clock-only search.
const midnight = option(date("00:10"));
plan(midnight, { requestedDate: date("00:10"), effectiveArrivalDate: date("00:10"), earlyFlexibility: 30 });
comparison = timing.buildTimingComparison([midnight]);
assert.equal(comparison.selectedRows[0].arrivalDate.getTime(), date("23:40", "2026-10-29").getTime());
assert.equal(comparison.selectedRows.at(-1).arrivalDate.getTime(), date("00:10").getTime());
api.renderRecommendation([midnight]);
assert.equal(api.els.recommendation.hidden, true, "A zero-cost selection does not produce a second success panel.");
console.log("Timing UX validation passed: bounded flexibility, actionable times, arrival buffer, aligned feasible chart, return constraints and midnight handling.");
