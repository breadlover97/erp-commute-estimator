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

const erpKmlResponse = await fetch("https://onemotoring.lta.gov.sg/mapapp/kml/erp-kml/erp-kml-0.kml");
if (!erpKmlResponse.ok) {
  throw new Error(`Failed to fetch OneMotoring ERP KML: ${erpKmlResponse.status}`);
}

await writeFile(
  new URL("../data/onemotoring-erp.kml", import.meta.url),
  await erpKmlResponse.text(),
);

console.log("Saved data/lta-gantry.geojson");
console.log("Saved data/onemotoring-erp.kml");
