import assert from "node:assert/strict";
import { createZeroErpSearch } from "../public/lib/zero-erp-search.js";
import { createRouteService } from "../public/lib/route-service.js";
import { departureForMode, lookupErpRate } from "../public/lib/erp-engine.js";

const start = { lat: 1.3, lng: 103.8 };
const end = { lat: 1.4, lng: 103.9 };
const gantryA = { lat: 1.32, lng: 103.82, heading: 90 };
const gantryB = { lat: 1.36, lng: 103.86, heading: 180 };
const route = (id, total = 1, durationSeconds = 600) => ({
  id, total, durationSeconds, totalMeters: 10000,
  points: [start, { lat: 1.33 + id / 100000, lng: 103.83 }, end],
});
const evaluate = (candidate) => ({ total: candidate.total, chargeLocations: candidate.total ? [gantryA] : [] });
const provider = (fn) => ({ id: "test", supportsExclusions: true, route: fn });
const run = (search, options = {}) => search(start, end, { evaluate, ...options });
let checks = 0;
async function check(name, test) { await test(); checks++; console.log(`✓ ${name}`); }

await check("a slower fourth ordinary route survives display truncation and coarse deduplication", async () => {
  const raw = [route(1), route(2), route(3), route(4, 0, 1200)];
  const service = createRouteService({ providers: [async () => raw], rank: (routes) => routes.slice(0, 3) });
  let all;
  assert.equal((await service(start, end, { onCandidates: (routes) => { all = routes; } })).length, 3);
  assert.equal(all.length, 4);
  let called = false;
  const result = await run(createZeroErpSearch({ providers: [provider(() => { called = true; })] }), { routes: all });
  assert.equal(result.status, "found");
  assert.equal(result.route.id, 4);
  assert.equal(result.candidates.length, 4);
  assert.equal(called, false);
  let cached;
  await service(start, end, { onCandidates: (routes) => { cached = routes; } });
  assert.equal(cached.length, 4, "The cache must retain every raw alternative");
});

await check("avoid-tolls preference must still pass actual ERP evaluation", async () => {
  const requests = [];
  const result = await run(createZeroErpSearch({ providers: [provider(async (a, b, options) => {
    requests.push(options);
    return [route(5, 2)];
  })] }), { routes: [route(1, 3)] });
  assert.equal(result.status, "not-found");
  assert.equal(result.route, undefined);
  assert.equal(requests[0].avoidTolls, true);
  assert.deepEqual(requests[0].excludeLocations, []);
  assert.deepEqual(requests[1].excludeLocations, [gantryA]);
});

await check("iterative detours exclude newly discovered positive-charge crossings", async () => {
  const requests = [];
  const result = await run(createZeroErpSearch({ providers: [provider(async (a, b, options) => {
    requests.push(options.excludeLocations);
    if (!options.excludeLocations.length) return [route(1, 2)];
    if (options.excludeLocations.length === 1) return [route(2, 1)];
    return [route(3, 0)];
  })] }), { evaluate: (r) => ({ total: r.total, chargeLocations: r.id === 1 ? [gantryA] : r.id === 2 ? [gantryB] : [] }) });
  assert.equal(result.status, "found");
  assert.equal(result.route.id, 3);
  assert.equal(result.requests, 3);
  assert.deepEqual(new Set(requests[2].map((p) => p.heading)), new Set([90, 180]));
});

await check("different charged candidates retain distinct exclusion branches", async () => {
  const requests = [];
  const result = await run(createZeroErpSearch({ providers: [provider(async (a, b, options) => {
    requests.push(options.excludeLocations);
    return options.excludeLocations.some((p) => p.heading === 180) ? [route(3, 0)] : [route(1, 1)];
  })] }), {
    routes: [route(1, 1), route(2, 2)],
    evaluate: (r) => ({ total: r.total, chargeLocations: r.id === 1 ? [gantryA] : r.id === 2 ? [gantryB] : [] }),
  });
  assert.equal(result.status, "found");
  assert.equal(requests.length, 3);
});

