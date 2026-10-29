// Bounded in-memory cache: locations never leave this tab except to routing providers.
export function createRouteService({ providers, rank, limit = 3, cacheTtlMs = 600000, maxEntries = 20, collectWindowMs = 300, fallbackDelayMs = 1000 }) {
  const cache = new Map();
  return async function getRoutes(start, end, { signal, onCandidates } = {}) {
    if (signal?.aborted) throw signal.reason || new DOMException("Cancelled", "AbortError");
    const key = [start.lat, start.lng, end.lat, end.lng].map((n) => Number(n).toFixed(6)).join(",");
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) {
      onCandidates?.([...cached.candidates]);
      return cached.routes;
    }
    cache.delete(key);
    const routes = await collectProviders(providers, start, end, { signal, collectWindowMs, fallbackDelayMs });
    const selected = rank(routes, start, end).slice(0, limit).map((route, index) => ({ ...route, index }));
    if (!selected.length) throw new Error("No driving route found between those points.");
    // ERP search needs the full geometry pool, including slower/nearby alternatives
    // that ordinary display ranking may merge or truncate. Cache geometry, never cost.
    cache.set(key, { routes: selected, candidates: routes, expires: Date.now() + cacheTtlMs });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    onCandidates?.([...routes]);
    return selected;
  };
}

function collectProviders(providers, start, end, { signal, collectWindowMs, fallbackDelayMs }) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const routes = [];
    let settled = false;
    let completed = 0;
    let started = 0;
    let collectionTimer;
    let fallbackTimer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(collectionTimer);
      clearTimeout(fallbackTimer);
      signal?.removeEventListener("abort", cancel);
      controller.abort();
      if (error) reject(error);
      else resolve(routes);
    };
    const cancel = () => finish(signal.reason || new DOMException("Cancelled", "AbortError"));
    const launch = (provider) => {
      started += 1;
      Promise.resolve().then(() => provider(start, end, { signal: controller.signal })).then((result) => {
        if (settled || !result?.length) return;
        routes.push(...result);
        if (!collectionTimer) collectionTimer = setTimeout(() => finish(), collectWindowMs);
      }).catch(() => {
        // A failed engine must not hide a usable route from another provider.
      }).finally(() => {
        completed += 1;
        if (settled) return;
        if (completed === started) {
          if (routes.length) finish();
          else if (started < providers.length) launchFallbacks();
          else finish(new Error("Routing services are unavailable. Please try again."));
        }
      });
    };
    const launchFallbacks = () => {
      clearTimeout(fallbackTimer);
      if (settled) return;
      providers.slice(started).forEach(launch);
    };
    if (signal?.aborted) return cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    providers.slice(0, 2).forEach(launch);
    if (!started) finish(new Error("No routing providers available."));
    else if (started < providers.length) fallbackTimer = setTimeout(launchFallbacks, fallbackDelayMs);
  });
}
