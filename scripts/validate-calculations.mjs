import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { loadAppForTest } from "./app-test-harness.mjs";
import { lookupErpRate } from "../public/lib/erp-engine.js";
import { singaporeDateTime } from "../public/planner-utils.js";

const data = JSON.parse(await readFile(new URL("../public/data/erp-data.json", import.meta.url), "utf8"));
const { api } = await loadAppForTest(data);
const vehicles = {
  motorcycle: { multiplier: 0.5, label: "Motorcycle" },
  car: { multiplier: 1, label: "Car" },
  heavy: { multiplier: 1.5, label: "Heavy vehicle" },
  "very-heavy": { multiplier: 2, label: "Very heavy vehicle" },
};

// Expected amounts independently transcribed from the official September table.
const cases = [
  ["50", "2026-10-30", "08:45", "motorcycle", 3, "motorcycle multiplier"],
  ["50", "2026-10-30", "08:45", "car", 6, "current KPE rate"],
  ["50", "2026-10-30", "08:45", "heavy", 9, "heavy vehicle multiplier"],
  ["50", "2026-10-30", "08:45", "very-heavy", 12, "very heavy vehicle multiplier"],
  ["50", "2026-10-31", "08:45", "car", 0, "Saturday"],
  ["50", "2026-11-01", "08:45", "car", 0, "Sunday"],
  ["50", "2026-11-09", "08:45", "car", 0, "Deepavali observed holiday"],
  ["50", "2027-02-08", "08:45", "car", 0, "2027 Chinese New Year observed holiday"],
  ["46,67", "2026-12-24", "18:15", "car", 0, "Christmas Eve cutoff"],
  ["46,67", "2026-12-31", "18:15", "car", 0, "New Year's Eve cutoff"],
  ["12", "2026-10-30", "11:00", "car", 0.5, "Orchard opening transition"],
  ["12", "2026-10-30", "11:05", "car", 1, "Orchard full rate"],
  ["12", "2026-10-30", "18:55", "car", 0.5, "Orchard closing transition"],
  ["12", "2026-10-30", "19:00", "car", 0, "Orchard closed"],
];
for (const [group, day, time, vehicle, expected, label] of cases) {
  const [hours, minutes] = time.split(":").map(Number);
  assert.equal(lookupErpRate(data, group, day, hours * 60 + minutes, vehicles[vehicle]).amount, expected, label);
}

const trip = (matches, day, time, vehicle = "car") => api.calculateTrip(
  { durationSeconds: 1800 }, matches, singaporeDateTime(day, time), vehicle, "Outbound",
);
const outbound = trip([match("50", 0.4), match("35", 0.6)], "2026-10-30", "08:00");
assert.equal(outbound.total, 8);
assert.equal(JSON.stringify(outbound.entries.map((entry) => [entry.groupId, entry.amount, entry.crossingTime])),
  JSON.stringify([["50", 5, "08:12"], ["35", 3, "08:18"]]), "Crossing times select the applicable current rates");
const returning = trip([match("46,67", 0.5)], "2026-10-30", "18:00");
assert.equal(returning.total, 4);
assert.equal(outbound.total + returning.total, 12, "Combined outbound and return totals");
assert.equal(trip([match("50", 0.5)], "2026-10-31", "08:30", "very-heavy").total, 0);
const sharedSet = [match("46,67", 0.2), match("46,67", 0.4, "67")];
assert.equal(trip(sharedSet, "2026-10-30", "18:00").total, 4, "An expressway gantry set is charged once");
const orchard = trip([match("4", 0.2), match("12", 0.7)], "2026-10-30", "12:00");
assert.equal(orchard.total, 2, "Separate Orchard entries remain separately chargeable despite sharing a tariff");
const beforeCutoff = trip([match("12", 0)], "2026-12-31", "12:59");
const afterCutoff = trip([match("12", 0.5)], "2026-12-31", "12:59");
assert.equal(beforeCutoff.total, 1);
assert.equal(afterCutoff.total, 0, "Holiday-eve cutoff applies at gantry crossing, not departure");
const uncertainEve = lookupErpRate(data, "12", "2027-03-09", 840, vehicles.car);
assert.equal(uncertainEve.amount, 1);
assert.equal(uncertainEve.estimated, true, "Conflicting official eve guidance is qualified, not silently free");
console.log(`Current ERP calculations passed: ${cases.length} rate/vehicle/calendar cases plus crossing, return and gantry-group regressions`);

function match(groupId, progressRatio, gantryNo) {
  const gantry = data.gantries.find((item) => item.groupId === groupId && (!gantryNo || item.gantryNo === gantryNo));
  assert.ok(gantry, `Missing gantry for ${groupId}`);
  return { gantry, progressRatio, progressMeters: 10000 * progressRatio, distanceMeters: 0, matchType: "marker" };
}
