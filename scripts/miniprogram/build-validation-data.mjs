import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const outputPath = resolve(process.argv[2] || "../70城小程序技术验证/data/validation-data.js");
const dataRoot = resolve(root, "apps/web/public/data");
const manifest = JSON.parse(await readFile(resolve(dataRoot, "manifest.json"), "utf8"));
const cityPath = manifest.city_data_url_template.replace("{city_id}", "beijing").replace(/^\/data\//, "");
const cityData = JSON.parse(await readFile(resolve(dataRoot, cityPath), "utf8"));
const records = cityData.records
  .filter((record) => record.property_type === "new" && record.size_band === "all" && record.mom_change !== null)
  .sort((left, right) => left.stat_month.localeCompare(right.stat_month))
  .slice(-24)
  .map((record) => ({ month: record.stat_month, change: record.mom_change, index: record.mom_index }));

if (records.length !== 24) throw new Error(`Expected 24 validation records, received ${records.length}`);

const output = {
  cityId: "beijing",
  cityName: "北京",
  propertyType: "新房",
  metric: "环比",
  datasetAsOf: manifest.dataset_as_of,
  releaseDate: manifest.release_date,
  sourceUrl: manifest.latest_official_url,
  records,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `module.exports = ${JSON.stringify(output, null, 2)};\n`, "utf8");
console.log(`Generated ${records.length} real records at ${outputPath}`);
