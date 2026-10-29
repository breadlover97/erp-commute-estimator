import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const data = JSON.parse(await readFile(new URL("../public/data/erp-data.json", import.meta.url), "utf8"));
const manifest = JSON.parse(await readFile(new URL("../data/sources.json", import.meta.url), "utf8"));
const groupIds = new Set(data.groups.map((group) => group.id));
const timeMinutes = (clock) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));

assert.equal(data.meta.ratesEffectiveFrom, "2026-09-07");
assert.equal(data.meta.verifiedOn, manifest.verifiedOn);
assert.equal(groupIds.size, data.groups.length, "Duplicate group ID");
assert.equal(data.gantries.length, 78, "Expected all current OneMotoring map markers");
assert.equal(new Set(data.gantries.map((gantry) => gantry.id)).size, data.gantries.length);
assert.equal(data.baseRates.length, 158, "Expected compacted full September rate table");
assert.deepEqual(data.adjustments, [], "Current full table must not be overwritten by obsolete June adjustments");

for (const source of Object.values(manifest.sources)) {
  if (!source.file) continue;
  const bytes = await readFile(new URL(`../data/${source.file}`, import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256, `Changed source: ${source.file}`);
  assert.equal(bytes.length, source.bytes);
}

for (const rate of data.baseRates) {
  assert.ok(groupIds.has(rate.groupId), `Unknown rate group ${rate.groupId}`);
  assert.ok(Number.isFinite(rate.amount) && rate.amount > 0);
  assert.match(rate.start, /^\d{2}:\d{2}$/);
  assert.match(rate.end, /^\d{2}:\d{2}$/);
  assert.ok(timeMinutes(rate.start) < timeMinutes(rate.end));
  assert.ok(timeMinutes(rate.start) >= 0 && timeMinutes(rate.end) <= 1440);
}
for (const id of groupIds) {
  const rates = data.baseRates.filter((rate) => rate.groupId === id).sort((a, b) => a.start.localeCompare(b.start));
  for (let index = 1; index < rates.length; index++) {
    assert.ok(rates[index - 1].end <= rates[index].start, `Overlapping rates for ${id}`);
  }
}

for (const gantry of data.gantries) {
  assert.ok(!gantry.groupId || groupIds.has(gantry.groupId));
  for (const [lat, lon] of [gantry.center, ...gantry.line]) {
    assert.ok(lat > 1.1 && lat < 1.5 && lon > 103.5 && lon < 104.2, `Invalid coordinates for ${gantry.gantryNo}`);
  }
  assert.ok(gantry.directionDegrees == null || (gantry.directionDegrees >= 0 && gantry.directionDegrees < 360));
}
const activeGroups = new Set(data.baseRates.map((rate) => rate.groupId));
for (const id of activeGroups) {
  const group = data.groups.find((group) => group.id === id);
  for (const number of group.gantryNos) {
    assert.ok(data.gantries.some((gantry) => gantry.gantryNo === number && gantry.groupId === id), `Missing active marker ${number}`);
  }
}
assert.equal(data.gantries.filter((gantry) => activeGroups.has(gantry.groupId)).length, 33,
  "LTA September 2026 release identifies 33 operational gantries");

// Independently read off the official PDF, including short transition bands that
// the previous broad adjustment overrides accidentally erased.
const sourceCases = [
  ["52,53,74", "07:00", 0.5], ["52,53,74", "07:05", 1],
  ["52,53,74", "07:30", 3], ["52,53,74", "07:35", 5],
  ["52,53,74", "07:55", 3.5], ["52,53,74", "08:00", 2],
  ["32,45", "07:00", 0.5], ["32,45", "07:30", 1.5],
  ["32,45", "08:30", 3], ["32,45", "08:35", 4],
  ["50", "08:00", 4.5], ["50", "08:05", 5],
  ["50", "08:30", 5.5], ["50", "08:35", 6],
  ["50", "08:55", 4], ["50", "09:55", 0.5], ["50", "10:00", 0],
  ["35", "07:00", 1], ["35", "07:05", 2], ["35", "08:00", 2.5],
  ["46,67", "17:30", 2], ["46,67", "17:35", 4],
  ["46,67", "19:25", 2], ["46,67", "19:55", 0.5], ["46,67", "20:00", 0],
];
const orchardNumbers = ["4", "12", "13", "14", "15", "21", "22", "26", "27", "47", "49"];
for (const number of orchardNumbers) {
  sourceCases.push([number, "10:59", 0], [number, "11:00", 0.5], [number, "11:05", 1],
    [number, "18:54", 1], [number, "18:55", 0.5], [number, "19:00", 0]);
  assert.equal(data.gantries.find((gantry) => gantry.gantryNo === number)?.groupId, number);
}
for (const [groupId, clock, expected] of sourceCases) {
  const rate = data.baseRates.find((rate) => rate.groupId === groupId && rate.start <= clock && clock < rate.end);
  assert.equal(rate?.amount ?? 0, expected, `${groupId} at ${clock} differs from official PDF`);
}
for (const key of ["publicHolidays", "eveCutoffDates", "uncertainEveDates"]) {
  assert.equal(new Set(data.calendar[key]).size, data.calendar[key].length, `Duplicate calendar date in ${key}`);
  for (const date of data.calendar[key]) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(data.calendar.years.includes(Number(date.slice(0, 4))));
  }
}
for (const date of ["2026-11-09", "2027-02-08", "2027-10-28"]) {
  assert.ok(data.calendar.publicHolidays.includes(date), `Missing published holiday ${date}`);
}
assert.ok(data.calendar.eveCutoffDates.includes("2026-12-31"), "New Year's Eve cutoff was previously missing");
for (const date of data.calendar.uncertainEveDates) {
  assert.ok(!data.calendar.eveCutoffDates.includes(date), "Unconfirmed holiday-eve cutoff must not silently be free");
}
console.log(`ERP data validation passed: 78 markers, 33 active locations, ${sourceCases.length} official rate checks, verified source hashes`);
