'use strict'

const { createHash } = require('node:crypto')
const {
  CONTROL_VALIDATOR_ID,
  MAX_VALIDATION_RECEIPT_MS,
  VALIDATION_RECEIPT_SCHEMA_VERSION,
  stableJson,
} = require('./validate-current.js')

function currentFingerprint(current) {
  return createHash('sha256').update(stableJson(current), 'utf8').digest('hex')
}

function describeValidator() {
  return {
    validator_id: CONTROL_VALIDATOR_ID,
    receipt_schema_version: VALIDATION_RECEIPT_SCHEMA_VERSION,
    max_receipt_validity_ms: MAX_VALIDATION_RECEIPT_MS,
  }
}

function buildValidationReceipt(current, now = Date.now()) {
  const validatedAt = new Date(now).toISOString()
  return {
    receipt_schema_version: VALIDATION_RECEIPT_SCHEMA_VERSION,
    validator_id: CONTROL_VALIDATOR_ID,
    validated_at: validatedAt,
    valid_until: new Date(now + MAX_VALIDATION_RECEIPT_MS).toISOString(),
    current_fingerprint: currentFingerprint(current),
    manifest_sha256: current.manifest_sha256,
    revocations_sha256: current.revocations_sha256,
    control_generation: current.control_generation,
    revocations_generation: current.revocations_generation,
  }
}

module.exports = { buildValidationReceipt, currentFingerprint, describeValidator }
