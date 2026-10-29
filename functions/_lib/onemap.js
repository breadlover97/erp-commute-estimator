const AUTH_ENDPOINT = "https://www.onemap.gov.sg/api/auth/post/getToken";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
let cachedToken = null;
let cachedExpiry = 0;
let cachedEmail = null;
let cachedPassword = null;

// Only immutable token data is shared between requests, never request-owned I/O.
export async function getOneMapToken(env, { signal, forceRefresh = false } = {}) {
  if (!env.ONEMAP_EMAIL || !env.ONEMAP_PASSWORD) {
    if (env.ONEMAP_API_TOKEN) return { token: env.ONEMAP_API_TOKEN };
    return { code: "missing_onemap_credentials", error: "OneMap is not configured." };
  }
  const now = Date.now();
  if (!forceRefresh && cachedToken && cachedEmail === env.ONEMAP_EMAIL &&
      cachedPassword === env.ONEMAP_PASSWORD && cachedExpiry - REFRESH_BUFFER_MS > now) {
    return { token: cachedToken };
  }
  const response = await fetch(AUTH_ENDPOINT, {
    method: "POST",
    signal,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ email: env.ONEMAP_EMAIL, password: env.ONEMAP_PASSWORD }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || typeof payload?.access_token !== "string" || !payload.access_token) {
    cachedToken = null;
    cachedExpiry = 0;
    return { code: "onemap_auth_failed", error: "OneMap authentication failed." };
  }
  cachedToken = payload.access_token;
  cachedEmail = env.ONEMAP_EMAIL;
  cachedPassword = env.ONEMAP_PASSWORD;
  const expiry = Number(payload.expiry_timestamp) * 1000;
  cachedExpiry = Number.isFinite(expiry) && expiry > now ? expiry : now + 60 * 60 * 1000;
  return { token: cachedToken };
}

export async function fetchOneMapJson(url, { env, fetchOptions = {}, signal, timeoutMs = 4800 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let token = await getOneMapToken(env, { signal: controller.signal });
    if (!token.token) {
      return { response: new Response(null, { status: 503 }), payload: token };
    }
    const request = async () => {
      const response = await fetch(String(url), {
        ...fetchOptions,
        signal: controller.signal,
        headers: { Accept: "application/json", ...fetchOptions.headers, Authorization: token.token },
      });
      const payload = await response.json().catch(() => null);
      return { response, payload };
    };
    let result = await request();
    const message = result.payload?.error || result.payload?.message || result.payload?.Message || "";
    const invalidToken = [401, 403].includes(result.response.status) || /token.*(?:expired|invalid)|(?:expired|invalid).*token/i.test(String(message));
    if (invalidToken && env.ONEMAP_EMAIL && env.ONEMAP_PASSWORD) {
      token = await getOneMapToken(env, { forceRefresh: true, signal: controller.signal });
      if (token.token) result = await request();
    }
    return result;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
