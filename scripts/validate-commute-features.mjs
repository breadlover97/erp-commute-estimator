import assert from "node:assert/strict";
import { createCommuteStore, calculateWeeklyEstimate, mountSavedCommutes } from "../public/lib/commute-features.js";
import { lookupErpRate } from "../public/lib/erp-engine.js";
import { singaporeClock, singaporeDateValue } from "../public/planner-utils.js";

class MemoryStorage {
  values = new Map(); writes = 0;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.writes += 1; this.values.set(key, value); }
}
const startPoint = { lat: 1.3694, lng: 103.8494, label: "Ang Mo Kio MRT", isCurrentLocation: true, inputValue: "secret display state" };
const endPoint = { lat: 1.2843, lng: 103.8515, label: "Raffles Place MRT" };
const trip = { startPoint, endPoint, vehicleType: "car", timeMode: "arrive", time: "09:00", arrivalBuffer: 10,
  earlyFlexibility: 30, tripMode: "return", returnTime: "17:00", returnDayOffset: 0, requestedDate: "2026-10-29" };
const storage = new MemoryStorage();
let id = 0;
const store = createCommuteStore(storage, { createId: () => `trip-${++id}` });
assert.equal(storage.writes, 0);
assert.deepEqual(store.read(), { places: {}, trips: [], error: null });
assert.equal(storage.writes, 0, "Reading must never autosave an address or geolocation");
assert.equal(store.saveTrip("Morning commute", trip).ok, true);
let saved = store.read().trips[0];
assert.equal(saved.name, "Morning commute");
assert.equal(saved.arrivalBuffer, 10);
assert.equal(saved.returnDayOffset, 0);
assert.equal(saved.startPoint.isCurrentLocation, undefined, "Only an explicitly saved coordinate and label are retained");
assert.equal(saved.startPoint.inputValue, undefined);
assert.equal(saved.requestedDate, undefined, "Saved trips repeat relative to tomorrow, not an obsolete calendar date");
assert.equal(createCommuteStore(storage).read().trips[0].time, "09:00", "Trips survive a new module/store instance");
assert.equal(store.saveTrip(" morning COMMUTE ", { ...trip, time: "08:45" }).ok, true);
assert.equal(store.read().trips.length, 1, "Saving the same named trip updates it rather than duplicating");
assert.equal(store.read().trips[0].id, saved.id);
assert.equal(store.read().trips[0].time, "08:45");
assert.equal(store.savePlace("home", startPoint).ok, true);
assert.equal(store.savePlace("work", endPoint).ok, true);
assert.equal(store.read().places.home.label, "Ang Mo Kio MRT");
assert.equal(store.savePlace("elsewhere", startPoint).ok, false);
assert.equal(store.savePlace("home", { lat: 50, lng: 1, label: "Wrong region" }).ok, false);
assert.equal(store.read().places.home.label, "Ang Mo Kio MRT", "Invalid writes preserve existing saved places");
assert.equal(store.saveTrip("Bad time", { ...trip, time: "25:00" }).ok, false);
assert.equal(store.saveTrip("Bad offset", { ...trip, returnDayOffset: -1 }).ok, false);
assert.equal(store.saveTrip(" ", trip).ok, false);
for (let index = 0; index < 7; index += 1) assert.equal(store.saveTrip(`Trip ${index}`, trip).ok, true);
assert.equal(store.saveTrip("Ninth trip", trip).ok, false, "The saved-trip store has a visible bounded limit");
assert.equal(store.read().trips.length, 8);
store.removeTrip(saved.id);
assert.equal(store.read().trips.length, 7);
store.removePlace("home");
assert.equal(store.read().places.home, undefined);
assert.equal(store.read().places.work.label, "Raffles Place MRT", "Removing one place preserves the other");
const denied = createCommuteStore({ getItem() { return null; }, setItem() { throw new Error("Quota exceeded"); } });
assert.equal(denied.saveTrip("Work", trip).ok, false);
assert.match(denied.saveTrip("Work", trip).error, /full or blocked/);
assert.equal(createCommuteStore(null).saveTrip("Work", trip).ok, false, "Unavailable storage must not claim a successful save");
const broken = createCommuteStore({ getItem() { throw new Error("Denied"); } });
assert.match(broken.read().error, /could not be read/);
const damaged = new MemoryStorage();
damaged.setItem("erpSavedCommutesV1", JSON.stringify({ version: 1, places: { home: { lat: "1.3", lng: 103.8, label: "Bad" }, work: endPoint },
  trips: [{ ...trip, id: "bad", time: "99:00", name: "Corrupt" }, { ...trip, id: "good", name: "Valid" }, { ...trip, id: "good", name: "Duplicate" }] }));
