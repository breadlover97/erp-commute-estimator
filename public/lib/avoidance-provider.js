// Valhalla's toll preference supplies candidates; only the ERP evaluator can
// establish whether a candidate costs $0 for a particular departure.
// API: https://valhalla.github.io/valhalla/api/route/api-reference/
const ROUTE_ENDPOINT = "https://valhalla1.openstreetmap.de/route";
const MAX_EXCLUSIONS = 40;
// Official route API codes: 441 = location unreachable, 442 = no path.
// 443 is an exact map-matching failure, not a normal /route no-path response.
const NO_PATH_CODES = new Set([441, 442]);

export function createAvoidanceProvider({
  parseRoutes,
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = 6500,
  cacheTtlMs = 600000,
  maxEntries = 20,
  minIntervalMs = 1100,
} = {}) {
  if (typeof parseRoutes !== "function") throw new TypeError("A route parser is required.");
  const cache = new Map();
  let queue = Promise.resolve();
  let lastStarted = 0;

  return {
    id: "valhalla-avoid",
    supportsExclusions: true,
    async route(start, end, { signal, avoidTolls = true, excludeLocations = [] } = {}) {
      throwIfAborted(signal);
      const body = buildAvoidanceRequest(start, end, { avoidTolls, excludeLocations });
      const key = JSON.stringify(body);
      const cached = cache.get(key);
      if (cached && cached.expires > Date.now()) return cached.routes;
      cache.delete(key);

      // Public FOSSGIS service: at most one request/user/second. Serialize
      // requests from this adapter, including ordinary routes when shared.
      const pending = queue.then(async () => {
        throwIfAborted(signal);
        const queuedCache = cache.get(key);
        if (queuedCache && queuedCache.expires > Date.now()) return queuedCache.routes;
        await wait(Math.max(0, lastStarted + minIntervalMs - Date.now()), signal);
        throwIfAborted(signal);
        lastStarted = Date.now();
        const controller = new AbortController();
        const cancel = () => controller.abort(signal.reason);
        signal?.addEventListener("abort", cancel, { once: true });
        const timer = setTimeout(() => controller.abort(new DOMException("Avoidance routing timed out.", "TimeoutError")), timeoutMs);
        try {
          const response = await fetchImpl(ROUTE_ENDPOINT, {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json", "Accept": "application/json", "X-Client-Id": "erp-commute-estimator.pages.dev" },
            body: key,
          });
          const payload = await response.json();
          throwIfAborted(signal);
          throwIfAborted(controller.signal);
          // A route search with valid exclusions can legitimately have no path.
          // Throttling, malformed responses and outages must remain failures.
          if (NO_PATH_CODES.has(Number(payload.error_code))) return [];
          if (!response.ok || payload.error || payload.error_code) {
            const error = new Error(`Avoidance routing failed (${response.status}).`);
            error.status = response.status;
            error.code = payload.error_code || "avoidance_unavailable";
            throw error;
          }
          const routes = parseRoutes(payload, {
            provider: avoidTolls || excludeLocations.length ? "valhalla-avoid" : "valhalla",
            providerLabel: avoidTolls || excludeLocations.length ? "Valhalla ERP avoidance search" : "Valhalla enhanced routing",
            providerRank: -1,
          });
          if (!Array.isArray(routes)) throw new Error("Invalid avoidance routing response.");
          if (routes.length) {
            cache.set(key, { routes, expires: Date.now() + cacheTtlMs });
            while (cache.size > Math.max(0, maxEntries)) cache.delete(cache.keys().next().value);
          }
          return routes;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", cancel);
        }
      });
      queue = pending.catch(() => {});
      return abortable(pending, signal);
    },
  };
}

export function buildAvoidanceRequest(start, end, { avoidTolls = true, excludeLocations = [] } = {}) {
  if (!Array.isArray(excludeLocations) || excludeLocations.length > MAX_EXCLUSIONS) {
    throw new RangeError(`At most ${MAX_EXCLUSIONS} excluded road locations are supported.`);
  }
  const exclusions = excludeLocations.map((point) => {
    const location = coordinate(point);
    if (point.heading != null) {
      if (!Number.isFinite(point.heading)) throw new TypeError("Invalid excluded-road heading.");
      location.heading = ((point.heading % 360) + 360) % 360;
      location.heading_tolerance = 35;
    }
    return location;
  });
  const body = {
    locations: [coordinate(start), coordinate(end)],
    costing: "auto",
    units: "kilometers",
    alternates: 2,
    directions_type: "none",
  };
  if (avoidTolls) body.costing_options = { auto: { use_tolls: 0 } };
  if (exclusions.length) body.exclude_locations = exclusions;
  return body;
}

function coordinate(point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)
      || point.lat < 1.13 || point.lat > 1.49 || point.lng < 103.58 || point.lng > 104.12) {
    throw new RangeError("Avoidance routing requires valid Singapore coordinates.");
  }
  return { lat: Number(point.lat.toFixed(6)), lon: Number(point.lng.toFixed(6)) };
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Cancelled", "AbortError");
}

function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason || new DOMException("Cancelled", "AbortError"));
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}

function wait(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(signal.reason || new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", cancel); resolve(); }, ms);
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
  });
}
