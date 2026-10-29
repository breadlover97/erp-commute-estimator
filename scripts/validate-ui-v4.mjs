import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { chooseRouteChoices, googleMapsDirectionsUrl, steppedTime } from "../public/lib/route-presentation.js";
import { loadAppForTest } from "./app-test-harness.mjs";

const points = [{ lat: 1.36, lng: 103.8 }, { lat: 1.34, lng: 103.8 }];
const choice = (index, durationSeconds, total, extras = {}) => ({
  index, id: `outbound-${index}`, legKey: "outbound", legLabel: "Outbound",
  route: { points, cumulativeMeters: [0, 2400], durationSeconds, totalMeters: 2400, ...extras },
  trip: { total, entries: [{ groupId: "test", amount: total }] },
});
const fast = choice(0, 600, 8);
const duplicate = choice(1, 800, 8);
const cheap = choice(2, 900, 4);
const free = choice(3, 1200, 0);
let choices = chooseRouteChoices([fast, duplicate, cheap, free]);
assert.deepEqual(choices.primary.map((option) => option.index), [0, 3, 2]);
assert.equal(choices.more.length, 0, "A slower same-price duplicate is removed after tariff evaluation.");
assert.equal(choices.free, free, "A zero-charge alternative survives even with identical geometry to a paid route.");
assert.equal(chooseRouteChoices([fast, duplicate, cheap, free], 1).more[0], duplicate,
  "A previously selected duplicate remains reachable instead of silently changing selection.");
const fastFree = choice(0, 600, 0);
assert.equal(chooseRouteChoices([fastFree, choice(1, 1200, 0)]).primary.length, 1,
  "The same route does not need separate fastest and zero-ERP cards.");
assert.deepEqual(chooseRouteChoices([]).primary, []);
const differentCharge = { ...duplicate, trip: { total: 8, entries: [{ groupId: "other", amount: 8 }] } };
assert.equal(chooseRouteChoices([fast, differentCharge]).more.length, 1,
  "Different charging locations remain inspectable even where coarse geometry resembles another option.");

const link = new URL(googleMapsDirectionsUrl(points[0], points[1]));
assert.equal(link.origin, "https://www.google.com");
assert.equal(link.pathname, "/maps/dir/");
assert.equal(link.searchParams.get("origin"), "1.36,103.8");
assert.equal(link.searchParams.get("destination"), "1.34,103.8");
assert.equal(link.searchParams.get("travelmode"), "driving");
assert.equal(link.searchParams.get("api"), "1");
assert.throws(() => googleMapsDirectionsUrl({ lat: 91, lng: 0 }, points[1]), /valid/);
assert.equal(steppedTime("09:00", 15), "09:15");
assert.equal(steppedTime("09:00", -15), "08:45");
assert.equal(steppedTime("00:00", -15), "23:45", "The clock wraps to the previous day; the form updates the associated date.");
assert.equal(steppedTime("23:45", 15), "00:00", "The clock wraps after the last quarter-hour.");
assert.equal(steppedTime("09:07", 15), "09:22", "Stepping an exact manual time adds a full fifteen minutes.");
assert.equal(steppedTime("09:08", -15), "08:53", "Stepping an exact manual time subtracts a full fifteen minutes.");
assert.equal(steppedTime("23:58", 15), "00:13");

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const sliderTag = html.match(/<input\b[^>]*\bid="time-slider"[^>]*>/)?.[0];
assert.ok(sliderTag, "The primary time slider remains available.");
assert.match(sliderTag, /step="15"/);
assert.match(sliderTag, /max="1425"/);
assert.doesNotMatch(html.match(/<details\b[^>]*\bid="exact-timing"[^>]*>/)?.[0] || "", /\bopen\b/,
  "The exact date/time editor starts collapsed.");
assert.match(html, /id="date-input"/);
assert.match(html, /id="time-input"/);
assert.match(html, /data-time-step="-15"/);
assert.match(html, /data-time-step="15"/);
assert.doesNotMatch(html, /data-time-preset=/, "Redundant fixed-time preset controls are removed.");

