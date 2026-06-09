const SINGAPORE_CENTER = [1.3521, 103.8198];
const GANTRY_POINT_MATCH_THRESHOLD_METERS = 115;
const GANTRY_LINE_MATCH_THRESHOLD_METERS = 70;
const DIRECTION_TOLERANCE_DEGREES = 75;
const DATA_VERSION = "2026-06-10-default-start-v18";
const DEFAULT_START_POINT = {
  inputValue: "838 Yishun St 81 Singapore 760838",
  lat: 1.41642178701227,
  lng: 103.833559766776,
  label: "838 YISHUN STREET 81 SINGAPORE 760838",
};
const ROUTE_SEARCH_START_MINUTES = 4 * 60 + 30;
const ROUTE_SEARCH_END_MINUTES = 22 * 60 + 30;
const ERP_RATE_TABLE_START_MINUTES = 7 * 60;
const ERP_RATE_TABLE_END_MINUTES = 20 * 60;
const MAX_ROUTE_OPTIONS = 3;
const ROUTING_TIMEOUTS = {
  onemap: 5200,
  valhalla: 2800,
  fossgisOsrm: 6500,
  osrmDemo: 6500,
};
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

const VEHICLE_TYPES = {
  motorcycle: {
    label: "Motorcycle",
    multiplier: 0.5,
  },
  car: {
    label: "Passenger car / taxi / light goods",
    multiplier: 1,
  },
  heavy: {
    label: "Heavy goods / small bus",
    multiplier: 1.5,
  },
  "very-heavy": {
    label: "Very heavy goods / big bus",
    multiplier: 2,
  },
};

const MAP_SOURCES = {
  osm: {
    label: "OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  "osm-hot": {
    label: "OSM Humanitarian",
    url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    options: {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, tiles &copy; HOT',
    },
  },
  "carto-light": {
    label: "Carto Light",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    options: {
      maxZoom: 20,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  "esri-imagery": {
    label: "Esri Imagery",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    options: {
      maxZoom: 19,
      attribution:
        "Tiles &copy; Esri, Earthstar Geographics, and the GIS user community",
    },
  },
};

const state = {
  erpData: null,
  map: null,
  baseLayer: null,
  allGantriesLayer: null,
  matchedGantriesLayer: null,
  routeLayerGroup: null,
  pointLayer: null,
  address: {
    start: null,
    destination: null,
  },
  currentPlan: null,
  selectedRoutes: {
    outbound: 0,
    return: 0,
  },
  routeSelectionToRestore: null,
  showAllGantries: true,
  suggestionTimers: {},
  autoEstimateOnReady: false,
  routeRequestId: 0,
};

const els = {
  form: document.querySelector("#route-form"),
  start: document.querySelector("#start-input"),
  destination: document.querySelector("#destination-input"),
  startSuggestions: document.querySelector("#start-suggestions"),
  destinationSuggestions: document.querySelector("#destination-suggestions"),
  startConfirmation: document.querySelector("#start-confirmation"),
  destinationConfirmation: document.querySelector("#destination-confirmation"),
  swap: document.querySelector("#swap-button"),
  date: document.querySelector("#date-input"),
  time: document.querySelector("#time-input"),
  returnControls: document.querySelector("#return-controls"),
  returnDate: document.querySelector("#return-date-input"),
  returnTime: document.querySelector("#return-time-input"),
  vehicleType: document.querySelector("#vehicle-type"),
  mapSource: document.querySelector("#map-source"),
  showAllGantries: document.querySelector("#show-all-gantries"),
  fitRoute: document.querySelector("#fit-route-button"),
  share: document.querySelector("#share-button"),
  reset: document.querySelector("#reset-button"),
  totalCost: document.querySelector("#total-cost"),
  driveTime: document.querySelector("#drive-time"),
  driveDistance: document.querySelector("#drive-distance"),
  matchedCount: document.querySelector("#matched-count"),
  timingBody: document.querySelector("#timing-body"),
  gantryList: document.querySelector("#gantry-list"),
  status: document.querySelector("#status-bar"),
  comparisonNote: document.querySelector("#comparison-note"),
  recommendation: document.querySelector("#recommendation"),
  recommendationTitle: document.querySelector("#recommendation-title"),
  recommendationCopy: document.querySelector("#recommendation-copy"),
  sourceGenerated: document.querySelector("#source-generated"),
  sourceCopy: document.querySelector("#source-copy"),
  primaryButton: document.querySelector(".primary-button"),
  mapPanel: document.querySelector("#map-panel"),
  routeOptionsSection: document.querySelector("#route-options-section"),
  routeOptions: document.querySelector("#route-options"),
  routeProvider: document.querySelector("#route-provider"),
  mapResultDock: document.querySelector("#map-result-dock"),
  mapDockTotal: document.querySelector("#map-dock-total"),
  mapDockMeta: document.querySelector("#map-dock-meta"),
  mapDockProvider: document.querySelector("#map-dock-provider"),
  tripBreakdown: document.querySelector("#trip-breakdown"),
};

init().catch((error) => {
  console.error(error);
  setStatus("Could not start the estimator. Refresh the page and try again.");
});

async function init() {
  setDefaultSingaporeDateTime();
  setReturnOffset(8);
  initMap();
  hydrateFromUrl();
  applyDefaultStartAddress();
  state.erpData = await fetchJson(`./data/erp-data.json?v=${DATA_VERSION}`);
  renderSourceMetadata();
  renderAllGantries();
  bindEvents();
  renderTripMode();
  window.lucide?.createIcons();

  if (state.autoEstimateOnReady) {
    window.setTimeout(() => els.form.requestSubmit(), 250);
  }
}

function bindEvents() {
  els.form.addEventListener("submit", handleRouteSubmit);
  els.swap.addEventListener("click", handleSwap);
  els.vehicleType.addEventListener("change", () => {
    renderAllGantries();
    if (state.currentPlan) {
      recalculatePlanForVehicle();
    }
  });
  els.mapSource.addEventListener("change", () => setMapSource(els.mapSource.value));
  els.showAllGantries.addEventListener("change", () => {
    state.showAllGantries = els.showAllGantries.checked;
    renderAllGantries();
  });
  els.fitRoute.addEventListener("click", fitCurrentRoute);
  els.share.addEventListener("click", copyShareUrl);
  els.reset.addEventListener("click", resetEstimator);
  els.date.addEventListener("change", () => {
    syncReturnDateIfBeforeDeparture();
    renderAllGantries();
  });
  els.time.addEventListener("change", () => {
    syncReturnDateIfBeforeDeparture();
    renderAllGantries();
  });

  document.querySelectorAll("input[name='tripMode']").forEach((input) => {
    input.addEventListener("change", renderTripMode);
  });

  bindAddressField("start");
  bindAddressField("destination");

  document.querySelectorAll(".date-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const date = addDays(new Date(), Number(button.dataset.dateOffset));
      els.date.value = toDateInputValue(date);
      syncReturnDateIfBeforeDeparture();
    });
  });

  document.querySelectorAll(".time-chip").forEach((button) => {
    button.addEventListener("click", () => {
      els.time.value = button.dataset.time;
      syncReturnDateIfBeforeDeparture();
    });
  });

  document.querySelectorAll(".return-chip").forEach((button) => {
    button.addEventListener("click", () => setReturnOffset(Number(button.dataset.hours)));
  });

  document.querySelectorAll(".time-step").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.querySelector(`#${button.dataset.target}`);
      stepTimeInput(target, Number(button.dataset.minutes));
      syncReturnDateIfBeforeDeparture();
    });
  });

  document.addEventListener("click", (event) => {
    const tooltipCard = event.target.closest(".tooltip-card");
    document.querySelectorAll(".tooltip-card.show-tooltip").forEach((card) => {
      if (card !== tooltipCard) {
        card.classList.remove("show-tooltip");
      }
    });
    if (tooltipCard && window.matchMedia("(hover: none)").matches) {
      tooltipCard.classList.toggle("show-tooltip");
    }
  });
}

function bindAddressField(type) {
  const input = els[type];
  input.addEventListener("input", () => {
    const confirmed = state.address[type];
    if (confirmed && confirmed.inputValue !== input.value.trim()) {
      state.address[type] = null;
      renderAddressConfirmation(type);
    }

    window.clearTimeout(state.suggestionTimers[type]);
    state.suggestionTimers[type] = window.setTimeout(async () => {
      const query = input.value.trim();
      if (query.length < 3) {
        renderAddressSuggestions(type, []);
        return;
      }
      try {
        renderAddressSuggestions(type, null);
        const suggestions = await fetchAddressSuggestions(query, 5);
        renderAddressSuggestions(type, suggestions);
      } catch {
        renderAddressSuggestions(type, []);
      }
    }, 350);
  });
}

