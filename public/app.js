const SINGAPORE_CENTER = [1.3521, 103.8198];
const GANTRY_MATCH_THRESHOLD_METERS = 115;
const DIRECTION_TOLERANCE_DEGREES = 75;
const DATA_VERSION = "2026-06-08-ux-v5";
const ROUTE_SEARCH_START_MINUTES = 4 * 60 + 30;
const ROUTE_SEARCH_END_MINUTES = 22 * 60 + 30;
const SINGAPORE_PUBLIC_HOLIDAYS_2026 = new Set([
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
const ERP_EVE_CUTOFF_DATES_2026 = new Set([
  "2026-02-16",
  "2026-03-20",
  "2026-11-07",
  "2026-12-24",
]);

const state = {
  erpData: null,
  map: null,
  allGantriesLayer: null,
  matchedGantriesLayer: null,
  routeLayer: null,
  pointLayer: null,
  lastRoute: null,
};

const els = {
  form: document.querySelector("#route-form"),
  start: document.querySelector("#start-input"),
  destination: document.querySelector("#destination-input"),
  swap: document.querySelector("#swap-button"),
  date: document.querySelector("#date-input"),
  time: document.querySelector("#time-input"),
  totalCost: document.querySelector("#total-cost"),
  driveTime: document.querySelector("#drive-time"),
  driveDistance: document.querySelector("#drive-distance"),
  matchedCount: document.querySelector("#matched-count"),
  timingBody: document.querySelector("#timing-body"),
  gantryList: document.querySelector("#gantry-list"),
  status: document.querySelector("#status-bar"),
  rateSource: document.querySelector("#rate-source"),
  comparisonNote: document.querySelector("#comparison-note"),
  recommendation: document.querySelector("#recommendation"),
  recommendationTitle: document.querySelector("#recommendation-title"),
  recommendationCopy: document.querySelector("#recommendation-copy"),
  sourceGenerated: document.querySelector("#source-generated"),
  sourceCopy: document.querySelector("#source-copy"),
  primaryButton: document.querySelector(".primary-button"),
  mapPanel: document.querySelector("#map-panel"),
};

init().catch((error) => {
  console.error(error);
  setStatus("Could not start the estimator. Refresh the page and try again.");
});

async function init() {
  setDefaultSingaporeDateTime();
  initMap();
  state.erpData = await fetchJson(`./data/erp-data.json?v=${DATA_VERSION}`);
  els.rateSource.textContent = "Official source-backed rates";
  renderSourceMetadata();
  renderAllGantries();
  bindEvents();
  window.lucide?.createIcons();
}

function bindEvents() {
  els.form.addEventListener("submit", handleRouteSubmit);
  els.swap.addEventListener("click", () => {
    const oldStart = els.start.value;
    els.start.value = els.destination.value;
    els.destination.value = oldStart;
    els.start.focus();
  });

  document.querySelectorAll(".sample-button").forEach((button) => {
    button.addEventListener("click", () => {
      els.start.value = button.dataset.start;
      els.destination.value = button.dataset.destination;
    });
  });
}

async function handleRouteSubmit(event) {
  event.preventDefault();
  setLoading(true);
  clearRouteLayers();
  setStatus("Finding addresses and driving route...");

  try {
    const selected = getSelectedDateTime();
    const timeMode = new FormData(els.form).get("timeMode");
    const [startPoint, endPoint] = await Promise.all([
      geocodeAddress(els.start.value),
      geocodeAddress(els.destination.value),
    ]);
    const route = await fetchDrivingRoute(startPoint, endPoint);
    const matchedGantries = matchGantriesToRoute(route);
    const baseDeparture =
      timeMode === "arrive" ? addSeconds(selected, -route.durationSeconds) : selected;
    const currentTrip = calculateTrip(route, matchedGantries, baseDeparture);
    const comparison = buildTimingComparison(route, matchedGantries, baseDeparture);
    const suggestion = findBestSuggestion(route, matchedGantries, baseDeparture, selected, timeMode);

    state.lastRoute = { route, matchedGantries, startPoint, endPoint };
    renderRoute(startPoint, endPoint, route, matchedGantries);
    renderSummary(route, matchedGantries, currentTrip);
    renderTimingComparison(comparison, baseDeparture);
    renderGantryList(currentTrip.entries);
    renderRecommendation(currentTrip, suggestion, timeMode);
    focusMapAfterEstimate();

    setStatus(
      `Route matched ${matchedGantries.length} gantry location${
        matchedGantries.length === 1 ? "" : "s"
      }. ERP shown for ${state.erpData.meta.vehicleClass.toLowerCase()}.`,
    );
  } catch (error) {
    setStatus(error.message || "Unable to calculate this route.");
    renderErrorState(error.message || "Unable to calculate this route.");
  } finally {
    setLoading(false);
  }
}

function initMap() {
  state.map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView(SINGAPORE_CENTER, 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);

  state.allGantriesLayer = L.layerGroup().addTo(state.map);
  state.matchedGantriesLayer = L.layerGroup().addTo(state.map);
  state.pointLayer = L.layerGroup().addTo(state.map);
}

function renderAllGantries() {
  state.allGantriesLayer.clearLayers();
  state.erpData.gantries.forEach((gantry) => {
    const marker = L.circleMarker(gantry.center, {
      radius: gantry.isPriced ? 4 : 3,
      color: gantry.isPriced ? "#b76e00" : "#6f7a80",
      fillColor: gantry.isPriced ? "#f0a534" : "#8b969d",
      fillOpacity: gantry.isPriced ? 0.82 : 0.5,
      opacity: 0.75,
      weight: 1,
    });
    marker.bindPopup(popupForGantry(gantry));
    marker.addTo(state.allGantriesLayer);
  });
}

function renderRoute(startPoint, endPoint, route, matchedGantries) {
  clearRouteLayers();

  state.routeLayer = L.polyline(
    route.points.map((point) => [point.lat, point.lng]),
    {
      color: "#1267d6",
      weight: 6,
      opacity: 0.82,
      lineJoin: "round",
    },
  ).addTo(state.map);

  L.circleMarker([startPoint.lat, startPoint.lng], {
    radius: 7,
    color: "#0f8b5f",
    fillColor: "#0f8b5f",
    fillOpacity: 1,
    weight: 2,
  })
    .bindPopup(`<strong>Start</strong><br>${escapeHtml(startPoint.label)}`)
    .addTo(state.pointLayer);

  L.circleMarker([endPoint.lat, endPoint.lng], {
    radius: 7,
    color: "#d94b3d",
    fillColor: "#d94b3d",
    fillOpacity: 1,
    weight: 2,
  })
    .bindPopup(`<strong>Destination</strong><br>${escapeHtml(endPoint.label)}`)
    .addTo(state.pointLayer);

  matchedGantries.forEach((match) => {
    if (match.gantry.line?.length > 1) {
      L.polyline(match.gantry.line, {
        color: match.gantry.isPriced ? "#d94b3d" : "#465159",
        weight: match.gantry.isPriced ? 5 : 3,
        opacity: 0.95,
      })
        .bindPopup(popupForGantry(match.gantry, match.distanceMeters))
        .addTo(state.matchedGantriesLayer);
    }

    L.circleMarker(match.gantry.center, {
      radius: match.gantry.isPriced ? 7 : 5,
      color: "#ffffff",
      fillColor: match.gantry.isPriced ? "#d94b3d" : "#465159",
      fillOpacity: 1,
      weight: 2,
    })
      .bindPopup(popupForGantry(match.gantry, match.distanceMeters))
      .addTo(state.matchedGantriesLayer);
  });

  const bounds = state.routeLayer.getBounds();
  state.map.fitBounds(bounds.pad(0.16));
  refreshMapLayout();
}

function clearRouteLayers() {
  state.routeLayer?.remove();
  state.routeLayer = null;
  state.matchedGantriesLayer?.clearLayers();
  state.pointLayer?.clearLayers();
}

function popupForGantry(gantry, distanceMeters) {
  const number = gantry.gantryNo ? `Gantry ${escapeHtml(gantry.gantryNo)}` : "Unnumbered gantry";
  const distance = Number.isFinite(distanceMeters)
    ? `<br><span>${Math.round(distanceMeters)} m from route geometry</span>`
    : "";
  const priced = gantry.isPriced ? "Priced schedule available" : "No active price schedule";
  return `<strong>${number}</strong><br>${escapeHtml(gantry.label)}<br><span>${priced}</span>${distance}`;
}

async function geocodeAddress(query) {
  const coordinateMatch = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coordinateMatch) {
    return {
      lat: Number(coordinateMatch[1]),
      lng: Number(coordinateMatch[2]),
      label: query.trim(),
    };
  }

  const searchQuery = /singapore/i.test(query) ? query : `${query}, Singapore`;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    format: "jsonv2",
    q: searchQuery,
    limit: "1",
    countrycodes: "sg",
    viewbox: "103.55,1.49,104.15,1.16",
    bounded: "1",
  }).toString();

  const results = await fetchJson(url.toString());
  if (!Array.isArray(results) || !results.length) {
    throw new Error(`No Singapore address match found for "${query}".`);
  }

  return {
    lat: Number(results[0].lat),
    lng: Number(results[0].lon),
    label: results[0].display_name,
  };
}

