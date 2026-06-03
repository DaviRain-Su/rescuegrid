// Validate the hackathon demo loop against a live local Worker and Sui Testnet.
//
// Sequence: create -> activate/monitor -> force tick -> revoke -> post-revoke tick.
// The tick leg accepts either a real execution or the documented Testnet funding
// gate. It never prints AGENT_KEY or INTERNAL_AGENT_TICK_TOKEN.
//
// Usage:
//   node worker/scripts/validate-demo-loop.mjs [--worker-url http://localhost:8787]
//   node worker/scripts/validate-demo-loop.mjs --require-execution
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Transaction } from '@mysten/sui/transactions'
import { strategyHash } from '../src/strategy-core.js'
import { getClient, readPolicyCreated, DEPLOYMENT } from '../src/sui-tx.js'
import { readMandate, readWrapper } from '../src/chain.js'
import { loadAgentKeypairFromDevVars, readWorkerDevVar } from './agent-key-loader.mjs'
import {
  activityHasChainEvent,
  assertStrictDemoExecutionReport,
  buildDemoExecutionReport,
  chainEventTypesFromActivity,
  writeDemoExecutionReportArtifact,
} from './demo-execution-report.mjs'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if (!arg.startsWith('--')) continue
  const [key, inlineValue] = arg.split('=')
  const nextValue = process.argv[i + 1]
  if (inlineValue != null) args.set(key, inlineValue)
  else if (nextValue && !nextValue.startsWith('--')) {
    args.set(key, nextValue)
    i += 1
  } else {
    args.set(key, 'true')
  }
}

if (args.has('--help') || process.argv.includes('-h')) {
  console.log(`Validate the RescueGrid live demo loop.

Usage:
  node worker/scripts/validate-demo-loop.mjs [--worker-url http://localhost:8787] [--require-execution]
  node worker/scripts/validate-demo-loop.mjs --require-execution --out .rescuegrid/demo-execute-report.json

Requires a local Worker with INTERNAL_AGENT_TICK_TOKEN configured and
RESCUEGRID_DEMO_MODE=true so force_trigger can exercise the agent tick path.
Runs create -> activate/monitor -> force tick -> revoke -> post-revoke tick.
The tick leg may produce a real execution or the documented DBUSDC/DEEP funding
gate; either way no raw secrets are printed.

Options:
  --worker-url <url>       Worker URL (default: WORKER_URL or http://localhost:8787)
  --require-execution      Fail unless the forced tick produces structured
                           AgentTradeExecuted evidence and spend increase. This
                           mode preflights signer, execution and DBUSDC/DEEP/SUI
                           funding before policy creation, so a known funding gate
                           does not leave a test policy behind. Use this after
                           DBUSDC/DEEP funding is available to prove the full PRD
                           execution gate.
  --out <path>             Write the final pass report as JSON after the full
                           create -> tick -> revoke -> post-revoke sequence passes.`)
  process.exit(0)
}

const workerUrl = String(args.get('--worker-url') || process.env.WORKER_URL || 'http://localhost:8787').replace(/\/$/, '')
const requireExecution = args.has('--require-execution') || process.env.RESCUEGRID_REQUIRE_EXECUTION === 'true'
const reportOutPath = args.get('--out') || args.get('--report-out') || args.get('--output')
const expectedChain = 'sui:testnet'
const client = getClient()
const keypair = loadAgentKeypairFromDevVars()
const ownerAddress = keypair.getPublicKey().toSuiAddress()
const delegatedAgentAddress = DEPLOYMENT.agent.address

function localDevVar(name) {
  try {
    return readWorkerDevVar(name)
  } catch {
    return null
  }
}

const internalTickToken = process.env.INTERNAL_AGENT_TICK_TOKEN || localDevVar('INTERNAL_AGENT_TICK_TOKEN')

function fail(message, details = undefined) {
  const suffix = details == null ? '' : `\n${JSON.stringify(details, null, 2)}`
  throw new Error(`${message}${suffix}`)
}

function assert(condition, message, details = undefined) {
  if (!condition) fail(message, details)
}

function txMeta(tx) {
  return {
    digest: tx.digest,
    status: tx.effects?.status?.status ?? null,
    checkpoint: tx.checkpoint ?? null,
    timestamp_ms: tx.timestampMs ? Number(tx.timestampMs) : null,
  }
}

function withoutStrategyHash(strategy) {
  const { strategy_hash: _strategyHash, ...unsignedStrategy } = strategy
  return unsignedStrategy
}

function hexFromMaybeVector(value) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return null
  return `0x${value.map((b) => Number(b).toString(16).padStart(2, '0')).join('')}`
}