async function handleRouteSubmit(event) {
  event.preventDefault();
  const requestId = ++state.routeRequestId;
  setLoading(true);
  clearRouteLayers();
  setStatus("Confirming addresses and finding route options...");

  try {
    const startPoint = await requireConfirmedAddress("start");
    const endPoint = await requireConfirmedAddress("destination");
    const vehicleType = getVehicleType();
    const tripMode = getTripMode();
    const outboundDeparture = getSelectedDateTime();
    const returnDeparture = tripMode === "return" ? getReturnDateTime() : null;

    if (tripMode === "return" && returnDeparture <= outboundDeparture) {
      throw new Error("Choose a return time after the outbound departure.");
    }

    const [outboundRoutes, returnRoutes] = await Promise.all([
      fetchDrivingRoutes(startPoint, endPoint),
      tripMode === "return" ? fetchDrivingRoutes(endPoint, startPoint) : Promise.resolve([]),
    ]);

    const outbound = buildLegOptions({
      legKey: "outbound",
      legLabel: "Outbound",
      routes: outboundRoutes,
      departureDate: outboundDeparture,
      vehicleType,
    });
    const returnLeg =
      tripMode === "return"
        ? buildLegOptions({
            legKey: "return",
            legLabel: "Return",
            routes: returnRoutes,
            departureDate: returnDeparture,
            vehicleType,
          })
        : [];

    if (requestId !== state.routeRequestId) {
      return;
    }

    const routeSelectionToRestore = state.routeSelectionToRestore;
    state.routeSelectionToRestore = null;
    state.selectedRoutes = {
      outbound: routeIndexOrDefault(routeSelectionToRestore?.outbound, outbound.length),
      return: routeIndexOrDefault(routeSelectionToRestore?.return, returnLeg.length),
    };
    state.currentPlan = {
      startPoint,
      endPoint,
      tripMode,
      vehicleType,
      outbound,
      return: returnLeg,
    };

    renderPlan();
    focusMapAfterEstimate();
    replaceUrlWithShareState();
  } catch (error) {
    if (requestId !== state.routeRequestId) {
      return;
    }
    setStatus(error.message || "Unable to calculate this route.");
    renderErrorState(error.message || "Unable to calculate this route.");
  } finally {
    if (requestId === state.routeRequestId) {
      setLoading(false);
    }
  }
}

function buildLegOptions({ legKey, legLabel, routes, departureDate, vehicleType }) {
  const options = routes
    .slice(0, MAX_ROUTE_OPTIONS)
    .map((route) => {
      const matchedGantries = matchGantriesToRoute(route);
      const trip = calculateTrip(route, matchedGantries, departureDate, vehicleType, legLabel);
      return {
        legKey,
        legLabel,
        route,
        matchedGantries,
        trip,
      };
    });
  return rankLegOptions(legKey, options);
}

function rankLegOptions(legKey, options) {
  return [...options]
    .sort((a, b) => legOptionRecommendationScore(a) - legOptionRecommendationScore(b))
    .map((option, index) => ({
      ...option,
      id: `${legKey}-${index}`,
      index,
    }));
}

function legOptionRecommendationScore(option) {
  return option.route.efficiencyScore + option.trip.total * 90;
}

function recalculatePlanForVehicle() {
  const vehicleType = getVehicleType();
  state.currentPlan.vehicleType = vehicleType;
  state.currentPlan.outbound = rankLegOptions(
    "outbound",
    state.currentPlan.outbound.map((option) => ({
      ...option,
      trip: calculateTrip(
        option.route,
        option.matchedGantries,
        option.trip.departureDate,
        vehicleType,
        option.legLabel,
      ),
    })),
  );
  state.currentPlan.return = rankLegOptions(
    "return",
    state.currentPlan.return.map((option) => ({
      ...option,
      trip: calculateTrip(
        option.route,
        option.matchedGantries,
        option.trip.departureDate,
        vehicleType,
        option.legLabel,
      ),
    })),
  );
  state.selectedRoutes = {
    outbound: routeIndexOrDefault(state.selectedRoutes.outbound, state.currentPlan.outbound.length),
    return: routeIndexOrDefault(state.selectedRoutes.return, state.currentPlan.return.length),
  };
  renderPlan();
  replaceUrlWithShareState();
}

function renderPlan() {
  const selectedLegs = getSelectedLegs();
  const total = selectedLegs.reduce((sum, option) => sum + option.trip.total, 0);
  const gantryCount = selectedLegs.reduce((sum, option) => sum + option.trip.entries.length, 0);

  renderRouteOptions();
  renderRouteProvider(selectedLegs);
  renderRouteMap(selectedLegs);
  renderSummary(selectedLegs, total, gantryCount);
  renderMapResultDock(selectedLegs, total, gantryCount);
  renderTripBreakdown(selectedLegs);
  renderTimingComparison(buildTimingComparison(selectedLegs), selectedLegs[0].trip.departureDate);
  renderGantryList(selectedLegs.flatMap((option) => option.trip.entries));
  renderRecommendation(selectedLegs);

  setStatus(
    `Selected ${state.currentPlan.tripMode === "return" ? "return" : "one-way"} route matched ${gantryCount} ERP location${
      gantryCount === 1 ? "" : "s"
    }. Vehicle: ${VEHICLE_TYPES[state.currentPlan.vehicleType].label}.`,
  );
}

function renderRouteOptions() {
  const sections = [
    routeOptionsForLeg("outbound", state.currentPlan.outbound),
    state.currentPlan.tripMode === "return"
      ? routeOptionsForLeg("return", state.currentPlan.return)
      : "",
  ].filter(Boolean);

  els.routeOptionsSection.hidden = false;
  els.routeOptions.innerHTML = sections.join("");
  els.routeOptions.querySelectorAll(".route-option").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedRoutes[button.dataset.leg] = Number(button.dataset.index);
      renderPlan();
      replaceUrlWithShareState();
    });
  });
}

function routeOptionsForLeg(legKey, options) {
  if (!options.length) {
    return "";
  }

  const heading = `<div class="route-option-group-title">${legKey === "outbound" ? "Outbound" : "Return"}</div>`;
  const cards = options
    .map((option) => {
      const isSelected = state.selectedRoutes[legKey] === option.index;
      const tooltip = routeOptionTooltip(option);
      return `<button class="route-option tooltip-card ${isSelected ? "selected" : ""}" data-leg="${legKey}" data-index="${
        option.index
      }" data-tooltip="${escapeHtml(tooltip)}" type="button">
        <span class="route-option-topline">
          <span class="route-option-name">${routeOptionName(option)}</span>
          <span class="route-provider-chip">${escapeHtml(routingProviderLabel(option.route))}</span>
        </span>
        <strong>${formatMoney(option.trip.total)}</strong>
        <small>${formatDuration(option.route.durationSeconds)} · ${formatDistance(option.route.totalMeters)} · ${
          option.trip.entries.length
        } ERP</small>
      </button>`;
    })
    .join("");
  return `${heading}<div class="route-option-row">${cards}</div>`;
}

function renderRouteProvider(selectedLegs) {
  if (!selectedLegs.length) {
    els.routeProvider.textContent = "";
    return;
  }

  const selectedProviders = selectedLegs.map((option) => routingProviderLabel(option.route));
  const uniqueProviders = [...new Set(selectedProviders)];
  if (uniqueProviders.length === 1) {
    els.routeProvider.textContent = `Routing: ${uniqueProviders[0]}`;
    return;
  }

  els.routeProvider.textContent = `Routing: ${selectedLegs
    .map((option) => `${option.legLabel}: ${routingProviderLabel(option.route)}`)
    .join(" · ")}`;
}

function routingProviderLabel(route) {
  return route?.providerLabel || "Fallback routing";
}

function routeOptionName(option) {
  if (option.index === 0) {
    return "Recommended route";
  }
  return `Alternative ${option.index + 1}`;
}

function routeOptionTooltip(option) {
  const charged = option.trip.entries.filter((entry) => entry.amount > 0).length;
  const routeName = option.route.routeName ? ` Via ${option.route.routeName}.` : "";
  return `${option.legLabel}: ${option.route.providerLabel}.${routeName} Ranked by drive time, distance, detour and ERP charge. ${formatDistance(option.route.totalMeters)}, ${formatDuration(
    option.route.durationSeconds,
  )}, ${option.trip.entries.length} matched ERP location${
    option.trip.entries.length === 1 ? "" : "s"
  }, ${charged} charged at this timing.`;
}

function renderSummary(selectedLegs, total, gantryCount) {
  const durationSeconds = selectedLegs.reduce((sum, option) => sum + option.route.durationSeconds, 0);
  const distanceMeters = selectedLegs.reduce((sum, option) => sum + option.route.totalMeters, 0);
  els.totalCost.textContent = formatMoney(total);
  els.driveTime.textContent = formatDuration(durationSeconds);
  els.driveDistance.textContent = formatDistance(distanceMeters);
  els.matchedCount.textContent = String(gantryCount);
}

function renderMapResultDock(selectedLegs, total, gantryCount) {
  if (!selectedLegs.length) {
    els.mapResultDock.hidden = true;
    return;
  }

  const durationSeconds = selectedLegs.reduce((sum, option) => sum + option.route.durationSeconds, 0);
  const distanceMeters = selectedLegs.reduce((sum, option) => sum + option.route.totalMeters, 0);
  const providers = [...new Set(selectedLegs.map((option) => routingProviderLabel(option.route)))];
  els.mapResultDock.hidden = false;
  els.mapDockTotal.textContent = formatMoney(total);
  els.mapDockMeta.textContent = `${formatDuration(durationSeconds)} · ${formatDistance(distanceMeters)} · ${gantryCount} ERP`;
  els.mapDockProvider.textContent = providers.length === 1 ? providers[0] : providers.join(" · ");
}

