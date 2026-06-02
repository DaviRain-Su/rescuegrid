import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const SAFETY_NEGATIVE_REQUIRED_CODES = [
  'OVER_BUDGET',
  'OVER_SLIPPAGE',
  'WRONG_POOL',
  'WRONG_AGENT',
  'MANDATE_MISMATCH',
  'POLICY_EXPIRED',
  'POLICY_REVOKED',
]

export const SAFETY_NEGATIVE_REQUIRED_ASSERTIONS = [
  'VAL-SAFETY-001',
  'VAL-SAFETY-002',
  'VAL-SAFETY-003',
  'VAL-SAFETY-005',
  'VAL-SAFETY-008',
]

function normalizedEvidence(row = {}) {
  const spendUnchanged = row.spend_unchanged === true || (
    row.spend_before != null &&
    row.spend_after != null &&
    String(row.spend_before) === String(row.spend_after)
  )
  const successActivityUnchanged = row.success_activity_unchanged === true || (
    row.success_activity_count_before != null &&
    row.success_activity_count_after != null &&
    Number(row.success_activity_count_before) === Number(row.success_activity_count_after)
  )
  const chainSuccessActivityCount = Number(row.chain_success_activity_count ?? 0)
  return {
    name: row.name || null,
    endpoint: row.endpoint || 'POST /api/execution/validate-plan',
    construction_path: row.construction_path || null,
    expected_code: row.expected_code || null,
    observed_code: row.observed_code || row.code || row.blocker_code || null,
    action: row.action || null,
    submitted: row.submitted === false ? false : row.submitted ?? null,
    execution_claimed: row.execution_claimed === true,
    spend_before: row.spend_before == null ? null : String(row.spend_before),
    spend_after: row.spend_after == null ? null : String(row.spend_after),
    spend_unchanged: spendUnchanged,
    success_activity_count_before: row.success_activity_count_before ?? null,
    success_activity_count_after: row.success_activity_count_after ?? null,
    success_activity_unchanged: successActivityUnchanged,
    chain_success_activity_count: Number.isFinite(chainSuccessActivityCount) ? chainSuccessActivityCount : null,
    chain_time_source: row.chain_time_source || null,
  }
}

export function buildSafetyNegativeReport({
  generatedAt = new Date().toISOString(),
  workerUrl = null,
  chain = 'sui:testnet',
  signerAddress = null,
  delegatedAgentAddress = null,
  activePolicy = null,
  expiringPolicy = null,
  revokeResolved = null,
  evidence = [],
} = {}) {
  const normalized = evidence.map(normalizedEvidence)
  const observedCodes = normalized.map((row) => row.observed_code).filter(Boolean)
  const missingCodes = SAFETY_NEGATIVE_REQUIRED_CODES.filter((code) => !observedCodes.includes(code))
  const allPreSubmission = normalized.every((row) => row.submitted === false)
  const allExecutionUnclaimed = normalized.every((row) => row.execution_claimed === false)
  const allSpendUnchanged = normalized.every((row) => row.spend_unchanged === true)
  const allSuccessActivityUnchanged = normalized.every((row) => row.success_activity_unchanged === true)
  const chainSuccessActivityTotal = normalized.reduce((sum, row) => sum + Number(row.chain_success_activity_count || 0), 0)
  const phase = missingCodes.length === 0 &&
    allPreSubmission &&
    allExecutionUnclaimed &&
    allSpendUnchanged &&
    allSuccessActivityUnchanged &&
    chainSuccessActivityTotal === 0
    ? 'pass'
    : 'failed'

  return {
    status: phase === 'pass' ? 'ok' : 'error',
    purpose: 'rescuegrid_safety_negative_report',
    phase,
    generated_at: generatedAt,
    chain,
    worker_url: workerUrl,
    signer_address: signerAddress,
    delegated_agent_address: delegatedAgentAddress,
    active_policy: activePolicy,
    expiring_policy: expiringPolicy,
    revoke_tx_digest: revokeResolved?.digest || null,
    revoke_tx: revokeResolved ? {
      digest: revokeResolved.digest || null,
      status: revokeResolved.effects?.status?.status ?? revokeResolved.status ?? null,
      checkpoint: revokeResolved.checkpoint ?? null,
      timestamp_ms: revokeResolved.timestampMs ? Number(revokeResolved.timestampMs) : null,
    } : null,
    assertions: SAFETY_NEGATIVE_REQUIRED_ASSERTIONS,
    required_codes: SAFETY_NEGATIVE_REQUIRED_CODES,
    validated_codes: observedCodes,
    missing_codes: missingCodes,
    all_pre_submission: allPreSubmission,
    all_execution_unclaimed: allExecutionUnclaimed,
    all_spend_unchanged: allSpendUnchanged,
    all_success_activity_unchanged: allSuccessActivityUnchanged,
    chain_success_activity_total: chainSuccessActivityTotal,
    evidence: normalized,
  }
}

export function writeSafetyNegativeReportArtifact(report, { outPath } = {}) {
  if (!outPath) throw new Error('outPath is required')
  const resolvedPath = resolve(String(outPath))
  const payload = `${JSON.stringify(report, null, 2)}\n`
  mkdirSync(dirname(resolvedPath), { recursive: true })
  writeFileSync(resolvedPath, payload, 'utf8')
  return {
    path: resolvedPath,
    format: 'json',
    bytes: Buffer.byteLength(payload),
  }
}
