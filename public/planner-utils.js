const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1000;

export function singaporeDateValue(date = new Date()) {
  return new Date(date.getTime() + SINGAPORE_OFFSET_MS).toISOString().slice(0, 10);
}

export function singaporeClock(date) {
  return new Date(date.getTime() + SINGAPORE_OFFSET_MS).toISOString().slice(11, 16);
}

export function singaporeDateTime(date, time = "00:00") {
  return new Date(`${date}T${time}:00+08:00`);
}

export function relativeSingaporeDate(days, now = new Date()) {
  return singaporeDateValue(new Date(now.getTime() + days * 86400000));
}

export function defaultTripTiming(now = new Date()) {
  return { date: relativeSingaporeDate(1, now), time: "09:00", mode: "arrive" };
}

export function isSingaporePoint(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng)
    && point.lat >= 1.13 && point.lat <= 1.49 && point.lng >= 103.58 && point.lng <= 104.12;
}

export function displayTime(clock) {
  const [hour, minute] = clock.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

export function normalizeOneMapResults(payload, limit = 5) {
  const seen = new Set();
  return (Array.isArray(payload?.results) ? payload.results : []).flatMap((result) => {
    const lat = Number(result.LATITUDE);
    const lng = Number(result.LONGITUDE);
    if (!isSingaporePoint({ lat, lng })) return [];
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const building = result.BUILDING && result.BUILDING !== "NIL" ? result.BUILDING : "";
    const street = [result.BLK_NO, result.ROAD_NAME].filter((part) => part && part !== "NIL").join(" ");
    const postal = /^\d{6}$/.test(result.POSTAL) ? `Singapore ${result.POSTAL}` : "Singapore";
    const label = [building, street, postal].filter(Boolean).join(", ");
    return [{ lat, lng, label: label || result.ADDRESS, postal: result.POSTAL }];
  }).slice(0, limit);
}