function renderTripBreakdown(selectedLegs) {
  if (selectedLegs.length < 2) {
    els.tripBreakdown.hidden = true;
    els.tripBreakdown.innerHTML = "";
    return;
  }

  els.tripBreakdown.hidden = false;
  els.tripBreakdown.innerHTML = selectedLegs
    .map((option) => {
      return `<article>
        <span>${option.legLabel}</span>
        <strong>${formatMoney(option.trip.total)}</strong>
        <small>${formatClock(option.trip.departureDate)} to ${formatClock(option.trip.arrivalDate)} · ${formatDistance(
          option.route.totalMeters,
        )}</small>
      </article>`;
    })
    .join("");
}

function renderRouteMap(selectedLegs) {
  clearRouteLayers();
  const routeColors = {
    outbound: "#1267d6",
    return: "#0d835c",
  };

  state.currentPlan.outbound.forEach((option) => {
    drawRouteOption(option, routeColors.outbound, state.selectedRoutes.outbound === option.index);
  });
  state.currentPlan.return.forEach((option) => {
    drawRouteOption(option, routeColors.return, state.selectedRoutes.return === option.index);
  });

  L.circleMarker([state.currentPlan.startPoint.lat, state.currentPlan.startPoint.lng], {
    radius: 7,
    color: "#0d835c",
    fillColor: "#0d835c",
    fillOpacity: 1,
    weight: 2,
  })
    .bindPopup(`<strong>Start</strong><br>${escapeHtml(state.currentPlan.startPoint.label)}`)
    .addTo(state.pointLayer);

  L.circleMarker([state.currentPlan.endPoint.lat, state.currentPlan.endPoint.lng], {
    radius: 7,
    color: "#d94b3d",
    fillColor: "#d94b3d",
    fillOpacity: 1,
    weight: 2,
  })
    .bindPopup(`<strong>Destination</strong><br>${escapeHtml(state.currentPlan.endPoint.label)}`)
    .addTo(state.pointLayer);

  selectedLegs.forEach((option) => {
    option.trip.entries.forEach((entry) => drawMatchedGantry(entry));
  });

  fitCurrentRoute();
  refreshMapLayout();
}

function drawRouteOption(option, color, isSelected) {
  const layer = L.polyline(
    option.route.points.map((point) => [point.lat, point.lng]),
    {
      color,
      weight: isSelected ? 6 : 4,
      opacity: isSelected ? 0.9 : 0.22,
      lineJoin: "round",
      dashArray: isSelected ? null : "8 10",
    },
  ).addTo(state.routeLayerGroup);

  const popup = `<strong>${escapeHtml(option.legLabel)} ${
    option.index === 0 ? "fastest route" : `alternative ${option.index + 1}`
  }</strong><br>${formatDistance(option.route.totalMeters)} · ${formatDuration(
    option.route.durationSeconds,
  )}<br>ERP at selected timing: ${formatMoney(option.trip.total)}`;
  layer.bindPopup(popup);
  bindHoverPopup(layer);
}

function drawMatchedGantry(entry) {
  const color = entry.amount > 0 ? "#d94b3d" : "#465159";
  const info = infoForTripEntry(entry);

  if (entry.match.gantry.line?.length > 1) {
    const line = L.polyline(entry.match.gantry.line, {
      color,
      weight: entry.amount > 0 ? 6 : 4,
      opacity: 0.95,
      className: "erp-map-target",
    }).addTo(state.matchedGantriesLayer);
    bindGantryInfo(line, info.popup, info.tooltip);
  }

  const marker = L.circleMarker(entry.match.gantry.center, {
    radius: entry.amount > 0 ? 8 : 6,
    color: "#ffffff",
    fillColor: color,
    fillOpacity: 1,
    weight: 2,
    className: "erp-map-target",
  }).addTo(state.matchedGantriesLayer);
  bindGantryInfo(marker, info.popup, info.tooltip);
}

function infoForTripEntry(entry) {
  return infoForErpRates({
    groupId: entry.groupId,
    title: erpRateTitle(entry.label, entry.gantryNos),
    vehicleType: state.currentPlan?.vehicleType || getVehicleType(),
    dateString: entry.crossingDateString || selectedRateDateString(),
    highlightMinutes: entry.crossingDate.getHours() * 60 + entry.crossingDate.getMinutes(),
    note: `${entry.legLabel} crosses around ${entry.crossingTime}. Estimated charge: ${formatMoney(entry.amount)}.`,
  });
}