const recovered = createCommuteStore(damaged).read();
assert.equal(recovered.trips.length, 1);
assert.equal(recovered.trips[0].name, "Valid");
assert.equal(recovered.places.home, undefined);
assert.equal(recovered.places.work.label, "Raffles Place MRT");
assert.doesNotThrow(() => mountSavedCommutes({ container: null }).refresh());

// Exercise explicit save/apply controls without a browser or storage side effects
// on initial render; all text from persisted labels must be escaped.
const uiStorage = new MemoryStorage();
const uiStore = createCommuteStore(uiStorage, { createId: () => "ui-trip" });
const controls = {
  ".saved-trip-editor": { open: false },
  "[data-saved-name]": { value: "<img src=x onerror=alert(1)>" },
  "[data-saved-place]": { value: "home" },
  "[data-saved-source]": { value: "start" },
};
const container = {
  innerHTML: "", handlers: {},
  querySelector: (selector) => controls[selector] || null,
  addEventListener(event, handler) { this.handlers[event] = handler; },
  removeEventListener(event) { delete this.handlers[event]; },
  contains() { return true; },
};
let appliedTrip, appliedPlace;
const mounted = mountSavedCommutes({ container, store: uiStore, getTrip: () => trip,
  onApplyTrip: (value) => { appliedTrip = value; }, onApplyPlace: (point, target) => { appliedPlace = { point, target }; } });
const click = (dataset) => container.handlers.click({ target: { closest: () => ({ dataset }) } });
assert.equal(uiStorage.writes, 0, "Mounting saved controls does not persist geolocation or trip data");
await click({ savedAction: "save-trip" });
assert.equal(uiStorage.writes, 1);
assert.match(container.innerHTML, /&lt;img/);
assert.doesNotMatch(container.innerHTML, /<img src=x/);
assert.match(container.innerHTML, /Saved on this device/);
await click({ savedAction: "apply-trip", savedId: "ui-trip" });
assert.equal(appliedTrip.time, "09:00");
assert.equal(appliedTrip.arrivalBuffer, 10);
await click({ savedAction: "save-place" });
await click({ savedAction: "apply-place", savedKind: "home", savedTarget: "destination" });
assert.equal(appliedPlace.target, "destination");
assert.equal(appliedPlace.point.lat, startPoint.lat);
await click({ savedAction: "remove-trip", savedId: "ui-trip" });
assert.equal(uiStore.read().trips.length, 0);
assert.match(container.innerHTML, /Removed from this device/);
mounted.destroy();
assert.equal(container.handlers.click, undefined);

// Price actual dates and crossing times with the same indexed ERP rate engine.
const data = { meta: { ratesEffectiveFrom: "2026-09-07" },
  groups: [{ id: "test", label: "Test" }], adjustments: [],
  baseRates: [{ groupId: "test", start: "08:00", end: "08:45", amount: 2 },
    { groupId: "test", start: "17:00", end: "18:00", amount: 3 },
    { groupId: "test", start: "23:45", end: "24:00", amount: 4 }],
  calendar: { years: [2026, 2027], publicHolidays: ["2026-11-09"], eveCutoffDates: [], uncertainEveDates: [] } };