async function getJson(path) {
  const res = await fetch(`${workerUrl}${path}`)
  const json = await res.json().catch(() => null)
  assert(res.ok, `Worker GET ${path} returned HTTP ${res.status}`, json)
  assert(json && json.status !== 'error', `Worker GET ${path} returned an error`, json)
  return json
}

async function postJson(path, body, headers = {}) {
  const res = await fetch(`${workerUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  assert(res.ok, `Worker POST ${path} returned HTTP ${res.status}`, json)
  assert(json && json.status !== 'error', `Worker POST ${path} returned an error`, json)
  return json
}

async function waitFor(label, fn, { attempts = 12, delayMs = 1_500 } = {}) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try {
      const value = await fn()
      if (value) return value
    } catch (e) {
      lastError = e
    }
    await delay(delayMs)
  }
  if (lastError) throw lastError
  fail(`Timed out waiting for ${label}`)
}

async function waitForTx(digest) {
  return client.waitForTransaction({
    digest,
    options: { showEvents: true, showEffects: true, showObjectChanges: true },
  })
}

function assertTickLeg(result, { requireExecution = false } = {}) {
  if (result.action === 'executed') {
    assert(result.execution_claimed === true, 'Executed tick did not claim execution', result)
    assert(result.tx_digest, 'Executed tick did not return tx_digest', result)
    assert(result.agent_trade_event_found === true, 'Executed tick lacks AgentTradeExecuted evidence', result)
    assert(result.spend_increased === true, 'Executed tick did not prove spend increase', result)
    return 'executed'
  }

  const blockers = new Set(result.blocker_codes || [result.code].filter(Boolean))
  const acceptedGate = ['EXECUTION_DISABLED', 'INSUFFICIENT_DBUSDC', 'INSUFFICIENT_DEEP', 'INSUFFICIENT_GAS']
  assert(result.action === 'blocked', 'Tick must either execute or hit the documented funding gate', result)
  assert(acceptedGate.some((code) => blockers.has(code)), 'Tick blocked for an unexpected reason', result)
  assert(result.execution_claimed === false, 'Gated tick claimed execution', result)
  assert(!requireExecution, 'Strict demo execution required, but tick hit a funding/execution gate', {
    action: result.action,
    code: result.code,
    blocker_codes: result.blocker_codes || [],
    funding: result.funding || null,
  })
  return 'gated'
}

async function strictExecutionPreflight(strategy) {
  if (!requireExecution) return null
  try {
    const readiness = await getJson(
      `/api/execution/readiness?dbusdc_threshold=${encodeURIComponent(strategy.execution.max_single_trade_amount)}&deep_threshold=1&sui_gas_threshold=1`,
    )
    const evidence = {
      execution: readiness.execution,
      signer: readiness.signer,
      funding: {
        balances: readiness.funding?.balances,
        thresholds: readiness.funding?.thresholds,
        execution_ready: readiness.execution_ready,
        execution_blocker_codes: readiness.blocker_codes,
        funding_blocker_codes: readiness.funding_blocker_codes,
      },
    }
    assert(readiness.execution_ready === true, 'Strict demo execution preflight failed before policy creation', evidence)
    return evidence
  } catch (e) {
    fail('Strict demo execution preflight failed before policy creation', {
      code: 'STRICT_PREFLIGHT_READ_FAILED',
      detail: e?.message || String(e),
    })
  }
}

async function cleanupRevokeCreatedPolicy(wrapperId) {
  const revokeBuilt = await postJson(`/api/policies/${wrapperId}/revoke`, { owner: ownerAddress, confirmed: true })
  assert(revokeBuilt.wrapper_id === wrapperId, 'Cleanup revoke build wrapper id mismatch', revokeBuilt)
  const revokeSubmitted = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: Transaction.from(revokeBuilt.tx_json),
    options: { showEffects: true },
  })
  const revokeResolved = await waitForTx(revokeSubmitted.digest)
  assert(revokeResolved.effects?.status?.status === 'success', 'cleanup revoke_policy transaction failed', txMeta(revokeResolved))
  return revokeResolved
}

assert(DEPLOYMENT.chain === expectedChain, 'Deployment is not configured for Sui Testnet', { chain: DEPLOYMENT.chain })
assert(internalTickToken, 'INTERNAL_AGENT_TICK_TOKEN is required for demo-loop validation. Set it in env or worker/.dev.vars.')

const workerRoot = await getJson('/')
assert(workerRoot.service === 'rescuegrid-worker', 'Worker root did not identify rescuegrid-worker', workerRoot)
assert(workerRoot.agent === delegatedAgentAddress, 'Worker root agent differs from deployment agent', workerRoot)

const nowMs = Date.now()
const currentRunMarker = `demo-loop-${new Date(nowMs).toISOString()}-${randomUUID().slice(0, 8)}`
const strategy = {
  version: '1',
  strategy_type: 'risk_response',
  current_run_marker: currentRunMarker,
  owner: ownerAddress,
  agent: delegatedAgentAddress,
  chain: expectedChain,
  executor_kind: 'deepbook',
  pool_id: DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id,
  budget_coin_type: DEPLOYMENT.deepbook.dbusdc_coin_type,
  budget_ceiling: '50000000',
  trigger: { metric: 'price_drop_pct', asset: 'SUI', threshold_pct: '8' },
  execution: { order_type: 'market_or_ioc', max_slippage_bps: 100, max_single_trade_amount: '10000000' },
  expires_at_ms: nowMs + 6 * 86_400_000,
}
strategy.strategy_hash = strategyHash(strategy)

console.log(JSON.stringify({
  phase: 'preflight',
  worker_url: workerUrl,
  chain: DEPLOYMENT.chain,
  current_run_marker: currentRunMarker,
  scripted_owner_address: ownerAddress,
  configured_delegated_agent_address: delegatedAgentAddress,
  strategy_hash: strategy.strategy_hash,
  internal_tick_token_configured: true,
  require_execution: requireExecution,
}, null, 2))

const strictPreflight = await strictExecutionPreflight(strategy)
if (strictPreflight) {
  console.log(JSON.stringify({
    phase: 'strict_execution_preflight_ready',
    execution: strictPreflight.execution,
    signer: strictPreflight.signer,
    funding: strictPreflight.funding,
  }, null, 2))
}

let wrapperId = null
let mandateId = null
let revoked = false
let completed = false

try {
const createBuilt = await postJson('/api/policies', {
  owner: ownerAddress,
  strategy: withoutStrategyHash(strategy),
  strategy_hash: strategy.strategy_hash,
  confirmed: true,
})
assert(createBuilt.strategy_hash === strategy.strategy_hash, 'Worker create build returned an unexpected strategy hash', createBuilt)
const createSubmitted = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: Transaction.from(createBuilt.tx_json),
  options: { showEffects: true },
})
const createResolved = await waitForTx(createSubmitted.digest)
assert(createResolved.effects?.status?.status === 'success', 'create_policy transaction failed', txMeta(createResolved))
const created = readPolicyCreated(createResolved)
assert(created?.wrapper_id && created?.mandate_id, 'PolicyCreated event did not contain wrapper/mandate IDs', createResolved.events)
wrapperId = created.wrapper_id
mandateId = created.mandate_id
const createEvent = (createResolved.events || []).find((e) => String(e.type).endsWith('::policy::PolicyCreated'))
assert(hexFromMaybeVector(createEvent?.parsedJson?.strategy_hash) === strategy.strategy_hash, 'PolicyCreated strategy hash mismatch')

console.log(JSON.stringify({
  phase: 'created',
  tx: txMeta(createResolved),
  wrapper_id: wrapperId,
  mandate_id: mandateId,
  executor_kind: strategy.executor_kind,
  budget_ceiling: strategy.budget_ceiling,
}, null, 2))

const activate = await postJson(`/api/policies/${wrapperId}/activate`, { strategy: withoutStrategyHash(strategy) })
assert(activate.runtime_state === 'Monitoring', 'Runtime did not enter Monitoring after activation', activate)
const runtime = await waitFor('runtime activation', async () => {
  const state = await getJson(`/api/policies/${wrapperId}/runtime`)
  return state.runtime_state === 'Monitoring' && state.executor_kind === 'deepbook' ? state : null
})
const detailAfterActivate = await getJson(`/api/policies/${wrapperId}/activity`)
assert(detailAfterActivate.runtime_activity?.some((e) => e.action === 'activated'), 'Runtime activation activity missing', detailAfterActivate.runtime_activity)

console.log(JSON.stringify({
  phase: 'activated_monitoring',
  wrapper_id: wrapperId,
  runtime_state: runtime.runtime_state,
  executor_kind: runtime.executor_kind,
  runtime_activity_count: detailAfterActivate.runtime_activity.length,
}, null, 2))

const beforeTickWrapper = await readWrapper(client, wrapperId)
const tick = await postJson('/api/agent/tick', {
  wrapper_id: wrapperId,
  force_trigger: true,
}, { Authorization: `Bearer ${internalTickToken}` })
const tickOutcome = assertTickLeg(tick, { requireExecution })
const afterTickWrapper = await readWrapper(client, wrapperId)
if (tickOutcome === 'gated') {
  assert(beforeTickWrapper?.spent_amount === afterTickWrapper?.spent_amount, 'Gated tick changed wrapper spend', {
    before_spent: beforeTickWrapper?.spent_amount,
    after_spent: afterTickWrapper?.spent_amount,
  })
}

console.log(JSON.stringify({
  phase: 'agent_tick',
  outcome: tickOutcome,
  action: tick.action,
  code: tick.code ?? null,
  blocker_codes: tick.blocker_codes ?? [],
  tx_digest: tick.tx_digest ?? null,
  execution_claimed: tick.execution_claimed,
  spend_before: beforeTickWrapper?.spent_amount ?? null,
  spend_after: afterTickWrapper?.spent_amount ?? null,
}, null, 2))

const revokeBuilt = await postJson(`/api/policies/${wrapperId}/revoke`, { owner: ownerAddress, confirmed: true })
assert(revokeBuilt.wrapper_id === wrapperId, 'Worker revoke build wrapper id mismatch', revokeBuilt)
const revokeSubmitted = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: Transaction.from(revokeBuilt.tx_json),
  options: { showEffects: true },
})
const revokeResolved = await waitForTx(revokeSubmitted.digest)
assert(revokeResolved.effects?.status?.status === 'success', 'revoke_policy transaction failed', txMeta(revokeResolved))
const mandateAfterRevoke = await readMandate(client, mandateId)
assert(mandateAfterRevoke?.revoked === true, 'Mandate was not revoked on-chain after revoke tx', mandateAfterRevoke)
revoked = true

console.log(JSON.stringify({
  phase: 'revoked',
  tx: txMeta(revokeResolved),
  wrapper_id: wrapperId,
  mandate_id: mandateId,
  mandate_revoked: mandateAfterRevoke.revoked,
}, null, 2))

const postRevokeTick = await postJson('/api/agent/tick', {
  wrapper_id: wrapperId,
  force_trigger: true,
}, { Authorization: `Bearer ${internalTickToken}` })
assert(postRevokeTick.action === 'stopped_revoked', 'Post-revoke tick did not stop on revoked mandate', postRevokeTick)
assert(postRevokeTick.code === 'POLICY_REVOKED', 'Post-revoke tick returned wrong code', postRevokeTick)
assert(postRevokeTick.execution_claimed === false, 'Post-revoke tick claimed execution', postRevokeTick)

const finalActivity = await waitFor('revoked policy activity', async () => {
  const detail = await getJson(`/api/policies/${wrapperId}/activity`)
  return detail.policy?.revoked === true && activityHasChainEvent(detail, 'PolicyRevoked') ? detail : null
})

console.log(JSON.stringify({
  phase: 'post_revoke_tick',
  action: postRevokeTick.action,
  code: postRevokeTick.code,
  execution_claimed: postRevokeTick.execution_claimed,
  final_policy_status: finalActivity.policy.status,
  final_runtime_state: finalActivity.policy.runtime_state,
  chain_event_types: chainEventTypesFromActivity(finalActivity),
}, null, 2))

const passReport = buildDemoExecutionReport({
  workerUrl,
  chain: DEPLOYMENT.chain,
  requireExecution,
  current_run_marker: currentRunMarker,
  ownerAddress,
  delegatedAgentAddress,
  poolId: strategy.pool_id,
  wrapperId,
  mandateId,
  strategyHash: strategy.strategy_hash,
  createResolved,
  revokeResolved,
  tick,
  tickOutcome,
  beforeTickWrapper,
  afterTickWrapper,
  postRevokeTick,
  finalActivity,
  strictPreflight,
})
if (requireExecution) assertStrictDemoExecutionReport(passReport)

console.log(JSON.stringify(passReport, null, 2))
if (reportOutPath) {
  const artifact = writeDemoExecutionReportArtifact(passReport, { outPath: reportOutPath })
  console.log(JSON.stringify({
    phase: 'report_written',
    purpose: passReport.purpose,
    artifact,
    execution_claimed: passReport.execution_claimed,
    tick_tx_digest: passReport.tick_tx_digest,
  }, null, 2))
}
completed = true
} finally {
  if (!completed && wrapperId && !revoked) {
    try {
      const cleanupResolved = await cleanupRevokeCreatedPolicy(wrapperId)
      revoked = true
      console.error(JSON.stringify({
        phase: 'cleanup_revoked_after_failure',
        wrapper_id: wrapperId,
        mandate_id: mandateId,
        tx: txMeta(cleanupResolved),
      }, null, 2))
    } catch (e) {
      console.error(JSON.stringify({
        phase: 'cleanup_revoke_failed',
        wrapper_id: wrapperId,
        mandate_id: mandateId,
        code: 'CLEANUP_REVOKE_FAILED',
        detail: e?.message || String(e),
      }, null, 2))
    }
  }
}