function renderTimingComparison(rows, baseDeparture) {
  const minCost = Math.min(...rows.map((row) => row.total));
  const modeCopy =
    state.currentPlan?.tripMode === "return"
      ? "Outbound departure intervals; return time stays fixed."
      : "15-minute departure intervals around your selected timing.";
  els.comparisonNote.textContent = modeCopy;
  els.timingBody.innerHTML = rows
    .map((row) => {
      const rowClasses = [
        row.total === minCost ? "best-row" : "",
        Math.abs(row.departureDate - baseDeparture) < 1000 ? "current-row" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<tr class="${rowClasses}">
        <td data-label="Leave">${formatClock(row.departureDate)}</td>
        <td data-label="Arrive">${formatClock(row.arrivalDate)}</td>
        <td data-label="ERP" class="money">${formatMoney(row.total)}</td>
        <td data-label="Route ERP">${row.routeErp}</td>
      </tr>`;
    })
    .join("");
}

function buildTimingComparison(selectedLegs) {
  const outbound = selectedLegs[0];
  const returnLeg = selectedLegs[1];
  const rows = [];
  for (let offset = -60; offset <= 180; offset += 15) {
    const departure = addMinutes(outbound.trip.departureDate, offset);
    const outboundTrip = calculateTrip(
      outbound.route,
      outbound.matchedGantries,
      departure,
      state.currentPlan.vehicleType,
      outbound.legLabel,
    );
    const total = outboundTrip.total + (returnLeg?.trip.total || 0);
    const routeErp = outboundTrip.entries.length + (returnLeg?.trip.entries.length || 0);
    rows.push({
      departureDate: departure,
      arrivalDate: outboundTrip.arrivalDate,
      total,
      routeErp,
    });
  }
  return rows;
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
      const tooltip = entryTooltip(entry);
      return `<article class="gantry-item tooltip-card" tabindex="0" data-tooltip="${escapeHtml(tooltip)}">
        <div>
          <strong>${escapeHtml(entry.label)}</strong>
          <small>${escapeHtml(entry.legLabel)} · Gantry ${escapeHtml(numbers)} at about ${
            entry.crossingTime
          }. ${escapeHtml(entry.rateLabel)}. Matched ${Math.round(entry.match.distanceMeters)} m by ${
            entry.match.matchType === "line" ? "gantry line" : "marker"
          }.</small>
        </div>
        <span class="${priceClass}">${formatMoney(entry.amount)}</span>
      </article>`;
    })
    .join("");
}

function entryTooltip(entry) {
  return `${entry.legLabel}: ${entry.label}. ${entry.rateLabel}. Base ${formatMoney(
    entry.baseAmount,
  )} x ${formatMultiplier(entry.multiplier)} for ${entry.vehicleLabel} = ${formatMoney(entry.amount)}.`;
}

function renderRecommendation(selectedLegs) {
  const outbound = selectedLegs[0];
  const currentTotal = selectedLegs.reduce((sum, option) => sum + option.trip.total, 0);
  const suggestion = findBestSuggestion(selectedLegs);

  if (!suggestion) {
    els.recommendation.hidden = false;
    els.recommendationTitle.textContent =
      currentTotal === 0 ? "Your selected timing is already ERP-free" : "No lower-cost timing found nearby";
    els.recommendationCopy.textContent =
      currentTotal === 0
        ? "The route has no estimated ERP charge at the selected timing."
        : "The nearby search window did not find a lower ERP cost for this route.";
    return;
  }

  const saving = currentTotal - suggestion.total;
  els.recommendation.hidden = false;
  els.recommendationTitle.textContent =
    suggestion.total === 0
      ? `Leave ${formatClock(suggestion.departureDate)} to avoid ERP`
      : `Leave ${formatClock(suggestion.departureDate)} for ${formatMoney(suggestion.total)}`;
  els.recommendationCopy.textContent = `Estimated arrival is ${formatClock(
    addSeconds(suggestion.departureDate, outbound.route.durationSeconds),
  )}. Estimated saving: ${formatMoney(saving)}.`;
}

function findBestSuggestion(selectedLegs) {
  const outbound = selectedLegs[0];
  const returnLeg = selectedLegs[1];
  const baseDeparture = outbound.trip.departureDate;
  const dateString = toDateInputValue(baseDeparture);
  const startOfDay = new Date(`${dateString}T00:00:00`);
  const currentTotal = selectedLegs.reduce((sum, option) => sum + option.trip.total, 0);
  let best = null;

  for (let minute = ROUTE_SEARCH_START_MINUTES; minute <= ROUTE_SEARCH_END_MINUTES; minute += 5) {
    const departure = addMinutes(startOfDay, minute);
    const outboundTrip = calculateTrip(
      outbound.route,
      outbound.matchedGantries,
      departure,
      state.currentPlan.vehicleType,
      outbound.legLabel,
    );
    const total = outboundTrip.total + (returnLeg?.trip.total || 0);
    const candidate = {
      departureDate: departure,
      total,
    };
    if (!best) {
      best = candidate;
      continue;
    }
    const bestDistance = Math.abs(best.departureDate - baseDeparture);
    const candidateDistance = Math.abs(candidate.departureDate - baseDeparture);
    if (candidate.total < best.total || (candidate.total === best.total && candidateDistance < bestDistance)) {
      best = candidate;
    }
  }

  if (!best || best.total >= currentTotal) {
    return null;
  }
  return best;
}

function renderErrorState(message) {
  els.totalCost.textContent = formatMoney(0);
  els.driveTime.textContent = "--";
  els.driveDistance.textContent = "--";
  els.matchedCount.textContent = "--";
  els.timingBody.innerHTML = `<tr><td colspan="4" class="empty-row">${escapeHtml(message)}</td></tr>`;
  els.gantryList.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  els.routeOptionsSection.hidden = true;
  els.routeOptions.innerHTML = "";
  els.routeProvider.textContent = "";
  els.mapResultDock.hidden = true;
  els.tripBreakdown.hidden = true;
  els.tripBreakdown.innerHTML = "";
  els.recommendation.hidden = true;
  els.recommendationTitle.textContent = "";
  els.recommendationCopy.textContent = "";
}

function renderInitialResults() {
  els.totalCost.textContent = formatMoney(0);
  els.driveTime.textContent = "--";
  els.driveDistance.textContent = "--";
  els.matchedCount.textContent = "--";
  els.comparisonNote.textContent = "Run an estimate to compare costs.";
  els.timingBody.innerHTML = `<tr><td colspan="4" class="empty-row">No route calculated yet.</td></tr>`;
  els.gantryList.innerHTML = `<div class="empty-state">No route calculated yet.</div>`;
  els.routeOptionsSection.hidden = true;
  els.routeOptions.innerHTML = "";
  els.routeProvider.textContent = "";
  els.mapResultDock.hidden = true;
  els.tripBreakdown.hidden = true;
  els.tripBreakdown.innerHTML = "";
  els.recommendation.hidden = true;
  els.recommendationTitle.textContent = "";
  els.recommendationCopy.textContent = "";
}

function initMap() {
  state.map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView(SINGAPORE_CENTER, 12);

  setMapSource(els.mapSource.value || "osm");
  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(state.map);
  state.map.on("popupopen", keepPopupInViewport);

  state.allGantriesLayer = L.layerGroup().addTo(state.map);
  state.matchedGantriesLayer = L.layerGroup().addTo(state.map);
  state.routeLayerGroup = L.layerGroup().addTo(state.map);
  state.pointLayer = L.layerGroup().addTo(state.map);
}

function setMapSource(sourceKey) {
  const source = MAP_SOURCES[sourceKey] || MAP_SOURCES.osm;
  if (state.baseLayer) {
    state.baseLayer.remove();
  }
  state.baseLayer = L.tileLayer(source.url, source.options).addTo(state.map);
  state.baseLayer.bringToBack();
  els.mapSource.value = sourceKey in MAP_SOURCES ? sourceKey : "osm";
}

function renderAllGantries() {
  if (!state.erpData || !state.allGantriesLayer) {
    return;
  }
  state.allGantriesLayer.clearLayers();
  if (!state.showAllGantries) {
    return;
  }
  state.erpData.gantries.forEach((gantry) => {
    const marker = L.circleMarker(gantry.center, {
      radius: gantry.isPriced ? 5 : 4,
      color: gantry.isPriced ? "#b76e00" : "#6f7a80",
      fillColor: gantry.isPriced ? "#f0a534" : "#8b969d",
      fillOpacity: gantry.isPriced ? 0.82 : 0.5,
      opacity: 0.75,
      weight: gantry.isPriced ? 1.5 : 1,
      className: "erp-map-target",
    });
    const info = infoForGantry(gantry);
    bindGantryInfo(marker, info.popup, info.tooltip);
    marker.addTo(state.allGantriesLayer);
  });
}

function infoForGantry(gantry) {
  const group = state.erpData.groups.find((candidate) => candidate.id === gantry.groupId);
  return infoForErpRates({
    groupId: gantry.groupId,
    title: erpRateTitle(group?.label || gantry.label, group?.gantryNos || [gantry.gantryNo].filter(Boolean)),
    vehicleType: getVehicleType(),
    dateString: selectedRateDateString(),
    highlightMinutes: selectedRateMinutes(),
  });
}

function infoForErpRates(options) {
  return {
    popup: popupForErpRates(options),
    tooltip: tooltipForErpRates(options),
  };
}

function popupForErpRates({ groupId, title, vehicleType, dateString, note = "" }) {
  const rows = buildErpRateRows(groupId, dateString, vehicleType);
  const body = rows
    .map((row) => {
      return `<tr>
        <td>${escapeHtml(row.range)}</td>
        <td>${formatPopupMoney(row.amount)}</td>
      </tr>`;
    })
    .join("");

  return `<div class="erp-rate-card">
    <h3>${escapeHtml(title)}</h3>
    <div class="erp-rate-controls">
      <div class="erp-rate-select" aria-hidden="true">${escapeHtml(vehiclePopupLabel(vehicleType))}</div>
      <div class="erp-rate-select" aria-hidden="true">${escapeHtml(rateDayLabel(dateString))}</div>
    </div>
    <div class="erp-rate-table-wrap">
      <table class="erp-rate-table">
        <tbody>${body}</tbody>
      </table>
    </div>
    ${note ? `<p class="erp-rate-note">${escapeHtml(note)}</p>` : ""}
  </div>`;
}

function tooltipForErpRates({ groupId, title, vehicleType, dateString, highlightMinutes }) {
  const rows = buildErpRateRows(groupId, dateString, vehicleType);
  const activeMinutes = Number.isFinite(highlightMinutes) ? highlightMinutes : selectedRateMinutes();
  const activeRow = rowForMinutes(rows, activeMinutes);
  const maxAmount = Math.max(...rows.map((row) => row.amount));
  const chargedWindow = chargedWindowSummary(rows);

  return `<div class="erp-hover-card">
    <span class="erp-hover-kicker">ERP rates</span>
    <h3>${escapeHtml(title)}</h3>
    <div class="erp-hover-meta">
      <span>${escapeHtml(vehiclePopupLabel(vehicleType))}</span>
      <span>${escapeHtml(rateDayLabel(dateString))}</span>
    </div>
    <div class="erp-hover-stats">
      <div>
        <span>${escapeHtml(clockFromMinutes(activeMinutes))}</span>
        <strong>${formatPopupMoney(activeRow.amount)}</strong>
      </div>
      <div>
        <span>Peak</span>
        <strong>${formatPopupMoney(maxAmount)}</strong>
      </div>
    </div>
    <p><span>Charged window</span><strong>${escapeHtml(chargedWindow)}</strong></p>
  </div>`;
}

function erpRateTitle(label, gantryNos) {
  const numbers = gantryNos?.filter(Boolean).join(", ");
  return numbers ? `${label} (${numbers})` : label;
}

function buildErpRateRows(groupId, dateString, vehicleType) {
  if (!groupId) {
    return [{ range: "All day", amount: 0 }];
  }

  if (isZeroErpDate(dateString) || !isWeekday(dateString)) {
    return [{ range: "All day", amount: 0 }];
  }

  const relevantSegments = [
    ...state.erpData.baseRates.filter((rate) => rate.groupId === groupId),
    ...state.erpData.adjustments.filter((adjustment) => {
      return (
        adjustment.groupId === groupId &&
        dateString >= adjustment.fromDate &&
        (!adjustment.toDate || dateString <= adjustment.toDate)
      );
    }),
  ];

  if (!relevantSegments.length) {
    return [{ range: "All day", amount: 0 }];
  }

  const boundaries = new Set([ERP_RATE_TABLE_START_MINUTES, ERP_RATE_TABLE_END_MINUTES]);
  relevantSegments.forEach((segment) => {
    const start = clamp(minutesFromClock(segment.start), ERP_RATE_TABLE_START_MINUTES, ERP_RATE_TABLE_END_MINUTES);
    const end = clamp(minutesFromClock(segment.end), ERP_RATE_TABLE_START_MINUTES, ERP_RATE_TABLE_END_MINUTES);
    if (start < end) {
      boundaries.add(start);
      boundaries.add(end);
    }
  });

  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
  const rows = [];
  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const start = sortedBoundaries[index];
    const end = sortedBoundaries[index + 1];
    if (start >= end) {
      continue;
    }
    const rate = getRateForGroup(groupId, dateWithMinutes(dateString, start), vehicleType);
    const previous = rows.at(-1);
    if (previous && previous.amount === rate.amount && previous.end === start) {
      previous.end = end;
      previous.range = `${clockFromMinutes(previous.start)} - ${clockFromMinutes(end)}`;
    } else {
      rows.push({
        start,
        end,
        range: `${clockFromMinutes(start)} - ${clockFromMinutes(end)}`,
        amount: rate.amount,
      });
    }
  }

  return rows.length ? rows : [{ range: "All day", amount: 0 }];
}

function selectedRateDateString() {
  return els.date.value || toDateInputValue(new Date());
}

function selectedRateMinutes() {
  return els.time.value ? minutesFromClock(els.time.value) : 8 * 60 + 30;
}

function rowForMinutes(rows, minutes) {
  return (
    rows.find((row) => Number.isFinite(row.start) && minutes >= row.start && minutes < row.end) ||
    rows.find((row) => row.amount > 0) ||
    rows[0] || { amount: 0, range: "All day" }
  );
}

function chargedWindowSummary(rows) {
  const chargedRows = rows.filter((row) => row.amount > 0 && Number.isFinite(row.start) && Number.isFinite(row.end));
  if (!chargedRows.length) {
    return "No charge";
  }
  return `${clockFromMinutes(chargedRows[0].start)} - ${clockFromMinutes(chargedRows.at(-1).end)}`;
}

function dateWithMinutes(dateString, minutes) {
  return new Date(`${dateString}T${clockFromMinutes(minutes)}:00`);
}

function clockFromMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function vehiclePopupLabel(vehicleType) {
  const labels = {
    motorcycle: "Motorcycles",
    car: "Passenger Cars/Light Goods Vehicles/Taxis",
    heavy: "Heavy Goods Vehicles/Small Buses",
    "very-heavy": "Very Heavy Goods Vehicles/Big Buses",
  };
  return labels[vehicleType] || labels.car;
}

function rateDayLabel(dateString) {
  if (isZeroErpDate(dateString)) {
    return "Sundays/Public Holidays";
  }
  if (!isWeekday(dateString)) {
    return "Saturdays";
  }
  return "Weekdays";
}

function bindHoverPopup(layer) {
  layer.on("mouseover", () => {
    if (window.matchMedia("(hover: hover)").matches) {
      layer.openPopup();
    }
  });
  layer.on("mouseout", () => {
    if (window.matchMedia("(hover: hover)").matches) {
      layer.closePopup();
    }
  });
}

function bindGantryInfo(layer, popupContent, tooltipContent) {
  layer.bindPopup(popupContent, {
    className: "map-info-popup",
    maxWidth: 320,
    autoPan: true,
    autoPanPadding: [44, 44],
    keepInView: true,
  });
  layer.bindTooltip(tooltipContent, {
    className: "map-info-tooltip",
    direction: "top",
    offset: [0, -10],
    opacity: 1,
    sticky: true,
  });

  layer.on("mouseover", () => {
    if (canUseHoverTooltips()) {
      layer.openTooltip();
    }
  });
  layer.on("mouseout", () => {
    if (canUseHoverTooltips()) {
      layer.closeTooltip();
    }
  });
  layer.on("click", () => {
    layer.closeTooltip();
    layer.openPopup();
  });
}

function keepPopupInViewport(event) {
  const clampPopup = () => {
    const container = event.popup?._container;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const margin = 8;
    let shiftX = 0;
    if (rect.left < margin) {
      shiftX = margin - rect.left;
    } else if (rect.right > window.innerWidth - margin) {
      shiftX = window.innerWidth - margin - rect.right;
    }
    if (!shiftX) {
      return;
    }

    const match = container.style.transform.match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px,\s*0px\)/);
    if (!match) {
      return;
    }
    const nextX = Number(match[1]) + shiftX;
    container.style.transform = `translate3d(${nextX}px, ${match[2]}px, 0px)`;
  };

  requestAnimationFrame(() => {
    clampPopup();
    requestAnimationFrame(clampPopup);
  });
}

function canUseHoverTooltips() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

async function requireConfirmedAddress(type) {
  const input = els[type];
  const value = input.value.trim();
  const confirmed = state.address[type];
  if (confirmed && confirmed.inputValue === value) {
    return confirmed;
  }

  const coordinatePoint = parseCoordinateInput(value);
  if (coordinatePoint) {
    setConfirmedAddress(type, coordinatePoint, value);
    return state.address[type];
  }

  const suggestions = await fetchAddressSuggestions(value, 5);
  renderAddressSuggestions(type, suggestions);
  if (!suggestions.length) {
    throw new Error(`No Singapore address match found for "${value}".`);
  }
  throw new Error(
    `Confirm the ${type === "start" ? "start point" : "destination"} from the suggestions before estimating.`,
  );
}

async function fetchAddressSuggestions(query, limit = 5) {
  const coordinatePoint = parseCoordinateInput(query);
  if (coordinatePoint) {
    return [coordinatePoint];
  }
  const searchQuery = /singapore/i.test(query) ? query : `${query}, Singapore`;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    format: "jsonv2",
    q: searchQuery,
    limit: String(limit),
    countrycodes: "sg",
    addressdetails: "1",
    viewbox: "103.55,1.49,104.15,1.16",
    bounded: "1",
  }).toString();

  const results = await fetchJson(url.toString());
  if (!Array.isArray(results)) {
    return [];
  }
  return results.map((result) => ({
    lat: Number(result.lat),
    lng: Number(result.lon),
    label: result.display_name,
  }));
}

function parseCoordinateInput(value) {
  const coordinateMatch = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!coordinateMatch) {
    return null;
  }
  return {
    lat: Number(coordinateMatch[1]),
    lng: Number(coordinateMatch[2]),
    label: value.trim(),
  };
}

function renderAddressSuggestions(type, suggestions) {
  const container = type === "start" ? els.startSuggestions : els.destinationSuggestions;
  if (suggestions === null) {
    container.innerHTML = `<div class="suggestion-muted">Searching...</div>`;
    return;
  }
  if (!suggestions.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = suggestions
    .map(
      (suggestion, index) => `<button type="button" class="suggestion-option" data-index="${index}">
        <strong>${escapeHtml(shortAddress(suggestion.label))}</strong>
        <small>${escapeHtml(suggestion.label)}</small>
      </button>`,
    )
    .join("");
  container.querySelectorAll(".suggestion-option").forEach((button) => {
    button.addEventListener("click", () => {
      setConfirmedAddress(type, suggestions[Number(button.dataset.index)]);
      container.innerHTML = "";
    });
  });
}

function setConfirmedAddress(type, point, inputValue = null) {
  const input = els[type];
  if (inputValue !== null) {
    input.value = inputValue;
  }
  state.address[type] = {
    lat: point.lat,
    lng: point.lng,
    label: point.label,
    inputValue: input.value.trim(),
  };
  renderAddressConfirmation(type);
}

function renderAddressConfirmation(type) {
  const confirmation = type === "start" ? els.startConfirmation : els.destinationConfirmation;
  const point = state.address[type];
  confirmation.textContent = point ? `Using: ${shortAddress(point.label)}` : "";
}

function shortAddress(label) {
  return label.split(",").slice(0, 3).join(",").trim();
}

async function fetchDrivingRoutes(startPoint, endPoint) {
  const providerResults = await Promise.allSettled([
    fetchOneMapRoutes(startPoint, endPoint),
    fetchFossgisOsrmRoutes(startPoint, endPoint),
    fetchValhallaRoutes(startPoint, endPoint),
    fetchOsrmDemoRoutes(startPoint, endPoint),
  ]);
  const routes = providerResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  if (!routes.length) {
    throw new Error("No driving route found between those points.");
  }

  return rankRouteCandidates(routes, startPoint, endPoint)
    .slice(0, MAX_ROUTE_OPTIONS)
    .map((route, index) => ({
      ...route,
      index,
    }));
}

async function fetchOneMapRoutes(startPoint, endPoint) {
  const params = new URLSearchParams({
    start: `${startPoint.lat},${startPoint.lng}`,
    end: `${endPoint.lat},${endPoint.lng}`,
  });
  const payload = await fetchJson(`./api/routes/onemap?${params}`, { timeoutMs: ROUTING_TIMEOUTS.onemap });
  return parseOneMapRoutes(payload, {
    provider: "onemap",
    providerLabel: "OneMap routing",
    providerRank: -3,
  });
}

async function fetchFossgisOsrmRoutes(startPoint, endPoint) {
  const coordinates = `${startPoint.lng},${startPoint.lat};${endPoint.lng},${endPoint.lat}`;
  const url = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false&alternatives=true`;
  const payload = await fetchJson(url, { timeoutMs: ROUTING_TIMEOUTS.fossgisOsrm });
  return parseOsrmRoutes(payload, {
    provider: "fossgis-osrm",
    providerLabel: "OpenStreetMap routing",
    providerRank: 0,
  });
}

async function fetchOsrmDemoRoutes(startPoint, endPoint) {
  const coordinates = `${startPoint.lng},${startPoint.lat};${endPoint.lng},${endPoint.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false&alternatives=true`;
  const payload = await fetchJson(url, { timeoutMs: ROUTING_TIMEOUTS.osrmDemo });
  return parseOsrmRoutes(payload, {
    provider: "osrm-demo",
    providerLabel: "OSRM fallback",
    providerRank: 2,
  });
}

async function fetchValhallaRoutes(startPoint, endPoint) {
  const request = {
    locations: [
      { lat: startPoint.lat, lon: startPoint.lng, type: "break" },
      { lat: endPoint.lat, lon: endPoint.lng, type: "break" },
    ],
    costing: "auto",
    units: "kilometers",
    alternates: MAX_ROUTE_OPTIONS - 1,
    directions_options: {
      units: "kilometers",
    },
  };
  const payload = await fetchJson("https://valhalla1.openstreetmap.de/route", {
    method: "POST",
    timeoutMs: ROUTING_TIMEOUTS.valhalla,
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": "erp-commute-estimator.pages.dev",
    },
    body: JSON.stringify(request),
  });
  return parseValhallaRoutes(payload, {
    provider: "valhalla",
    providerLabel: "Valhalla enhanced routing",
    providerRank: -1,
  });
}

function parseOneMapRoutes(payload, providerMeta) {
  const routes = oneMapRoutePayloads(payload)
    .flatMap((routePayload, index) =>
      parseOneMapRouteCandidate(routePayload, {
        ...providerMeta,
        providerRank: providerMeta.providerRank + index * 0.05,
      }),
    );

  if (!routes.length) {
    throw new Error("No usable OneMap driving route found.");
  }

  return routes;
}

function oneMapRoutePayloads(payload) {
  const candidates = [
    payload,
    ...(Array.isArray(payload?.alternativeroute) ? payload.alternativeroute : []),
    payload?.phyroute,
  ].filter(Boolean);
  const seen = new Set();
  return candidates.filter((routePayload) => {
    const signature = [
      routePayload.route_geometry || routePayload.routeGeometry || routePayload.geometry || "",
      routePayload.route_summary?.total_distance || routePayload.routeSummary?.totalDistance || "",
      routePayload.route_summary?.total_time || routePayload.routeSummary?.totalTime || "",
    ].join("|");
    if (seen.has(signature)) {
      return false;
    }
    seen.add(signature);
    return true;
  });
}

function parseOneMapRouteCandidate(routePayload, providerMeta) {
  routePayload ||= {};
  const points = parseOneMapRouteGeometry(
    routePayload.route_geometry ||
      routePayload.routeGeometry ||
      routePayload.geometry ||
      routePayload.route?.route_geometry,
  );
  const summary =
    routePayload.route_summary || routePayload.routeSummary || routePayload.summary || routePayload.route?.route_summary || {};
  const totalMeters = Number(
    summary.total_distance ??
      summary.totalDistance ??
      routePayload.total_distance ??
      routePayload.totalDistance ??
      routePayload.distance,
  );
  const durationSeconds = Number(
    summary.total_time ??
      summary.totalTime ??
      routePayload.total_time ??
      routePayload.totalTime ??
      routePayload.duration ??
      routePayload.time,
  );

  if (points.length < 2 || !Number.isFinite(totalMeters) || !Number.isFinite(durationSeconds)) {
    return [];
  }

  return [
    buildRouteCandidate({
      points,
      totalMeters,
      durationSeconds,
      routeName: oneMapRouteName(routePayload),
      ...providerMeta,
    }),
  ];
}

function oneMapRouteName(routePayload) {
  if (Array.isArray(routePayload.route_name)) {
    return routePayload.route_name.filter(Boolean).join(" / ");
  }
  return routePayload.viaRoute || routePayload.subtitle || "";
}

function parseOsrmRoutes(payload, providerMeta) {
  if (payload.code !== "Ok" || !payload.routes?.length) {
    throw new Error("No driving route found between those points.");
  }

  return payload.routes.map((route) => {
    const points = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
    return buildRouteCandidate({
      points,
      totalMeters: route.distance,
      durationSeconds: route.duration,
      ...providerMeta,
    });
  });
}

function parseValhallaRoutes(payload, providerMeta) {
  const trips = [payload.trip, ...(payload.alternates || []).map((item) => item.trip || item)].filter(Boolean);
  if (!trips.length) {
    throw new Error("No Valhalla driving route found.");
  }

  return trips.flatMap((trip) => {
    const points = (trip.legs || []).flatMap((leg, legIndex) => {
      const decoded = decodeValhallaShape(leg.shape || "");
      return legIndex === 0 ? decoded : decoded.slice(1);
    });
    const totalMeters = Number(trip.summary?.length) * 1000;
    const durationSeconds = Number(trip.summary?.time);
    if (points.length < 2 || !Number.isFinite(totalMeters) || !Number.isFinite(durationSeconds)) {
      return [];
    }
    return [
      buildRouteCandidate({
        points,
        totalMeters,
        durationSeconds,
        ...providerMeta,
      }),
    ];
  });
}

function buildRouteCandidate(route) {
  const cumulativeMeters = buildCumulativeDistances(route.points);
  return {
    ...route,
    cumulativeMeters,
    shapeSignature: routeShapeSignature(route.points),
  };
}

function rankRouteCandidates(routes, startPoint, endPoint) {
  const uniqueRoutes = dedupeRoutes(routes).filter((route) => route.points.length > 1);
  const fastestSeconds = Math.min(...uniqueRoutes.map((route) => route.durationSeconds));
  const shortestMeters = Math.min(...uniqueRoutes.map((route) => route.totalMeters));
  const directMeters = Math.max(haversineMeters(startPoint, endPoint), 1);

  return uniqueRoutes
    .map((route) => ({
      ...route,
      efficiencyScore: routeEfficiencyScore(route, fastestSeconds, shortestMeters, directMeters),
    }))
    .sort((a, b) => {
      if (Math.abs(a.efficiencyScore - b.efficiencyScore) > 1) {
        return a.efficiencyScore - b.efficiencyScore;
      }
      return a.providerRank - b.providerRank || a.durationSeconds - b.durationSeconds || a.totalMeters - b.totalMeters;
    });
}

function routeEfficiencyScore(route, fastestSeconds, shortestMeters, directMeters) {
  const distancePenalty = Math.max(0, route.totalMeters - shortestMeters) * 0.012;
  const slowPenalty = Math.max(0, route.durationSeconds - fastestSeconds) * 0.35;
  const detourFactor = route.totalMeters / directMeters;
  const detourPenalty = Math.max(0, detourFactor - 1.65) * 260;
  const providerPenalty = route.providerRank * 18;
  return route.durationSeconds + distancePenalty + slowPenalty + detourPenalty + providerPenalty;
}

function dedupeRoutes(routes) {
  const uniqueRoutes = [];
  for (const route of routes) {
    const duplicate = uniqueRoutes.find((existing) => routesAreSimilar(existing, route));
    if (!duplicate) {
      uniqueRoutes.push(route);
      continue;
    }
    const duplicateScore =
      duplicate.durationSeconds + duplicate.totalMeters * 0.01 + duplicate.providerRank * 20;
    const routeScore = route.durationSeconds + route.totalMeters * 0.01 + route.providerRank * 20;
    if (routeScore < duplicateScore) {
      uniqueRoutes.splice(uniqueRoutes.indexOf(duplicate), 1, route);
    }
  }
  return uniqueRoutes;
}

function routesAreSimilar(a, b) {
  if (a.shapeSignature === b.shapeSignature) {
    return true;
  }
  const distanceClose = Math.abs(a.totalMeters - b.totalMeters) <= 220;
  const durationClose = Math.abs(a.durationSeconds - b.durationSeconds) <= 75;
  return distanceClose && durationClose && averageSampleDistance(a.points, b.points) <= 180;
}

function averageSampleDistance(aPoints, bPoints) {
  const samples = [0.2, 0.4, 0.6, 0.8];
  const total = samples.reduce((sum, ratio) => {
    const aPoint = aPoints[Math.min(aPoints.length - 1, Math.round((aPoints.length - 1) * ratio))];
    const bPoint = bPoints[Math.min(bPoints.length - 1, Math.round((bPoints.length - 1) * ratio))];
    return sum + haversineMeters(aPoint, bPoint);
  }, 0);
  return total / samples.length;
}

function routeShapeSignature(points) {
  const samples = [0, 0.25, 0.5, 0.75, 1];
  return samples
    .map((ratio) => {
      const point = points[Math.min(points.length - 1, Math.round((points.length - 1) * ratio))];
      return `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`;
    })
    .join("|");
}

function decodeValhallaShape(shape) {
  return decodeEncodedPolyline(shape, 1e6);
}

function parseOneMapRouteGeometry(geometry) {
  if (!geometry) {
    return [];
  }
  if (typeof geometry === "string") {
    const trimmed = geometry.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return parseOneMapRouteGeometry(JSON.parse(trimmed));
      } catch {
        return [];
      }
    }
    return decodeEncodedPolyline(trimmed, 1e5);
  }
  if (Array.isArray(geometry)) {
    return geometry.flatMap((point) => normalizeRouteCoordinate(point));
  }
  if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.flatMap((point) => normalizeRouteCoordinate(point));
  }
  if (Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.flatMap((point) => normalizeRouteCoordinate(point));
  }
  return [];
}

