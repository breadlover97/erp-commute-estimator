import { writeFile } from "node:fs/promises";

const datasetId = "d_753090823cc9920ac41efaa6530c5893";
const pollUrl = `https://api-open.data.gov.sg/v1/public/api/datasets/${datasetId}/poll-download`;
const metaResponse = await fetch(pollUrl);

if (!metaResponse.ok) {
  throw new Error(`Failed to fetch data.gov.sg download metadata: ${metaResponse.status}`);
}

const downloadMeta = await metaResponse.json();
if (!downloadMeta?.data?.url) {
  throw new Error("Missing signed data.gov.sg download URL.");
}

const response = await fetch(downloadMeta.data.url);
if (!response.ok) {
  throw new Error(`Failed to fetch LTA gantry GeoJSON: ${response.status}`);
}

await writeFile(
  new URL("../data/lta-gantry.geojson", import.meta.url),
  await response.text(),
);

console.log("Saved data/lta-gantry.geojson");
