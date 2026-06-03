#!/usr/bin/env node
// Verify provider-supplied funding transaction digests plus current execution
// readiness. This script is read-only: it never signs, submits, or prints keys.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { requireChainDataProvider } from '../src/chain-data-provider.js'
import { buildExecutionReadiness } from '../src/execution-readiness.js'
import { DEPLOYMENT, getClient } from '../src/sui-tx.js'
import { buildFundingHandoff, fundingHandoffEnv } from './funding-handoff.mjs'

const TX_FLAGS = new Map([
  ['--tx', 'provider_funding_tx'],
  ['--digest', 'provider_funding_tx'],
  ['--dbusdc-tx', 'dbusdc_funding_tx'],
  ['--deep-tx', 'deep_funding_tx'],
  ['--sui-gas-tx', 'sui_gas_funding_tx'],
])

function firstValue(...values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') return String(value)
  }
  return undefined
}

function requestedThresholds(flags) {
  return {
    dbusdc_threshold: firstValue(flags.get('--dbusdc-threshold'), flags.get('--required-dbusdc-balance'), flags.get('--required-dbusdc')),
    deep_threshold: firstValue(flags.get('--deep-threshold'), flags.get('--required-deep-balance'), flags.get('--required-deep')),
    sui_gas_threshold: firstValue(flags.get('--sui-gas-threshold'), flags.get('--required-sui-gas-mist'), flags.get('--required-sui-gas')),
  }
}

function setFlag(flags, key, value = 'true') {
  const normalized = String(key || '').trim()
  if (!normalized) return
  flags.set(normalized, value == null ? 'true' : String(value))
}

export function parseFundingProofArgs(argv = process.argv.slice(2)) {
  const flags = new Map()
  const txDigests = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const [key, inlineValue] = arg.split('=')
    let value = inlineValue
    if (value == null) {
      const nextValue = argv[i + 1]
      if (nextValue && !nextValue.startsWith('--')) {
        value = nextValue
        i += 1
      } else {
        value = 'true'
      }
    }
    if (TX_FLAGS.has(key)) {
      if (value && value !== 'true') txDigests.push({ role: TX_FLAGS.get(key), digest: String(value) })
    } else {
      setFlag(flags, key, value)
    }
  }
  return { flags, txDigests }
}

export function fundingProofOptions(parsed = parseFundingProofArgs()) {
  const flags = parsed.flags || new Map()
  return {
    format: String(flags.get('--format') || (flags.has('--json') ? 'json' : 'json')).toLowerCase(),
    outPath: firstValue(flags.get('--out'), flags.get('--output'), flags.get('--report-out')),
    requested: requestedThresholds(flags),
    txDigests: parsed.txDigests || [],
  }
}

function ownerKind(owner) {
  if (!owner) return null
  if (typeof owner === 'string') return owner
  if (owner.AddressOwner) return 'AddressOwner'
  if (owner.ObjectOwner) return 'ObjectOwner'
  if (owner.Shared) return 'Shared'
  if (owner.Immutable) return 'Immutable'
  return Object.keys(owner)[0] || null
}

function ownerValue(owner) {
  if (!owner || typeof owner === 'string') return owner || null
  return owner.AddressOwner || owner.ObjectOwner || owner.Shared?.initial_shared_version || owner.Immutable || null
}

function sanitizeBalanceChange(row = {}) {
  return {
    coin_type: row.coinType || row.coin_type || null,
    amount: String(row.amount ?? ''),
    owner_kind: ownerKind(row.owner),
    owner: ownerValue(row.owner),
  }
}

function moveCallObject(value) {
  if (!value || typeof value !== 'object') return null
  if (value.MoveCall) return value.MoveCall
  if (value.$kind === 'MoveCall') return value
  return null
}

function moveCallDescriptor(value) {
  const call = moveCallObject(value)
  if (!call) return null
  const pkg = call.package || call.Package || call.packageId || call.package_id || null
  const module = call.module || call.Module || null
  const fn = call.function || call.Function || null
  if (!pkg || !module || !fn) return null
  return {
    target: `${pkg}::${module}::${fn}`,
    package: pkg,
    module,
    function: fn,
    type_arguments: (call.type_arguments || call.typeArguments || call.TypeArguments || []).map(String),
  }
}

