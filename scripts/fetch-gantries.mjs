import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Download only the explicitly reviewed source versions. Advancing a source URL
// or verifiedOn requires reviewing LTA's release, PDF and calendar together.
const manifestUrl = new URL("../data/sources.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const keys = ["oneMotoringErpRatesPdf", "ltaGantryGeoJson", "oneMotoringErpKml"];
const downloads = await Promise.all(keys.map(async (key) => {
  const source = manifest.sources[key];
  const response = await fetch(source.url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${key}: download failed (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const header = bytes.subarray(0, 120).toString();
  const expected = source.file.endsWith(".pdf") ? "%PDF-" : source.file.endsWith(".zip") ? "PK" : "<?xml";
  if (!header.startsWith(expected)) throw new Error(`${key}: expected ${expected} file, received unexpected content`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== source.sha256) {
    throw new Error(`${key}: source changed since verification; review the new source before updating sources.json`);
  }
  return { source, bytes };
}));
for (const { source, bytes } of downloads) {
  await writeFile(new URL(`../data/${source.file}`, import.meta.url), bytes);
  console.log(`Verified and saved data/${source.file}`);
}
console.log("Run python3 scripts/convert-gantries.py, then python3 scripts/build-data.py and npm run validate:data.");
