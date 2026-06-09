import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const data = JSON.parse(await readFile(new URL("../public/data/erp-data.json", import.meta.url), "utf8"));

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

const vehicleTypes = {
  motorcycle: { multiplier: 0.5 },
  car: { multiplier: 1 },
  heavy: { multiplier: 1.5 },
  "very-heavy": { multiplier: 2 },
};

const rateCases = [
  ["50", "2026-06-08", "08:45", "motorcycle", 2.5, "motorcycle multiplier"],
  ["50", "2026-06-08", "08:45", "car", 5, "car June 2026 adjusted rate"],
  ["50", "2026-06-08", "08:45", "heavy", 7.5, "heavy vehicle multiplier"],
  ["50", "2026-06-08", "08:45", "very-heavy", 10, "very heavy vehicle multiplier"],
  ["50", "2026-06-14", "08:45", "car", 0, "Sunday ERP-free"],
  ["50", "2026-06-13", "08:45", "car", 0, "Saturday ERP-free"],
  ["50", "2026-06-01", "08:45", "car", 0, "Singapore public holiday ERP-free"],
  ["46,67", "2026-12-24", "18:15", "car", 0, "major public holiday eve after 13:00"],
];

for (const [groupId, dateString, clock, vehicleType, expected, label] of rateCases) {
  assert.equal(rateForGroup(groupId, dateString, clock, vehicleType).amount, expected, label);
}

const outboundTrip = calculateTrip(
  { durationSeconds: 30 * 60 },
  [
    match("50", 0.4),
    match("35", 0.6),
  ],
  new Date("2026-06-08T08:00:00"),
  "car",
);
assert.equal(outboundTrip.total, 6, "outbound synthetic route total");
assert.deepEqual(
  outboundTrip.entries.map((entry) => [entry.groupId, entry.amount, entry.crossingTime]),
  [
    ["50", 4, "08:12"],
    ["35", 2, "08:18"],
  ],
  "outbound synthetic route crossing times and amounts",
);

const returnTrip = calculateTrip(
  { durationSeconds: 30 * 60 },
  [match("46,67", 0.5)],
  new Date("2026-06-08T18:00:00"),
  "car",
);
assert.equal(returnTrip.total, 3, "return synthetic route total");
assert.equal(roundMoney(outboundTrip.total + returnTrip.total), 9, "combined return-trip total");

const weekendTrip = calculateTrip(
  { durationSeconds: 20 * 60 },
  [match("50", 0.5)],
  new Date("2026-06-14T08:30:00"),
  "very-heavy",
);
assert.equal(weekendTrip.total, 0, "weekend trip remains zero even for very heavy vehicles");

console.log("ERP calculation validation passed");

function match(groupId, progressRatio) {
  const gantry = data.gantries.find((item) => item.groupId === groupId);
  assert.ok(gantry, `Missing gantry for ${groupId}`);
  return {
    gantry,
    progressRatio,
    distanceMeters: 0,
    matchType: "marker",
  };
}

function calculateTrip(route, matchedGantries, departureDate, vehicleType) {
  const entries = matchedGantries.map((matchItem) => {
    const crossingDate = addSeconds(departureDate, route.durationSeconds * matchItem.progressRatio);
    const crossingDateString = dateString(crossingDate);
    const crossingTime = clockString(crossingDate);
    const rate = rateForGroup(matchItem.gantry.groupId, crossingDateString, crossingTime, vehicleType);
    return {
      groupId: matchItem.gantry.groupId,
      amount: rate.amount,
      crossingTime,
    };
  });
  return {
    entries,
    total: roundMoney(entries.reduce((sum, entry) => sum + entry.amount, 0)),
  };
}

function rateForGroup(groupId, dateStringValue, clock, vehicleType) {
  const vehicle = vehicleTypes[vehicleType] || vehicleTypes.car;
  const minutes = minutesFromClock(clock);
  const zero = (label) => ({
    amount: 0,
    baseAmount: 0,
    multiplier: vehicle.multiplier,
    label,
  });

  if (isZeroErpDate(dateStringValue)) {
    return zero("Sunday or Singapore public holiday");
  }
  if (isMajorHolidayEveCutoff(dateStringValue, minutes)) {
    return zero("Eve of major public holiday after 13:00");
  }
  if (!isWeekday(dateStringValue)) {
    return zero("No modelled Saturday ERP rate");
  }

  const adjustment = data.adjustments.find((item) => {
    return (
      item.groupId === groupId &&
      dateStringValue >= item.fromDate &&
      (!item.toDate || dateStringValue <= item.toDate) &&
      minutes >= minutesFromClock(item.start) &&
      minutes < minutesFromClock(item.end)
    );
  });
  if (adjustment) {
    return {
      amount: roundMoney(adjustment.amount * vehicle.multiplier),
      baseAmount: adjustment.amount,
      multiplier: vehicle.multiplier,
      label: adjustment.reason,
    };
  }

  const baseRate = data.baseRates.find((item) => {
    return item.groupId === groupId && minutes >= minutesFromClock(item.start) && minutes < minutesFromClock(item.end);
  });
  if (baseRate) {
    return {
      amount: roundMoney(baseRate.amount * vehicle.multiplier),
      baseAmount: baseRate.amount,
      multiplier: vehicle.multiplier,
      label: "Base weekday rate",
    };
  }
  return zero("No active ERP rate");
}

function minutesFromClock(clock) {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

function isWeekday(dateStringValue) {
  const [year, month, day] = dateStringValue.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

function isZeroErpDate(dateStringValue) {
  const [year, month, day] = dateStringValue.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek === 0 || publicHolidays2026.has(dateStringValue);
}

function isMajorHolidayEveCutoff(dateStringValue, minutes) {
  return eveCutoffDates2026.has(dateStringValue) && minutes >= 13 * 60;
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function dateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function clockString(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function roundMoney(amount) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
