import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as plannerUtils from "../public/planner-utils.js";
import * as erpEngine from "../public/lib/erp-engine.js";
import { createRouteService } from "../public/lib/route-service.js";

export async function loadAppForTest(data, overrides = {}) {
  const source = (await readFile(new URL("../public/app.js", import.meta.url), "utf8"))
    .replace(/^import .*;\n/gm, "")
    .replace(/init\(\)\.catch\(\(error\) => \{[\s\S]*?\n\}\);/, "");
  const elements = new Map();
  const element = () => ({ value: "", innerHTML: "", textContent: "", disabled: false, hidden: false,
    classList: { add() {}, remove() {} }, attributes: new Map(), events: {},
    setAttribute(key, value) { this.attributes.set(key, value); },
    getAttribute(key) { return this.attributes.get(key); },
    removeAttribute(key) { this.attributes.delete(key); },
    addEventListener(key, listener) { this.events[key] = listener; },
    querySelectorAll() { return []; }, contains() { return false; }, focus() {}, replaceChildren() {}, append() {},
  });
  const document = {
    querySelector(selector) { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); },
    querySelectorAll() { return []; }, createElement: element,
  };
  const context = vm.createContext({
    ...plannerUtils, ...erpEngine, createRouteService, console, URL, URLSearchParams, Date, Map, Set, WeakMap,
    AbortController, DOMException, document,
    window: { setTimeout, clearTimeout, history: { replaceState() {} }, location: { origin: "https://example.com", pathname: "/" } },
    ...overrides,
  });
  vm.runInContext(`${source}\nglobalThis.api = { buildLegOptions, matchGantriesToRoute, buildRouteCandidate,
    findTimingSuggestions, renderRecommendation, calculateTrip, buildCumulativeDistances, bearingDegrees, haversineMeters, state, els,
    clearCurrentEstimate, handleTimingChange, requireConfirmedAddress, useCurrentLocation, cancelLocationRequest,
    handleSwap, bindAddressField,
    setData(data) { state.erpData = data; } };`, context);
  if (data) context.api.setData(data);
  return context;
}