function collectMoveCalls(value, out = [], seen = new Set()) {
  if (!value || typeof value !== 'object') return out
  if (seen.has(value)) return out
  seen.add(value)
  const descriptor = moveCallDescriptor(value)
  if (descriptor) out.push(descriptor)
  if (Array.isArray(value)) {
    for (const item of value) collectMoveCalls(item, out, seen)
    return out
  }
  for (const item of Object.values(value)) collectMoveCalls(item, out, seen)
  return out
}

function normalizeSuiId(value) {
  return String(value || '').trim().toLowerCase()
}

function objectChangeObjectId(row = {}) {
  return row.objectId || row.object_id || row.object?.objectId || row.object?.object_id || row.reference?.objectId || null
}

function positiveAmount(value) {
  try {
    return BigInt(String(value || '0')) > 0n
  } catch {
    return false
  }
}

const FUNDING_ASSETS = Object.freeze({
  DBUSDC: DEPLOYMENT.deepbook.dbusdc_coin_type,
  DEEP: DEPLOYMENT.deepbook.deep_coin_type,
  SUI_MIST: '0x2::sui::SUI',
})

function fundingAssetHits({ balanceChanges = [], moveCalls = [] } = {}) {
  const hits = []
  for (const [asset, coinType] of Object.entries(FUNDING_ASSETS)) {
    const balanceHit = balanceChanges.some((row) => row.coin_type === coinType)
    const callHit = moveCalls.some((row) => row.type_arguments?.includes(coinType))
    if (balanceHit || callHit) {
      hits.push({
        asset,
        coin_type: coinType,
        observed_in_balance_changes: balanceHit,
        observed_in_move_call_type_arguments: callHit,
      })
    }
  }
  return hits
}

function fundingTargetEvidence({ balanceChanges = [], moveCalls = [], objectChanges = [] } = {}) {
  const balanceManagerId = normalizeSuiId(DEPLOYMENT.agent.balance_manager_id)
  const agentAddress = normalizeSuiId(DEPLOYMENT.agent.address)
  const objectRows = Array.isArray(objectChanges) ? objectChanges : []
  const objectChangeIds = objectRows.map(objectChangeObjectId).filter(Boolean)
  const balanceManagerObjectTouched = objectChangeIds.some((id) => normalizeSuiId(id) === balanceManagerId) ||
    balanceChanges.some((row) => normalizeSuiId(row.owner) === balanceManagerId)
  const agentGasAddressTouched = balanceChanges.some((row) => (
    row.coin_type === FUNDING_ASSETS.SUI_MIST &&
    row.owner_kind === 'AddressOwner' &&
    normalizeSuiId(row.owner) === agentAddress &&
    positiveAmount(row.amount)
  ))
  const hits = fundingAssetHits({ balanceChanges, moveCalls })
  const assetHit = (asset) => hits.some((row) => row.asset === asset)
  const assetTargetHits = [
    assetHit('DBUSDC') && balanceManagerObjectTouched ? {
      asset: 'DBUSDC',
      target_kind: 'deepbook_balance_manager',
      target: DEPLOYMENT.agent.balance_manager_id,
    } : null,
    assetHit('DEEP') && balanceManagerObjectTouched ? {
      asset: 'DEEP',
      target_kind: 'deepbook_balance_manager',
      target: DEPLOYMENT.agent.balance_manager_id,
    } : null,
    agentGasAddressTouched ? {
      asset: 'SUI_MIST',
      target_kind: 'agent_gas_address',
      target: DEPLOYMENT.agent.address,
    } : null,
  ].filter(Boolean)
  return {
    required: true,
    target_evidence_passed: assetTargetHits.length > 0,
    balance_manager_id: DEPLOYMENT.agent.balance_manager_id,
    agent_address: DEPLOYMENT.agent.address,
    balance_manager_object_touched: balanceManagerObjectTouched,
    agent_gas_address_touched: agentGasAddressTouched,
    asset_target_hits: assetTargetHits,
  }
}