await check("duplicate detours keep exclusion history for a combined retry", async () => {
  const requests = [];
  const result = await run(createZeroErpSearch({ providers: [provider(async (a, b, options) => {
    requests.push(options.excludeLocations);
    return options.excludeLocations.length === 2 ? [route(3, 0)] : [route(2, 2)];
  })] }), {
    routes: [route(1, 1), route(2, 2)],
    evaluate: (r) => ({ total: r.total, chargeLocations: r.id === 1 ? [gantryA] : r.id === 2 ? [gantryB] : [] }),
  });
  assert.equal(result.status, "found");
  assert.equal(requests[2].length, 2);
});

await check("real rate lookup distinguishes depart and arrive crossing times for each duration", async () => {
  const data = {
    meta: {}, calendar: { years: [2026] }, groups: [{ id: "A" }],
    baseRates: [{ groupId: "A", start: "08:00", end: "09:00", amount: 2 }], adjustments: [],
  };
  const selected = new Date("2026-10-27T01:10:00Z"); // Singapore 09:10
  const short = route(1, 0, 600);
  const long = route(2, 0, 2400);
  const evaluateAt = (timeMode) => (r) => {
    const departure = departureForMode(selected, r.durationSeconds, timeMode);
    const crossing = new Date(departure.getTime() + r.durationSeconds * 500);
    const minutes = (crossing.getUTCHours() * 60 + crossing.getUTCMinutes() + 480) % 1440;
    const total = lookupErpRate(data, "A", "2026-10-27", minutes, { multiplier: 1, label: "Car" }).amount;
    return { total, chargeLocations: total ? [gantryA] : [] };
  };
  const search = createZeroErpSearch();
  const arrived = await run(search, { routes: [long, short], evaluate: evaluateAt("arrive") });
  assert.equal(arrived.status, "found");
  assert.equal(arrived.route, short);
  assert.equal(arrived.candidates.find((r) => r.route === long).evaluation.total, 2);
  const departed = await run(search, { routes: [long], evaluate: evaluateAt("depart") });
  assert.equal(departed.status, "found");
  assert.equal(departed.evaluation.total, 0, "Cached geometry is recalculated at the chosen mode/time");
});

await check("identical geometry with distinct duration is independently evaluated", async () => {
  const original = route(1, 2);
  const alternate = { ...original, durationSeconds: 1200, total: 0 };
  const result = await run(createZeroErpSearch(), { routes: [original, alternate] });
  assert.equal(result.status, "found");
  assert.equal(result.candidates.length, 2);
});

await check("all provider failures report unavailable", async () => {
  const result = await run(createZeroErpSearch({ providers: [provider(async () => { throw Error("offline"); })] }), { routes: [route(1)] });
  assert.equal(result.status, "unavailable");
  assert.equal(result.partial, true);
});

await check("partial provider failure is distinguished from a wholly unavailable search", async () => {
  const result = await run(createZeroErpSearch({ providers: [
    provider(async () => { throw Error("offline"); }),
    { id: "working", supportsExclusions: false, route: async () => [route(1, 2)] },
  ] }));
  assert.equal(result.status, "not-found");
  assert.equal(result.partial, true);
  assert.equal(result.successfulRequests, 1);
  const found = await run(createZeroErpSearch({ providers: [
    provider(async () => { throw Error("offline"); }),
    { id: "working", route: async () => [route(1, 0)] },
  ] }));
  assert.equal(found.status, "found");
  assert.equal(found.partial, true);
});

await check("a successful empty provider search reports no route found", async () => {
  const result = await run(createZeroErpSearch({ providers: [provider(async () => [])] }));
  assert.equal(result.status, "not-found");
  assert.equal(result.successfulRequests, 1);
});

await check("invalid geometry and invalid evaluator totals never imply zero ERP", async () => {
  for (const value of [NaN, undefined, -1, "0"]) {
    const result = await run(createZeroErpSearch({ providers: [provider(async () => [route(1)])] }), { evaluate: () => ({ total: value }) });
    assert.equal(result.status, "unavailable");
  }
  const result = await run(createZeroErpSearch({ providers: [provider(async () => [{ ...route(1, 0), points: [] }])] }));
  assert.equal(result.status, "unavailable");
});