function normalizeRouteCoordinate(point) {
  if (Array.isArray(point) && Array.isArray(point[0])) {
    return point.flatMap((child) => normalizeRouteCoordinate(child));
  }
  if (Array.isArray(point) && point.length >= 2) {
    const first = Number(point[0]);
    const second = Number(point[1]);
    if (!Number.isFinite(first) || !Number.isFinite(second)) {
      return [];
    }
    if (isSingaporeLatLng(first, second)) {
      return [{ lat: first, lng: second }];
    }
    if (isSingaporeLatLng(second, first)) {
      return [{ lat: second, lng: first }];
    }
    return [{ lat: first, lng: second }];
  }
  if (point && typeof point === "object") {
    const lat = Number(point.lat ?? point.latitude);
    const lng = Number(point.lng ?? point.lon ?? point.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng }] : [];
  }
  return [];
}

function isSingaporeLatLng(lat, lng) {
  return lat >= 1.13 && lat <= 1.49 && lng >= 103.58 && lng <= 104.12;
}

function decodeEncodedPolyline(shape, precision) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < shape.length) {
    const latResult = decodePolylineValue(shape, index);
    index = latResult.index;
    const lngResult = decodePolylineValue(shape, index);
    index = lngResult.index;
    lat += latResult.value;
    lng += lngResult.value;
    points.push({ lat: lat / precision, lng: lng / precision });
  }

  return points;
}

