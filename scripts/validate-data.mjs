import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const data = JSON.parse(await readFile(new URL("../public/data/erp-data.json", import.meta.url), "utf8"));

const groupIds = new Set(data.groups.map((group) => group.id));

assert.equal(data.meta.vehicleClass, "Passenger cars, taxis and light goods vehicles");
assert.ok(data.gantries.length >= 100, "Expected at least 100 gantry geometries");
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
}

assert.equal(rateFor("50", "2026-06-08", "08:45"), 5);
assert.equal(rateFor("46,67", "2026-06-08", "19:45"), 0);
assert.equal(rateFor("52,53,74", "2026-06-30", "07:45"), 5);
assert.equal(rateFor("65", "2026-03-24", "07:45"), 1);
assert.equal(rateFor("50", "2026-06-07", "08:45"), 0);

console.log("ERP data validation passed");

function rateFor(groupId, dateString, clock) {
  if (!isWeekday(dateString)) {
    return 0;
  }
  const minutes = minutesFromClock(clock);
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

function minutesFromClock(clock) {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

function isWeekday(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}
