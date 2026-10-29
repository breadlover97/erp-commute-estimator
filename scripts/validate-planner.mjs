import assert from 'node:assert/strict';
import { defaultTripTiming, singaporeClock, singaporeDateTime, singaporeDateValue, normalizeOneMapResults } from '../public/planner-utils.js';
import { onRequestGet } from '../functions/api/search.js';
assert.deepEqual(defaultTripTiming(new Date('2026-10-29T15:59:59Z')), {date:'2026-10-30',time:'09:00',mode:'arrive'});
assert.deepEqual(defaultTripTiming(new Date('2026-10-29T16:00:00Z')), {date:'2026-10-31',time:'09:00',mode:'arrive'});
assert.equal(defaultTripTiming(new Date('2026-12-31T10:00:00Z')).date,'2027-01-01');
assert.equal(singaporeClock(singaporeDateTime('2026-10-30','09:00')), '09:00');
assert.equal(singaporeDateValue(new Date('2026-10-29T17:00:00Z')), '2026-10-30');
const location = { LATITUDE:'1.332', LONGITUDE:'103.847', BUILDING:'TEST BUILDING', BLK_NO:'123', ROAD_NAME:'TEST ROAD', POSTAL:'123456' };
const results = normalizeOneMapResults({results:[location, location, {...location,LATITUDE:NaN}, {...location,LONGITUDE:'0'}]});
assert.equal(results.length,1);
assert.equal(results[0].label,'TEST BUILDING, 123 TEST ROAD, Singapore 123456');
assert.equal((await onRequestGet({request:new Request('https://example.com/api/search?q=ab'),env:{}})).status,400);
assert.equal((await onRequestGet({request:new Request('https://example.com/api/search?q=toa', {headers:{'Sec-Fetch-Site':'cross-site'}}),env:{}})).status,403);
const originalFetch=globalThis.fetch;
let calls=0;
globalThis.fetch=async (url,options)=>{
  calls++;
  assert.equal(new URL(url).searchParams.get('searchVal'),'123456');
  assert.equal(options.headers.Authorization,'test-token');
  return Response.json({results:[location]});
};
try {
  const request=new Request('https://example.com/api/search?q=123456');
  const response=await onRequestGet({request,env:{ONEMAP_API_TOKEN:'test-token'}});
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.equal(payload.results[0].lat,1.332);
  assert.ok(!JSON.stringify(payload).includes('test-token'));
  await onRequestGet({request,env:{ONEMAP_API_TOKEN:'test-token'}});
  assert.equal(calls,1,'Repeated searches reuse cached results');
} finally { globalThis.fetch=originalFetch; }
assert.equal((await onRequestGet({request:new Request('https://example.com/api/search?q=unconfigured'),env:{}})).status,503);
console.log('Planner and address-search validation passed');