function decodePolylineValue(value, startIndex) {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  let byte = null;

  do {
    byte = value.charCodeAt(index) - 63;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20 && index < value.length);

  return {
    value: result & 1 ? ~(result >> 1) : result >> 1,
    index,
  };
}

function matchGantriesToRoute(route) {
  const matches = [];
  for (const gantry of state.erpData.gantries) {
    const closest = closestProgressToGantry(gantry, route);
    const threshold =
      closest.matchType === "line" ? GANTRY_LINE_MATCH_THRESHOLD_METERS : GANTRY_POINT_MATCH_THRESHOLD_METERS;
    if (
      closest.distanceMeters <= threshold &&
      routeDirectionMatchesGantry(closest.routeBearingDegrees, gantry.directionDegrees)
    ) {
      matches.push({
        gantry,
        distanceMeters: closest.distanceMeters,
        directionDelta: directionDelta(closest.routeBearingDegrees, gantry.directionDegrees),
        progressMeters: closest.progressMeters,
        progressRatio: route.totalMeters > 0 ? closest.progressMeters / route.totalMeters : 0,
        matchType: closest.matchType,
      });
    }
  }

  return matches.sort((a, b) => a.progressMeters - b.progressMeters);
}

function closestProgressToGantry(gantry, route) {
  if (gantry.line?.length > 1) {
    return closestProgressToGantryLine(
      gantry.line.map(([lat, lng]) => ({ lat, lng })),
      route.points,
      route.cumulativeMeters,
    );
  }
  return {
    ...closestProgressOnRoute({ lat: gantry.center[0], lng: gantry.center[1] }, route.points, route.cumulativeMeters),
    matchType: "marker",
  };
}