const route = { durationSeconds: 1800 };
const calls = [];
const evaluate = (route, matches, departureDate, vehicleType, legLabel) => {
  const crossing = new Date(departureDate.getTime() + route.durationSeconds * 500);
  const [hour, minute] = singaporeClock(crossing).split(":").map(Number);
  const rate = lookupErpRate(data, "test", singaporeDateValue(crossing), hour * 60 + minute,
    { multiplier: vehicleType === "motorcycle" ? 0.5 : 1, label: vehicleType });
  calls.push({ departureDate, crossing, legLabel, matches });
  return { total: rate.amount, departureDate, arrivalDate: new Date(departureDate.getTime() + route.durationSeconds * 1000) };
};
const legs = [
  { route, matchedGantries: ["cached geometry"], selectedClock: "08:00", timeMode: "depart", legLabel: "Outbound" },
  { route, selectedClock: "17:00", timeMode: "depart", legLabel: "Return" },
];
const week = calculateWeeklyEstimate({ startDate: "2026-11-06", weekdays: [1, 2, 3, 4, 5], legs, vehicleType: "car", evaluate });
assert.equal(week.startDate, "2026-11-06");
assert.equal(week.endDate, "2026-11-12");
assert.equal(week.days.length, 5);
assert.equal(week.tripCount, 10);
assert.equal(week.days.find((day) => day.date === "2026-11-09").total, 0, "The public holiday is priced separately");
assert.equal(week.total, 20, "Weekly cost is actual dated outbound+return costs, not one day's cost times five");
assert.deepEqual(calls[0].matches, ["cached geometry"]);
assert.equal(calculateWeeklyEstimate({ startDate: "2026-11-06", weekdays: [5], legs, vehicleType: "motorcycle", evaluate }).total, 2.5);
assert.equal(calculateWeeklyEstimate({ startDate: "2026-11-06", weekdays: [], legs, evaluate }).total, 0);
assert.equal(calculateWeeklyEstimate({ startDate: "2026-11-06", weekdays: [5, 5], legs, evaluate }).days.length, 1, "Repeated weekdays do not double count");
const arrivalLeg = { route, selectedClock: "09:00", timeMode: "arrive", arrivalBuffer: 0 };
assert.equal(calculateWeeklyEstimate({ startDate: "2026-11-06", weekdays: [5], legs: [arrivalLeg], evaluate }).total, 0);
assert.equal(calculateWeeklyEstimate({ startDate: "2026-11-06", weekdays: [5], legs: [{ ...arrivalLeg, arrivalBuffer: 10 }], evaluate }).total, 2, "The arrival buffer changes the actual gantry crossing and charge");
const overnight = calculateWeeklyEstimate({ startDate: "2026-10-31", weekdays: [6], legs: [{ route, selectedClock: "00:10", timeMode: "arrive" }], evaluate });
assert.equal(overnight.total, 4, "A Saturday arrival can cross a charging gantry on Friday night");
assert.equal(singaporeDateValue(overnight.days[0].legs[0].trip.departureDate), "2026-10-30");
const nextDayReturn = calculateWeeklyEstimate({ startDate: "2026-11-06", weekdays: [5], legs: [legs[0], { ...legs[1], dayOffset: 1 }], evaluate });
assert.equal(nextDayReturn.total, 2, "A return on the following Saturday uses Saturday's rates");
assert.throws(() => calculateWeeklyEstimate({ startDate: "2026-11-06", legs: [legs[0], { ...legs[1], selectedClock: "08:15" }], evaluate }), /return departure/);
assert.throws(() => calculateWeeklyEstimate({ startDate: "2026-02-30", legs, evaluate }), /valid week/);
assert.throws(() => calculateWeeklyEstimate({ startDate: "2026-11-06", weekdays: [7], legs, evaluate }), /valid travel/);
assert.throws(() => calculateWeeklyEstimate({ startDate: "2026-11-06", legs: [{ ...legs[0], selectedClock: "24:00" }], evaluate }), /route timing/);
assert.throws(() => calculateWeeklyEstimate({ startDate: "2026-11-06", legs, evaluate: () => ({ total: NaN }) }), /could not be calculated/);
console.log("Saved commutes and weekly ERP validated: explicit bounded device storage, failures, damaged records, dates, holidays, return legs, arrival buffers and midnight crossings.");