function txStatus(effects = {}) {
  const status = effects.status
  if (typeof status === 'string') return status
  return status?.status || null
}

export async function verifyFundingTransaction({ digest, role = 'provider_funding_tx', client = getClient() } = {}) {
  const cleanDigest = String(digest || '').trim()
  if (!cleanDigest) {
    return {
      role,
      digest: null,
      status: 'failed',
      passed: false,
      code: 'FUNDING_TX_DIGEST_MISSING',
      detail: 'funding transaction digest is required',
    }
  }
  try {
    const tx = await client.getTransactionBlock({
      digest: cleanDigest,
      options: {
        showEffects: true,
        showEvents: true,
        showBalanceChanges: true,
        showInput: true,
        showObjectChanges: true,
      },
    })
    const effectStatus = txStatus(tx.effects)
    const balanceChanges = (tx.balanceChanges || []).map(sanitizeBalanceChange)
    const moveCalls = collectMoveCalls(tx.transaction?.data?.transaction || tx.transaction || [])
    const objectChanges = tx.objectChanges || []
    const passed = effectStatus === 'success'
    return {
      role,
      digest: tx.digest || cleanDigest,
      status: passed ? 'passed' : 'failed',
      passed,
      code: passed ? null : 'FUNDING_TX_NOT_SUCCESSFUL',
      effect_status: effectStatus,
      checkpoint: tx.checkpoint || null,
      timestamp_ms: tx.timestampMs ? Number(tx.timestampMs) : tx.timestamp_ms ? Number(tx.timestamp_ms) : null,
      sender: tx.transaction?.data?.sender || null,
      move_call_targets: moveCalls.map((row) => row.target),
      funding_asset_hits: fundingAssetHits({ balanceChanges, moveCalls }),
      target_evidence: fundingTargetEvidence({ balanceChanges, moveCalls, objectChanges }),
      balance_changes: balanceChanges,
      object_change_count: Array.isArray(objectChanges) ? objectChanges.length : null,
      event_types: (tx.events || []).map((event) => String(event.type || '').split('::').pop()).filter(Boolean),
    }
  } catch (error) {
    return {
      role,
      digest: cleanDigest,
      status: 'failed',
      passed: false,
      code: error?.code || 'FUNDING_TX_READ_FAILED',
      detail: String(error?.message || error),
    }
  }
}