async function fetchDrivingRoute(startPoint, endPoint) {
  const coordinates = `${startPoint.lng},${startPoint.lat};${endPoint.lng},${endPoint.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false&alternatives=false`;
  const payload = await fetchJson(url);

  if (payload.code !== "Ok" || !payload.routes?.length) {
    throw new Error("No driving route found between those points.");
  }

  const route = payload.routes[0];
  const points = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  const cumulativeMeters = buildCumulativeDistances(points);
  return {
    points,
    cumulativeMeters,
    totalMeters: route.distance,
    durationSeconds: route.duration,
  };
}

function matchGantriesToRoute(route) {
  const matches = [];
  for (const gantry of state.erpData.gantries) {
    const closest = closestProgressOnRoute(
      { lat: gantry.center[0], lng: gantry.center[1] },
      route.points,
      route.cumulativeMeters,
    );
    if (
      closest.distanceMeters <= GANTRY_MATCH_THRESHOLD_METERS &&
      routeDirectionMatchesGantry(closest.routeBearingDegrees, gantry.directionDegrees)
    ) {
      matches.push({
        gantry,
        distanceMeters: closest.distanceMeters,
        directionDelta: directionDelta(closest.routeBearingDegrees, gantry.directionDegrees),
        progressMeters: closest.progressMeters,
        progressRatio: route.totalMeters > 0 ? closest.progressMeters / route.totalMeters : 0,
      });
    }
  }

  return matches.sort((a, b) => a.progressMeters - b.progressMeters);
}