await check("successfully evaluated but infeasible detours report not found", async () => {
  let calls = 0;
  const result = await run(createZeroErpSearch({ providers: [provider(async () => {
    calls++;
    return [route(1, 0), route(2, 2)];
  })] }), { evaluate: (r) => ({ ...evaluate(r), eligible: false }) });
  assert.equal(result.status, "not-found");
  assert.equal(result.successfulRequests, 1);
  assert.equal(result.partial, false);
  assert.equal(result.candidates.length, 0);
  assert.equal(calls, 1, "Infeasible paid routes must not seed exclusion retries");

  const eligible = await run(createZeroErpSearch({ providers: [provider(async () => [route(1, 0), route(2, 0)])] }), {
    evaluate: (r) => ({ ...evaluate(r), eligible: r.id === 2 }),
  });
  assert.equal(eligible.status, "found");
  assert.equal(eligible.route.id, 2);
  assert.equal(eligible.candidates.length, 1);

  let evaluations = 0;
  const duplicate = await run(createZeroErpSearch({ providers: [provider(async () => [route(1, 0)])] }), {
    routes: [route(1, 0)],
    evaluate: () => { evaluations++; return { total: 0, eligible: false }; },
  });
  assert.equal(duplicate.status, "not-found");
  assert.equal(evaluations, 1, "Known infeasible geometry should be remembered");

  const invalid = await run(createZeroErpSearch({ providers: [provider(async () => [route(1)])] }), {
    evaluate: () => ({ total: NaN, eligible: false }),
  });
  assert.equal(invalid.status, "unavailable", "Eligibility cannot legitimize an invalid estimate");
});

await check("request timeout bounds a provider that ignores cancellation", async () => {
  let providerSignal;
  const started = Date.now();
  const result = await run(createZeroErpSearch({ requestTimeoutMs: 20, deadlineMs: 100,
    providers: [provider(async (a, b, { signal }) => { providerSignal = signal; return new Promise(() => {}); })],
  }));
  assert.equal(result.status, "unavailable");
  assert.equal(providerSignal.aborted, true);
  assert.ok(Date.now() - started < 500);
});

await check("overall deadline and request count cap repeated detours", async () => {
  let count = 0;
  const result = await run(createZeroErpSearch({ maxRequests: 3, providers: [provider(async () => [route(++count)])] }), {
    evaluate: (r) => ({ total: 1, chargeLocations: [{ lat: 1.3 + r.id / 100, lng: 103.8 }] }),
  });
  assert.equal(result.requests, 3);
  assert.equal(result.status, "not-found");
  assert.equal(result.partial, true);
  const deadlineResult = await run(createZeroErpSearch({ deadlineMs: 30, requestTimeoutMs: 100,
    providers: [provider(() => new Promise(() => {})), provider(() => new Promise(() => {}))],
  }));
  assert.equal(deadlineResult.requests, 1);
});

await check("cancellation rejects immediately and discards ignored late provider results", async () => {
  const controller = new AbortController();
  let settle;
  let evaluations = 0;
  const search = createZeroErpSearch({ providers: [provider(() => new Promise((resolve) => { settle = resolve; }))] });
  const pending = run(search, { signal: controller.signal, evaluate: (r) => { evaluations++; return evaluate(r); } });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  settle([route(1, 0)]);
  await Promise.resolve();
  assert.equal(evaluations, 0);
  await assert.rejects(run(search, { signal: controller.signal }), { name: "AbortError" });
});

await check("outbound and return searches keep independent results and cancellation", async () => {
  const first = new AbortController();
  const search = createZeroErpSearch({ providers: [provider(async (a) => a === start ? [route(1, 0)] : [route(2, 1)])] });
  const [outbound, inbound] = await Promise.all([
    search(start, end, { evaluate, signal: first.signal }),
    search(end, start, { evaluate }),
  ]);
  assert.equal(outbound.status, "found");
  assert.equal(inbound.status, "not-found");
});

await check("candidate and exclusion limits report a partial bounded search", async () => {
  const result = await run(createZeroErpSearch({ maxCandidates: 2, providers: [provider(async () => [route(3, 0)])] }), {
    routes: [route(1), route(2), route(3, 0)],
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.partial, true);
  const excluded = await run(createZeroErpSearch({ maxExclusions: 1, providers: [provider(async () => [route(1)])] }), {
    evaluate: () => ({ total: 1, chargeLocations: [gantryA, gantryB] }),
  });
  assert.equal(excluded.requests, 1);
  assert.equal(excluded.partial, true);
});
console.log(`Zero-ERP search validation passed (${checks} scenarios)`);
