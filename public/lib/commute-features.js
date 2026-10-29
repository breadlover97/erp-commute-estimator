import { isSingaporePoint, singaporeDateTime, singaporeDateValue, displayTime } from "../planner-utils.js";
import { departureForMode } from "./erp-engine.js";

const STORAGE_KEY = "erpSavedCommutesV1";
const MAX_TRIPS = 8;
const VEHICLES = new Set(["car", "motorcycle", "heavy", "very-heavy"]);
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 86400000;

// All writes are explicit user saves/removals. Merely viewing the planner never
// persists a current location, a trip, or a proposed home/work address.
export function createCommuteStore(storage, { key = STORAGE_KEY, createId = () => globalThis.crypto?.randomUUID?.() || `trip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } = {}) {
  const read = () => {
    try {
      if (!storage) return emptyState("Saving is unavailable in this browser.");
      const raw = storage.getItem(key);
      if (!raw) return emptyState();
      if (raw.length > 100000) return emptyState("Saved trips could not be read.");
      const data = JSON.parse(raw);
      if (data?.version !== 1) return emptyState("Saved trips use an unsupported format.");
      const places = {};
      for (const kind of ["home", "work"]) {
        try { if (data.places?.[kind]) places[kind] = validPoint(data.places[kind]); } catch { /* Ignore invalid stored points. */ }
      }
      const trips = [];
      const seen = new Set();
      for (const trip of Array.isArray(data.trips) ? data.trips.slice(0, 100) : []) {
        try {
          const name = validName(trip.name);
          const id = typeof trip.id === "string" && trip.id.length <= 100 ? trip.id : null;
          if (!id || seen.has(id)) continue;
          trips.push({ ...validTrip(trip), id, name });
          seen.add(id);
          if (trips.length === MAX_TRIPS) break;
        } catch { /* A damaged saved trip must not break the planner. */ }
      }
      return { places, trips, error: null };
    } catch {
      return emptyState("Saved trips could not be read. Browser storage may be blocked.");
    }
  };
  const write = (change) => {
    const current = read();
    if (current.error) return { ok: false, error: current.error };
    try {
      const next = change(current);
      storage.setItem(key, JSON.stringify({ version: 1, places: next.places, trips: next.trips }));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof TypeError || error instanceof RangeError
        ? error.message : "Could not save changes on this device. Browser storage may be full or blocked." };
    }
  };
  return {
    read,
    saveTrip(name, trip) {
      return write((current) => {
        const label = validName(name);
        const value = validTrip(trip);
        const existing = current.trips.find((item) => item.name.toLocaleLowerCase() === label.toLocaleLowerCase());
        if (!existing && current.trips.length >= MAX_TRIPS) throw new RangeError("You can save up to 8 trips. Remove one before adding another.");
        const saved = { ...value, id: existing?.id || createId(), name: label };
        return { ...current, trips: [saved, ...current.trips.filter((item) => item.id !== saved.id)] };
      });
    },
    removeTrip(id) { return write((current) => ({ ...current, trips: current.trips.filter((item) => item.id !== id) })); },
    savePlace(kind, point) {
      return write((current) => {
        if (!["home", "work"].includes(kind)) throw new TypeError("Choose Home or Work.");
        return { ...current, places: { ...current.places, [kind]: validPoint(point) } };
      });
    },
    removePlace(kind) {
      return write((current) => {
        const places = { ...current.places };
        if (["home", "work"].includes(kind)) delete places[kind];
        return { ...current, places };
      });
    },
  };
}

function emptyState(error = null) { return { places: {}, trips: [], error }; }
function validName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 40) throw new TypeError("Enter a trip name of 1–40 characters.");
  return name;
}
function validPoint(value) {
  if (!isSingaporePoint(value) || typeof value.label !== "string" || !value.label.trim() || value.label.length > 500) {
    throw new TypeError("Select a matching Singapore address before saving.");
  }
  return { lat: value.lat, lng: value.lng, label: value.label.trim() };
}
function validTrip(value) {
  if (!value || !VEHICLES.has(value.vehicleType || "car")) throw new TypeError("Choose a valid vehicle type.");
  const time = value.time || "09:00";
  const returnTime = value.returnTime || "17:00";
  const timeMode = value.timeMode || "arrive";
  const tripMode = value.tripMode || "one-way";
  const arrivalBuffer = value.arrivalBuffer ?? 0;
  const earlyFlexibility = value.earlyFlexibility ?? 30;
  const returnDayOffset = value.returnDayOffset ?? 0;
  if (!CLOCK.test(time) || !CLOCK.test(returnTime) || !["arrive", "depart"].includes(timeMode) || !["one-way", "return"].includes(tripMode)
      || ![0, 5, 10].includes(arrivalBuffer) || ![0, 15, 30, 60].includes(earlyFlexibility)
      || !Number.isInteger(returnDayOffset) || returnDayOffset < 0 || returnDayOffset > 7) {
    throw new TypeError("Check the trip time and options before saving.");
  }
  return { startPoint: validPoint(value.startPoint), endPoint: validPoint(value.endPoint), vehicleType: value.vehicleType || "car",
    timeMode, time, arrivalBuffer, earlyFlexibility, tripMode, returnTime, returnDayOffset };
}

export function mountSavedCommutes({ container, store, getTrip, onApplyTrip, onApplyPlace }) {
  if (!container) return { refresh() {}, destroy() {} };
  let message = "";
  let failed = false;
  const refresh = () => {
    const editorOpen = container.querySelector(".saved-trip-editor")?.open;
    const name = container.querySelector("[data-saved-name]")?.value || "";
    const { places, trips, error } = store.read();
    const tripButtons = trips.map((trip) => `<button type="button" class="saved-trip-button" data-saved-action="apply-trip" data-saved-id="${escapeHtml(trip.id)}"><strong>${escapeHtml(trip.name)}</strong><span>${trip.timeMode === "arrive" ? "Arrive" : "Leave"} ${escapeHtml(displayTime(trip.time))}</span></button>`).join("");
    const placeButtons = Object.entries(places).map(([kind, point]) => `<div class="saved-place-item"><span title="${escapeHtml(point.label)}">${kind === "home" ? "Home" : "Work"}</span><button type="button" data-saved-action="apply-place" data-saved-kind="${kind}" data-saved-target="start" aria-label="Start from ${kind}">From</button><button type="button" data-saved-action="apply-place" data-saved-kind="${kind}" data-saved-target="destination" aria-label="Go to ${kind}">To</button></div>`).join("");
    const removals = trips.map((trip) => `<div class="saved-trip-manage-row"><span>${escapeHtml(trip.name)}</span><button class="saved-item-remove" type="button" data-saved-action="remove-trip" data-saved-id="${escapeHtml(trip.id)}" aria-label="Remove saved trip ${escapeHtml(trip.name)}">Remove</button></div>`).join("") + Object.keys(places).map((kind) => `<div class="saved-trip-manage-row"><span>${kind === "home" ? "Home" : "Work"}</span><button class="saved-item-remove" type="button" data-saved-action="remove-place" data-saved-kind="${kind}" aria-label="Remove saved ${kind}">Remove</button></div>`).join("");
    container.innerHTML = `${tripButtons || placeButtons ? `<div class="saved-trip-list">${tripButtons}${placeButtons}</div>` : ""}
      <details class="saved-trip-editor"${editorOpen ? " open" : ""}><summary>Save or manage trips</summary>
        <p>Saved on this device. Tap a trip to estimate it for tomorrow.</p>
        <div class="saved-trip-form"><label>Trip name<input data-saved-name type="text" maxlength="40" placeholder="e.g. Morning commute" value="${escapeHtml(name)}" /></label><button type="button" data-saved-action="save-trip">Save current trip</button></div>
        <div class="saved-trip-form"><label>Save place<select data-saved-place><option value="home">Home</option><option value="work">Work</option></select></label><label>Use address<select data-saved-source><option value="start">From</option><option value="destination">To</option></select></label><button type="button" data-saved-action="save-place">Save place</button></div>
        ${removals ? `<div class="saved-trip-manage-list">${removals}</div>` : ""}
      </details><p class="saved-trip-message${failed || error ? " error" : ""}" role="status" aria-live="polite"${message || error ? "" : " hidden"}>${escapeHtml(message || error || "")}</p>`;
  };
  const handler = async (event) => {
    const button = event.target.closest?.("[data-saved-action]");
    if (!button || !container.contains(button)) return;
    const action = button.dataset.savedAction;
    const { places, trips } = store.read();
    try {
      if (action === "apply-trip") {
        const trip = trips.find((item) => item.id === button.dataset.savedId);
        if (trip) await onApplyTrip(trip);
        return;
      }
      if (action === "apply-place") {
        const point = places[button.dataset.savedKind];
        if (point) await onApplyPlace(point, button.dataset.savedTarget);
        return;
      }
      let result;
      if (action === "save-trip") result = store.saveTrip(container.querySelector("[data-saved-name]").value, getTrip());
      if (action === "save-place") {
        const trip = getTrip();
        const source = container.querySelector("[data-saved-source]").value;
        result = store.savePlace(container.querySelector("[data-saved-place]").value, source === "start" ? trip.startPoint : trip.endPoint);
      }
      if (action === "remove-trip") result = store.removeTrip(button.dataset.savedId);
      if (action === "remove-place") result = store.removePlace(button.dataset.savedKind);
      if (!result) return;
      failed = !result.ok;
      message = result.ok ? action.startsWith("remove") ? "Removed from this device." : "Saved on this device." : result.error;
    } catch (error) {
      failed = true;
      message = error.message || "Could not use this saved trip. Please try again.";
    }
    refresh();
  };
  container.addEventListener("click", handler);
  refresh();
  return { refresh, destroy: () => container.removeEventListener("click", handler) };
}

// Reuse each selected route's geometry, but price every actual calendar date.
// The evaluator remains the app's shipped ERP engine, including holidays and
// crossing-time rules; a weekly estimate is never daily cost multiplied by five.
export function calculateWeeklyEstimate({ startDate, weekdays = [1, 2, 3, 4, 5], legs, vehicleType = "car", evaluate }) {
  const start = validDate(startDate);
  if (!Array.isArray(weekdays) || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new TypeError("Choose valid travel days.");
  if (!Array.isArray(legs) || !legs.length || legs.length > 2 || typeof evaluate !== "function") throw new TypeError("Choose a route before estimating the week.");
  const selectedDays = new Set(weekdays);
  const days = [];
  for (let day = 0; day < 7; day += 1) {
    const date = singaporeDateValue(new Date(start.getTime() + day * DAY_MS));
    if (!selectedDays.has(new Date(`${date}T00:00:00Z`).getUTCDay())) continue;
    const pricedLegs = [];
    for (const leg of legs) {
      const offset = leg.dayOffset ?? 0;
      const buffer = leg.timeMode === "arrive" ? leg.arrivalBuffer ?? 0 : 0;
      if (!CLOCK.test(leg.selectedClock) || !["arrive", "depart"].includes(leg.timeMode || "depart")
          || !Number.isInteger(offset) || offset < 0 || offset > 7 || !Number.isFinite(buffer) || buffer < 0 || buffer > 60) {
        throw new TypeError("Check the route timing before estimating the week.");
      }
      const legDate = singaporeDateValue(new Date(start.getTime() + (day + offset) * DAY_MS));
      const selectedTime = new Date(singaporeDateTime(legDate, leg.selectedClock).getTime() - buffer * 60000);
      const departure = departureForMode(selectedTime, leg.route?.durationSeconds, leg.timeMode);
      const trip = evaluate(leg.route, leg.matchedGantries || [], departure, vehicleType, leg.legLabel || (pricedLegs.length ? "Return" : "Outbound"));
      if (!Number.isFinite(trip?.total) || trip.total < 0 || !Number.isFinite(trip.arrivalDate?.getTime())) throw new TypeError("The weekly ERP estimate could not be calculated.");
      if (pricedLegs.length && departure <= pricedLegs.at(-1).trip.arrivalDate) throw new RangeError("The return departure must follow the outbound arrival.");
      pricedLegs.push({ legLabel: leg.legLabel || (pricedLegs.length ? "Return" : "Outbound"), trip });
    }
    days.push({ date, total: roundMoney(pricedLegs.reduce((total, leg) => total + leg.trip.total, 0)), legs: pricedLegs });
  }
  return { startDate, endDate: singaporeDateValue(new Date(start.getTime() + 6 * DAY_MS)), days,
    total: roundMoney(days.reduce((total, day) => total + day.total, 0)), tripCount: days.length * legs.length };
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError("Choose a valid week start date.");
  const date = singaporeDateTime(value);
  if (!Number.isFinite(date.getTime()) || singaporeDateValue(date) !== value) throw new TypeError("Choose a valid week start date.");
  return date;
}
function roundMoney(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
