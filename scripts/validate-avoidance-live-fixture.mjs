import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { loadAppForTest } from "./app-test-harness.mjs";
import { createAvoidanceProvider } from "../public/lib/avoidance-provider.js";
import { createZeroErpSearch } from "../public/lib/zero-erp-search.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/zero-erp-amk-raffles.json", import.meta.url), "utf8"));
const data = JSON.parse(await readFile(new URL("../public/data/erp-data.json", import.meta.url), "utf8"));
let shippedSearchOptions;
const context = await loadAppForTest(data, {
  createZeroErpSearch: (options) => { shippedSearchOptions = options; return async () => {}; },
});
const parseRoutes = vm.runInContext("parseValhallaRoutes", context);
const responses = new Map(fixture.responses.map((item) => [JSON.stringify(item.request), item]));
let calls = 0;
const provider = createAvoidanceProvider({
  minIntervalMs: 0,
  parseRoutes,
  fetchImpl: async (_url, options) => {
    calls += 1;
    const recorded = responses.get(options.body);
    assert.ok(recorded, "The recorded public-provider fixture must match the exact route/exclusion request.");
    return Response.json(recorded.payload, { status: recorded.status });
  },
});
const plan = { requestedDate: new Date(fixture.departure), vehicleType: "car", timeMode: "depart" };
const evaluate = (route) => context.api.evaluateZeroErpCandidate(route, plan, "outbound");
const ordinary = await provider.route(fixture.start, fixture.end, { avoidTolls: false });
assert.ok(ordinary.every((route) => evaluate(route).total > 0), "This regression must start with only paid ordinary routes.");
const limitedSearch = createZeroErpSearch({ providers: [provider], maxRequests: 4, deadlineMs: 18000, requestTimeoutMs: 8000 });
const limited = await limitedSearch(fixture.start, fixture.end, { routes: ordinary, evaluate });
assert.equal(limited.status, "not-found");
assert.equal(limited.reason, "search-limit");
assert.equal(limited.successfulRequests, 4);
assert.equal(limited.route, undefined, "A best paid candidate must not be labelled as zero ERP.");

const fullSearch = createZeroErpSearch({ ...shippedSearchOptions, providers: [provider] });
const found = await fullSearch(fixture.start, fixture.end, { routes: ordinary, evaluate });
assert.equal(found.status, "found");
assert.equal(found.evaluation.total, 0);
assert.equal(found.requests, 5);
assert.equal(found.failures.length, 0);
assert.equal(found.route.totalMeters, 11986);
assert.equal(found.route.durationSeconds, 1819.049);
assert.equal(calls, 6, "The second search should reuse successful first-search provider responses.");
assert.ok(found.route.durationSeconds > Math.min(...ordinary.map((route) => route.durationSeconds)));
console.log("Recorded live routes validated: Ang Mo Kio to Raffles Place at 08:00, ordinary $7/$6/$4; four searches report not found, five find a verified $0 12.0 km/30.3 minute route.");