export function buildFundingProofReport({
  readiness,
  transactionProofs = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const handoff = buildFundingHandoff(readiness, { generatedAt })
  const txChecks = Array.isArray(transactionProofs) ? transactionProofs : []
  const failedTxChecks = txChecks.filter((row) => row.passed !== true)
  const failedTargetChecks = txChecks.filter((row) => row.passed === true && row.target_evidence?.target_evidence_passed !== true)
  const missingDigest = txChecks.length === 0
  const txEvidencePassed = !missingDigest && failedTxChecks.length === 0
  const targetEvidencePassed = txEvidencePassed && failedTargetChecks.length === 0
  const fundingProven = txEvidencePassed && targetEvidencePassed && handoff.funding_ready === true
  const readyForStrictExecution = fundingProven && handoff.ready_for_strict_execution === true
  const txBlockers = [
    missingDigest ? 'FUNDING_TX_DIGEST_MISSING' : null,
    failedTxChecks.length > 0 ? 'FUNDING_TX_NOT_PROVEN' : null,
    failedTargetChecks.length > 0 ? 'FUNDING_TX_TARGET_NOT_PROVEN' : null,
  ].filter(Boolean)
  const blockerCodes = [
    ...txBlockers,
    ...(handoff.blocker_codes || []),
  ]

  return {
    status: failedTxChecks.length > 0 || failedTargetChecks.length > 0 ? 'failed' : readyForStrictExecution ? 'ready' : 'blocked',
    purpose: 'rescuegrid_external_funding_proof',
    generated_at: generatedAt,
    chain: handoff.chain,
    funding_proven: fundingProven,
    ready_for_strict_execution: readyForStrictExecution,
    funding_ready: handoff.funding_ready,
    execution_ready: handoff.execution_ready,
    policy_creation_allowed: readyForStrictExecution,
    policy_creation_blocked: !readyForStrictExecution,
    execution_claimed: false,
    blocker_codes: [...new Set(blockerCodes)],
    transaction_evidence: {
      required: true,
      tx_digest_count: txChecks.length,
      tx_evidence_passed: txEvidencePassed,
      target_evidence_passed: targetEvidencePassed,
      failed_tx_digests: failedTxChecks.map((row) => row.digest).filter(Boolean),
      failed_target_digests: failedTargetChecks.map((row) => row.digest).filter(Boolean),
      asset_hits: [...new Set(txChecks.flatMap((row) => (row.funding_asset_hits || []).map((hit) => hit.asset)))],
      target_asset_hits: [...new Set(txChecks.flatMap((row) => (row.target_evidence?.asset_target_hits || []).map((hit) => hit.asset)))],
    },
    transactions: txChecks,
    signer: handoff.signer,
    signer_capabilities: handoff.signer_capabilities,
    external_signer: handoff.external_signer,
    cloud_per_user_signer: handoff.cloud_per_user_signer,
    funding_targets: handoff.funding_targets,
    execution_gate: handoff.execution_gate,
    next_verification: handoff.next_verification,
    source_of_truth: [
      'provider supplied Sui transaction digest(s)',
      ...handoff.source_of_truth,
    ],
  }
}

export function writeFundingProofArtifact(report, { outPath } = {}) {
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

export async function runFundingProof({
  options = fundingProofOptions(),
  env = process.env,
  client = getClient(),
  loadReadiness = null,
  generatedAt = () => new Date().toISOString(),
  print = (report) => console.log(JSON.stringify(report, null, 2)),
} = {}) {
  const runtimeEnv = fundingHandoffEnv(env)
  const [transactionProofs, readiness] = await Promise.all([
    Promise.all((options.txDigests || []).map((row) => verifyFundingTransaction({ ...row, client }))),
    loadReadiness
      ? loadReadiness({ requested: options.requested })
      : buildExecutionReadiness({
        env: runtimeEnv,
        chainData: requireChainDataProvider(runtimeEnv),
        requested: options.requested,
      }),
  ])
  const report = buildFundingProofReport({
    readiness,
    transactionProofs,
    generatedAt: generatedAt(),
  })
  if (options.outPath) {
    const artifact = writeFundingProofArtifact(report, { outPath: options.outPath })
    print({
      status: report.status,
      purpose: report.purpose,
      artifact,
      chain: report.chain,
      funding_proven: report.funding_proven,
      ready_for_strict_execution: report.ready_for_strict_execution,
      blocker_codes: report.blocker_codes,
      execution_claimed: false,
    })
  } else {
    print(report, options.format)
  }
  return report.status === 'ready' ? 0 : 1
}

function help() {
  console.log(`Verify RescueGrid external funding proof.

Usage:
  node worker/scripts/funding-proof.mjs --tx <sui_digest> --json
  node worker/scripts/funding-proof.mjs --dbusdc-tx <digest> --deep-tx <digest> --out .rescuegrid/funding-proof-report.json
  node worker/scripts/funding-proof.mjs --tx <digest> --dbusdc-threshold <amount> --deep-threshold <amount>

This is read-only. It fetches provider-supplied Sui transaction digests and the
current execution readiness gate. A successful digest alone is not enough:
funding_proven only becomes true when the digest also anchors to the target
BalanceManager or agent gas address and the live BalanceManager / agent gas
reads satisfy the DBUSDC, DEEP and SUI gas thresholds. No private key,
AGENT_KEY, permission token or WaaP session value is accepted or printed.`)
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const parsed = parseFundingProofArgs(argv)
  if (parsed.flags.has('--help') || parsed.flags.has('-h')) {
    help()
    return 0
  }
  return runFundingProof({ options: fundingProofOptions(parsed), env })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(JSON.stringify({ status: 'error', code: error.code || 'FUNDING_PROOF_ERROR', message: error.message }, null, 2))
    process.exit(1)
  })
}
