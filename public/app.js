import { defaultTripTiming, relativeSingaporeDate, singaporeDateValue, singaporeClock, singaporeDateTime, isSingaporePoint, displayTime } from "./planner-utils.js";
import { departureForMode, indexErpData, lookupErpRate } from "./lib/erp-engine.js";
import { createRouteService } from "./lib/route-service.js";

const SINGAPORE_CENTER = [1.3521, 103.8198];
const GANTRY_POINT_MATCH_THRESHOLD_METERS = 115;
const UNPRICED_MARKER_MATCH_THRESHOLD_METERS = 35;
const GANTRY_LINE_NEAR_MISS_THRESHOLD_METERS = 18;
const GANTRY_LINE_INTERIOR_BUFFER_T = 0.12;
const DIRECTION_TOLERANCE_DEGREES = 75;
const COMPETING_GANTRY_PROGRESS_WINDOW_METERS = 45;
const COMPETING_GANTRY_SPATIAL_WINDOW_METERS = 55;
const DATA_VERSION = "2026-10-29-v2";
const ADDRESS_STORAGE_KEY = "erpRecentPlaces";
const addressCache = new Map();
const SINGAPORE_MAP_BOUNDS = [
  [1.11, 103.55],
  [1.5, 104.15],
];
const ROUTE_SEARCH_START_MINUTES = 4 * 60 + 30;
const ROUTE_SEARCH_END_MINUTES = 22 * 60 + 30;
const TIMING_COMPARISON_START_OFFSET_MINUTES = -60;
const TIMING_COMPARISON_END_OFFSET_MINUTES = 180;
const TIMING_COMPARISON_STEP_MINUTES = 15;
const PANEL_WIDTH_STORAGE_KEY = "erpPlannerPanelWidth";
const PANEL_RESIZE_BREAKPOINT_PX = 980;
const PANEL_WIDTH_LIMITS = {
  min: 360,
  max: 640,
  minMap: 460,
  handle: 12,
};
const ROUTE_COLORS = {
  outbound: ["#1267d6", "#b26200", "#7a4fd3"],
  return: ["#0d835c", "#c44e52", "#26758f"],
};
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
  searchControllers: {},
  suggestions: { start: [], destination: [] },
  activeSuggestions: { start: -1, destination: -1 },
  routeController: null,
  timingTimer: null,
  autoEstimateOnReady: false,
  routeRequestId: 0,
  selectedErpDetail: null,
};

const els = {
  appShell: document.querySelector(".app-shell"),
  plannerPanel: document.querySelector(".planner-panel"),
  panelResizer: document.querySelector("#panel-resizer"),
  form: document.querySelector("#route-form"),
  start: document.querySelector("#start-input"),
  destination: document.querySelector("#destination-input"),
  startSuggestions: document.querySelector("#start-suggestions"),
  destinationSuggestions: document.querySelector("#destination-suggestions"),
  startConfirmation: document.querySelector("#start-confirmation"),
  destinationConfirmation: document.querySelector("#destination-confirmation"),
  swap: document.querySelector("#swap-button"),
  returnTrip: document.querySelector("#return-trip-checkbox"),
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
  gantryList: document.querySelector("#gantry-list"),
  status: document.querySelector("#status-bar"),
  recommendation: document.querySelector("#recommendation"),
  recommendationTitle: document.querySelector("#recommendation-title"),
  recommendationCopy: document.querySelector("#recommendation-copy"),
  recommendationOptions: document.querySelector("#recommendation-options"),
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
  erpDetailPanel: document.querySelector("#erp-detail-panel"),
  erpDetailContent: document.querySelector("#erp-detail-content"),
  erpDetailClose: document.querySelector("#erp-detail-close"),
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
  bindEvents();
  initPanelResizer();
  renderTripMode();
  syncTimingControls();
  renderRecentPlaces();
  if (els.returnTrip.checked || els.vehicleType.value !== "car") document.querySelector("#trip-options").open = true;
  window.lucide?.createIcons();
  // Address entry is interactive while the ERP table loads.
  state.erpData = await fetchJson(`./data/erp-data.json?v=${DATA_VERSION}`);
  renderSourceMetadata();
  renderAllGantries();

  if (state.autoEstimateOnReady) {
    window.setTimeout(() => els.form.requestSubmit(), 250);
  }
}

function bindEvents() {
  els.form.addEventListener("submit", handleRouteSubmit);
  els.swap.addEventListener("click", handleSwap);
  els.vehicleType.addEventListener("change", () => {
    closeErpDetail();
    renderAllGantries();
    if (state.currentPlan) recalculatePlanForVehicle();
  });
  els.mapSource.addEventListener("change", () => setMapSource(els.mapSource.value));
  els.showAllGantries.addEventListener("change", () => {
    state.showAllGantries = els.showAllGantries.checked;
    renderAllGantries();
  });
  els.fitRoute.addEventListener("click", fitCurrentRoute);
  els.share.addEventListener("click", copyShareUrl);
  els.reset.addEventListener("click", resetEstimator);
  els.erpDetailClose.addEventListener("click", closeErpDetail);
  els.returnTrip.addEventListener("change", () => {
    renderTripMode();
    handleTimingChange();
  });
  [els.date, els.time, els.returnDate, els.returnTime].forEach((input) => {
    input.addEventListener("change", handleTimingChange);
  });
  document.querySelectorAll("input[name='timeMode']").forEach((input) => {
    input.addEventListener("change", handleTimingChange);
  });
  document.querySelectorAll("[data-date-shortcut]").forEach((button) => {
    button.addEventListener("click", () => {
      els.date.value = relativeSingaporeDate(Number(button.dataset.dateShortcut));
      handleTimingChange();
    });
  });
  document.querySelectorAll("[data-time-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      els.time.value = button.dataset.timePreset;
      handleTimingChange();
    });
  });
  document.querySelector("#time-slider").addEventListener("input", (event) => {
    els.time.value = clockFromMinutes(Number(event.target.value));
    handleTimingChange();
  });
  document.querySelector("#use-location").addEventListener("click", useCurrentLocation);
  bindAddressField("start");
  bindAddressField("destination");
  document.addEventListener("click", (event) => {
    for (const type of ["start", "destination"]) {
      if (!event.target.closest(`.${type === "start" ? "start" : "destination"}-field`)) closeAddressSuggestions(type);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeErpDetail();
  });
}

function syncTimingControls() {
  if (!els.time.value) return;
  const minutes = minutesFromClock(els.time.value);
  const slider = document.querySelector("#time-slider");
  slider.value = minutes;
  slider.setAttribute("aria-valuetext", displayTime(els.time.value));
  document.querySelector("#time-display").textContent = displayTime(els.time.value);
  document.querySelectorAll("[data-time-preset]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.timePreset === els.time.value));
  });
  document.querySelectorAll("[data-date-shortcut]").forEach((button) => {
    button.setAttribute("aria-pressed", String(relativeSingaporeDate(Number(button.dataset.dateShortcut)) === els.date.value));
  });
}

function handleTimingChange() {
  const shouldRecalculate = !!state.currentPlan || !!state.timingTimer || els.primaryButton.disabled;
  window.clearTimeout(state.timingTimer);
  syncTimingControls();
  syncReturnDateIfBeforeDeparture();
  closeErpDetail();
  clearCurrentEstimate("Timing updated. Ready to estimate.");
  if (shouldRecalculate && state.address.start && state.address.destination) {
    state.timingTimer = window.setTimeout(() => {
      state.timingTimer = null;
      els.form.requestSubmit();
    }, 180);
  }
}

function initPanelResizer() {
  if (!els.appShell || !els.plannerPanel || !els.panelResizer) {
    return;
  }

  const storedWidth = readStoredPanelWidth();
  if (storedWidth) {
    setPanelWidth(storedWidth, { persist: false, refresh: false });
  }
  updatePanelResizerState();

  els.panelResizer.addEventListener("pointerdown", startPanelResize);
  els.panelResizer.addEventListener("keydown", handlePanelResizeKeydown);
  els.panelResizer.addEventListener("dblclick", resetPanelWidth);
  window.addEventListener("resize", () => {
    updatePanelResizerState();
    refreshMapLayout();
  });
}

