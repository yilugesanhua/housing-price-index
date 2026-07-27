import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_ATTESTATIONS = [
  "android_wechat",
  "iphone_wechat",
  "chrome_current",
  "chrome_previous",
  "edge_current",
  "edge_previous",
  "safari_current",
  "safari_previous",
  "legal_review",
];

export function normalizePublicOrigin(value) {
  if (!value) throw new Error("VITE_PUBLIC_SITE_URL is required");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) throw new Error("VITE_PUBLIC_SITE_URL must be an HTTPS origin without a path, query, or hash");
  return url.origin;
}

export function validateContactUrl(value) {
  if (!value) throw new Error("VITE_CONTACT_URL is required");
  const url = new URL(value);
  if (url.protocol === "mailto:" && !url.pathname.includes("@")) throw new Error("mailto contact must contain an email address");
  if (url.protocol !== "mailto:" && url.protocol !== "https:") throw new Error("VITE_CONTACT_URL must use https: or mailto:");
  return value;
}

export function validateAttestations(value) {
  const errors = [];
  if (!value || typeof value !== "object" || value.schema_version !== 1) return ["release attestations schema_version must be 1"];
  for (const key of REQUIRED_ATTESTATIONS) {
    const item = value[key];
    if (!item || typeof item !== "object") {
      errors.push(`${key} attestation is missing`);
      continue;
    }
    if (item.result !== "passed") errors.push(`${key} result must be passed`);
    if (!Number.isFinite(Date.parse(item.verified_at))) errors.push(`${key} verified_at must be an ISO timestamp`);
    for (const field of ["tester", "device_or_os", "version"]) if (typeof item[field] !== "string" || !item[field].trim()) errors.push(`${key} ${field} is required`);
  }
  return errors;
}

async function validateBuiltSite(root, origin, contactUrl) {
  const errors = [];
  const dist = resolve(root, "apps", "web", "dist");
  const html = await readFile(resolve(dist, "index.html"), "utf8");
  if (!html.includes(`property="og:url" content="${origin}/"`)) errors.push("built og:url is not the configured absolute HTTPS URL");
  if (!html.includes(`property="og:image" content="${origin}/share-card.png"`)) errors.push("built og:image is not the configured absolute HTTPS URL");
  if (!html.includes(`rel="canonical" href="${origin}/"`)) errors.push("built canonical URL is not the configured absolute HTTPS URL");

  const png = await readFile(resolve(dist, "share-card.png"));
  if (png.length < 24 || png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) errors.push("share-card.png must be 1200x630");

  const assets = await readdir(resolve(dist, "assets"));
  const scripts = assets.filter((name) => name.endsWith(".js"));
  const scriptContents = await Promise.all(scripts.map((name) => readFile(resolve(dist, "assets", name), "utf8")));
  if (!scriptContents.some((content) => content.includes(contactUrl))) errors.push("built application does not contain the configured correction contact URL");

  const manifest = JSON.parse(await readFile(resolve(dist, "data", "manifest.json"), "utf8"));
  if (manifest.validation_status !== "passed" || manifest.data_status !== "current") errors.push("release data manifest must be passed and current");
  return errors;
}

export async function runReleaseReadiness({ root = process.cwd(), env = process.env } = {}) {
  const errors = [];
  if (env.VITE_APP_ENV !== "public") errors.push("VITE_APP_ENV must be public for a release build");
  let origin;
  let contactUrl;
  try { origin = normalizePublicOrigin(env.VITE_PUBLIC_SITE_URL); } catch (error) { errors.push(error.message); }
  try { contactUrl = validateContactUrl(env.VITE_CONTACT_URL); } catch (error) { errors.push(error.message); }

  const attestationPath = resolve(root, env.RELEASE_ATTESTATIONS_PATH || "release/attestations.json");
  try {
    errors.push(...validateAttestations(JSON.parse(await readFile(attestationPath, "utf8"))));
  } catch (error) {
    errors.push(`cannot read release attestations: ${error.message}`);
  }
  if (origin && contactUrl) {
    try { errors.push(...await validateBuiltSite(root, origin, contactUrl)); } catch (error) { errors.push(`cannot validate built site: ${error.message}`); }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = await runReleaseReadiness();
  if (errors.length > 0) {
    console.error("Release readiness failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Release readiness passed: public metadata, contact, data, share image, browser/device checks, and legal review are all recorded.");
  }
}
