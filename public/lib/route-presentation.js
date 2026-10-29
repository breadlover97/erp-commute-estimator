import { isSingaporePoint } from "../planner-utils.js";

// Presentation pruning happens only after ERP evaluation. A free option must
// never disappear just because its geometry resembles a charged route.
export function chooseRouteChoices(options, selectedIndex = 0) {
  if (!options.length) return { primary: [], more: [], fastest: null, free: null };
  const ordered = [...options].sort((a, b) => a.route.durationSeconds - b.route.durationSeconds || a.trip.total - b.trip.total);
  const unique = ordered.filter((option, index) => !ordered.slice(0, index).some((previous) => sameJourney(previous, option)));
  const fastest = ordered[0];
  const free = ordered.find((option) => option.trip.total === 0);
  const primary = [fastest, free].filter((option, index, list) => option && list.indexOf(option) === index);
  const middle = unique.find((option) => option.trip.total > 0 && option.trip.total < fastest.trip.total &&
    (!free || option.route.durationSeconds < free.route.durationSeconds));
  if (middle && !primary.includes(middle)) primary.push(middle);
  const selected = options.find((option) => option.index === selectedIndex);
  const more = unique.filter((option) => !primary.includes(option));
  if (selected && !primary.includes(selected) && !more.includes(selected)) more.push(selected);
  return { primary, more, fastest, free };
}

function sameJourney(a, b) {
  if (a.trip.total !== b.trip.total || Math.abs(a.route.totalMeters - b.route.totalMeters) > 150) return false;
  const charges = (option) => (option.trip.entries || []).map((entry) => [entry.groupId, entry.amount]);
  return JSON.stringify(charges(a)) === JSON.stringify(charges(b)) && geometryKey(a.route) === geometryKey(b.route);
}

function geometryKey(route) {
  const points = route.points || [];
  const cumulative = route.cumulativeMeters;
  if (points.length < 2 || !cumulative?.length) return JSON.stringify(points);
  const total = cumulative.at(-1);
  let end = 1;
  return Array.from({ length: 17 }, (_, index) => {
    const distance = total * index / 16;
    while (end < points.length - 1 && cumulative[end] < distance) end++;
    const span = cumulative[end] - cumulative[end - 1];
    const ratio = span ? (distance - cumulative[end - 1]) / span : 0;
    const a = points[end - 1], b = points[end];
    return [(a.lat + (b.lat - a.lat) * ratio).toFixed(4), (a.lng + (b.lng - a.lng) * ratio).toFixed(4)];
  }).join("|");
}

export function googleMapsDirectionsUrl(start, end) {
  if (!isSingaporePoint(start) || !isSingaporePoint(end)) throw new Error("Choose valid start and destination locations.");
  const url = new URL("https://www.google.com/maps/dir/");
  url.search = new URLSearchParams({ api: "1", origin: `${start.lat},${start.lng}`, destination: `${end.lat},${end.lng}`, travelmode: "driving" }).toString();
  return url.toString();
}

export function steppedTime(clock, delta) {
  const [hours, minutes] = clock.split(":").map(Number);
  const next = ((hours * 60 + minutes + delta) % 1440 + 1440) % 1440;
  return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
}
