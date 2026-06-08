import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const data = JSON.parse(await readFile(new URL("../public/data/erp-data.json", import.meta.url), "utf8"));

const groupIds = new Set(data.groups.map((group) => group.id));
const publicHolidays2026 = new Set([
  "2026-01-01",
  "2026-02-17",
  "2026-02-18",
  "2026-03-21",
  "2026-04-03",
  "2026-05-01",
  "2026-05-27",
  "2026-05-31",
  "2026-06-01",
  "2026-08-09",
  "2026-08-10",
  "2026-11-08",
  "2026-11-09",
  "2026-12-25",
]);
const eveCutoffDates2026 = new Set(["2026-02-16", "2026-03-20", "2026-11-07", "2026-12-24"]);

assert.equal(data.meta.vehicleClass, "Passenger cars, taxis and light goods vehicles");
assert.ok(data.gantries.length >= 70, "Expected official ERP gantry markers");
assert.ok(data.baseRates.length >= 180, "Expected extracted weekday base rates");
assert.ok(data.adjustments.length >= 20, "Expected June 2026 adjustments");

for (const rate of data.baseRates) {
  assert.ok(groupIds.has(rate.groupId), `Unknown base-rate group ${rate.groupId}`);
  assert.ok(rate.amount >= 0, "Base rate amount must be non-negative");
}

for (const adjustment of data.adjustments) {
  assert.ok(groupIds.has(adjustment.groupId), `Unknown adjustment group ${adjustment.groupId}`);
  assert.match(adjustment.fromDate, /^\d{4}-\d{2}-\d{2}$/);
}

for (const gantry of data.gantries) {
  if (gantry.groupId) {
    assert.ok(groupIds.has(gantry.groupId), `Unknown gantry group ${gantry.groupId}`);
  }
  assert.equal(gantry.center.length, 2);
  assert.ok(gantry.center[0] > 1.1 && gantry.center[0] < 1.5, "Gantry latitude outside Singapore range");
  assert.ok(gantry.center[1] > 103.5 && gantry.center[1] < 104.2, "Gantry longitude outside Singapore range");
  if (gantry.directionDegrees !== null && gantry.directionDegrees !== undefined) {
    assert.ok(gantry.directionDegrees >= 0 && gantry.directionDegrees < 360, "Invalid gantry direction");
  }
}

const pricedGroupsWithGeometry = new Set(
  data.gantries.filter((gantry) => gantry.groupId).map((gantry) => gantry.groupId),
);
const activePricedGroups = new Set([
  ...data.baseRates.filter((rate) => rate.amount > 0).map((rate) => rate.groupId),
  ...data.adjustments.map((adjustment) => adjustment.groupId),
]);
for (const groupId of activePricedGroups) {
  assert.ok(pricedGroupsWithGeometry.has(groupId), `Active priced group missing ERP map marker: ${groupId}`);
}

const criticalMapMarkers = new Map([
  ["35", "35"],
  ["46", "46,67"],
  ["67", "46,67"],
  ["50", "50"],
  ["51", "51"],
  ["68", "68"],
]);
for (const [gantryNo, groupId] of criticalMapMarkers) {
  const marker = data.gantries.find((gantry) => gantry.gantryNo === gantryNo);
  assert.equal(marker?.groupId, groupId, `Missing official ERP marker for gantry ${gantryNo}`);
}