function calculateTrip(route, matchedGantries, departureDate) {
  const groupMatches = new Map();
  const unpricedEntries = [];

  matchedGantries.forEach((match) => {
    const offsetSeconds = route.durationSeconds * match.progressRatio;
    const crossingDate = addSeconds(departureDate, offsetSeconds);
    const base = {
      match,
      crossingDate,
      crossingTime: formatClock(crossingDate),
      crossingDateString: toDateInputValue(crossingDate),
    };

    if (match.gantry.groupId) {
      const existing = groupMatches.get(match.gantry.groupId);
      if (!existing || match.progressMeters < existing.match.progressMeters) {
        groupMatches.set(match.gantry.groupId, base);
      }
    } else {
      unpricedEntries.push({
        ...base,
        groupId: null,
        label: match.gantry.label,
        gantryNos: match.gantry.gantryNo ? [match.gantry.gantryNo] : [],
        amount: 0,
        rateLabel: "No priced schedule",
      });
    }
  });

  const pricedEntries = [...groupMatches.entries()].map(([groupId, item]) => {
    const group = state.erpData.groups.find((candidate) => candidate.id === groupId);
    const rate = getRateForGroup(groupId, item.crossingDate);
    return {
      ...item,
      groupId,
      label: group?.label || item.match.gantry.label,
      gantryNos: group?.gantryNos || [item.match.gantry.gantryNo],
      amount: rate.amount,
      rateLabel: rate.label,
    };
  });

  const entries = [...pricedEntries, ...unpricedEntries].sort(
    (a, b) => a.match.progressMeters - b.match.progressMeters,
  );

  return {
    departureDate,
    arrivalDate: addSeconds(departureDate, route.durationSeconds),
    entries,
    total: entries.reduce((sum, entry) => sum + entry.amount, 0),
    chargedCount: entries.filter((entry) => entry.amount > 0).length,
  };
}