function closestProgressToGantryLine(linePoints, routePoints, cumulativeMeters) {
  let best = {
    distanceMeters: Number.POSITIVE_INFINITY,
    progressMeters: 0,
    routeBearingDegrees: null,
    matchType: "line",
  };
  const originLat = linePoints[0].lat;

  for (let routeIndex = 0; routeIndex < routePoints.length - 1; routeIndex += 1) {
    const routeStart = routePoints[routeIndex];
    const routeEnd = routePoints[routeIndex + 1];
    const routeStartMeters = toMeters(routeStart, originLat);
    const routeEndMeters = toMeters(routeEnd, originLat);

    for (let lineIndex = 0; lineIndex < linePoints.length - 1; lineIndex += 1) {
      const gantryStartMeters = toMeters(linePoints[lineIndex], originLat);
      const gantryEndMeters = toMeters(linePoints[lineIndex + 1], originLat);
      const closest = closestSegmentDistance(routeStartMeters, routeEndMeters, gantryStartMeters, gantryEndMeters);
      if (closest.distanceMeters < best.distanceMeters) {
        const segmentMeters = haversineMeters(routeStart, routeEnd);
        best = {
          distanceMeters: closest.distanceMeters,
          progressMeters: cumulativeMeters[routeIndex] + segmentMeters * closest.routeT,
          routeBearingDegrees: bearingDegrees(routeStart, routeEnd),
          matchType: "line",
        };
      }
    }
  }

  return best;
}

function closestSegmentDistance(a, b, c, d) {
  const intersection = segmentIntersectionParameter(a, b, c, d);
  if (intersection !== null) {
    return {
      distanceMeters: 0,
      routeT: intersection,
    };
  }

  const candidates = [
    { distanceMeters: pointToSegmentDistance(a, c, d).distanceMeters, routeT: 0 },
    { distanceMeters: pointToSegmentDistance(b, c, d).distanceMeters, routeT: 1 },
  ];
  const cToRoute = pointToSegmentDistance(c, a, b);
  const dToRoute = pointToSegmentDistance(d, a, b);
  candidates.push({ distanceMeters: cToRoute.distanceMeters, routeT: cToRoute.t });
  candidates.push({ distanceMeters: dToRoute.distanceMeters, routeT: dToRoute.t });
  return candidates.reduce((best, item) => (item.distanceMeters < best.distanceMeters ? item : best));
}

function segmentIntersectionParameter(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-9) {
    return null;
  }
  const cMinusA = { x: c.x - a.x, y: c.y - a.y };
  const t = cross(cMinusA, s) / denominator;
  const u = cross(cMinusA, r) / denominator;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return t;
  }
  return null;
}

