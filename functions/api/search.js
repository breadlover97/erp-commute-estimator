import { fetchOneMapJson } from "../_lib/onemap.js";
import { normalizeOneMapResults } from "../../public/planner-utils.js";

const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000;
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, max-age=300",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};
const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { ...headers, ...(status === 200 ? {} : { "Cache-Control": "no-store" }) },
});

export async function onRequestGet({ request, env }) {
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return json({ error: "Cross-site address searches are not allowed." }, 403);
  }
  const query = (new URL(request.url).searchParams.get("q") || "").trim().replace(/\s+/g, " ");
  if (query.length < 3 || query.length > 120 || /[\u0000-\u001f]/.test(query)) {
    return json({ error: "Enter between 3 and 120 characters." }, 400);
  }
  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return json(hit.payload);
  const url = new URL("https://www.onemap.gov.sg/api/common/elastic/search");
  url.search = new URLSearchParams({ searchVal: query, returnGeom: "Y", getAddrDetails: "Y", pageNum: "1" }).toString();
  try {
    const { response, payload } = await fetchOneMapJson(url, { env, timeoutMs: 5000, signal: request.signal });
    if (!response.ok || !Array.isArray(payload?.results)) {
      return json({ error: "Singapore address search is temporarily unavailable. Please try again." }, 503);
    }
    const result = { results: normalizeOneMapResults(payload, 8), source: "OneMap, Singapore Land Authority" };
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, { payload: result, expiresAt: Date.now() + CACHE_TTL });
    return json(result);
  } catch {
    return json({ error: "Address search timed out. Please try again." }, 503);
  }
}