function getRateForGroup(groupId, crossingDate) {
  const dateString = toDateInputValue(crossingDate);
  const minutes = crossingDate.getHours() * 60 + crossingDate.getMinutes();
  if (isZeroErpDate(dateString)) {
    return { amount: 0, label: "Sunday or Singapore public holiday" };
  }
  if (isMajorHolidayEveCutoff(dateString, minutes)) {
    return { amount: 0, label: "Eve of major public holiday after 13:00" };
  }
  if (!isWeekday(dateString)) {
    return { amount: 0, label: "No modelled Saturday ERP rate" };
  }

  const adjustment = state.erpData.adjustments.find((item) => {
    return (
      item.groupId === groupId &&
      dateString >= item.fromDate &&
      (!item.toDate || dateString <= item.toDate) &&
      minutes >= minutesFromClock(item.start) &&
      minutes < minutesFromClock(item.end)
    );
  });

  if (adjustment) {
    return { amount: adjustment.amount, label: adjustment.reason };
  }

  const baseRate = state.erpData.baseRates.find((item) => {
    return (
      item.groupId === groupId &&
      minutes >= minutesFromClock(item.start) &&
      minutes < minutesFromClock(item.end)
    );
  });

  if (baseRate) {
    return { amount: baseRate.amount, label: "Base weekday rate" };
  }

  return { amount: 0, label: "No active ERP rate" };
}

function buildTimingComparison(route, matchedGantries, baseDeparture) {
  const rows = [];
  for (let offset = -60; offset <= 180; offset += 15) {
    const departure = addMinutes(baseDeparture, offset);
    const trip = calculateTrip(route, matchedGantries, departure);
    rows.push(trip);
  }
  return rows;
}

function findBestSuggestion(route, matchedGantries, baseDeparture, selectedDate, timeMode) {
  const dateString = toDateInputValue(baseDeparture);
  const startOfDay = new Date(`${dateString}T00:00:00`);
  const currentTrip = calculateTrip(route, matchedGantries, baseDeparture);
  let best = null;

  for (let minute = ROUTE_SEARCH_START_MINUTES; minute <= ROUTE_SEARCH_END_MINUTES; minute += 5) {
    const departure = addMinutes(startOfDay, minute);
    const trip = calculateTrip(route, matchedGantries, departure);
    if (timeMode === "arrive" && trip.arrivalDate > selectedDate) {
      continue;
    }
    if (!best) {
      best = trip;
      continue;
    }
    const bestDistance = Math.abs(best.departureDate - baseDeparture);
    const tripDistance = Math.abs(trip.departureDate - baseDeparture);
    if (trip.total < best.total || (trip.total === best.total && tripDistance < bestDistance)) {
      best = trip;
    }
  }

  if (!best || best.total >= currentTrip.total) {
    return null;
  }

  return best;
}

function renderSummary(route, matchedGantries, trip) {
  els.totalCost.textContent = formatMoney(trip.total);
  els.driveTime.textContent = formatDuration(route.durationSeconds);
  els.driveDistance.textContent = formatDistance(route.totalMeters);
  els.matchedCount.textContent = String(matchedGantries.length);
}