const officialCurrentRateCases = [
  ["36", "08:15", 1, "AYE before Alexandra current 08:00-08:30"],
  ["52,53,74", "09:15", 3, "AYE after Jurong current 09:00-09:30"],
  ["52,53,74", "18:15", 1, "AYE after Jurong current 18:00-18:30"],
  ["35", "07:15", 2, "Southbound CTE current 07:00-07:30"],
  ["35", "08:15", 3, "Southbound CTE current 08:00-08:30"],
  ["35", "08:45", 3, "Southbound CTE current 08:30-09:00"],
  ["50", "07:15", 1, "KPE Defu current 07:00-07:30"],
  ["50", "07:45", 4, "KPE Defu current 07:30-08:00"],
  ["50", "08:15", 5, "KPE Defu current 08:00-08:30"],
  ["50", "08:45", 6, "KPE Defu current 08:30-09:00"],
  ["50", "09:15", 2, "KPE Defu current 09:00-09:30"],
  ["50", "09:45", 1, "KPE Defu current 09:30-10:00"],
  ["65", "07:45", 1, "PIE westbound before Eunos current 07:30-08:00"],
  ["65", "09:15", 1, "PIE westbound before Eunos current 09:00-09:30"],
  ["46,67", "18:15", 4, "Northbound CTE current 18:00-18:30"],
  ["46,67", "18:45", 4, "Northbound CTE current 18:30-19:00"],
  ["46,67", "19:15", 3, "Northbound CTE current 19:00-19:30"],
  ["46,67", "19:45", 1, "Northbound CTE current 19:30-20:00"],
  ["32,45", "07:15", 0, "PIE Kallang/Bendemeer current 07:00-07:30"],
  ["32,45", "07:45", 1, "PIE Kallang/Bendemeer current 07:30-08:00"],
  ["32,45", "08:15", 1, "PIE Kallang/Bendemeer current 08:00-08:30"],
  ["32,45", "08:45", 3, "PIE Kallang/Bendemeer current 08:30-09:00"],
];

for (const [groupId, clock, amount, label] of officialCurrentRateCases) {
  assert.equal(baseRateFor(groupId, clock), amount, label);
}

assert.equal(rateFor("50", "2026-06-08", "08:45"), 5);
assert.equal(rateFor("35", "2026-06-08", "07:15"), 1);
assert.equal(rateFor("35", "2026-06-08", "08:15"), 2);
assert.equal(rateFor("35", "2026-06-08", "08:45"), 2);
assert.equal(rateFor("46,67", "2026-06-08", "19:45"), 0);
assert.equal(rateFor("52,53,74", "2026-06-30", "07:45"), 5);
assert.equal(rateFor("65", "2026-03-24", "07:45"), 1);
assert.equal(rateFor("50", "2026-06-07", "08:45"), 0);
assert.equal(rateFor("50", "2026-06-01", "08:45"), 0);
assert.equal(baseRateFor("46,67", "18:15"), 4);
assert.equal(rateFor("46,67", "2026-12-24", "18:15"), 0);

console.log("ERP data validation passed");

function rateFor(groupId, dateString, clock) {
  const minutes = minutesFromClock(clock);
  if (isZeroErpDate(dateString)) {
    return 0;
  }
  if (isMajorHolidayEveCutoff(dateString, minutes)) {
    return 0;
  }
  if (!isWeekday(dateString)) {
    return 0;
  }
  const adjustment = data.adjustments.find((item) => {
    return (
      item.groupId === groupId &&
      dateString >= item.fromDate &&
      (!item.toDate || dateString <= item.toDate) &&
      minutes >= minutesFromClock(item.start) &&
      minutes < minutesFromClock(item.end)
    );
  });
  if (adjustment) {
    return adjustment.amount;
  }
  const baseRate = data.baseRates.find((item) => {
    return (
      item.groupId === groupId &&
      minutes >= minutesFromClock(item.start) &&
      minutes < minutesFromClock(item.end)
    );
  });
  return baseRate?.amount || 0;
}

function baseRateFor(groupId, clock) {
  const minutes = minutesFromClock(clock);
  const baseRate = data.baseRates.find((item) => {
    return (
      item.groupId === groupId &&
      minutes >= minutesFromClock(item.start) &&
      minutes < minutesFromClock(item.end)
    );
  });
  return baseRate?.amount || 0;
}

function minutesFromClock(clock) {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

function isWeekday(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

function isZeroErpDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek === 0 || publicHolidays2026.has(dateString);
}

function isMajorHolidayEveCutoff(dateString, minutes) {
  return eveCutoffDates2026.has(dateString) && minutes >= 13 * 60;
}
