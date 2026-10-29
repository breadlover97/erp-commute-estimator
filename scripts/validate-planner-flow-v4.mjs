import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadAppForTest } from './app-test-harness.mjs';
const data = {
  meta: { ratesEffectiveFrom: '2026-09-07' },
  groups: [{ id:'test',label:'Morning',gantryNos:['1'] }],
  gantries: [{groupId:'test',gantryNo:'1',center:[1.35,103.8],directionDegrees:180}],
  baseRates:[{groupId:'test',start:'08:45',end:'09:00',amount:3}],adjustments:[],
  calendar:{years:[2026,2027],publicHolidays:[],eveCutoffDates:[],uncertainEveDates:[]},
};
const context=await loadAppForTest(data);
const {api}=context;
vm.runInContext(`
  requireConfirmedAddress = async (type) => state.address[type];
  fetchDrivingRoutes = async (_start, _end, {onCandidates}) => { onCandidates([...globalThis.routes]); return globalThis.routes; };
  renderPlan = () => { globalThis.renders = (globalThis.renders || 0) + 1; };
  replaceUrlWithShareState = () => {};
  focusResultsAfterEstimate = () => { globalThis.focuses = (globalThis.focuses || 0) + 1; };
  searchPlanForZeroErp = async () => {};
`,context);
const points=[{lat:1.36,lng:103.8},{lat:1.34,lng:103.8}];
const route=api.buildRouteCandidate({points,totalMeters:2400,durationSeconds:1200,efficiencyScore:1200,providerRank:0});
const preserved=api.buildRouteCandidate({points:[{lat:1.36,lng:103.81},{lat:1.34,lng:103.81}],totalMeters:2800,durationSeconds:1800,efficiencyScore:1800,providerRank:0});
context.routes=[route];
api.state.address={start:{...points[0],label:'Start'},destination:{...points[1],label:'End'}};
api.els.date.value='2026-10-30';api.els.time.value='09:00';api.els.vehicleType.value='car';
api.els.arrivalBuffer.value='10';api.els.earlyFlexibility.value='30';
api.els.returnTrip.checked=true;api.els.returnDate.value='2026-10-30';api.els.returnTime.value='08:55';
api.state.timingRoutesToRestore={outbound:preserved};
const submit=vm.runInContext('handleRouteSubmit',context);
await submit({preventDefault(){}});
assert.ok(api.state.currentPlan,'A return after the buffered arrival is feasible even before the original requested deadline.');
assert.equal(api.state.currentPlan.requestedDate.toISOString(),'2026-10-30T01:00:00.000Z');
assert.equal(api.state.currentPlan.effectiveArrivalDate.toISOString(),'2026-10-30T00:50:00.000Z');
assert.equal(api.state.currentPlan.outbound[api.state.selectedRoutes.outbound].route,preserved,'Applying a timing suggestion keeps the same geometry even when it was absent from normal alternatives.');
assert.equal(api.state.currentPlan.outbound[api.state.selectedRoutes.outbound].trip.arrivalDate.toISOString(),'2026-10-30T00:50:00.000Z');
assert.equal(context.focuses,undefined,'Automatic recalculation does not collapse or scroll the editor.');
await submit({preventDefault(){},submitter:{}});
assert.equal(context.focuses,1,'An explicit Estimate action focuses mobile results.');
vm.runInContext('syncReturnDateIfBeforeDeparture()',context);
assert.equal(api.els.returnTime.value,'08:55','Return auto-adjustment respects the buffered arrival.');

api.state.currentPlan.returnDeparture=new Date('2026-11-08T17:00:00+08:00');
assert.doesNotThrow(()=>api.renderWeeklyEstimate(),'An unsupported weekly projection never breaks valid individual route results.');
assert.match(context.document.querySelector('#weekly-estimate-content').textContent,/unavailable for this return schedule/);
api.state.currentPlan.tripMode='one-way';
api.state.currentPlan.return=[];
api.state.currentPlan.requestedDate=new Date('2027-12-31T09:00:00+08:00');
api.renderWeeklyEstimate();
assert.match(context.document.querySelector('#weekly-estimate-content').innerHTML,/unverified historical rates or calendar rules/,'A week crossing beyond the holiday calendar is qualified.');
api.state.erpData=null;
api.state.locationRequestId=9;
api.applySavedCommute({startPoint:{...points[0],label:'Saved start'},endPoint:{...points[1],label:'Saved end'},time:'09:00',timeMode:'arrive',vehicleType:'car',arrivalBuffer:10,earlyFlexibility:15,tripMode:'return',returnTime:'17:00',returnDayOffset:1});
assert.equal(api.state.locationRequestId,10,'Saved-trip selection invalidates an older pending geolocation callback even while ERP data loads.');
assert.equal(api.state.autoEstimateOnReady,true);
assert.equal(api.els.arrivalBuffer.value,'10');
assert.equal(api.els.earlyFlexibility.value,'15');
assert.equal(new Date(api.els.returnDate.value)-new Date(api.els.date.value),86400000);
console.log('Planner flow validated: buffered return feasibility, route-preserving time application, no automatic mobile collapse, weekly error isolation/coverage and saved-trip geolocation cancellation.');