function renderTimingComparison(rows, baseDeparture) {
  const minCost = Math.min(...rows.map((row) => row.total));
  els.comparisonNote.textContent = "15-minute departure intervals around your selected timing.";
  els.timingBody.innerHTML = rows
    .map((trip) => {
      const rowClasses = [
        trip.total === minCost ? "best-row" : "",
        Math.abs(trip.departureDate - baseDeparture) < 1000 ? "current-row" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const routeErp = trip.entries.filter((entry) => entry.match.gantry.isPriced).length;
      return `<tr class="${rowClasses}">
        <td data-label="Leave">${formatClock(trip.departureDate)}</td>
        <td data-label="Arrive">${formatClock(trip.arrivalDate)}</td>
        <td data-label="ERP" class="money">${formatMoney(trip.total)}</td>
        <td data-label="Route ERP">${routeErp}</td>
      </tr>`;
    })
    .join("");
}

function renderGantryList(entries) {
  if (!entries.length) {
    els.gantryList.innerHTML = `<div class="empty-state">No ERP gantries detected along this route.</div>`;
    return;
  }

  els.gantryList.innerHTML = entries
    .map((entry) => {
      const priceClass = entry.amount > 0 ? "gantry-price charge" : "gantry-price";
      const numbers = entry.gantryNos.filter(Boolean).join(", ") || "Unnumbered";
      return `<article class="gantry-item">
        <div>
          <strong>${escapeHtml(entry.label)}</strong>
          <small>Gantry ${escapeHtml(numbers)} at about ${entry.crossingTime}. ${escapeHtml(entry.rateLabel)}.</small>
        </div>
        <span class="${priceClass}">${formatMoney(entry.amount)}</span>
      </article>`;
    })
    .join("");
}

function renderRecommendation(currentTrip, suggestion, timeMode) {
  if (!suggestion) {
    els.recommendation.hidden = false;
    els.recommendationTitle.textContent =
      currentTrip.total === 0 ? "Your selected timing is already ERP-free" : "No lower-cost timing found nearby";
    els.recommendationCopy.textContent =
      currentTrip.total === 0
        ? "The route has no estimated ERP charge at the selected timing."
        : "The nearby search window did not find a lower ERP cost for this route.";
    return;
  }

  const saving = currentTrip.total - suggestion.total;
  const title =
    suggestion.total === 0
      ? `Leave ${formatClock(suggestion.departureDate)} to avoid ERP`
      : `Leave ${formatClock(suggestion.departureDate)} for ${formatMoney(suggestion.total)}`;
  const arriveCopy =
    timeMode === "arrive"
      ? `It still arrives by ${formatClock(suggestion.arrivalDate)}.`
      : `Estimated arrival is ${formatClock(suggestion.arrivalDate)}.`;

  els.recommendation.hidden = false;
  els.recommendationTitle.textContent = title;
  els.recommendationCopy.textContent = `${arriveCopy} Estimated saving: ${formatMoney(saving)}.`;
}

function renderErrorState(message) {
  els.totalCost.textContent = formatMoney(0);
  els.driveTime.textContent = "--";
  els.driveDistance.textContent = "--";
  els.matchedCount.textContent = "--";
  els.timingBody.innerHTML = `<tr><td colspan="4" class="empty-row">${escapeHtml(message)}</td></tr>`;
  els.gantryList.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  els.recommendation.hidden = true;
  els.recommendationTitle.textContent = "";
  els.recommendationCopy.textContent = "";
}

function focusMapAfterEstimate() {
  if (!els.mapPanel || !window.matchMedia("(max-width: 760px)").matches) {
    refreshMapLayout();
    return;
  }

  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  requestAnimationFrame(() => {
    els.mapPanel.scrollIntoView({ behavior, block: "start" });
    refreshMapLayout();
    window.setTimeout(refreshMapLayout, 450);
  });
}

function refreshMapLayout() {
  if (!state.map) {
    return;
  }

  requestAnimationFrame(() => {
    state.map.invalidateSize({ pan: false });
  });
}

function renderSourceMetadata() {
  const generatedDate = state.erpData.meta.generatedAt
    ? new Date(state.erpData.meta.generatedAt).toLocaleDateString("en-SG", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Singapore",
      })
    : "unknown date";
  const pricedCount = state.erpData.gantries.filter((gantry) => gantry.isPriced).length;
  els.sourceGenerated.textContent = `Generated ${generatedDate}; ${pricedCount} priced gantry geometries indexed.`;
  els.sourceCopy.textContent = state.erpData.meta.notes.join(" ");
}

