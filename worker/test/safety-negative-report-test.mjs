import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildSafetyNegativeReport,
  SAFETY_NEGATIVE_REQUIRED_CODES,
  writeSafetyNegativeReportArtifact,
} from '../scripts/safety-negative-report.mjs'

function evidence(code, overrides = {}) {
  return {
    name: code.toLowerCase().replaceAll('_', '-'),
    expected_code: code,
    observed_code: code,
    action: 'blocked',
    submitted: false,
    execution_claimed: false,
    spend_before: '0',
    spend_after: '0',
    success_activity_count_before: 0,
    success_activity_count_after: 0,
    chain_success_activity_count: 0,
    ...overrides,
  }
}

function fullEvidence(overrides = {}) {
  return SAFETY_NEGATIVE_REQUIRED_CODES.map((code) => evidence(code, overrides[code]))
}

const pass = buildSafetyNegativeReport({
  generatedAt: '2026-06-03T00:00:00.000Z',
  workerUrl: 'http://localhost:8787',
  signerAddress: '0xowner',
  delegatedAgentAddress: '0xagent',
  activePolicy: { wrapper_id: '0xactive', mandate_id: '0xmandate' },
  expiringPolicy: { wrapper_id: '0xexpired', mandate_id: '0xexpiredmandate' },
  revokeResolved: {
    digest: 'revokeDigest',
    checkpoint: '42',
    timestampMs: '1760000000000',
    effects: { status: { status: 'success' } },
  },
  evidence: fullEvidence(),
})

assert.equal(pass.purpose, 'rescuegrid_safety_negative_report')
assert.equal(pass.phase, 'pass')
assert.equal(pass.status, 'ok')
assert.deepEqual(pass.missing_codes, [])
assert.equal(pass.all_pre_submission, true)
assert.equal(pass.all_execution_unclaimed, true)
assert.equal(pass.all_spend_unchanged, true)
assert.equal(pass.all_success_activity_unchanged, true)
assert.equal(pass.chain_success_activity_total, 0)
assert.equal(pass.validated_codes.includes('POLICY_REVOKED'), true)
assert.equal(pass.assertions.includes('VAL-SAFETY-008'), true)

const missing = buildSafetyNegativeReport({
  evidence: fullEvidence().filter((row) => row.observed_code !== 'POLICY_REVOKED'),
})
assert.equal(missing.phase, 'failed')
assert.deepEqual(missing.missing_codes, ['POLICY_REVOKED'])

const mutated = buildSafetyNegativeReport({
  evidence: fullEvidence({
    OVER_BUDGET: { spend_after: '1' },
  }),
})
assert.equal(mutated.phase, 'failed')
assert.equal(mutated.all_spend_unchanged, false)

const submitted = buildSafetyNegativeReport({
  evidence: fullEvidence({
    WRONG_POOL: { submitted: true },
  }),
})
assert.equal(submitted.phase, 'failed')
assert.equal(submitted.all_pre_submission, false)

const artifactDir = mkdtempSync(join(tmpdir(), 'rescuegrid-safety-negative-report-'))
try {
  const artifactPath = join(artifactDir, 'safety-negative-report.json')
  const artifact = writeSafetyNegativeReportArtifact(pass, { outPath: artifactPath })
  assert.equal(artifact.path, artifactPath)
  assert.equal(artifact.format, 'json')
  assert(artifact.bytes > 900)
  const body = readFileSync(artifactPath, 'utf8')
  assert.match(body, /rescuegrid_safety_negative_report/)
  assert.match(body, /OVER_BUDGET/)
  assert.match(body, /POLICY_REVOKED/)
  assert.equal(body.includes('AGENT_KEY='), false)
  assert.equal(body.includes('INTERNAL_AGENT_TICK_TOKEN='), false)
  assert.equal(body.includes('WAAP_PERMISSION_TOKEN='), false)
} finally {
  rmSync(artifactDir, { recursive: true, force: true })
}

console.log('\nALL SAFETY NEGATIVE REPORT TESTS PASS')
