// A bounded search, not proof that no free path exists in the road network.
// Evaluation is supplied by the planner so every candidate uses the same geometry
// matching, vehicle, date, and per-route depart/arrive calculation as visible routes.
export function createZeroErpSearch({
  providers = [], maxRequests = 4, deadlineMs = 12000,
  requestTimeoutMs = 4500, maxCandidates = 64, maxExclusions = 40,
} = {}) {
  return async function search(start, end, { routes = [], evaluate, signal, onProgress } = {}) {
    if (typeof evaluate !== "function") throw new TypeError("An ERP route evaluator is required.");
    throwIfAborted(signal);
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason || abortError());
    signal?.addEventListener("abort", cancel, { once: true });
    const deadline = Date.now() + Math.max(1, deadlineMs);
    const candidates = [];
    const seen = new Map();
    const attemptedExclusions = new Set();
    const failures = [];
    let requests = 0;
    let successfulRequests = 0;
    let limited = false;
    const ingest = (newRoutes, exclusions = []) => {
      let evaluated = 0;
      for (const route of newRoutes || []) {
        throwIfAborted(signal);
        if (Date.now() >= deadline || seen.size >= maxCandidates) { limited = true; break; }
        // Exact full geometry and duration: coarse shape/distance similarity can
        // collapse opposite sides of a gantry or different arrival crossing times.
        if (!validRoute(route)) { failures.push("invalid-route"); continue; }
        const key = JSON.stringify([route.durationSeconds, route.points.map(({ lat, lng }) => [lat, lng])]);
        if (seen.has(key)) {
          // The same paid path may be returned after an exclusion request. Retain
          // that branch's history so its next retry combines old and new gantries.
          const existing = seen.get(key);
          if (existing.evaluation.eligible !== false && !existing.exclusionPaths.some((path) => JSON.stringify(path) === JSON.stringify(exclusions))) {
            existing.exclusionPaths.push(exclusions);
          }
          evaluated += 1;
          continue;
        }
        try {
          const evaluation = evaluate(route);
          if (!Number.isFinite(evaluation?.total) || evaluation.total < 0) throw new Error("Invalid ERP estimate");
          const candidate = { route, evaluation, exclusionPaths: [exclusions] };
          // A valid estimate can fail the planner's journey constraints (for
          // example, arriving after the return trip leaves). That is a checked,
          // infeasible route, not a provider/evaluation failure or a free option.
          if (evaluation.eligible !== false) candidates.push(candidate);
          seen.set(key, candidate);
          evaluated += 1;
        } catch (error) {
          if (signal?.aborted) throw error;
          failures.push("evaluation-failed");
        }
      }
      return evaluated;
    };
    const result = (status, reason) => {
      const best = candidates.filter(({ evaluation }) => evaluation.total === 0)
        .sort((a, b) => a.route.durationSeconds - b.route.durationSeconds || a.route.totalMeters - b.route.totalMeters)[0];
      return {
        status, reason, route: best?.route, evaluation: best?.evaluation,
        candidates: candidates.map(({ route, evaluation }) => ({ route, evaluation })),
        requests, successfulRequests, partial: limited || failures.length > 0,
        failures: [...failures],
      };
    };
    const freeFound = () => candidates.some(({ evaluation }) => evaluation.total === 0);
    const publish = () => onProgress?.({ status: "searching", checkedCandidates: seen.size, requests });
    const canRequest = () => requests < maxRequests && Date.now() < deadline && seen.size < maxCandidates;
    const request = async (provider, excludeLocations = []) => {
      throwIfAborted(signal);
      requests += 1;
      publish();
      try {
        const response = await boundedRequest(provider.route, start, end, {
          signal: controller.signal, avoidTolls: true, excludeLocations,
          timeoutMs: Math.min(requestTimeoutMs, Math.max(1, deadline - Date.now())),
        });
        throwIfAborted(signal);
        if (!Array.isArray(response)) throw new Error("Invalid route response");
        const evaluated = ingest(response, excludeLocations);
        if (!response.length || evaluated) successfulRequests += 1;
      } catch (error) {
        throwIfAborted(signal);
        failures.push(error?.name === "TimeoutError" ? "timeout" : "provider-failed");
      }
      publish();
    };
    try {
      ingest(routes);
      publish();
      if (freeFound()) return result("found", "verified-zero");
      // Dedicated avoid-tolls requests are independent of the fast ordinary-route
      // collection window. A toll preference alone never qualifies a route as free.
      for (const provider of providers) {
        if (!canRequest()) break;
        await request(provider);
        if (freeFound()) return result("found", "verified-zero");
      }
      // Explore distinct charged routes, then grow each exclusion set when the
      // detour encounters another active gantry. Never exclude inactive crossings.
      while (canRequest()) {
        let next;
        const ordered = [...candidates].sort((a, b) => a.evaluation.total - b.evaluation.total || a.route.durationSeconds - b.route.durationSeconds);
        for (const candidate of ordered) {
          for (const path of [...candidate.exclusionPaths].sort((a, b) => b.length - a.length)) {
            const locations = normalizeLocations([...path, ...(candidate.evaluation.chargeLocations || [])]);
            if (!locations.length) continue;
            if (locations.length > maxExclusions) { limited = true; continue; }
            for (const provider of providers.filter((item) => item.supportsExclusions)) {
              const key = JSON.stringify([provider.id, locations]);
              if (!attemptedExclusions.has(key)) { next = { provider, locations, key }; break; }
            }
            if (next) break;
          }
          if (next) break;
        }
        if (!next) break;
        attemptedExclusions.add(next.key);
        await request(next.provider, next.locations);
        if (freeFound()) return result("found", "verified-zero");
      }
      limited ||= requests >= maxRequests || Date.now() >= deadline;
      // An empty/failed dedicated search cannot establish that routes were checked.
      // A successful provider with no route is still useful search evidence.
      if (!successfulRequests) return result("unavailable", providers.length ? "search-unavailable" : "no-search-provider");
      return result("not-found", limited ? "search-limit" : "candidates-exhausted");
    } finally {
      signal?.removeEventListener("abort", cancel);
      controller.abort();
    }
  };
}

function validRoute(route) {
  return Array.isArray(route?.points) && route.points.length > 1 &&
    route.points.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)) &&
    Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0;
}

function normalizeLocations(locations) {
  const unique = new Map();
  for (const point of locations) {
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) continue;
    const location = { lat: point.lat, lng: point.lng };
    if (Number.isFinite(point.heading)) location.heading = ((point.heading % 360) + 360) % 360;
    const key = JSON.stringify(location);
    unique.set(key, location);
  }
  return [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, location]) => location);
}

function abortError() { return new DOMException("Cancelled", "AbortError"); }
function throwIfAborted(signal) { if (signal?.aborted) throw signal.reason || abortError(); }

// Race even providers that ignore AbortSignal; late results must never update UI.
function boundedRequest(route, start, end, { signal, timeoutMs, ...options }) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      controller.abort();
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(signal.reason || abortError());
    if (signal.aborted) return cancel();
    signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => finish(new DOMException("ERP route search timed out", "TimeoutError")), timeoutMs);
    Promise.resolve().then(() => {
      throwIfAborted(controller.signal);
      return route(start, end, { ...options, signal: controller.signal });
    }).then((value) => finish(null, value), (error) => finish(error));
  });
}