function buildCumulativeDistances(points) {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative[index] = cumulative[index - 1] + haversineMeters(points[index - 1], points[index]);
  }
  return cumulative;
}

function closestProgressOnRoute(point, routePoints, cumulativeMeters) {
  let best = {
    distanceMeters: Number.POSITIVE_INFINITY,
    progressMeters: 0,
    routeBearingDegrees: null,
  };
  const originLat = point.lat;
  const pointXY = toMeters(point, originLat);

  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const start = toMeters(routePoints[index], originLat);
    const end = toMeters(routePoints[index + 1], originLat);
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
    if (segmentLengthSquared === 0) {
      continue;
    }

    const t = clamp(
      ((pointXY.x - start.x) * segmentX + (pointXY.y - start.y) * segmentY) /
        segmentLengthSquared,
      0,
      1,
    );
    const closest = {
      x: start.x + segmentX * t,
      y: start.y + segmentY * t,
    };
    const dx = pointXY.x - closest.x;
    const dy = pointXY.y - closest.y;
    const distanceMeters = Math.hypot(dx, dy);
    if (distanceMeters < best.distanceMeters) {
      const segmentMeters = haversineMeters(routePoints[index], routePoints[index + 1]);
      best = {
        distanceMeters,
        progressMeters: cumulativeMeters[index] + segmentMeters * t,
        routeBearingDegrees: bearingDegrees(routePoints[index], routePoints[index + 1]),
      };
    }
  }

  return best;
}

function routeDirectionMatchesGantry(routeBearingDegrees, gantryDirectionDegrees) {
  if (!Number.isFinite(gantryDirectionDegrees) || !Number.isFinite(routeBearingDegrees)) {
    return true;
  }
  return directionDelta(routeBearingDegrees, gantryDirectionDegrees) <= DIRECTION_TOLERANCE_DEGREES;
}

function directionDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  const delta = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return Math.round(delta);
}

function bearingDegrees(a, b) {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function haversineMeters(a, b) {
  const radius = 6371000;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toMeters(point, originLat) {
  const radius = 6371000;
  return {
    x: toRadians(point.lng) * radius * Math.cos(toRadians(originLat)),
    y: toRadians(point.lat) * radius,
  };
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function setDefaultSingaporeDateTime() {
  const formatter = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  els.date.value = `${parts.year}-${parts.month}-${parts.day}`;
  const roundedMinute = Math.ceil(Number(parts.minute) / 5) * 5;
  const hour = Number(parts.hour) + (roundedMinute === 60 ? 1 : 0);
  const minute = roundedMinute === 60 ? 0 : roundedMinute;
  els.time.value = `${String(hour % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getSelectedDateTime() {
  return new Date(`${els.date.value}T${els.time.value}:00`);
}

function isWeekday(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

function isZeroErpDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek === 0 || SINGAPORE_PUBLIC_HOLIDAYS_2026.has(dateString);
}

function isMajorHolidayEveCutoff(dateString, minutes) {
  return ERP_EVE_CUTOFF_DATES_2026.has(dateString) && minutes >= 13 * 60;
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function minutesFromClock(clock) {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

function toDateInputValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function formatClock(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatMoney(amount) {
  return `S$${amount.toFixed(2)}`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function setStatus(message) {
  els.status.textContent = message;
}

function setLoading(isLoading) {
  els.primaryButton.disabled = isLoading;
  els.primaryButton.innerHTML = isLoading
    ? `<i data-lucide="loader-2"></i> Estimating`
    : `<i data-lucide="route"></i> Estimate ERP`;
  window.lucide?.createIcons();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
