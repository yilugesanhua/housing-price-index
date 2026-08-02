import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const {
  CONTROL_VALIDATOR_ID,
  MAX_VALIDATION_RECEIPT_MS,
  VALIDATION_RECEIPT_SCHEMA_VERSION,
} = require(resolve(root, 'apps/miniprogram/cloudfunctions/getHousingDataManifest/validate-current.js'))
const { buildValidationReceipt, describeValidator } = require(resolve(root, 'apps/miniprogram/cloudfunctions/getHousingDataManifest/validation-receipt.js'))
const { validateValidationReceipt } = require(resolve(root, 'apps/miniprogram/utils/data-runtime.js'))

const issuedAt = Date.parse('2026-07-31T01:30:00.000Z')
const current = Object.freeze({
  control_generated_at: '2026-07-29T03:17:46.325Z',
  manifest_sha256: 'a'.repeat(64),
  revocations_sha256: 'b'.repeat(64),
  control_generation: 1,
  revocations_generation: 1,
  dataset_version: '2026-06-e9788d0bddf3',
})

test('validator identity can be checked before any control-plane write', () => {
  assert.deepEqual(describeValidator(), {
    validator_id: CONTROL_VALIDATOR_ID,
    receipt_schema_version: VALIDATION_RECEIPT_SCHEMA_VERSION,
    max_receipt_validity_ms: MAX_VALIDATION_RECEIPT_MS,
  })
})

test('strict cloud validation receipt has an exact identity-bound ten-minute window', () => {
  const receipt = buildValidationReceipt(current, issuedAt)
  assert.deepEqual(Object.keys(receipt).sort(), [
    'control_generation',
    'current_fingerprint',
    'manifest_sha256',
    'receipt_schema_version',
    'revocations_generation',
    'revocations_sha256',
    'valid_until',
    'validated_at',
    'validator_id',
  ])
  assert.equal(receipt.receipt_schema_version, VALIDATION_RECEIPT_SCHEMA_VERSION)
  assert.equal(receipt.validator_id, CONTROL_VALIDATOR_ID)
  assert.equal(Date.parse(receipt.valid_until) - Date.parse(receipt.validated_at), MAX_VALIDATION_RECEIPT_MS)
  assert.equal(validateValidationReceipt(receipt, current, issuedAt).activationAuthorized, true)
  assert.equal(validateValidationReceipt(receipt, current, issuedAt + MAX_VALIDATION_RECEIPT_MS).activationAuthorized, false)
})

test('receipt identity, validator, generations, and time window all fail closed when changed', () => {
  const receipt = buildValidationReceipt(current, issuedAt)
  for (const [label, mutate] of [
    ['validator', (value) => { value.validator_id = 'legacy-validator' }],
    ['current', (value) => { value.current_fingerprint = 'c'.repeat(64) }],
    ['manifest', (value) => { value.manifest_sha256 = 'd'.repeat(64) }],
    ['revocations', (value) => { value.revocations_sha256 = 'e'.repeat(64) }],
    ['generation', (value) => { value.control_generation += 1 }],
    ['window', (value) => { value.valid_until = new Date(issuedAt + MAX_VALIDATION_RECEIPT_MS + 1).toISOString() }],
  ]) {
    const changed = structuredClone(receipt)
    mutate(changed)
    assert.throws(() => validateValidationReceipt(changed, current, issuedAt), Error, label)
  }
})