function pointToSegmentDistance(point, start, end) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) {
    return {
      distanceMeters: Math.hypot(point.x - start.x, point.y - start.y),
      t: 0,
    };
  }
  const t = clamp(((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared, 0, 1);
  const closest = {
    x: start.x + segmentX * t,
    y: start.y + segmentY * t,
  };
  return {
    distanceMeters: Math.hypot(point.x - closest.x, point.y - closest.y),
    t,
  };
}

function calculateTrip(route, matchedGantries, departureDate, vehicleType, legLabel) {
  const groupMatches = new Map();
  const unpricedEntries = [];

  matchedGantries.forEach((match) => {
    const offsetSeconds = route.durationSeconds * match.progressRatio;
    const crossingDate = addSeconds(departureDate, offsetSeconds);
    const base = {
      match,
      legLabel,
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
        baseAmount: 0,
        multiplier: VEHICLE_TYPES[vehicleType].multiplier,
        vehicleLabel: VEHICLE_TYPES[vehicleType].label,
        rateLabel: "No priced schedule",
      });
    }
  });

  const pricedEntries = [...groupMatches.entries()].map(([groupId, item]) => {
    const group = state.erpData.groups.find((candidate) => candidate.id === groupId);
    const rate = getRateForGroup(groupId, item.crossingDate, vehicleType);
    return {
      ...item,
      groupId,
      label: group?.label || item.match.gantry.label,
      gantryNos: group?.gantryNos || [item.match.gantry.gantryNo],
      amount: rate.amount,
      baseAmount: rate.baseAmount,
      multiplier: rate.multiplier,
      vehicleLabel: rate.vehicleLabel,
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
    total: roundMoney(entries.reduce((sum, entry) => sum + entry.amount, 0)),
    chargedCount: entries.filter((entry) => entry.amount > 0).length,
  };
}

function getRateForGroup(groupId, crossingDate, vehicleType) {
  const dateString = toDateInputValue(crossingDate);
  const minutes = crossingDate.getHours() * 60 + crossingDate.getMinutes();
  const vehicle = VEHICLE_TYPES[vehicleType] || VEHICLE_TYPES.car;
  const zero = (label) => ({
    amount: 0,
    baseAmount: 0,
    multiplier: vehicle.multiplier,
    vehicleLabel: vehicle.label,
    label,
  });

  if (isZeroErpDate(dateString)) {
    return zero("Sunday or Singapore public holiday");
  }
  if (isMajorHolidayEveCutoff(dateString, minutes)) {
    return zero("Eve of major public holiday after 13:00");
  }
  if (!isWeekday(dateString)) {
    return zero("No modelled Saturday ERP rate");
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
    return {
      amount: roundMoney(adjustment.amount * vehicle.multiplier),
      baseAmount: adjustment.amount,
      multiplier: vehicle.multiplier,
      vehicleLabel: vehicle.label,
      label: adjustment.reason,
    };
  }

  const baseRate = state.erpData.baseRates.find((item) => {
    return (
      item.groupId === groupId &&
      minutes >= minutesFromClock(item.start) &&
      minutes < minutesFromClock(item.end)
    );
  });

  if (baseRate) {
    return {
      amount: roundMoney(baseRate.amount * vehicle.multiplier),
      baseAmount: baseRate.amount,
      multiplier: vehicle.multiplier,
      vehicleLabel: vehicle.label,
      label: "Base weekday rate",
    };
  }

  return zero("No active ERP rate");
}

function getSelectedLegs() {
  if (!state.currentPlan) {
    return [];
  }
  return [
    state.currentPlan.outbound[state.selectedRoutes.outbound],
    state.currentPlan.tripMode === "return" ? state.currentPlan.return[state.selectedRoutes.return] : null,
  ].filter(Boolean);
}

function clearRouteLayers() {
  state.routeLayerGroup?.clearLayers();
  state.matchedGantriesLayer?.clearLayers();
  state.pointLayer?.clearLayers();
}

function resetEstimator() {
  state.routeRequestId += 1;
  state.address = {
    start: null,
    destination: null,
  };
  state.currentPlan = null;
  state.selectedRoutes = {
    outbound: 0,
    return: 0,
  };
  state.routeSelectionToRestore = null;
  state.autoEstimateOnReady = false;
  state.showAllGantries = true;

  for (const timer of Object.values(state.suggestionTimers)) {
    window.clearTimeout(timer);
  }
  state.suggestionTimers = {};

  els.start.value = "";
  els.destination.value = "";
  els.startSuggestions.innerHTML = "";
  els.destinationSuggestions.innerHTML = "";
  applyDefaultStartAddress();
  renderAddressConfirmation("start");
  renderAddressConfirmation("destination");

  setRadioValue("tripMode", "one-way");
  setRadioValue("timeMode", "depart");
  els.vehicleType.value = "car";
  setDefaultSingaporeDateTime();
  setReturnOffset(8);
  renderTripMode();

  els.showAllGantries.checked = true;
  setMapSource("osm");
  renderAllGantries();
  clearRouteLayers();
  fitCurrentRoute();
  renderInitialResults();
  setLoading(false);
  setStatus("Enter a start point, destination and timing.");

  window.history.replaceState(null, "", `${window.location.origin}${window.location.pathname}`);
  els.start.focus();
}

function fitCurrentRoute() {
  const selectedLegs = getSelectedLegs();
  if (!selectedLegs.length || !state.map) {
    state.map?.setView(SINGAPORE_CENTER, 12);
    return;
  }
  const bounds = selectedLegs.reduce((combined, option) => {
    const routeBounds = L.latLngBounds(option.route.points.map((point) => [point.lat, point.lng]));
    return combined ? combined.extend(routeBounds) : routeBounds;
  }, null);
  if (bounds?.isValid()) {
    state.map.fitBounds(bounds.pad(0.14));
  }
}

function handleSwap() {
  const oldStart = els.start.value;
  els.start.value = els.destination.value;
  els.destination.value = oldStart;
  const oldAddress = state.address.start;
  state.address.start = state.address.destination
    ? { ...state.address.destination, inputValue: els.start.value.trim() }
    : null;
  state.address.destination = oldAddress ? { ...oldAddress, inputValue: els.destination.value.trim() } : null;
  renderAddressConfirmation("start");
  renderAddressConfirmation("destination");
  els.start.focus();
}

function renderTripMode() {
  const isReturn = getTripMode() === "return";
  els.returnControls.hidden = !isReturn;
  if (isReturn) {
    syncReturnDateIfBeforeDeparture();
  }
}

function getTripMode() {
  return new FormData(els.form).get("tripMode") || "one-way";
}

function getVehicleType() {
  return els.vehicleType.value in VEHICLE_TYPES ? els.vehicleType.value : "car";
}

function getSelectedDateTime() {
  return new Date(`${els.date.value}T${els.time.value}:00`);
}

function getReturnDateTime() {
  return new Date(`${els.returnDate.value}T${els.returnTime.value}:00`);
}

function setReturnOffset(hours) {
  const departure = getSelectedDateTime();
  const returnDate = addHours(departure, hours);
  els.returnDate.value = toDateInputValue(returnDate);
  els.returnTime.value = formatClock(returnDate);
}

function syncReturnDateIfBeforeDeparture() {
  if (!els.returnDate.value || !els.returnTime.value) {
    setReturnOffset(8);
    return;
  }
  if (getReturnDateTime() <= getSelectedDateTime()) {
    setReturnOffset(8);
  }
}

function stepTimeInput(input, minutes) {
  if (!input?.value) {
    input.value = "08:00";
  }
  const [hours, currentMinutes] = input.value.split(":").map(Number);
  const date = new Date(2026, 0, 1, hours, currentMinutes);
  const next = addMinutes(date, minutes);
  input.value = formatClock(next);
}

function replaceUrlWithShareState() {
  window.history.replaceState(null, "", buildShareUrl());
}

async function copyShareUrl() {
  const url = buildShareUrl();
  window.history.replaceState(null, "", url);
  try {
    await navigator.clipboard.writeText(url);
    setStatus("Share URL copied to clipboard.");
  } catch {
    setStatus("Share URL is ready in the address bar.");
  }
}

function buildShareUrl() {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  params.set("s", els.start.value.trim());
  params.set("d", els.destination.value.trim());
  params.set("date", els.date.value);
  params.set("time", els.time.value);
  params.set("mode", new FormData(els.form).get("timeMode") || "depart");
  params.set("trip", getTripMode());
  params.set("vehicle", getVehicleType());
  params.set("layer", els.mapSource.value);
  params.set("allErp", els.showAllGantries.checked ? "1" : "0");
  if (getTripMode() === "return") {
    params.set("returnDate", els.returnDate.value);
    params.set("returnTime", els.returnTime.value);
  } else {
    params.delete("returnDate");
    params.delete("returnTime");
  }
  for (const type of ["start", "destination"]) {
    const prefix = type === "start" ? "s" : "d";
    const point = state.address[type];
    if (point) {
      params.set(`${prefix}lat`, String(point.lat));
      params.set(`${prefix}lng`, String(point.lng));
      params.set(`${prefix}label`, point.label);
    } else {
      params.delete(`${prefix}lat`);
      params.delete(`${prefix}lng`);
      params.delete(`${prefix}label`);
    }
  }
  if (state.currentPlan) {
    params.set("auto", "1");
    params.set("outRoute", String(state.selectedRoutes.outbound));
    params.set("retRoute", String(state.selectedRoutes.return));
  }
  return url.toString();
}

function hydrateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.size) {
    return;
  }
  if (params.get("s")) {
    els.start.value = params.get("s");
  }
  if (params.get("d")) {
    els.destination.value = params.get("d");
  }
  if (params.get("date")) {
    els.date.value = params.get("date");
  }
  if (params.get("time")) {
    els.time.value = params.get("time");
  }
  if (params.get("returnDate")) {
    els.returnDate.value = params.get("returnDate");
  }
  if (params.get("returnTime")) {
    els.returnTime.value = params.get("returnTime");
  }
  if (params.get("vehicle") in VEHICLE_TYPES) {
    els.vehicleType.value = params.get("vehicle");
  }
  if (params.get("layer") in MAP_SOURCES) {
    setMapSource(params.get("layer"));
  }
  els.showAllGantries.checked = params.get("allErp") !== "0";
  state.showAllGantries = els.showAllGantries.checked;
  setRadioValue("timeMode", params.get("mode"));
  setRadioValue("tripMode", params.get("trip"));

  hydratePointFromParams("start", params, "s");
  hydratePointFromParams("destination", params, "d");
  state.routeSelectionToRestore = {
    outbound: params.get("outRoute"),
    return: params.get("retRoute"),
  };
  state.autoEstimateOnReady = params.get("auto") === "1" && !!state.address.start && !!state.address.destination;
}

function routeIndexOrDefault(value, optionCount) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < optionCount ? index : 0;
}

function hydratePointFromParams(type, params, prefix) {
  const lat = Number(params.get(`${prefix}lat`));
  const lng = Number(params.get(`${prefix}lng`));
  const label = params.get(`${prefix}label`);
  if (Number.isFinite(lat) && Number.isFinite(lng) && label) {
    setConfirmedAddress(type, { lat, lng, label });
  }
}

function applyDefaultStartAddress() {
  if (state.address.start || els.start.value.trim()) {
    return;
  }
  setConfirmedAddress("start", DEFAULT_START_POINT, DEFAULT_START_POINT.inputValue);
}

function setRadioValue(name, value) {
  if (!value) {
    return;
  }
  const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio) {
    radio.checked = true;
  }
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
  els.sourceCopy.textContent = `${state.erpData.meta.notes.join(
    " ",
  )} Vehicle types use the official base-rate multipliers. Route geometry uses OneMap drive routing when configured, with OpenStreetMap-based fallback providers.`;
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
    const closest = pointToSegmentDistance(pointXY, start, end);
    if (closest.distanceMeters < best.distanceMeters) {
      const segmentMeters = haversineMeters(routePoints[index], routePoints[index + 1]);
      best = {
        distanceMeters: closest.distanceMeters,
        progressMeters: cumulativeMeters[index] + segmentMeters * closest.t,
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
  return Math.round(Math.abs((((a - b) % 360) + 540) % 360 - 180));
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

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
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

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3600000);
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
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

function formatPopupMoney(amount) {
  return `$${amount.toFixed(2)}`;
}

function formatMultiplier(multiplier) {
  return `${Number(multiplier).toFixed(1)}x`;
}

function roundMoney(amount) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = 12000, headers = {}, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: { Accept: "application/json", ...headers },
    });
  } finally {
    window.clearTimeout(timeout);
  }
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
