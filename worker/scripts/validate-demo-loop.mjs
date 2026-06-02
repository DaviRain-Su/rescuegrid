// Validate the hackathon demo loop against a live local Worker and Sui Testnet.
//
// Sequence: create -> activate/monitor -> force tick -> revoke -> post-revoke tick.
// The tick leg accepts either a real execution or the documented Testnet funding
// gate. It never prints AGENT_KEY or INTERNAL_AGENT_TICK_TOKEN.
//
// Usage:
//   node worker/scripts/validate-demo-loop.mjs [--worker-url http://localhost:8787]
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Transaction } from '@mysten/sui/transactions'
import { strategyHash } from '../src/strategy-core.js'
import { getClient, readPolicyCreated, DEPLOYMENT } from '../src/sui-tx.js'
import { readMandate, readWrapper } from '../src/chain.js'
import { loadAgentKeypairFromDevVars, readWorkerDevVar } from './agent-key-loader.mjs'

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
  node worker/scripts/validate-demo-loop.mjs [--worker-url http://localhost:8787]

Requires a local Worker with INTERNAL_AGENT_TICK_TOKEN configured and
RESCUEGRID_DEMO_MODE=true so force_trigger can exercise the agent tick path.
Runs create -> activate/monitor -> force tick -> revoke -> post-revoke tick.
The tick leg may produce a real execution or the documented DBUSDC/DEEP funding
gate; either way no raw secrets are printed.`)
  process.exit(0)
}

const workerUrl = String(args.get('--worker-url') || process.env.WORKER_URL || 'http://localhost:8787').replace(/\/$/, '')
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

function assertTickLeg(result) {
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
  return 'gated'
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
}, null, 2))

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
const wrapperId = created.wrapper_id
const mandateId = created.mandate_id
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
const tickOutcome = assertTickLeg(tick)
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
  return detail.policy?.revoked === true && detail.events?.some((e) => e.type === 'PolicyRevoked') ? detail : null
})

console.log(JSON.stringify({
  phase: 'post_revoke_tick',
  action: postRevokeTick.action,
  code: postRevokeTick.code,
  execution_claimed: postRevokeTick.execution_claimed,
  final_policy_status: finalActivity.policy.status,
  final_runtime_state: finalActivity.policy.runtime_state,
  chain_event_types: finalActivity.events.map((e) => e.type),
}, null, 2))

console.log(JSON.stringify({
  phase: 'pass',
  assertions: [
    'G2-CREATE',
    'G2-ACTIVATE-MONITOR',
    tickOutcome === 'executed' ? 'G2-EXECUTE' : 'G2-DOCUMENTED-FUNDING-GATE',
    'G2-REVOKE',
    'G2-POST-REVOKE-NO-EXECUTION',
  ],
  current_run_marker: currentRunMarker,
  wrapper_id: wrapperId,
  mandate_id: mandateId,
  create_tx_digest: createResolved.digest,
  revoke_tx_digest: revokeResolved.digest,
  tick_outcome: tickOutcome,
  tick_tx_digest: tick.tx_digest ?? null,
  strategy_hash: strategy.strategy_hash,
}, null, 2))