const data = {
  meta: { ratesEffectiveFrom: "2026-09-07" },
  groups: [{ id: "test", label: "Morning charge", gantryNos: ["test"] }],
  gantries: [{ groupId: "test", gantryNo: "test", center: [1.35, 103.8], directionDegrees: 180 }],
  baseRates: [{ groupId: "test", start: "08:45", end: "09:00", amount: 3 }], adjustments: [],
  calendar: { years: [2026, 2027], publicHolidays: ["2026-11-02"], eveCutoffDates: [], uncertainEveDates: [] },
};
const context = await loadAppForTest(data);
const { api } = context;
context.window.location = { origin: "https://example.com", pathname: "/", href: "https://example.com/?buffer=10&flex=15&date=2026-10-30&time=09%3A00&mode=arrive", search: "?buffer=10&flex=15&date=2026-10-30&time=09%3A00&mode=arrive" };
api.hydrateFromUrl();
assert.equal(api.els.arrivalBuffer.value, "10");
assert.equal(api.els.earlyFlexibility.value, "15");
assert.equal(api.els.showAllGantries.checked, false, "Route markers are the default, including shared URLs without allErp.");
const shared = new URL(api.buildShareUrl());
assert.equal(shared.searchParams.get("buffer"), "10");
assert.equal(shared.searchParams.get("flex"), "15");
assert.equal(shared.searchParams.has("layer"), false, "Map-provider selection is no longer exposed in links.");
const date = (clock) => new Date(`2026-10-30T${clock}:00+08:00`);
const route = api.buildRouteCandidate({ points, durationSeconds: 1200, totalMeters: 2400, efficiencyScore: 1200, providerRank: 0 });
const plan = {
  requestedDate: date("09:00"), effectiveArrivalDate: date("08:50"), arrivalBuffer: 10,
  earlyFlexibility: 15, timeMode: "arrive", tripMode: "one-way", vehicleType: "car",
  startPoint: { ...points[0], label: "Start" }, endPoint: { ...points[1], label: "End" },
  outbound: [], return: [], zeroErp: { outbound: { status: "found" } },
};
let evaluated = api.evaluateZeroErpCandidate(route, plan, "outbound");
assert.equal(evaluated.option.trip.arrivalDate.getTime(), date("08:50").getTime());
assert.equal(evaluated.total, 0, "Dedicated zero-route evaluation uses the buffered arrival, rather than the input clock.");
assert.equal(api.evaluateZeroErpCandidate(route, { ...plan, effectiveArrivalDate: date("09:00"), arrivalBuffer: 0 }, "outbound").total, 3);
plan.outbound = [{ ...evaluated.option, index: 0, id: "outbound-0", zeroErp: true }];
api.state.currentPlan = plan;
api.state.selectedRoutes = { outbound: 0, return: 0 };
const foundStatus = api.zeroErpStatusTemplate("outbound");
assert.match(foundStatus, /class="sr-only"/, "Free-route completion is announced without a visible repeated banner.");
assert.match(foundStatus, /role="status"/);
const rendered = api.routeOptionsForLeg("outbound", plan.outbound);
assert.match(rendered, /S\$0 ERP/);
assert.match(rendered, /Leave 08:30 · Arrive 08:50/);
assert.match(rendered, /Google Maps recalculates directions/);
assert.doesNotMatch(rendered, /class="selected-route-card"/);
const weeklySettings = api.weeklyLegSettings(plan.outbound);
assert.equal(weeklySettings[0].selectedClock, "09:00", "Weekly integration starts from the user's requested clock.");
assert.equal(weeklySettings[0].arrivalBuffer, 10, "The weekly evaluator applies the same buffer once.");
api.renderWeeklyEstimate();
let weeklyHtml = context.document.querySelector("#weekly-estimate-content").innerHTML;
assert.match(weeklyHtml, /S\$0\.00/);
assert.match(weeklyHtml, /5 commute days/);
assert.match(weeklyHtml, /published holiday rates/);
plan.arrivalBuffer = 0;
plan.effectiveArrivalDate = plan.requestedDate;
api.renderWeeklyEstimate();
weeklyHtml = context.document.querySelector("#weekly-estimate-content").innerHTML;
assert.match(weeklyHtml, /<strong>S\$12\.00<\/strong>/, "Weekly output prices each day and excludes the known holiday.");
api.state.weeklyDays = [];
api.renderWeeklyEstimate();
assert.match(context.document.querySelector("#weekly-estimate-content").innerHTML, /Select at least one travel day/);
context.window.location.search = "?buffer=200&flex=-30";
api.hydrateFromUrl();
assert.equal(api.els.arrivalBuffer.value, "0");
assert.equal(api.els.earlyFlexibility.value, "30");
const steppingContext = await loadAppForTest();
vm.runInContext("handleTimingChange = () => { globalThis.timingChanges = (globalThis.timingChanges || 0) + 1; };", steppingContext);
const stepSelectedTime = vm.runInContext("stepSelectedTime", steppingContext);
steppingContext.api.els.date.value = "2026-10-31";
steppingContext.api.els.time.value = "23:45";
stepSelectedTime(15);
assert.equal(steppingContext.api.els.date.value, "2026-11-01", "The primary stepping control advances the calendar as the clock wraps.");
assert.equal(steppingContext.api.els.time.value, "00:00");
stepSelectedTime(-15);
assert.equal(steppingContext.api.els.date.value, "2026-10-31");
assert.equal(steppingContext.api.els.time.value, "23:45");
steppingContext.api.els.date.value = "2027-01-01";
steppingContext.api.els.time.value = "00:07";
stepSelectedTime(-15);
assert.equal(steppingContext.api.els.date.value, "2026-12-31");
assert.equal(steppingContext.api.els.time.value, "23:52");
assert.equal(steppingContext.timingChanges, 3, "Every step notifies the normal recalculation path exactly once.");
console.log("UI v4 validation passed: useful route choices, duplicate suppression, safe navigation link, slider boundaries, hidden precise editor, shared preferences, buffered zero search and dated weekly pricing.");
