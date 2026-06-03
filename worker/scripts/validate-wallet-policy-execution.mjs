#!/usr/bin/env node
// Validate strict execution against a browser-wallet-created policy lifecycle.
//
// Sequence: verify wallet-created wrapper -> activate/force strict tick ->
// wait for owner wallet revoke -> post-revoke no-execution -> write report.
// This script never creates or revokes the policy itself.
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { strategyHash } from '../src/strategy-core.js'
import { getClient, DEPLOYMENT } from '../src/sui-tx.js'
import { queryPolicyEvents, readMandate, readWrapper } from '../src/chain.js'
import { readWorkerDevVar } from './agent-key-loader.mjs'
import {
  assertStrictDemoExecutionReport,
  buildDemoExecutionReport,
  writeDemoExecutionReportArtifact,
} from './demo-execution-report.mjs'

const SECRET_LEAK_PATTERNS = [
  { id: 'agent-key', pattern: /\bAGENT_KEY["']?\s*[:=]\s*["']?(?!TODO\b|n\/a\b|not configured\b)\S+/i },
  { id: 'owner-key', pattern: /\bOWNER_KEY["']?\s*[:=]\s*["']?(?!TODO\b|n\/a\b|not configured\b)\S+/i },
  { id: 'private-key', pattern: /\b(private[_ -]?key|privateKey|signing[_ -]?secret|signingSecret)["']?\s*[:=]\s*["']?(?!TODO\b|n\/a\b|not configured\b)\S+/i },
  { id: 'internal-agent-tick-token', pattern: /\bINTERNAL_AGENT_TICK_TOKEN["']?\s*[:=]\s*["']?(?!TODO\b|n\/a\b|not configured\b)\S+/i },
  { id: 'waap-token', pattern: /\b(WAAP_PERMISSION_TOKEN|RESCUEGRID_WAAP_PERMISSION_TOKEN|permission_token|permissionToken)["']?\s*[:=]\s*["']?(?!TODO\b|n\/a\b|not configured\b|false\b|true\b|null\b)\S+/i },
  { id: 'sui-private-key', pattern: /\bsuiprivkey[1-9A-HJ-NP-Za-km-z]{20,}/ },
]

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Map()
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const [key, inlineValue] = arg.split('=')
    const nextValue = argv[i + 1]
    if (inlineValue != null) flags.set(key, inlineValue)
    else if (nextValue && !nextValue.startsWith('--')) {
      flags.set(key, nextValue)
      i += 1
    } else {
      flags.set(key, 'true')
    }
  }
  return flags
}

function help() {
  console.log(`Validate strict execution for a browser-wallet-created policy.

Usage:
  node worker/scripts/validate-wallet-policy-execution.mjs --wrapper-id <0x...> --strategy-file .rescuegrid/wallet-strategy.json --out .rescuegrid/demo-execute-report.json
  npm run demo:execute:wallet-report -- --wrapper-id <0x...> --strategy-file .rescuegrid/wallet-strategy.json --create-tx-digest <digest>

This is the same-wrapper wallet path for final mission readiness. It does not
create a policy or sign revoke. It verifies the supplied strategy JSON hashes to
the on-chain wrapper, preflights strict execution funding/signer readiness,
activates the existing runtime, force-runs one strict AgentTradeExecuted tick,
then waits for the owner to revoke the same policy in the browser wallet before
checking the post-revoke no-execution tick and writing the strict report.

Options:
  --worker-url <url>          Worker URL (default: WORKER_URL or http://localhost:8787)
  --wrapper-id <0x...>        Existing wallet-created RescuePolicyWrapper id
  --strategy-file <path>      JSON file containing the exact parsed strategy used at create time
  --owner-address <0x...>     Optional expected owner address from the wallet artifact
  --create-tx-digest <digest> Optional expected PolicyCreated digest; discovered from chain if omitted
  --revoke-tx-digest <digest> Optional expected PolicyRevoked digest; otherwise discovered while waiting
  --out <path>                Write the final strict report JSON after revoke/post-revoke checks
  --revoke-timeout-ms <ms>    Time to wait for browser-wallet revoke (default: 300000)
  --revoke-poll-ms <ms>       Poll interval while waiting for revoke (default: 3000)

Keep the browser wallet open while this runs. After the script prints the
awaiting_wallet_revoke phase, revoke the same policy in the UI. No raw secrets,
AGENT_KEY, owner keys or INTERNAL_AGENT_TICK_TOKEN values are printed.`)
}

function fail(message, details = undefined) {
  const suffix = details == null ? '' : `\n${JSON.stringify(details, null, 2)}`
  throw new Error(`${message}${suffix}`)
}

function assert(condition, message, details = undefined) {
  if (!condition) fail(message, details)
}

function localDevVar(name) {
  try {
    return readWorkerDevVar(name)
  } catch {
    return null
  }
}

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '')
}

function normalizeHex(value) {
  return String(value || '').trim().toLowerCase()
}

function hexFromMaybeVector(value) {
  if (typeof value === 'string') return value.startsWith('0x') ? value : `0x${value}`
  if (!Array.isArray(value)) return null
  return `0x${value.map((b) => Number(b).toString(16).padStart(2, '0')).join('')}`
}

function txMeta(tx = {}) {
  return {
    digest: tx.digest || null,
    status: tx.effects?.status?.status ?? tx.status ?? null,
    checkpoint: tx.checkpoint ?? null,
    timestamp_ms: tx.timestampMs ? Number(tx.timestampMs) : tx.timestamp_ms ?? null,
  }
}

function withoutStrategyHash(strategy = {}) {
  const { strategy_hash: _strategyHash, ...unsignedStrategy } = strategy
  return unsignedStrategy
}

function loadStrategyFile(path) {
  if (!path) fail('--strategy-file is required for wallet-created policy execution.')
  const raw = readFileSync(path, 'utf8')
  const leaks = SECRET_LEAK_PATTERNS.filter(({ pattern }) => pattern.test(raw)).map(({ id }) => id)
  assert(leaks.length === 0, 'strategy file appears to contain secret material', { secret_leak_patterns: leaks })
  const parsed = JSON.parse(raw)
  const strategy = parsed?.strategy && typeof parsed.strategy === 'object' ? parsed.strategy : parsed
  assert(strategy && typeof strategy === 'object' && !Array.isArray(strategy), 'strategy file must contain a JSON object or { "strategy": ... }')
  assert(strategy.owner && strategy.agent && strategy.pool_id && strategy.execution, 'strategy file is missing required strategy fields', {
    required: ['owner', 'agent', 'pool_id', 'execution'],
  })
  assert(strategy.execution.max_single_trade_amount, 'strategy file is missing execution.max_single_trade_amount')
  return withoutStrategyHash(strategy)
}

function findPolicyEvent(tx, eventName) {
  return (tx?.events || []).find((event) => String(event.type).endsWith(`::policy::${eventName}`))
    || (tx?.events || []).find((event) => String(event.type).endsWith(`::${eventName}`))
    || null
}

async function readTransaction(client, digest) {
  assert(digest, 'transaction digest is required')
  return client.getTransactionBlock({
    digest,
    options: { showEvents: true, showEffects: true, showObjectChanges: true },
  })
}

async function findEventDigest(client, wrapperId, eventType) {
  const events = await queryPolicyEvents(client, wrapperId, 100)
  return events.find((event) => event.type === eventType)?.tx || null
}

function validateCreateTx(tx, { wrapper, mandate, strategyHashValue, expectedDigest = null }) {
  assert(txMeta(tx).status === 'success', 'PolicyCreated transaction was not successful', txMeta(tx))
  if (expectedDigest) assert(tx.digest === expectedDigest, 'PolicyCreated digest mismatch', { expected: expectedDigest, actual: tx.digest })
  const event = findPolicyEvent(tx, 'PolicyCreated')
  const pj = event?.parsedJson || {}
  assert(event, 'PolicyCreated event missing from create transaction', { digest: tx.digest })
  assert(normalizeHex(pj.wrapper_id) === normalizeHex(wrapper.wrapper_id), 'PolicyCreated wrapper_id mismatch', pj)
  assert(normalizeHex(pj.mandate_id) === normalizeHex(wrapper.mandate_id), 'PolicyCreated mandate_id mismatch', pj)
  assert(normalizeHex(pj.owner) === normalizeHex(wrapper.owner), 'PolicyCreated owner mismatch', pj)
  assert(normalizeHex(pj.agent) === normalizeHex(wrapper.agent), 'PolicyCreated agent mismatch', pj)
  assert(normalizeHex(hexFromMaybeVector(pj.strategy_hash)) === normalizeHex(strategyHashValue), 'PolicyCreated strategy_hash mismatch', pj)
}

function validateRevokeTx(tx, { wrapper, expectedDigest = null }) {
  assert(txMeta(tx).status === 'success', 'PolicyRevoked transaction was not successful', txMeta(tx))
  if (expectedDigest) assert(tx.digest === expectedDigest, 'PolicyRevoked digest mismatch', { expected: expectedDigest, actual: tx.digest })
  const event = findPolicyEvent(tx, 'PolicyRevoked')
  const pj = event?.parsedJson || {}
  assert(event, 'PolicyRevoked event missing from revoke transaction', { digest: tx.digest })
  assert(normalizeHex(pj.wrapper_id) === normalizeHex(wrapper.wrapper_id), 'PolicyRevoked wrapper_id mismatch', pj)
  assert(normalizeHex(pj.mandate_id) === normalizeHex(wrapper.mandate_id), 'PolicyRevoked mandate_id mismatch', pj)
  assert(normalizeHex(pj.owner) === normalizeHex(wrapper.owner), 'PolicyRevoked owner mismatch', pj)
}

async function getJson(workerUrl, path) {
  const res = await fetch(`${workerUrl}${path}`)
  const json = await res.json().catch(() => null)
  assert(res.ok, `Worker GET ${path} returned HTTP ${res.status}`, json)
  assert(json && json.status !== 'error', `Worker GET ${path} returned an error`, json)
  return json
}

async function postJson(workerUrl, path, body, headers = {}) {
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

async function waitFor(label, fn, { timeoutMs = 300_000, delayMs = 3_000 } = {}) {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const value = await fn()
      if (value) return value
    } catch (e) {
      lastError = e
    }
    await delay(delayMs)
  }
  if (lastError) throw lastError
  fail(`Timed out waiting for ${label}`, { timeout_ms: timeoutMs })
}

function assertTickExecuted(result) {
  assert(result.action === 'executed', 'Wallet strict execution tick did not execute', result)
  assert(result.execution_claimed === true, 'Executed tick did not claim execution', result)
  assert(result.tx_digest, 'Executed tick did not return tx_digest', result)
  assert(result.agent_trade_event_found === true, 'Executed tick lacks AgentTradeExecuted evidence', result)
  assert(result.spend_increased === true, 'Executed tick did not prove spend increase', result)
  return 'executed'
}

async function strictExecutionPreflight(workerUrl, strategy) {
  const readiness = await getJson(
    workerUrl,
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
  assert(readiness.execution_ready === true, 'Strict wallet execution preflight failed before force tick', evidence)
  return evidence
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const flags = parseArgs(argv)
  if (flags.has('--help') || flags.has('-h')) {
    help()
    return 0
  }

  const workerUrl = normalizeUrl(flags.get('--worker-url') || env.WORKER_URL || 'http://localhost:8787')
  const wrapperId = flags.get('--wrapper-id')
  const strategyFile = flags.get('--strategy-file')
  const expectedOwnerAddress = flags.get('--owner-address') || null
  const expectedCreateDigest = flags.get('--create-tx-digest') || null
  const expectedRevokeDigest = flags.get('--revoke-tx-digest') || null
  const reportOutPath = flags.get('--out') || flags.get('--report-out') || flags.get('--output')
  const revokeTimeoutMs = Number(flags.get('--revoke-timeout-ms') || 300_000)
  const revokePollMs = Number(flags.get('--revoke-poll-ms') || 3_000)
  const internalTickToken = env.INTERNAL_AGENT_TICK_TOKEN || localDevVar('INTERNAL_AGENT_TICK_TOKEN')
  const client = getClient()

  assert(/^0x[0-9a-fA-F]+$/.test(String(wrapperId || '')), '--wrapper-id must be a Sui object id')
  assert(Number.isFinite(revokeTimeoutMs) && revokeTimeoutMs > 0, '--revoke-timeout-ms must be positive')
  assert(Number.isFinite(revokePollMs) && revokePollMs > 0, '--revoke-poll-ms must be positive')
  assert(DEPLOYMENT.chain === 'sui:testnet', 'Deployment is not configured for Sui Testnet', { chain: DEPLOYMENT.chain })
  assert(internalTickToken, 'INTERNAL_AGENT_TICK_TOKEN is required to force the agent tick. Set it in env or worker/.dev.vars.')

  const strategy = loadStrategyFile(strategyFile)
  const computedStrategyHash = strategyHash(strategy)
  const delegatedAgentAddress = DEPLOYMENT.agent.address
  const workerRoot = await getJson(workerUrl, '/')
  assert(workerRoot.service === 'rescuegrid-worker', 'Worker root did not identify rescuegrid-worker', workerRoot)
  assert(workerRoot.agent === delegatedAgentAddress, 'Worker root agent differs from deployment agent', workerRoot)

  const wrapper = await readWrapper(client, wrapperId)
  assert(wrapper, 'Wrapper not found on-chain', { wrapper_id: wrapperId })
  const mandate = await readMandate(client, wrapper.mandate_id)
  assert(mandate, 'Mandate not found on-chain', { mandate_id: wrapper.mandate_id })
  assert(mandate.revoked === false, 'Wallet-created policy is already revoked before strict execution', { wrapper_id: wrapper.wrapper_id, mandate_id: wrapper.mandate_id })
  assert(Date.now() < Number(mandate.expires_at_ms), 'Wallet-created policy is expired before strict execution', { expires_at_ms: mandate.expires_at_ms })
  assert(normalizeHex(wrapper.strategy_hash) === normalizeHex(computedStrategyHash), 'Strategy file does not hash to the on-chain wrapper strategy_hash', {
    wrapper_strategy_hash: wrapper.strategy_hash,
    computed_strategy_hash: computedStrategyHash,
  })
  assert(normalizeHex(strategy.owner) === normalizeHex(wrapper.owner), 'Strategy owner does not match wrapper owner', { strategy_owner: strategy.owner, wrapper_owner: wrapper.owner })
  assert(normalizeHex(strategy.agent) === normalizeHex(wrapper.agent), 'Strategy agent does not match wrapper agent', { strategy_agent: strategy.agent, wrapper_agent: wrapper.agent })
  assert(normalizeHex(strategy.agent) === normalizeHex(delegatedAgentAddress), 'Strategy agent does not match deployment agent', { strategy_agent: strategy.agent, deployment_agent: delegatedAgentAddress })
  assert(normalizeHex(strategy.pool_id) === normalizeHex(wrapper.pool_id), 'Strategy pool_id does not match wrapper pool_id', { strategy_pool_id: strategy.pool_id, wrapper_pool_id: wrapper.pool_id })
  if (expectedOwnerAddress) {
    assert(normalizeHex(expectedOwnerAddress) === normalizeHex(wrapper.owner), 'Expected owner address does not match wrapper owner', {
      expected_owner_address: expectedOwnerAddress,
      wrapper_owner: wrapper.owner,
    })
  }

  const createDigest = expectedCreateDigest || await findEventDigest(client, wrapper.wrapper_id, 'PolicyCreated')
  assert(createDigest, 'Could not discover PolicyCreated digest for wrapper; pass --create-tx-digest from the wallet artifact.', { wrapper_id: wrapper.wrapper_id })
  const createResolved = await readTransaction(client, createDigest)
  validateCreateTx(createResolved, { wrapper, mandate, strategyHashValue: computedStrategyHash, expectedDigest: expectedCreateDigest })

  console.log(JSON.stringify({
    phase: 'wallet_policy_verified',
    worker_url: workerUrl,
    chain: DEPLOYMENT.chain,
    wrapper_id: wrapper.wrapper_id,
    mandate_id: wrapper.mandate_id,
    owner_address: wrapper.owner,
    delegated_agent_address: delegatedAgentAddress,
    strategy_hash: computedStrategyHash,
    create_tx: txMeta(createResolved),
    report_mode: 'wallet_created_policy',
  }, null, 2))

  const strictPreflight = await strictExecutionPreflight(workerUrl, strategy)
  console.log(JSON.stringify({
    phase: 'strict_execution_preflight_ready',
    execution: strictPreflight.execution,
    signer: strictPreflight.signer,
    funding: strictPreflight.funding,
  }, null, 2))

  const activate = await postJson(workerUrl, `/api/policies/${wrapper.wrapper_id}/activate`, { strategy })
  assert(activate.runtime_state === 'Monitoring', 'Runtime did not enter Monitoring after activation', activate)
  await waitFor('runtime activation', async () => {
    const state = await getJson(workerUrl, `/api/policies/${wrapper.wrapper_id}/runtime`)
    return state.runtime_state === 'Monitoring' ? state : null
  }, { timeoutMs: 30_000, delayMs: 1_500 })

  const beforeTickWrapper = await readWrapper(client, wrapper.wrapper_id)
  const tick = await postJson(workerUrl, '/api/agent/tick', {
    wrapper_id: wrapper.wrapper_id,
    force_trigger: true,
  }, { Authorization: `Bearer ${internalTickToken}` })
  const tickOutcome = assertTickExecuted(tick)
  const afterTickWrapper = await readWrapper(client, wrapper.wrapper_id)

  console.log(JSON.stringify({
    phase: 'agent_tick_executed',
    wrapper_id: wrapper.wrapper_id,
    mandate_id: wrapper.mandate_id,
    tx_digest: tick.tx_digest,
    execution_claimed: tick.execution_claimed,
    spend_before: beforeTickWrapper?.spent_amount ?? null,
    spend_after: afterTickWrapper?.spent_amount ?? null,
  }, null, 2))

  console.log(JSON.stringify({
    phase: 'awaiting_wallet_revoke',
    wrapper_id: wrapper.wrapper_id,
    mandate_id: wrapper.mandate_id,
    instruction: 'Revoke this same policy in the browser wallet now; this script will only observe the chain event and run the post-revoke no-execution tick.',
    timeout_ms: revokeTimeoutMs,
    expected_revoke_tx_digest: expectedRevokeDigest,
  }, null, 2))

  const revoked = await waitFor('browser wallet revoke', async () => {
    const [latestMandate, detail] = await Promise.all([
      readMandate(client, wrapper.mandate_id),
      getJson(workerUrl, `/api/policies/${wrapper.wrapper_id}/activity`),
    ])
    const revokeEvent = (detail.events || []).find((event) => (
      event.type === 'PolicyRevoked' && (!expectedRevokeDigest || event.tx === expectedRevokeDigest)
    ))
    if (latestMandate?.revoked === true && revokeEvent) return { mandate: latestMandate, detail, revokeDigest: revokeEvent.tx }
    return null
  }, { timeoutMs: revokeTimeoutMs, delayMs: revokePollMs })

  const revokeDigest = expectedRevokeDigest || revoked.revokeDigest
  const revokeResolved = await readTransaction(client, revokeDigest)
  validateRevokeTx(revokeResolved, { wrapper, expectedDigest: expectedRevokeDigest })

  const postRevokeTick = await postJson(workerUrl, '/api/agent/tick', {
    wrapper_id: wrapper.wrapper_id,
    force_trigger: true,
  }, { Authorization: `Bearer ${internalTickToken}` })
  assert(postRevokeTick.action === 'stopped_revoked', 'Post-revoke tick did not stop on revoked mandate', postRevokeTick)
  assert(postRevokeTick.code === 'POLICY_REVOKED', 'Post-revoke tick returned wrong code', postRevokeTick)
  assert(postRevokeTick.execution_claimed === false, 'Post-revoke tick claimed execution', postRevokeTick)

  const finalActivity = await waitFor('revoked policy activity', async () => {
    const detail = await getJson(workerUrl, `/api/policies/${wrapper.wrapper_id}/activity`)
    return detail.policy?.revoked === true && detail.events?.some((event) => event.type === 'PolicyRevoked') ? detail : null
  }, { timeoutMs: 60_000, delayMs: 1_500 })

  const passReport = buildDemoExecutionReport({
    workerUrl,
    chain: DEPLOYMENT.chain,
    requireExecution: true,
    currentRunMarker: `wallet-policy-${wrapper.wrapper_id}`,
    ownerAddress: wrapper.owner,
    delegatedAgentAddress,
    poolId: strategy.pool_id,
    wrapperId: wrapper.wrapper_id,
    mandateId: wrapper.mandate_id,
    strategyHash: computedStrategyHash,
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
  passReport.report_mode = 'wallet_created_policy'
  assertStrictDemoExecutionReport(passReport)

  console.log(JSON.stringify(passReport, null, 2))
  if (reportOutPath) {
    const artifact = writeDemoExecutionReportArtifact(passReport, { outPath: reportOutPath })
    console.log(JSON.stringify({
      phase: 'report_written',
      purpose: passReport.purpose,
      report_mode: passReport.report_mode,
      artifact,
      execution_claimed: passReport.execution_claimed,
      tick_tx_digest: passReport.tick_tx_digest,
    }, null, 2))
  }
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error(e?.message || String(e))
    process.exit(1)
  })
}
