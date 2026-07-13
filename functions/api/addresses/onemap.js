const ONEMAP_AUTH_ENDPOINT = "https://www.onemap.gov.sg/api/auth/post/getToken";
const ONEMAP_SEARCH_ENDPOINT = "https://www.onemap.gov.sg/api/common/elastic/search";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const ADDRESS_CACHE_VERSION = "v1";
const ADDRESS_CACHE_TTL_SECONDS = 24 * 60 * 60;
const EMPTY_ADDRESS_CACHE_TTL_SECONDS = 5 * 60;
const JSON_RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=()",
  Vary: "Sec-Fetch-Site",
};

let cachedOneMapToken = null;
let cachedOneMapTokenExpiresAtMs = 0;

export async function onRequestGet(context) {
  if (context.request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return jsonResponse({ error: "Cross-site address searches are not allowed." }, 403);
  }

  const requestUrl = new URL(context.request.url);
  const query = String(requestUrl.searchParams.get("q") || "").trim();
  if (!/^\d{6}$/.test(query)) {
    return jsonResponse({ error: "Address query must be a six-digit Singapore postal code." }, 400);
  }

  const cacheRequest = createAddressCacheRequest(requestUrl, query);
  const cachedPayload = await readCachedAddressPayload(cacheRequest);
  if (cachedPayload) {
    return jsonResponse(cachedPayload, 200);
  }

  const tokenResult = await getOneMapToken(context.env);
  if (!tokenResult.token) {
    return jsonResponse(
      {
        error: tokenResult.error || "OneMap address search is not configured.",
        code: tokenResult.code || "missing_onemap_credentials",
      },
      503,
    );
  }

  const oneMapUrl = new URL(ONEMAP_SEARCH_ENDPOINT);
  oneMapUrl.searchParams.set("searchVal", query);
  oneMapUrl.searchParams.set("returnGeom", "Y");
  oneMapUrl.searchParams.set("getAddrDetails", "Y");
  oneMapUrl.searchParams.set("pageNum", "1");

  let { response, payload } = await fetchOneMapSearch(oneMapUrl, tokenResult.token);
  if (shouldRetryWithFreshToken(response, payload) && hasRefreshCredentials(context.env)) {
    clearCachedOneMapToken();
    const retryTokenResult = await getOneMapToken(context.env, { forceRefresh: true });
    if (retryTokenResult.token) {
      ({ response, payload } = await fetchOneMapSearch(oneMapUrl, retryTokenResult.token));
    }
  }

  const oneMapError = summarizeOneMapError(payload);
  if (!response.ok || oneMapError) {
    return jsonResponse(
      {
        error: "OneMap address search is temporarily unavailable.",
        code: "onemap_search_failed",
        details: oneMapError || `HTTP ${response.status}`,
      },
      response.ok ? 502 : response.status,
    );
  }

  const responsePayload = {
    found: Number(payload?.found) || 0,
    results: Array.isArray(payload?.results) ? payload.results.slice(0, 20) : [],
  };
  cacheAddressPayload(context, cacheRequest, responsePayload);
  return jsonResponse(responsePayload, 200);
}

function createAddressCacheRequest(requestUrl, query) {
  const cacheUrl = new URL(`/__address-cache/${ADDRESS_CACHE_VERSION}`, requestUrl.origin);
  cacheUrl.searchParams.set("postal", query);
  return new Request(cacheUrl.toString(), { method: "GET" });
}

async function readCachedAddressPayload(cacheRequest) {
  const cache = globalThis.caches?.default;
  if (!cache) {
    return null;
  }
  try {
    const response = await cache.match(cacheRequest);
    return response ? await response.json() : null;
  } catch {
    return null;
  }
}

function cacheAddressPayload(context, cacheRequest, payload) {
  const cache = globalThis.caches?.default;
  if (!cache || typeof context.waitUntil !== "function") {
    return;
  }
  const ttl = payload.results.length ? ADDRESS_CACHE_TTL_SECONDS : EMPTY_ADDRESS_CACHE_TTL_SECONDS;
  const response = new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${ttl}`,
    },
  });
  context.waitUntil(cache.put(cacheRequest, response).catch(() => undefined));
}

async function getOneMapToken(env, { forceRefresh = false } = {}) {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedOneMapToken &&
    cachedOneMapTokenExpiresAtMs - TOKEN_REFRESH_BUFFER_MS > now
  ) {
    return { token: cachedOneMapToken };
  }
  if (hasRefreshCredentials(env)) {
    const response = await fetch(ONEMAP_AUTH_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: env.ONEMAP_EMAIL, password: env.ONEMAP_PASSWORD }),
    });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.access_token) {
      const expirySeconds = Number(payload.expiry_timestamp);
      cachedOneMapToken = payload.access_token;
      cachedOneMapTokenExpiresAtMs = Number.isFinite(expirySeconds)
        ? expirySeconds * 1000
        : now + 70 * 60 * 60 * 1000;
      return { token: cachedOneMapToken };
    }
    clearCachedOneMapToken();
    return { error: "OneMap authentication failed.", code: "onemap_auth_failed" };
  }
  if (env.ONEMAP_API_TOKEN) {
    return { token: env.ONEMAP_API_TOKEN };
  }
  return {
    error: "OneMap address search is not configured.",
    code: "missing_onemap_credentials",
  };
}

async function fetchOneMapSearch(oneMapUrl, token) {
  const response = await fetch(oneMapUrl.toString(), {
    headers: { Accept: "application/json", Authorization: token },
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function shouldRetryWithFreshToken(response, payload) {
  if (response.status === 401 || response.status === 403) {
    return true;
  }
  const message = summarizeOneMapError(payload);
  return typeof message === "string" && /token|auth|expired/i.test(message);
}

function hasRefreshCredentials(env) {
  return Boolean(env.ONEMAP_EMAIL && env.ONEMAP_PASSWORD);
}

function clearCachedOneMapToken() {
  cachedOneMapToken = null;
  cachedOneMapTokenExpiresAtMs = 0;
}

function summarizeOneMapError(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return payload.error || payload.message || payload.Message || payload.status_message || null;
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_RESPONSE_HEADERS,
  });
}
