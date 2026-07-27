import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePublicOrigin, REQUIRED_ATTESTATIONS, validateAttestations, validateContactUrl } from "./release-readiness.mjs";

test("accepts an HTTPS origin and safe correction contacts", () => {
  assert.equal(normalizePublicOrigin("https://housing.example.com"), "https://housing.example.com");
  assert.equal(validateContactUrl("mailto:feedback@example.com"), "mailto:feedback@example.com");
  assert.equal(validateContactUrl("https://housing.example.com/contact"), "https://housing.example.com/contact");
});

test("rejects non-HTTPS site URLs and unsafe contacts", () => {
  assert.throws(() => normalizePublicOrigin("http://housing.example.com"), /HTTPS origin/);
  assert.throws(() => normalizePublicOrigin("https://housing.example.com/path"), /without a path/);
  assert.throws(() => validateContactUrl("javascript:alert(1)"), /https: or mailto:/);
  assert.throws(() => validateContactUrl("mailto:missing-address"), /email address/);
});

test("requires every device, browser, and legal attestation", () => {
  const complete = { schema_version: 1 };
  for (const key of REQUIRED_ATTESTATIONS) complete[key] = { verified_at: "2026-07-15T00:00:00.000Z", tester: "fixture", device_or_os: "fixture", version: "fixture", result: "passed" };
  assert.deepEqual(validateAttestations(complete), []);
  complete.iphone_wechat = null;
  assert.deepEqual(validateAttestations(complete), ["iphone_wechat attestation is missing"]);
});
