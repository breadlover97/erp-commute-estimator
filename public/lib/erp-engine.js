const dataIndexes = new WeakMap();

export function departureForMode(selectedDate, durationSeconds, timeMode = "depart") {
  if (!Number.isFinite(selectedDate?.getTime()) || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new Error("Choose a valid trip date and time.");
  }
  return new Date(selectedDate.getTime() - (timeMode === "arrive" ? durationSeconds * 1000 : 0));
}

export function indexErpData(data) {
  let index = dataIndexes.get(data);
  if (index) return index;
  const byGroup = (rates = []) => {
    const result = new Map();
    for (const rate of rates) {
      const rows = result.get(rate.groupId) || [];
      rows.push({ ...rate, startMinute: clockMinutes(rate.start), endMinute: clockMinutes(rate.end) });
      result.set(rate.groupId, rows);
    }
    return result;
  };
  index = {
    groups: new Map(data.groups.map((group) => [group.id, group])),
    baseRates: byGroup(data.baseRates),
    adjustments: byGroup(data.adjustments),
    holidays: new Set(data.calendar?.publicHolidays || []),
    eves: new Set(data.calendar?.eveCutoffDates || []),
    uncertainEves: new Set(data.calendar?.uncertainEveDates || []),
  };
  dataIndexes.set(data, index);
  return index;
}

export function lookupErpRate(data, groupId, dateString, minutes, vehicle) {
  const index = indexErpData(data);
  const day = new Date(`${dateString}T00:00:00Z`).getUTCDay();
  const effectiveFrom = data.meta?.ratesEffectiveFrom;
  const historic = Boolean(effectiveFrom && dateString < effectiveFrom);
  const unknownCalendar = Boolean(data.calendar?.years && !data.calendar.years.includes(Number(dateString.slice(0, 4))));
  const uncertainEve = minutes >= 780 && index.uncertainEves.has(dateString);
  const qualifier = historic ? "Current schedule used; historical rates unverified" : unknownCalendar
    ? "Public holidays unverified for this year" : uncertainEve
      ? "Holiday-eve cutoff unconfirmed; standard rate shown" : null;
  const result = (amount, label) => ({
    amount: Math.round((amount * vehicle.multiplier + Number.EPSILON) * 100) / 100,
    baseAmount: amount,
    multiplier: vehicle.multiplier,
    vehicleLabel: vehicle.label,
    label: qualifier || label,
    estimated: Boolean(qualifier),
  });
  if (day === 0 || index.holidays.has(dateString)) return result(0, "Sunday or Singapore public holiday");
  if (index.eves.has(dateString) && minutes >= 780) return result(0, "Eve of major public holiday after 13:00");
  if (day === 6) return result(0, "No Saturday ERP charge");
  const active = (rate) => minutes >= rate.startMinute && minutes < rate.endMinute &&
    (!rate.fromDate || dateString >= rate.fromDate) && (!rate.toDate || dateString <= rate.toDate);
  const adjustment = index.adjustments.get(groupId)?.find(active);
  if (adjustment) return result(adjustment.amount, adjustment.reason);
  const rate = index.baseRates.get(groupId)?.find(active);
  return rate ? result(rate.amount, "Weekday rate") : result(0, "No active ERP rate");
}

function clockMinutes(clock) {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}
