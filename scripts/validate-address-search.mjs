import assert from "node:assert/strict";

import {
  confirmedAddressFromSharedParams,
  createConfirmedAddress,
  isSingaporePostalCode,
  normalizeOneMapAddressResults,
} from "../public/address-search.js";
import { onRequestGet } from "../functions/api/addresses/onemap.js";

const oneMapPayload = {
  found: 3,
  results: [
    {
      ADDRESS: "838 YISHUN STREET 81 SARASWATHY DARMA MUNEESWARAN KINDERGARTEN SINGAPORE 760838",
      BLK_NO: "838",
      ROAD_NAME: "YISHUN STREET 81",
      BUILDING: "SARASWATHY DARMA MUNEESWARAN KINDERGARTEN",
      POSTAL: "760838",
      LATITUDE: "1.41642178701227",
      LONGITUDE: "103.833559766776",
    },
    {
      ADDRESS: "838 YISHUN STREET 81 SINGAPORE 760838",
      BLK_NO: "838",
      ROAD_NAME: "YISHUN STREET 81",
      BUILDING: "NIL",
      POSTAL: "760838",
      LATITUDE: "1.41642178701227",
      LONGITUDE: "103.833559766776",
    },
    {
      ADDRESS: "839 YISHUN STREET 81 SINGAPORE 760839",
      BLK_NO: "839",
      ROAD_NAME: "YISHUN STREET 81",
      BUILDING: "NIL",
      POSTAL: "760839",
      LATITUDE: "1.4159",
      LONGITUDE: "103.8331",
    },
  ],
};

assert.equal(isSingaporePostalCode("760838"), true);
assert.equal(isSingaporePostalCode("76083"), false);
assert.equal(isSingaporePostalCode("Yishun"), false);

const suggestions = normalizeOneMapAddressResults(oneMapPayload, "760838", 5);
assert.equal(suggestions.length, 2, "postal lookup should exclude non-matching postal codes");
assert.deepEqual(suggestions[0], {
  lat: 1.41642178701227,
  lng: 103.833559766776,
  label: "838 Yishun St 81 Singapore 760838",
  source: "onemap",
});

const confirmed = createConfirmedAddress(suggestions[0]);
assert.equal(confirmed.inputValue, "838 Yishun St 81 Singapore 760838");
assert.equal(confirmed.label, confirmed.inputValue);
assert.equal(createConfirmedAddress(suggestions[0], "760838").inputValue, "760838");

assert.deepEqual(normalizeOneMapAddressResults({ results: [] }, "760838"), []);
assert.deepEqual(
  normalizeOneMapAddressResults(
    {
      results: [
        {
          ADDRESS: "839 YISHUN STREET 81 SINGAPORE 760839",
          POSTAL: "760839",
          LATITUDE: "1.4159",
          LONGITUDE: "103.8331",
        },
      ],
    },
    "760838",
  ),
  [],
  "an exact postal lookup must not suggest a neighbouring postal code",
);
assert.throws(
  () => createConfirmedAddress({ lat: 0, lng: 0, label: "Invalid" }),
  /Singapore coordinates/,
);

const validSharedAddress = confirmedAddressFromSharedParams(
  new URLSearchParams({ slat: "1.41642178701227", slng: "103.833559766776", slabel: "838 Yishun St 81" }),
  "s",
);
assert.equal(validSharedAddress?.label, "838 Yishun St 81");
assert.equal(
  confirmedAddressFromSharedParams(
    new URLSearchParams({ slat: "0", slng: "0", slabel: "Invalid shared address" }),
    "s",
  ),
  null,
  "invalid or legacy shared coordinates should be ignored without aborting initialization",
);

const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;
const outboundRequests = [];
const cacheEntries = new Map();
globalThis.caches = {
  default: {
    async match(request) {
      return cacheEntries.get(request.url)?.clone();
    },
    async put(request, response) {
      cacheEntries.set(request.url, response.clone());
    },
  },
};
globalThis.fetch = async (url, options = {}) => {
  outboundRequests.push({ url: String(url), options });
  if (String(url).includes("/api/auth/post/getToken")) {
    return Response.json({ access_token: "test-token", expiry_timestamp: 4102444800 });
  }
  assert.equal(options.headers.Authorization, "test-token");
  const searchUrl = new URL(url);
  assert.equal(searchUrl.searchParams.get("searchVal"), "760838");
  assert.equal(searchUrl.searchParams.get("returnGeom"), "Y");
  assert.equal(searchUrl.searchParams.get("getAddrDetails"), "Y");
  return Response.json(oneMapPayload);
};

try {
  const cacheWrites = [];
  const proxyResponse = await onRequestGet({
    request: new Request("https://example.com/api/addresses/onemap?q=760838", {
      headers: { "Sec-Fetch-Site": "same-origin" },
    }),
    env: { ONEMAP_EMAIL: "test@example.com", ONEMAP_PASSWORD: "test-password" },
    waitUntil(promise) {
      cacheWrites.push(promise);
    },
  });
  assert.equal(proxyResponse.status, 200);
  const proxyPayload = await proxyResponse.json();
  assert.equal(proxyPayload.found, 3);
  assert.equal(proxyPayload.results.length, 3);
  assert.equal(outboundRequests.length, 2, "proxy should authenticate and search once");
  await Promise.all(cacheWrites);

  const cachedProxyResponse = await onRequestGet({
    request: new Request("https://example.com/api/addresses/onemap?q=760838", {
      headers: { "Sec-Fetch-Site": "same-origin" },
    }),
    env: {},
  });
  assert.equal(cachedProxyResponse.status, 200);
  assert.equal(outboundRequests.length, 2, "edge-cache hit should not call OneMap again");

  const crossSiteResponse = await onRequestGet({
    request: new Request("https://example.com/api/addresses/onemap?q=760838", {
      headers: { "Sec-Fetch-Site": "cross-site" },
    }),
    env: {},
  });
  assert.equal(crossSiteResponse.status, 403);

  const invalidQueryResponse = await onRequestGet({
    request: new Request("https://example.com/api/addresses/onemap?q=Yishun", {
      headers: { "Sec-Fetch-Site": "same-origin" },
    }),
    env: {},
  });
  assert.equal(invalidQueryResponse.status, 400);

} finally {
  globalThis.fetch = originalFetch;
  if (originalCaches === undefined) {
    delete globalThis.caches;
  } else {
    globalThis.caches = originalCaches;
  }
}

console.log("OneMap address search validation passed");