function startPanelResize(event) {
  if (!isPanelResizeEnabled()) {
    return;
  }

  event.preventDefault();
  const shellLeft = els.appShell.getBoundingClientRect().left;
  let latestWidth = getCurrentPanelWidth();
  let pendingWidth = latestWidth;
  let frameId = 0;

  const commitWidth = () => {
    frameId = 0;
    latestWidth = setPanelWidth(pendingWidth, { persist: false });
  };

  const handlePointerMove = (moveEvent) => {
    pendingWidth = moveEvent.clientX - shellLeft;
    if (!frameId) {
      frameId = window.requestAnimationFrame(commitWidth);
    }
  };

  const stopResize = () => {
    if (frameId) {
      window.cancelAnimationFrame(frameId);
      commitWidth();
    }
    setPanelWidth(latestWidth);
    document.body.classList.remove("is-resizing-panel");
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
    try {
      els.panelResizer.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
  };

  document.body.classList.add("is-resizing-panel");
  try {
    els.panelResizer.setPointerCapture(event.pointerId);
  } catch {
    // Continue with window-level pointer listeners if capture is unavailable.
  }
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", stopResize);
  window.addEventListener("pointercancel", stopResize);
}

function handlePanelResizeKeydown(event) {
  if (!isPanelResizeEnabled()) {
    return;
  }

  const step = event.shiftKey ? 48 : 24;
  const currentWidth = getCurrentPanelWidth();
  let nextWidth = currentWidth;

  if (event.key === "ArrowLeft") {
    nextWidth = currentWidth - step;
  } else if (event.key === "ArrowRight") {
    nextWidth = currentWidth + step;
  } else if (event.key === "Home") {
    nextWidth = getPanelWidthBounds().min;
  } else if (event.key === "End") {
    nextWidth = getPanelWidthBounds().max;
  } else {
    return;
  }

  event.preventDefault();
  setPanelWidth(nextWidth);
}

function resetPanelWidth() {
  document.documentElement.style.removeProperty("--left-panel-width");
  try {
    window.localStorage.removeItem(PANEL_WIDTH_STORAGE_KEY);
  } catch {
    // localStorage may be unavailable in strict browser modes.
  }

  const syncDefaultWidth = () => {
    updatePanelResizerState();
    refreshMapLayout();
  };
  window.requestAnimationFrame(syncDefaultWidth);
  window.setTimeout(syncDefaultWidth, 240);
}

function isPanelResizeEnabled() {
  return window.matchMedia(`(min-width: ${PANEL_RESIZE_BREAKPOINT_PX}px)`).matches;
}

function getPanelWidthBounds() {
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const maxByViewport = Math.max(
    320,
    viewportWidth - PANEL_WIDTH_LIMITS.minMap - PANEL_WIDTH_LIMITS.handle,
  );
  const min = Math.min(PANEL_WIDTH_LIMITS.min, maxByViewport);
  const max = Math.max(min, Math.min(PANEL_WIDTH_LIMITS.max, maxByViewport));
  return { min, max };
}

function getCurrentPanelWidth() {
  return els.plannerPanel?.getBoundingClientRect().width || PANEL_WIDTH_LIMITS.min;
}

function setPanelWidth(width, options = {}) {
  const { persist = true, refresh = true } = options;
  if (!Number.isFinite(width)) {
    return getCurrentPanelWidth();
  }

  const { min, max } = getPanelWidthBounds();
  const nextWidth = Math.round(Math.min(Math.max(width, min), max));
  document.documentElement.style.setProperty("--left-panel-width", `${nextWidth}px`);
  els.panelResizer.setAttribute("aria-valuemin", String(Math.round(min)));
  els.panelResizer.setAttribute("aria-valuemax", String(Math.round(max)));
  els.panelResizer.setAttribute("aria-valuenow", String(nextWidth));
  els.panelResizer.setAttribute("aria-valuetext", `${nextWidth}px controls panel width`);

  if (persist) {
    try {
      window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(nextWidth));
    } catch {
      // localStorage may be unavailable in strict browser modes.
    }
  }

  if (refresh) {
    refreshMapLayout();
  }
  return nextWidth;
}

function updatePanelResizerState() {
  if (!els.panelResizer) {
    return;
  }

  const enabled = isPanelResizeEnabled();
  const { min, max } = getPanelWidthBounds();
  els.panelResizer.setAttribute("aria-disabled", enabled ? "false" : "true");
  els.panelResizer.setAttribute("aria-valuemin", String(Math.round(min)));
  els.panelResizer.setAttribute("aria-valuemax", String(Math.round(max)));

  if (!enabled) {
    return;
  }

  const currentWidth = getCurrentPanelWidth();
  if (currentWidth > max || currentWidth < min) {
    setPanelWidth(currentWidth, { persist: false });
    return;
  }
  els.panelResizer.setAttribute("aria-valuenow", String(Math.round(currentWidth)));
  els.panelResizer.setAttribute(
    "aria-valuetext",
    `${Math.round(currentWidth)}px controls panel width`,
  );
}

