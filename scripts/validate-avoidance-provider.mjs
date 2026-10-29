import assert from "node:assert/strict";
import { buildAvoidanceRequest, createAvoidanceProvider } from "../public/lib/avoidance-provider.js";

const start = { lat: 1.3691, lng: 103.8454 };
const end = { lat: 1.2838, lng: 103.8515 };
const excluded = { lat: 1.34630899, lng: 103.8595446, heading: 180 };
const payload = buildAvoidanceRequest(start, end, { excludeLocations: [excluded] });
assert.deepEqual(payload.locations[0], { lat: start.lat, lon: start.lng });
assert.equal(payload.costing_options.auto.use_tolls, 0);
assert.equal(payload.exclude_locations[0].heading, 180);
assert.equal(payload.exclude_locations[0].heading_tolerance, 35);
assert.equal(payload.exclude_locations[0].lon, 103.859545);
assert.equal(buildAvoidanceRequest(start, end, { avoidTolls: false }).costing_options, undefined);
assert.throws(() => buildAvoidanceRequest({ lat: 999, lng: 103 }, end), RangeError);
assert.throws(() => buildAvoidanceRequest(start, end, { excludeLocations: Array(41).fill(excluded) }), RangeError);
assert.throws(() => buildAvoidanceRequest(start, end, { excludeLocations: [{ ...excluded, heading: NaN }] }), TypeError);

let calls = 0;
const requests = [];
const provider = createAvoidanceProvider({
  minIntervalMs: 0,
  parseRoutes: (_payload, meta) => [{ ...meta, points: [start, end], totalMeters: 13000, durationSeconds: 900 }],
  fetchImpl: async (url, options) => {
    calls += 1;
    requests.push({ url, options, body: JSON.parse(options.body) });
    return Response.json({ trip: {} });
  },
});
const first = await provider.route(start, end);
assert.equal(first[0].provider, "valhalla-avoid");
assert.equal(requests[0].url, "https://valhalla1.openstreetmap.de/route");
assert.equal(requests[0].options.headers["X-Client-Id"], "erp-commute-estimator.pages.dev");
assert.ok(requests[0].options.signal instanceof AbortSignal);
await provider.route(start, end);
assert.equal(calls, 1, "Repeated requests should use the tab cache.");
const ordinary = await provider.route(start, end, { avoidTolls: false });
assert.equal(ordinary[0].provider, "valhalla");
assert.equal(calls, 2, "A toll-avoid request must not reuse an ordinary-route cache key.");
await provider.route(start, end, { excludeLocations: [excluded] });
assert.equal(calls, 3, "Changing exclusions must trigger a new path search.");

const noPathProvider = createAvoidanceProvider({
  parseRoutes: () => { throw new Error("No-path responses must bypass the route parser."); },
  fetchImpl: async () => Response.json({ error_code: 442, error: "No path could be found for input" }, { status: 400 }),
});
assert.deepEqual(await noPathProvider.route(start, end), []);
const unavailable = createAvoidanceProvider({ parseRoutes: () => [], fetchImpl: async () => Response.json({ error: "Rate limited" }, { status: 429 }) });
await assert.rejects(() => unavailable.route(start, end), (error) => error.status === 429);

const abortFetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});
const slow = createAvoidanceProvider({ parseRoutes: () => [], fetchImpl: abortFetch, timeoutMs: 15, minIntervalMs: 0 });
await assert.rejects(() => slow.route(start, end), (error) => error.name === "TimeoutError");
const aborter = new AbortController();
const cancelled = slow.route(start, end, { signal: aborter.signal });
aborter.abort();
await assert.rejects(() => cancelled, (error) => error.name === "AbortError");

// A queued search must settle on cancellation instead of waiting for a different
// trip's network request, and a cancelled request must never enter the cache.
let queuedCalls = 0;
let finishFirst;
const queued = createAvoidanceProvider({
  minIntervalMs: 0,
  parseRoutes: () => [{ points: [start, end] }],
  fetchImpl: async () => { queuedCalls += 1; return new Promise((resolve) => { finishFirst = () => resolve(Response.json({ trip: {} })); }); },
});
const holding = queued.route(start, end);
await new Promise((resolve) => setTimeout(resolve, 0));
const cancelQueued = new AbortController();
const waiting = queued.route(end, start, { signal: cancelQueued.signal });
cancelQueued.abort();
await assert.rejects(() => waiting, (error) => error.name === "AbortError");
finishFirst();
await holding;
assert.equal(queuedCalls, 1);
console.log("Avoidance provider validated: toll preference, directed exclusions, cache separation, no-path/error distinction, timeout and queued cancellation.");