function readStoredPanelWidth() {
  try {
    const storedWidth = Number(window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
    return Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : null;
  } catch {
    return null;
  }
}

function bindAddressField(type) {
  const input = els[type];
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", `${type}-suggestions`);
  input.setAttribute("aria-expanded", "false");
  input.addEventListener("input", () => {
    if (type === "start") cancelLocationRequest();
    state.address[type] = null;
    renderAddressConfirmation(type);
    clearCurrentEstimate("Choose a matching address to continue.");
    cancelAddressSearch(type);
    closeAddressSuggestions(type);
    const query = input.value.trim();
    if (query.length < 3) return;
    state.suggestionTimers[type] = window.setTimeout(() => searchAddress(type, query), 240);
  });
  input.addEventListener("focus", () => {
    if (!state.address[type] && input.value.trim().length >= 3) searchAddress(type, input.value.trim());
  });
  input.addEventListener("blur", (event) => {
    if (els[`${type}Suggestions`].contains(event.relatedTarget)) return;
    cancelAddressSearch(type);
    closeAddressSuggestions(type);
  });
  input.addEventListener("keydown", (event) => {
    const suggestions = state.suggestions[type];
    if (event.key === "Escape") {
      cancelAddressSearch(type);
      closeAddressSuggestions(type);
      return;
    }
    if (["ArrowDown", "ArrowUp"].includes(event.key) && suggestions.length) {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      state.activeSuggestions[type] = (state.activeSuggestions[type] + delta + suggestions.length) % suggestions.length;
      updateActiveSuggestion(type);
    }
    if (event.key === "Enter" && suggestions.length && input.getAttribute("aria-expanded") === "true") {
      event.preventDefault();
      selectAddress(type, suggestions[Math.max(0, state.activeSuggestions[type])]);
    }
  });
  if (!state.address[type] && input.value.trim().length >= 3) {
    searchAddress(type, input.value.trim());
  }
}

function cancelAddressSearch(type) {
  window.clearTimeout(state.suggestionTimers[type]);
  state.searchControllers[type]?.abort();
  state.searchControllers[type] = null;
}

async function searchAddress(type, query) {
  cancelAddressSearch(type);
  const controller = new AbortController();
  state.searchControllers[type] = controller;
  renderAddressSuggestions(type, null);
  try {
    const suggestions = await fetchAddressSuggestions(query, 5, controller.signal);
    if (controller.signal.aborted || els[type].value.trim() !== query) return;
    renderAddressSuggestions(type, suggestions);
  } catch (error) {
    if (controller.signal.aborted) return;
    const container = els[`${type}Suggestions`];
    container.innerHTML = '<div class="suggestion-muted" role="status">Address search is unavailable. Try again shortly.</div>';
    els[type].setAttribute("aria-expanded", "true");
  }
}

function closeAddressSuggestions(type) {
  els[`${type}Suggestions`].innerHTML = "";
  els[type].setAttribute("aria-expanded", "false");
  els[type].removeAttribute("aria-activedescendant");
  state.suggestions[type] = [];
  state.activeSuggestions[type] = -1;
}

function updateActiveSuggestion(type) {
  els[`${type}Suggestions`].querySelectorAll(".suggestion-option").forEach((option, index) => {
    const selected = index === state.activeSuggestions[type];
    option.setAttribute("aria-selected", String(selected));
    if (selected) {
      els[type].setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    }
  });
}

function selectAddress(type, point) {
  if (type === "start") cancelLocationRequest();
  clearCurrentEstimate("Route updated. Ready to estimate.");
  setConfirmedAddress(type, point);
  rememberPlace(point);
  closeAddressSuggestions(type);
  if (type === "start" && !state.address.destination) els.destination.focus();
  else els.primaryButton.focus();
}

function readRecentPlaces() {
  try {
    const places = JSON.parse(localStorage.getItem(ADDRESS_STORAGE_KEY) || "[]");
    return Array.isArray(places) ? places.filter((place) => isSingaporePoint(place) && typeof place.label === "string").slice(0, 5) : [];
  } catch { return []; }
}

function rememberPlace(point) {
  if (point.isCurrentLocation) return;
  const places = [point, ...readRecentPlaces().filter((place) => place.lat !== point.lat || place.lng !== point.lng)].slice(0, 5);
  try { localStorage.setItem(ADDRESS_STORAGE_KEY, JSON.stringify(places)); } catch { /* Storage is optional. */ }
  renderRecentPlaces();
}

function renderRecentPlaces() {
  const places = readRecentPlaces();
  for (const type of ["start", "destination"]) {
    const container = document.querySelector(`#${type}-recent`);
    container.replaceChildren();
    for (const place of places.slice(0, 3)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "recent-place";
      button.textContent = place.label.split(",")[0];
      button.title = place.label;
      button.addEventListener("click", () => selectAddress(type, place));
      container.append(button);
    }
  }
}

function cancelLocationRequest() {
  state.locationRequestId = (state.locationRequestId || 0) + 1;
  document.querySelector("#use-location").disabled = false;
}

function useCurrentLocation() {
  if (!navigator.geolocation) { setStatus("Location is unavailable. Enter an address instead."); return; }
  cancelLocationRequest();
  const requestId = state.locationRequestId;
  const button = document.querySelector("#use-location");
  button.disabled = true;
  setStatus("Finding your location…");
  navigator.geolocation.getCurrentPosition((position) => {
    if (requestId !== state.locationRequestId) return;
    button.disabled = false;
    const point = { lat: position.coords.latitude, lng: position.coords.longitude, label: "Current location", isCurrentLocation: true };
    if (!isSingaporePoint(point)) { setStatus("Please choose a location in Singapore."); return; }
    selectAddress("start", point);
    setStatus("Current location selected. Choose your destination.");
  }, () => {
    if (requestId !== state.locationRequestId) return;
    button.disabled = false;
    setStatus("Location access is unavailable. Enter your starting address instead.");
  }, { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false });
}

async function handleRouteSubmit(event) {
  event.preventDefault();
  if (!state.erpData) {
    setStatus("ERP rates are loading. Please estimate again in a moment.");
    return;
  }
  cancelLocationRequest();
  state.routeController?.abort();
  state.routeController = new AbortController();
  const signal = state.routeController.signal;
  const requestId = ++state.routeRequestId;
  window.clearTimeout(state.timingTimer);
  state.timingTimer = null;
  setLoading(true);
  closeErpDetail();
  clearRouteLayers();
  setStatus("Confirming addresses and finding route options...");

  try {
    const startPoint = await requireConfirmedAddress("start", signal);
    const endPoint = await requireConfirmedAddress("destination", signal);
    if (signal.aborted || requestId !== state.routeRequestId) return;
    const timeMode = new FormData(els.form).get("timeMode") || "arrive";
    const vehicleType = getVehicleType();
    const tripMode = getTripMode();
    const outboundDeparture = getSelectedDateTime();
    const returnDeparture = tripMode === "return" ? getReturnDateTime() : null;

    if (tripMode === "return" && returnDeparture <= outboundDeparture) {
      throw new Error("Choose a return time after the outbound departure.");
    }

    const [outboundRoutes, returnRoutes] = await Promise.all([
      fetchDrivingRoutes(startPoint, endPoint, { signal }),
      tripMode === "return" ? fetchDrivingRoutes(endPoint, startPoint, { signal }) : Promise.resolve([]),
    ]);

    const outbound = buildLegOptions({
      legKey: "outbound",
      legLabel: "Outbound",
      routes: outboundRoutes,
      departureDate: outboundDeparture,
      timeMode,
      vehicleType,
    });
    if (tripMode === "return" && outbound.some((option) => returnDeparture <= option.trip.arrivalDate)) {
      throw new Error("Choose a return time after the outbound journey finishes.");
    }
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

    if (signal.aborted || requestId !== state.routeRequestId) {
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
      timeMode,
      requestedDate: outboundDeparture,
      vehicleType,
      outbound,
      return: returnLeg,
    };

    renderPlan();
    if (event.submitter) focusMapAfterEstimate();
    replaceUrlWithShareState();
  } catch (error) {
    if (signal.aborted || requestId !== state.routeRequestId) {
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

function buildLegOptions({ legKey, legLabel, routes, departureDate, vehicleType, timeMode = "depart" }) {
  const options = routes.slice(0, MAX_ROUTE_OPTIONS).map((route) => {
    const matchedGantries = matchGantriesToRoute(route);
    const actualDeparture = departureForMode(departureDate, route.durationSeconds, timeMode);
    return {
      legKey, legLabel, route, matchedGantries, timeMode,
      selectedDateTime: departureDate,
      trip: calculateTrip(route, matchedGantries, actualDeparture, vehicleType, legLabel),
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
  const plan = state.currentPlan;
  const vehicleType = getVehicleType();
  plan.vehicleType = vehicleType;
  for (const leg of ["outbound", "return"]) {
    const selectedRoute = plan[leg][state.selectedRoutes[leg]]?.route;
    plan[leg] = rankLegOptions(leg, plan[leg].map((option) => ({
      ...option,
      trip: calculateTrip(option.route, option.matchedGantries,
        option.selectedDateTime ? departureForMode(option.selectedDateTime, option.route.durationSeconds, option.timeMode) : option.trip.departureDate,
        vehicleType, option.legLabel),
    })));
    state.selectedRoutes[leg] = Math.max(0, plan[leg].findIndex((option) => option.route === selectedRoute));
  }
  renderPlan();
  replaceUrlWithShareState();
}

function renderPlan() {
  const selectedLegs = getSelectedLegs();
  const total = selectedLegs.reduce((sum, option) => sum + option.trip.total, 0);
  const gantryCount = selectedLegs.reduce((sum, option) => sum + option.trip.entries.length, 0);

  renderRouteOptions();
  renderRouteProvider(selectedLegs);
  renderEstimateCoverage(selectedLegs);
  renderMapResultDock(selectedLegs, total, gantryCount);
  renderRouteMap(selectedLegs);
  renderTripBreakdown(selectedLegs);
  renderTimingComparison(buildTimingComparison(selectedLegs), selectedLegs[0].trip.departureDate);
  renderGantryList(selectedLegs.flatMap((option) => option.trip.entries));
  renderRecommendation(selectedLegs);
  window.lucide?.createIcons();

  setStatus(
    `${state.currentPlan.tripMode === "return" ? "Return" : "One-way"} route: ${gantryCount} ERP matched.`,
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

  const legLabel = legKey === "outbound" ? "Outbound" : "Return";
  const selectedOption =
    options.find((option) => state.selectedRoutes[legKey] === option.index) || options[0];
  const buttons = options
    .map((option) => {
      const isSelected = state.selectedRoutes[legKey] === option.index;
      const tooltip = routeOptionTooltip(option);
      const routeColor = routeColorForOption(option);
      return `<button class="route-option route-option-tab tooltip-card ${
        isSelected ? "selected" : ""
      }" style="--route-color: ${routeColor}" data-leg="${legKey}" data-index="${option.index}" data-tooltip="${escapeHtml(
        tooltip,
      )}" type="button" aria-pressed="${isSelected}">
          <span class="route-option-name"><i class="route-color-dot" aria-hidden="true"></i>${routeOptionName(option)}</span>
          <strong>${formatMoney(option.trip.total)}</strong>
          <small>${formatDuration(option.route.durationSeconds)} · ${formatDistance(option.route.totalMeters)} · ${
            option.trip.entries.length
          } ERP</small>
        </button>`;
    })
    .join("");
  return `<section class="route-option-leg" aria-label="${legLabel} route choices">
    <div class="route-option-group-title">${legLabel}</div>
    <div class="route-option-tabs" aria-label="${legLabel} route options">${buttons}</div>
    ${selectedRouteCardTemplate(selectedOption, legKey)}
  </section>`;
}

function selectedRouteCardTemplate(option, legKey) {
  const routeColor = routeColorForOption(option);
  return `<article class="selected-route-card" style="--route-color: ${routeColor}">
    <div class="selected-route-summary">
      <div>
        <span class="route-option-topline">
          <span class="route-option-name"><i class="route-color-dot" aria-hidden="true"></i>${routeOptionName(option)}</span>
          <span class="route-provider-chip">${escapeHtml(routingProviderLabel(option.route))}</span>
        </span>
        <strong>${formatMoney(option.trip.total)}</strong>
        <small>${formatDuration(option.route.durationSeconds)} · ${formatDistance(option.route.totalMeters)} · ${
          option.trip.entries.length
        } ERP</small>
      </div>
    </div>
    <p class="selected-route-times">Leave <strong>${formatClock(option.trip.departureDate)}</strong> · Arrive <strong>${formatClock(option.trip.arrivalDate)}</strong>${toDateInputValue(option.trip.departureDate) !== toDateInputValue(option.trip.arrivalDate) ? " (next day)" : ""}</p>
    ${legKey === "outbound" ? selectedRouteTimingTemplate() : ""}
  </article>`;
}

function selectedRouteTimingTemplate() {
  return `<section class="route-option-timing" aria-label="Selected route timing comparison">
    <div class="route-timing-heading">
      <strong>Timing comparison</strong>
      <small id="comparison-note">All route options.</small>
    </div>
    <div class="timing-chart-card" id="timing-chart" aria-label="ERP cost by departure time for selected route">
      <div class="empty-state">No route calculated yet.</div>
    </div>
    <details class="timing-table-details">
      <summary>
        <span>Exact timings</span>
        <i data-lucide="chevron-down"></i>
      </summary>
      <div class="table-shell">
        <table>
          <thead>
            <tr>
              <th>Leave</th>
              <th>Arrive</th>
              <th>ERP</th>
              <th>Route ERP</th>
            </tr>
          </thead>
          <tbody id="timing-body">
            <tr>
              <td colspan="4" class="empty-row">No route calculated yet.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </section>`;
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

function routeColorForOption(option) {
  const palette = ROUTE_COLORS[option.legKey] || ROUTE_COLORS.outbound;
  return palette[option.index % palette.length];
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

function renderMapResultDock(selectedLegs, total, gantryCount) {
  if (!selectedLegs.length) {
    els.mapResultDock.hidden = true;
    els.mapPanel.classList.remove("has-route-result");
    return;
  }

  const durationSeconds = selectedLegs.reduce((sum, option) => sum + option.route.durationSeconds, 0);
  const distanceMeters = selectedLegs.reduce((sum, option) => sum + option.route.totalMeters, 0);
  const providers = [...new Set(selectedLegs.map((option) => routingProviderLabel(option.route)))];
  els.mapResultDock.hidden = false;
  els.mapPanel.classList.add("has-route-result");
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

  state.currentPlan.outbound.forEach((option) => {
    drawRouteOption(option, routeColorForOption(option), state.selectedRoutes.outbound === option.index);
  });
  state.currentPlan.return.forEach((option) => {
    drawRouteOption(option, routeColorForOption(option), state.selectedRoutes.return === option.index);
  });

  L.circleMarker([state.currentPlan.startPoint.lat, state.currentPlan.startPoint.lng], {
    radius: 7,
    color: "#0d835c",
    fillColor: "#0d835c",
    fillOpacity: 1,
    weight: 2,
  })
    .bindPopup(pointPopupTemplate("Start", state.currentPlan.startPoint.label), pointPopupOptions())
    .addTo(state.pointLayer);

  L.circleMarker([state.currentPlan.endPoint.lat, state.currentPlan.endPoint.lng], {
    radius: 7,
    color: "#d94b3d",
    fillColor: "#d94b3d",
    fillOpacity: 1,
    weight: 2,
  })
    .bindPopup(pointPopupTemplate("Destination", state.currentPlan.endPoint.label), pointPopupOptions())
    .addTo(state.pointLayer);

  selectedLegs.forEach((option) => {
    option.trip.entries.forEach((entry) => drawMatchedGantry(entry));
  });

  fitCurrentRoute();
  refreshMapLayout();
}

function pointPopupOptions() {
  return {
    autoPan: true,
    autoPanPadding: [18, 18],
    className: "endpoint-popup-shell",
    maxWidth: 240,
    minWidth: 180,
  };
}

function pointPopupTemplate(label, address) {
  const { title, detail } = splitPointAddress(address);
  return `<div class="endpoint-popup">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(title)}</strong>
    ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
  </div>`;
}

function splitPointAddress(address) {
  const fullAddress = String(address || "");
  const parts = fullAddress
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) {
    return { title: "Selected point", detail: "" };
  }
  const titlePartCount = parts[0] && /^\d+[A-Za-z]?$/.test(parts[0]) && parts[1] ? 2 : 1;
  return {
    title: parts.slice(0, titlePartCount).join(", "),
    detail: parts.slice(titlePartCount).join(", "),
  };
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
  layer.bindPopup(popup, { autoPan: false });
  bindHoverPopup(layer);
}

function drawMatchedGantry(entry) {
  const color = entry.amount > 0 ? "#d94b3d" : "#465159";
  const detail = infoForTripEntry(entry);

  if (entry.match.gantry.line?.length > 1) {
    const line = L.polyline(entry.match.gantry.line, {
      color,
      weight: entry.amount > 0 ? 6 : 4,
      opacity: 0.95,
      className: "erp-map-target",
    }).addTo(state.matchedGantriesLayer);
    bindGantryInfo(line, detail);
  }

  const marker = L.circleMarker(entry.match.gantry.center, {
    radius: entry.amount > 0 ? 8 : 6,
    color: "#ffffff",
    fillColor: color,
    fillOpacity: 1,
    weight: 2,
    className: "erp-map-target",
  }).addTo(state.matchedGantriesLayer);
  bindGantryInfo(marker, detail);
}

function infoForTripEntry(entry) {
  return infoForErpRates({
    groupId: entry.groupId,
    title: erpRateTitle(entry.label, entry.gantryNos),
    vehicleType: state.currentPlan?.vehicleType || getVehicleType(),
    dateString: entry.crossingDateString || selectedRateDateString(),
    highlightMinutes: minutesFromClock(formatClock(entry.crossingDate)),
    note: `${entry.legLabel} crosses around ${entry.crossingTime}. Estimated charge: ${formatMoney(entry.amount)}.`,
  });
}

function renderTimingComparison(comparison, baseDeparture) {
  const timingEls = getTimingElements();
  if (!timingEls.chart || !timingEls.body || !timingEls.note) {
    return;
  }
  const selectedRows = comparison.selectedRows || [];
  const routeSeries = comparison.routeSeries || [];
  timingEls.note.textContent =
    state.currentPlan?.tripMode === "return"
      ? "All outbound routes; return stays fixed."
      : "All route options.";
  renderTimingChart(routeSeries, baseDeparture, timingEls.chart);
  renderTimingRows(selectedRows, baseDeparture, timingEls.body);
}

function getTimingElements() {
  return {
    chart: document.querySelector("#timing-chart"),
    body: document.querySelector("#timing-body"),
    note: document.querySelector("#comparison-note"),
  };
}

function renderTimingRows(rows, baseDeparture, bodyElement = document.querySelector("#timing-body")) {
  if (!bodyElement) {
    return;
  }
  if (!rows.length) {
    bodyElement.innerHTML = `<tr><td colspan="4" class="empty-row">No timing comparison available.</td></tr>`;
    return;
  }

  const minCost = Math.min(...rows.map((row) => row.total));
  const maxCost = Math.max(...rows.map((row) => row.total));
  bodyElement.innerHTML = rows
    .map((row) => {
      const isCurrent = isSameDeparture(row.departureDate, baseDeparture);
      const rowClasses = [
        row.total === minCost ? "best-row" : "",
        row.total === maxCost && maxCost > minCost ? "highest-row" : "",
        isCurrent ? "current-row" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<tr class="${rowClasses}" style="${timingHeatStyle(row.total, minCost, maxCost)}">
        <td data-label="Leave">${formatClock(row.departureDate)}${isCurrent ? '<span class="selected-time-badge">Selected</span>' : ""}</td>
        <td data-label="Arrive">${formatClock(row.arrivalDate)}</td>
        <td data-label="ERP" class="money">${formatMoney(row.total)}</td>
        <td data-label="Route ERP">${row.routeErp}</td>
      </tr>`;
    })
    .join("");
}

function timingHeatStyle(total, minCost, maxCost) {
  if (maxCost <= minCost) {
    return "--heat-bg: #ddf7eb; --heat-border: rgba(13, 131, 92, 0.34);";
  }
  const level = clamp((total - minCost) / (maxCost - minCost), 0, 1);
  const start = [221, 247, 235];
  const end = [255, 224, 216];
  const borderStart = [13, 131, 92];
  const borderEnd = [217, 75, 61];
  const bg = start.map((value, index) => Math.round(value + (end[index] - value) * level));
  const border = borderStart.map((value, index) => Math.round(value + (borderEnd[index] - value) * level));
  return `--heat-bg: rgb(${bg.join(", ")}); --heat-border: rgba(${border.join(", ")}, 0.42);`;
}

function buildTimingComparison(selectedLegs) {
  const outbound = selectedLegs[0];
  const returnLeg = selectedLegs[1];
  const baseDeparture = outbound.trip.departureDate;
  const outboundOptions = state.currentPlan?.outbound?.length ? state.currentPlan.outbound : [outbound];
  const routeSeries = outboundOptions.map((option) => {
    const rows = buildTimingRowsForOption(option, baseDeparture, returnLeg);
    const minRow = findBestTimingRow(rows, baseDeparture);
    return {
      id: option.id || `outbound-${option.index}`,
      name: routeOptionName(option),
      provider: routingProviderLabel(option.route),
      selected: option.index === state.selectedRoutes.outbound,
      color: routeColorForOption(option),
      rows,
      minRow,
      currentRow: rows.find((row) => isSameDeparture(row.departureDate, baseDeparture)) || null,
    };
  });
  const selectedSeries = routeSeries.find((series) => series.selected) || routeSeries[0];
  return {
    selectedRows: selectedSeries?.rows || [],
    routeSeries,
  };
}

function buildTimingRowsForOption(option, baseDeparture, returnLeg) {
  const rows = [];
  const fixedReturnTotal = returnLeg?.trip.total || 0;
  const fixedReturnErp = returnLeg?.trip.entries.length || 0;

  for (
    let offset = TIMING_COMPARISON_START_OFFSET_MINUTES;
    offset <= TIMING_COMPARISON_END_OFFSET_MINUTES;
    offset += TIMING_COMPARISON_STEP_MINUTES
  ) {
    const departure = addMinutes(baseDeparture, offset);
    const outboundTrip = calculateTrip(
      option.route,
      option.matchedGantries,
      departure,
      state.currentPlan.vehicleType,
      option.legLabel,
    );
    rows.push({
      departureDate: departure,
      arrivalDate: outboundTrip.arrivalDate,
      total: roundMoney(outboundTrip.total + fixedReturnTotal),
      routeErp: outboundTrip.entries.length + fixedReturnErp,
      outboundTotal: outboundTrip.total,
    });
  }
  return rows;
}

function renderTimingChart(routeSeries, baseDeparture, chartElement = document.querySelector("#timing-chart")) {
  if (!chartElement) {
    return;
  }
  const series = routeSeries.filter((item) => item.rows.length);
  if (!series.length) {
    chartElement.innerHTML = `<div class="empty-state">No route calculated yet.</div>`;
    return;
  }

  const allRows = series.flatMap((item) => item.rows);
  const maxCost = Math.max(...allRows.map((row) => row.total), 0);
  const yMax = Math.max(1, Math.ceil(maxCost / 2) * 2);
  const width = 380;
  const height = 238;
  const padding = { top: 22, right: 16, bottom: 52, left: 60 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const rowCount = series[0].rows.length;
  const currentIndex = Math.max(
    0,
    series[0].rows.findIndex((row) => isSameDeparture(row.departureDate, baseDeparture)),
  );
  const xForIndex = (index) =>
    padding.left + (rowCount <= 1 ? plotWidth / 2 : (plotWidth * index) / (rowCount - 1));
  const yForValue = (value) => padding.top + plotHeight - (value / yMax) * plotHeight;
  const yTicks = [...new Set([0, yMax / 2, yMax])];
  const xTickIndexes = [...new Set([0, currentIndex, rowCount - 1])];

  const grid = yTicks
    .map((tick) => {
      const y = formatSvgNumber(yForValue(tick));
      return `<g class="timing-chart-grid">
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"></line>
        <text x="${padding.left - 8}" y="${y}" text-anchor="end">${formatCompactMoney(tick)}</text>
      </g>`;
    })
    .join("");

  const xLabels = xTickIndexes
    .map((index) => {
      const x = formatSvgNumber(xForIndex(index));
      const anchor = index === 0 ? "start" : index === rowCount - 1 ? "end" : "middle";
      return `<text class="timing-chart-x-label" x="${x}" y="${height - 24}" text-anchor="${anchor}">${formatClock(
        series[0].rows[index].departureDate,
      )}</text>`;
    })
    .join("");

  const lines = series
    .map((item) => {
      const path = stepPathForSeries(item.rows, xForIndex, yForValue);
      const strokeWidth = item.selected ? 4 : 2.75;
      const points = item.rows
        .map((row, index) => {
          const isCurrent = isSameDeparture(row.departureDate, baseDeparture);
          const isLowest = item.minRow && isSameDeparture(row.departureDate, item.minRow.departureDate);
          const radius = isCurrent || isLowest ? 3.7 : 2.3;
          const classes = ["timing-route-point", item.selected ? "selected" : "", isCurrent ? "current" : ""]
            .filter(Boolean)
            .join(" ");
          const title = `${item.name}, leave ${formatClock(row.departureDate)}, ${formatMoney(row.total)}`;
          return `<circle class="${classes}" cx="${formatSvgNumber(xForIndex(index))}" cy="${formatSvgNumber(
            yForValue(row.total),
          )}" r="${radius}" fill="${item.color}" stroke="${item.color}">
            <title>${escapeHtml(title)}</title>
          </circle>`;
        })
        .join("");
      return `<g class="timing-route-series">
        <path class="timing-route-line ${item.selected ? "selected" : ""}" d="${path}" stroke="${
          item.color
        }" stroke-width="${strokeWidth}"></path>
        ${points}
      </g>`;
    })
    .join("");

  const currentX = formatSvgNumber(xForIndex(currentIndex));

  chartElement.innerHTML = `
    <div class="timing-chart-shell">
      <svg class="timing-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="timing-chart-title">
        <title id="timing-chart-title">ERP cost by route and departure time</title>
        ${grid}
        <line class="timing-chart-axis" x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${
    width - padding.right
  }" y2="${padding.top + plotHeight}"></line>
        <line class="timing-current-line" x1="${currentX}" y1="${padding.top}" x2="${currentX}" y2="${
    padding.top + plotHeight
  }"></line>
        ${lines}
        ${xLabels}
        <text class="timing-chart-axis-label timing-chart-y-axis-label" x="16" y="${
          padding.top + plotHeight / 2
        }" text-anchor="middle" transform="rotate(-90 16 ${padding.top + plotHeight / 2})">ERP cost</text>
        <text class="timing-chart-axis-label timing-chart-x-axis-label" x="${
          padding.left + plotWidth / 2
        }" y="${height - 7}" text-anchor="middle">Departure time</text>
      </svg>
    </div>
    <p class="sr-only">${escapeHtml(accessibleTimingSummary(series))}</p>
  `;
}

function findBestTimingRow(rows, baseDeparture) {
  return rows.reduce((best, row) => {
    if (!best) {
      return row;
    }
    const rowDistance = Math.abs(row.departureDate - baseDeparture);
    const bestDistance = Math.abs(best.departureDate - baseDeparture);
    if (row.total < best.total || (row.total === best.total && rowDistance < bestDistance)) {
      return row;
    }
    return best;
  }, null);
}

function stepPathForSeries(rows, xForIndex, yForValue) {
  return rows
    .map((row, index) => {
      const x = formatSvgNumber(xForIndex(index));
      const y = formatSvgNumber(yForValue(row.total));
      return index === 0 ? `M ${x} ${y}` : `H ${x} V ${y}`;
    })
    .join(" ");
}

function isSameDeparture(dateA, dateB) {
  return Math.abs(dateA - dateB) < 1000;
}

function formatSvgNumber(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, "");
}

function formatCompactMoney(amount) {
  return Number.isInteger(amount) ? `S$${amount}` : `S$${amount.toFixed(1)}`;
}

function accessibleTimingSummary(series) {
  return series
    .map((item) => {
      const minRow = item.minRow || item.rows[0];
      return `${item.name} reaches a low of ${formatMoney(minRow.total)} at ${formatClock(minRow.departureDate)}.`;
    })
    .join(" ");
}

function renderGantryList(entries) {
  if (!entries.length) {
    els.gantryList.innerHTML = `<div class="empty-state">No ERP gantries detected along this route.</div>`;
    return;
  }

  els.gantryList.innerHTML = entries
    .map((entry, index) => {
      const priceClass = entry.amount > 0 ? "gantry-price charge" : "gantry-price";
      const numbers = entry.gantryNos.filter(Boolean).join(", ") || "Unnumbered";
      return `<button class="gantry-item" type="button" data-gantry-index="${index}">
        <div>
          <strong>${escapeHtml(entry.label)}</strong>
          <small>${escapeHtml(entry.legLabel)} · Gantry ${escapeHtml(numbers)} at about ${
            entry.crossingTime
          }. ${escapeHtml(entry.rateLabel)}. Matched ${Math.round(entry.match.distanceMeters)} m by ${
            entry.match.matchType === "line" ? "gantry line" : "marker"
          }.</small>
        </div>
        <span class="${priceClass}">${formatMoney(entry.amount)}</span>
      </button>`;
    })
    .join("");
  els.gantryList.querySelectorAll(".gantry-item").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = entries[Number(button.dataset.gantryIndex)];
      if (entry) {
        openErpDetail(infoForTripEntry(entry));
      }
    });
  });
}

function renderRecommendation(selectedLegs) {
  clearRecommendationOptions();
  if (!selectedLegs.length) {
    els.recommendation.hidden = true;
    return;
  }
  const currentTotal = selectedLegs.reduce((sum, option) => sum + option.trip.total, 0);
  const arriveBy = state.currentPlan?.timeMode === "arrive";
  const deadline = state.currentPlan?.requestedDate || selectedLegs[0].trip.arrivalDate;
  els.recommendation.hidden = false;

  if (currentTotal === 0) {
    els.recommendationTitle.textContent = "No ERP charge estimated";
    els.recommendationCopy.textContent = "No ERP charge was found for the selected route and timing. Actual charges may differ.";
    return;
  }

  const suggestions = findTimingSuggestions(selectedLegs);
  if (!suggestions.before && !suggestions.after) {
    els.recommendationTitle.textContent = arriveBy
      ? "No cheaper timing before your arrival deadline"
      : "No lower-cost timing found";
    els.recommendationCopy.textContent = arriveBy
      ? `No lower ERP estimate was found for this route while arriving by ${formatClock(deadline)}.`
      : "No lower ERP estimate was found for this route within the search window and your trip times.";
    return;
  }

  els.recommendationTitle.textContent = arriveBy ? "Leave earlier to spend less on ERP" : "Try these lower-cost timings";
  els.recommendationCopy.textContent = arriveBy
    ? `This earlier departure keeps you within your ${formatClock(deadline)} arrival deadline.`
    : `Compared with your selected leave time of ${formatClock(selectedLegs[0].trip.departureDate)}.`;
  els.recommendationOptions.hidden = false;
  els.recommendationOptions.innerHTML = [
    suggestions.before ? renderRecommendationOption("Earlier", suggestions.before) : "",
    !arriveBy && suggestions.after ? renderRecommendationOption("Later", suggestions.after) : "",
  ].join("");
}

function renderRecommendationOption(label, suggestion, emptyMessage) {
  if (!suggestion) {
    return `
      <article class="recommendation-option empty">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(emptyMessage)}</strong>
      </article>
    `;
  }

  const title =
    suggestion.total === 0
      ? `Leave ${formatClock(suggestion.departureDate)} · no ERP charge estimated`
      : `Leave ${formatClock(suggestion.departureDate)} for ${formatMoney(suggestion.total)}`;

  return `
    <article class="recommendation-option">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(title)}</strong>
      <small>Arrive ${escapeHtml(formatClock(suggestion.arrivalDate))} · Save ${escapeHtml(
        formatMoney(suggestion.saving),
      )}</small>
    </article>
  `;
}

function findTimingSuggestions(selectedLegs) {
  const outbound = selectedLegs[0];
  const returnLeg = selectedLegs[1];
  const baseDeparture = outbound.trip.departureDate;
  const arrivalDeadline = state.currentPlan.timeMode === "arrive"
    ? state.currentPlan.requestedDate || outbound.selectedDateTime || outbound.trip.arrivalDate
    : null;
  const dateString = toDateInputValue(baseDeparture);
  const startOfDay = singaporeDateTime(dateString);
  const currentTotal = selectedLegs.reduce((sum, option) => sum + option.trip.total, 0);
  const suggestions = {
    before: null,
    after: null,
  };

  for (let minute = ROUTE_SEARCH_START_MINUTES; minute <= ROUTE_SEARCH_END_MINUTES; minute += 5) {
    const departure = addMinutes(startOfDay, minute);
    const arrival = addSeconds(departure, outbound.route.durationSeconds);
    if ((arrivalDeadline && arrival > arrivalDeadline) ||
        (returnLeg && arrival >= returnLeg.trip.departureDate) ||
        departure.getTime() === baseDeparture.getTime()) {
      continue;
    }

    const outboundTrip = calculateTrip(
      outbound.route,
      outbound.matchedGantries,
      departure,
      state.currentPlan.vehicleType,
      outbound.legLabel,
    );
    const total = outboundTrip.total + (returnLeg?.trip.total || 0);
    if (total >= currentTotal) {
      continue;
    }

    const candidate = {
      departureDate: departure,
      arrivalDate: arrival,
      total,
      saving: roundMoney(currentTotal - total),
    };

    const bucket = departure < baseDeparture ? "before" : "after";
    if (isBetterTimingSuggestion(candidate, suggestions[bucket], baseDeparture)) {
      suggestions[bucket] = candidate;
    }
  }

  return suggestions;
}

function isBetterTimingSuggestion(candidate, currentBest, baseDeparture) {
  if (!currentBest) {
    return true;
  }
  const candidateDistance = Math.abs(candidate.departureDate - baseDeparture);
  const bestDistance = Math.abs(currentBest.departureDate - baseDeparture);
  return (
    candidate.total < currentBest.total ||
    (candidate.total === currentBest.total && candidateDistance < bestDistance)
  );
}

function clearRecommendationOptions() {
  els.recommendationOptions.hidden = true;
  els.recommendationOptions.innerHTML = "";
}

function renderErrorState(message) {
  closeErpDetail();
  const timingEls = getTimingElements();
  if (timingEls.chart) {
    timingEls.chart.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  }
  if (timingEls.body) {
    timingEls.body.innerHTML = `<tr><td colspan="4" class="empty-row">${escapeHtml(message)}</td></tr>`;
  }
  els.gantryList.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  els.routeOptionsSection.hidden = true;
  els.routeOptions.innerHTML = "";
  els.routeProvider.textContent = "";
  els.mapResultDock.hidden = true;
  els.mapPanel.classList.remove("has-route-result");
  els.tripBreakdown.hidden = true;
  els.tripBreakdown.innerHTML = "";
  els.recommendation.hidden = true;
  els.recommendationTitle.textContent = "";
  els.recommendationCopy.textContent = "";
  clearRecommendationOptions();
}

function renderInitialResults() {
  const timingEls = getTimingElements();
  if (timingEls.note) {
    timingEls.note.textContent = "Run an estimate to compare costs.";
  }
  if (timingEls.chart) {
    timingEls.chart.innerHTML = `<div class="empty-state">No route calculated yet.</div>`;
  }
  if (timingEls.body) {
    timingEls.body.innerHTML = `<tr><td colspan="4" class="empty-row">No route calculated yet.</td></tr>`;
  }
  els.gantryList.innerHTML = `<div class="empty-state">No route calculated yet.</div>`;
  els.routeOptionsSection.hidden = true;
  els.routeOptions.innerHTML = "";
  els.routeProvider.textContent = "";
  els.mapResultDock.hidden = true;
  els.mapPanel.classList.remove("has-route-result");
  els.tripBreakdown.hidden = true;
  els.tripBreakdown.innerHTML = "";
  els.recommendation.hidden = true;
  els.recommendationTitle.textContent = "";
  els.recommendationCopy.textContent = "";
  clearRecommendationOptions();
}

function clearCurrentEstimate(message) {
  state.routeController?.abort();
  state.routeController = null;
  window.clearTimeout(state.timingTimer);
  state.timingTimer = null;
  state.routeRequestId += 1;
  closeErpDetail();
  state.currentPlan = null;
  state.selectedRoutes = {
    outbound: 0,
    return: 0,
  };
  state.routeSelectionToRestore = null;
  clearRouteLayers();
  renderInitialResults();
  setLoading(false);
  setStatus(message);
  window.history.replaceState(null, "", `${window.location.origin}${window.location.pathname}`);
}

function initMap() {
  state.map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: "center",
    wheelDebounceTime: 80,
    wheelPxPerZoomLevel: 120,
    maxBounds: SINGAPORE_MAP_BOUNDS,
    maxBoundsViscosity: 0.85,
    worldCopyJump: false,
  }).setView(SINGAPORE_CENTER, 12);

  setMapSource(els.mapSource.value || "osm");
  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(state.map);

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
    bindGantryInfo(marker, () => infoForGantry(gantry));
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
  return erpDetailModel(options);
}

function erpDetailModel({ groupId, title, vehicleType, dateString, highlightMinutes, note = "" }) {
  const rows = buildErpRateRows(groupId, dateString, vehicleType);
  const activeMinutes = Number.isFinite(highlightMinutes) ? highlightMinutes : selectedRateMinutes();
  const activeRow = rowForMinutes(rows, activeMinutes);
  const maxAmount = Math.max(...rows.map((row) => row.amount));
  return {
    groupId,
    title,
    vehicleType,
    vehicleLabel: vehiclePopupLabel(vehicleType),
    dateString,
    dayLabel: rateDayLabel(dateString),
    activeMinutes,
    activeRow,
    maxAmount,
    chargedWindow: chargedWindowSummary(rows),
    rows,
    note,
  };
}

function erpDetailTemplate(detail) {
  const rows = detail.rows
    .map((row) => {
      const isActive = Number.isFinite(row.start) && detail.activeMinutes >= row.start && detail.activeMinutes < row.end;
      return `<tr class="${isActive ? "active-rate-row" : ""}">
        <td>${escapeHtml(row.range)}</td>
        <td>${formatPopupMoney(row.amount)}</td>
      </tr>`;
    })
    .join("");

  return `<section class="erp-detail-card">
    <div class="erp-detail-title">
      <span>ERP rates</span>
      <h3>${escapeHtml(detail.title)}</h3>
    </div>
    <div class="erp-detail-meta">
      <span>${escapeHtml(detail.vehicleLabel)}</span>
      <span>${escapeHtml(detail.dayLabel)}</span>
    </div>
    <div class="erp-detail-stats">
      <article>
        <span>${escapeHtml(clockFromMinutes(detail.activeMinutes))}</span>
        <strong>${formatPopupMoney(detail.activeRow.amount)}</strong>
      </article>
      <article>
        <span>Peak</span>
        <strong>${formatPopupMoney(detail.maxAmount)}</strong>
      </article>
      <article>
        <span>Charged window</span>
        <strong>${escapeHtml(detail.chargedWindow)}</strong>
      </article>
    </div>
    <div class="erp-rate-table-wrap">
      <table class="erp-rate-table">
        <colgroup>
          <col />
          <col class="erp-rate-amount-col" />
        </colgroup>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${detail.note ? `<p class="erp-rate-note">${escapeHtml(detail.note)}</p>` : ""}
  </section>`;
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

function dateWithMinutes(dateString, minutes) { return singaporeDateTime(dateString, clockFromMinutes(minutes)); }

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

function bindGantryInfo(layer, detail) {
  layer.on("click", () => {
    openErpDetail(typeof detail === "function" ? detail() : detail);
  });
}

function openErpDetail(detail) {
  state.selectedErpDetail = detail;
  els.erpDetailContent.innerHTML = erpDetailTemplate(detail);
  els.erpDetailPanel.hidden = false;
  els.erpDetailPanel.classList.add("open");
  window.lucide?.createIcons();
}

function closeErpDetail() {
  state.selectedErpDetail = null;
  els.erpDetailPanel.hidden = true;
  els.erpDetailPanel.classList.remove("open");
  els.erpDetailContent.innerHTML = "";
}

async function requireConfirmedAddress(type, signal = state.routeController?.signal) {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const value = els[type].value.trim();
  const confirmed = state.address[type];
  if (confirmed && confirmed.inputValue === value) return confirmed;
  const coordinatePoint = parseCoordinateInput(value);
  if (coordinatePoint) {
    setConfirmedAddress(type, coordinatePoint);
    return state.address[type];
  }
  const suggestions = await fetchAddressSuggestions(value, 5, signal);
  if (signal?.aborted || els[type].value.trim() !== value) throw new DOMException("Cancelled", "AbortError");
  // A single unambiguous match can be used directly; ambiguous addresses stay explicit.
  if (suggestions.length === 1) {
    setConfirmedAddress(type, suggestions[0]);
    rememberPlace(suggestions[0]);
    return state.address[type];
  }
  renderAddressSuggestions(type, suggestions);
  els[type].focus();
  throw new Error(suggestions.length
    ? `Choose the ${type === "start" ? "start point" : "destination"} from the matching addresses.`
    : `No Singapore address found for “${value}”. Try a postal code or building name.`);
}

async function fetchAddressSuggestions(query, limit = 5, signal) {
  const coordinatePoint = parseCoordinateInput(query);
  if (coordinatePoint) return [coordinatePoint];
  const key = query.trim().toLowerCase();
  if (addressCache.has(key)) return addressCache.get(key).slice(0, limit);
  const payload = await fetchJson(`/api/search?q=${encodeURIComponent(query.trim())}`, { timeoutMs: 6500, signal });
  const results = (payload.results || []).filter(isSingaporePoint);
  if (addressCache.size >= 60) addressCache.delete(addressCache.keys().next().value);
  addressCache.set(key, results);
  return results.slice(0, limit);
}

function parseCoordinateInput(value) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const point = { lat: Number(match[1]), lng: Number(match[2]), label: value.trim() };
  return isSingaporePoint(point) ? point : null;
}

function renderAddressSuggestions(type, suggestions) {
  const container = els[`${type}Suggestions`];
  state.suggestions[type] = suggestions || [];
  state.activeSuggestions[type] = -1;
  els[type].removeAttribute("aria-activedescendant");
  els[type].setAttribute("aria-expanded", "true");
  if (suggestions === null) {
    container.innerHTML = '<div class="suggestion-muted" role="status">Searching Singapore addresses…</div>';
    return;
  }
  if (!suggestions.length) {
    container.innerHTML = '<div class="suggestion-muted" role="status">No match. Try a postal code or building name.</div>';
    return;
  }
  container.innerHTML = suggestions.map((suggestion, index) => {
    const address = addressSuggestionParts(suggestion.label);
    return `<button type="button" role="option" tabindex="-1" aria-selected="false" id="${type}-option-${index}" class="suggestion-option" data-index="${index}">
      <strong>${escapeHtml(address.title)}</strong>${address.detail ? `<small>${escapeHtml(address.detail)}</small>` : ""}
    </button>`;
  }).join("");
  container.querySelectorAll(".suggestion-option").forEach((button) => {
    button.addEventListener("click", () => selectAddress(type, suggestions[Number(button.dataset.index)]));
  });
}

function setConfirmedAddress(type, point, inputValue = null) {
  cancelAddressSearch(type);
  const input = els[type];
  input.value = inputValue ?? shortAddress(point.label);
  state.address[type] = { ...point, inputValue: input.value.trim() };
  closeAddressSuggestions(type);
  renderAddressConfirmation(type);
}

function renderAddressConfirmation(type) {
  const confirmation = els[`${type}Confirmation`];
  const point = state.address[type];
  confirmation.textContent = point ? "Location selected" : "";
}

function shortAddress(label) {
  return label.split(",").slice(0, 3).join(",").trim();
}

function addressSuggestionParts(label) {
  const parts = label
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const titleParts = parts.slice(0, 1);
  return {
    title: titleParts.join(", ") || label,
    detail: parts.slice(titleParts.length).join(", "),
  };
}

const cachedDrivingRoutes = createRouteService({
  providers: [fetchOneMapRoutes, fetchFossgisOsrmRoutes, fetchValhallaRoutes, fetchOsrmDemoRoutes],
  rank: rankRouteCandidates,
  limit: MAX_ROUTE_OPTIONS,
});

async function fetchDrivingRoutes(startPoint, endPoint, options = {}) {
  return cachedDrivingRoutes(startPoint, endPoint, options);
}

async function fetchOneMapRoutes(startPoint, endPoint, { signal } = {}) {
  const params = new URLSearchParams({
    start: `${startPoint.lat},${startPoint.lng}`,
    end: `${endPoint.lat},${endPoint.lng}`,
  });
  const payload = await fetchJson(`./api/routes/onemap?${params}`, { signal, timeoutMs: ROUTING_TIMEOUTS.onemap });
  return parseOneMapRoutes(payload, {
    provider: "onemap",
    providerLabel: "OneMap routing",
    providerRank: -3,
  });
}

async function fetchFossgisOsrmRoutes(startPoint, endPoint, { signal } = {}) {
  const coordinates = `${startPoint.lng},${startPoint.lat};${endPoint.lng},${endPoint.lat}`;
  const url = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false&alternatives=true`;
  const payload = await fetchJson(url, { signal, timeoutMs: ROUTING_TIMEOUTS.fossgisOsrm });
  return parseOsrmRoutes(payload, {
    provider: "fossgis-osrm",
    providerLabel: "OpenStreetMap routing",
    providerRank: 0,
  });
}

async function fetchOsrmDemoRoutes(startPoint, endPoint, { signal } = {}) {
  const coordinates = `${startPoint.lng},${startPoint.lat};${endPoint.lng},${endPoint.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false&alternatives=true`;
  const payload = await fetchJson(url, { signal, timeoutMs: ROUTING_TIMEOUTS.osrmDemo });
  return parseOsrmRoutes(payload, {
    provider: "osrm-demo",
    providerLabel: "OSRM fallback",
    providerRank: 2,
  });
}

async function fetchValhallaRoutes(startPoint, endPoint, { signal } = {}) {
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
    signal,
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

const gantryMatchesCache = new WeakMap();

function matchGantriesToRoute(route) {
  const cached = gantryMatchesCache.get(route);
  if (cached?.data === state.erpData) return cached.matches;
  const bounds = route.points.reduce((b, p) => ({
    minLat: Math.min(b.minLat, p.lat), maxLat: Math.max(b.maxLat, p.lat),
    minLng: Math.min(b.minLng, p.lng), maxLng: Math.max(b.maxLng, p.lng),
  }), { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity });
  const geometryLength = route.cumulativeMeters.at(-1) || route.totalMeters;
  const matches = [];
  for (const gantry of state.erpData.gantries) {
    const points = gantry.line?.length > 1 ? gantry.line : [gantry.center];
    // 0.0012 degrees exceeds the 115 m match radius throughout Singapore.
    if (points.every(([lat]) => lat < bounds.minLat - 0.0012) ||
        points.every(([lat]) => lat > bounds.maxLat + 0.0012) ||
        points.every(([, lng]) => lng < bounds.minLng - 0.0012) ||
        points.every(([, lng]) => lng > bounds.maxLng + 0.0012)) continue;
    const closest = closestProgressToGantry(gantry, route);
    if (gantryMatchIsCloseEnough(closest, gantry) &&
        routeDirectionMatchesGantry(closest.routeBearingDegrees, gantry.directionDegrees)) {
      matches.push({
        gantry,
        distanceMeters: closest.distanceMeters,
        directionDelta: directionDelta(closest.routeBearingDegrees, gantry.directionDegrees),
        progressMeters: closest.progressMeters,
        progressRatio: geometryLength > 0 ? clamp(closest.progressMeters / geometryLength, 0, 1) : 0,
        matchType: closest.matchType,
      });
    }
  }
  const result = dedupeCompetingGantryMatches(matches).sort((a, b) => a.progressMeters - b.progressMeters);
  gantryMatchesCache.set(route, { data: state.erpData, matches: result });
  return result;
}

function gantryMatchIsCloseEnough(closest, gantry) {
  if (closest.matchType === "line") {
    return gantryLineMatchIsUsable(closest);
  }
  const markerThreshold = gantry.isPriced && Number.isFinite(gantry.directionDegrees)
    ? GANTRY_POINT_MATCH_THRESHOLD_METERS
    : UNPRICED_MARKER_MATCH_THRESHOLD_METERS;
  return closest.distanceMeters <= markerThreshold;
}

function gantryLineMatchIsUsable(closest) {
  if (closest.intersects) {
    return true;
  }
  return (
    closest.distanceMeters <= GANTRY_LINE_NEAR_MISS_THRESHOLD_METERS &&
    closest.lineT >= GANTRY_LINE_INTERIOR_BUFFER_T &&
    closest.lineT <= 1 - GANTRY_LINE_INTERIOR_BUFFER_T
  );
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

function dedupeCompetingGantryMatches(matches) {
  const kept = [];
  for (const match of matches.sort((a, b) => a.progressMeters - b.progressMeters)) {
    const competingIndex = kept.findIndex((existing) => gantryMatchesCompete(existing, match));
    if (competingIndex === -1) {
      kept.push(match);
      continue;
    }
    if (gantryMatchQualityScore(match) < gantryMatchQualityScore(kept[competingIndex])) {
      kept[competingIndex] = match;
    }
  }
  return kept;
}

function gantryMatchesCompete(a, b) {
  if (a.gantry.groupId && b.gantry.groupId && a.gantry.groupId === b.gantry.groupId) {
    return false;
  }
  return (
    Math.abs(a.progressMeters - b.progressMeters) <= COMPETING_GANTRY_PROGRESS_WINDOW_METERS &&
    haversineMeters(gantryCenterPoint(a.gantry), gantryCenterPoint(b.gantry)) <=
      COMPETING_GANTRY_SPATIAL_WINDOW_METERS
  );
}

function gantryMatchQualityScore(match) {
  const directionPenalty = Number.isFinite(match.directionDelta) ? match.directionDelta * 0.2 : 8;
  const markerPenalty = match.matchType === "line" ? 0 : 3;
  return match.distanceMeters + directionPenalty + markerPenalty;
}

function gantryCenterPoint(gantry) {
  if (gantry.line?.length > 1) {
    const midpoint = lineMidpoint(gantry.line);
    return { lat: midpoint[0], lng: midpoint[1] };
  }
  return { lat: gantry.center[0], lng: gantry.center[1] };
}

function lineMidpoint(line) {
  const middleIndex = Math.floor((line.length - 1) / 2);
  if (line.length === 2) {
    return [(line[0][0] + line[1][0]) / 2, (line[0][1] + line[1][1]) / 2];
  }
  return line[middleIndex];
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
          lineT: closest.lineT,
          intersects: closest.intersects,
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
      routeT: intersection.routeT,
      lineT: intersection.lineT,
      intersects: true,
    };
  }

  const aToLine = pointToSegmentDistance(a, c, d);
  const bToLine = pointToSegmentDistance(b, c, d);
  const candidates = [
    { distanceMeters: aToLine.distanceMeters, routeT: 0, lineT: aToLine.t, intersects: false },
    { distanceMeters: bToLine.distanceMeters, routeT: 1, lineT: bToLine.t, intersects: false },
  ];
  const cToRoute = pointToSegmentDistance(c, a, b);
  const dToRoute = pointToSegmentDistance(d, a, b);
  candidates.push({ distanceMeters: cToRoute.distanceMeters, routeT: cToRoute.t, lineT: 0, intersects: false });
  candidates.push({ distanceMeters: dToRoute.distanceMeters, routeT: dToRoute.t, lineT: 1, intersects: false });
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
    return {
      routeT: t,
      lineT: u,
    };
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
    const group = indexErpData(state.erpData).groups.get(groupId);
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
      estimated: rate.estimated,
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
  return lookupErpRate(state.erpData, groupId, toDateInputValue(crossingDate),
    minutesFromClock(formatClock(crossingDate)), VEHICLE_TYPES[vehicleType] || VEHICLE_TYPES.car);
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
  cancelLocationRequest();
  state.routeController?.abort();
  window.clearTimeout(state.timingTimer);
  state.timingTimer = null;
  cancelAddressSearch("start");
  cancelAddressSearch("destination");
  closeErpDetail();
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
  closeAddressSuggestions("start");
  closeAddressSuggestions("destination");
  renderAddressConfirmation("start");
  renderAddressConfirmation("destination");

  els.returnTrip.checked = false;
  setRadioValue("timeMode", "arrive");
  els.vehicleType.value = "car";
  setDefaultSingaporeDateTime();
  setReturnOffset(8);
  renderTripMode();
  syncTimingControls();
  document.querySelector("#trip-options").open = false;

  els.showAllGantries.checked = true;
  setMapSource("osm");
  renderAllGantries();
  clearRouteLayers();
  fitCurrentRoute();
  renderInitialResults();
  setLoading(false);
  setStatus("Arrive by 9:00 am tomorrow. Choose your start and destination.");

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
  }, L.latLngBounds([
    [state.currentPlan.startPoint.lat, state.currentPlan.startPoint.lng],
    [state.currentPlan.endPoint.lat, state.currentPlan.endPoint.lng],
  ]));
  if (bounds?.isValid()) {
    state.map.fitBounds(bounds.pad(0.08), routeFitOptions());
  }
}

function routeFitOptions() {
  const isCompact = window.matchMedia("(max-width: 760px)").matches;
  const dockHeight = els.mapResultDock.hidden ? 0 : els.mapResultDock.getBoundingClientRect().height;
  return {
    paddingTopLeft: [isCompact ? 48 : 72, isCompact ? 112 : 90],
    paddingBottomRight: [isCompact ? 28 : 72, Math.ceil(dockHeight) + (isCompact ? 34 : 42)],
  };
}

function handleSwap() {
  cancelLocationRequest();
  for (const type of ["start", "destination"]) {
    cancelAddressSearch(type);
    closeAddressSuggestions(type);
  }
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
  clearCurrentEstimate("Route swapped. Estimate again.");
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
  return els.returnTrip.checked ? "return" : "one-way";
}

function getVehicleType() {
  return els.vehicleType.value in VEHICLE_TYPES ? els.vehicleType.value : "car";
}

function getSelectedDateTime() { return singaporeDateTime(els.date.value, els.time.value); }

function getReturnDateTime() { return singaporeDateTime(els.returnDate.value, els.returnTime.value); }

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
  input.value = clockFromMinutes((minutesFromClock(input.value || "09:00") + minutes + 1440) % 1440);
}

function stepDateInput(input, days) {
  if (!input) {
    return;
  }
  const current = input.value ? singaporeDateTime(input.value) : new Date();
  input.value = toDateInputValue(addDays(current, days));
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
  els.returnTrip.checked = params.get("trip") === "return" || params.has("returnDate") || params.has("returnTime");

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
  if (params.has(`${prefix}lat`) && params.has(`${prefix}lng`) && isSingaporePoint({ lat, lng }) && label) {
    setConfirmedAddress(type, { lat, lng, label });
  }
}

function setRadioValue(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((radio) => {
    if (radio.value === value) radio.checked = true;
  });
}

function renderSourceMetadata() {
  const meta = state.erpData.meta;
  const activeCount = state.erpData.gantries.filter((gantry) => gantry.isPriced).length;
  const verified = new Date(`${meta.verifiedOn}T00:00:00+08:00`).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" });
  els.sourceGenerated.textContent = `Checked ${verified} · ${state.erpData.gantries.length} locations · ${activeCount} active`;
  els.sourceCopy.textContent = `${meta.notes.join(" ")} Address search: OneMap, Singapore Land Authority. Routing uses OneMap and OpenStreetMap-based providers; no live traffic.`;
  const sourceList = document.querySelector(".source-list");
  const rateLink = document.createElement("a");
  rateLink.href = meta.sourceLinks.oneMotoringErpRatesPdf;
  rateLink.target = "_blank";
  rateLink.rel = "noopener noreferrer";
  rateLink.textContent = "Full rate table · effective 7 September 2026";
  sourceList.prepend(rateLink);
}

function renderEstimateCoverage(legs) {
  let note = document.querySelector("#estimate-coverage");
  if (!note) {
    note = document.createElement("p");
    note.id = "estimate-coverage";
    note.className = "estimate-coverage";
    note.setAttribute("role", "note");
    els.routeOptions.before(note);
  }
  const meta = state.erpData.meta;
  const calendar = state.erpData.calendar;
  const dates = legs.flatMap((leg) => [toDateInputValue(leg.trip.departureDate), toDateInputValue(leg.trip.arrivalDate)]);
  const messages = [];
  if (dates.some((date) => date < meta.ratesEffectiveFrom)) messages.push("Historical rates are unverified; this estimate uses the current rate table.");
  if (dates.some((date) => !calendar.years.includes(Number(date.slice(0, 4))))) messages.push("Public holidays for this year are unverified.");
  if (legs.some((leg) => calendar.uncertainEveDates.some((date) => {
    const cutoff = singaporeDateTime(date, "13:00").getTime();
    return leg.trip.arrivalDate.getTime() >= cutoff && leg.trip.departureDate.getTime() < cutoff + 11 * 3600000;
  }))) messages.push("LTA's Hari Raya eve cutoff guidance differs between sources. Standard rates are shown; check OneMotoring before travel.");
  if (!messages.length && dates.some((date) => date > meta.ratesVerifiedThrough)) messages.push("Uses the latest published rates. Future rate revisions may change this estimate.");
  note.textContent = messages.join(" ");
  note.hidden = !messages.length;
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
  const defaults = defaultTripTiming();
  els.date.value = defaults.date;
  els.time.value = defaults.time;
  setRadioValue("timeMode", defaults.mode);
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

function addDays(date, days) { return new Date(date.getTime() + days * 86400000); }

function minutesFromClock(clock) {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

function toDateInputValue(date) { return singaporeDateValue(date); }

function formatClock(date) { return singaporeClock(date); }

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

function roundMoney(amount) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = 12000, headers = {}, signal, ...fetchOptions } = options;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...fetchOptions, signal: controller.signal,
      headers: { Accept: "application/json", ...headers },
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
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
