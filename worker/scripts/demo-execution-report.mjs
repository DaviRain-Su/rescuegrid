import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

function txMeta(tx) {
  return {
    digest: tx?.digest || null,
    status: tx?.effects?.status?.status ?? tx?.status ?? null,
    checkpoint: tx?.checkpoint ?? null,
    timestamp_ms: tx?.timestampMs ? Number(tx.timestampMs) : null,
  }
}

function stringBigInt(value) {
  if (value == null || value === '') return null
  try {
    return BigInt(String(value)).toString()
  } catch {
    return String(value)
  }
}

function bigintIncreased(before, after) {
  if (before == null || after == null) return false
  try {
    return BigInt(String(after)) > BigInt(String(before))
  } catch {
    return false
  }
}

function assertionsForOutcome(tickOutcome) {
  return [
    'G2-CREATE',
    'G2-ACTIVATE-MONITOR',
    tickOutcome === 'executed' ? 'G2-EXECUTE' : 'G2-DOCUMENTED-FUNDING-GATE',
    'G2-REVOKE',
    'G2-POST-REVOKE-NO-EXECUTION',
  ]
}

export function buildDemoExecutionReport({
  generatedAt = new Date().toISOString(),
  workerUrl = null,
  chain = 'sui:testnet',
  requireExecution = false,
  currentRunMarker = null,
  ownerAddress = null,
  delegatedAgentAddress = null,
  strategyHash = null,
  wrapperId = null,
  mandateId = null,
  createResolved = null,
  revokeResolved = null,
  tick = {},
  tickOutcome = null,
  beforeTickWrapper = null,
  afterTickWrapper = null,
  postRevokeTick = null,
  finalActivity = null,
  strictPreflight = null,
} = {}) {
  const normalizedOutcome = tickOutcome || (tick?.action === 'executed' ? 'executed' : 'gated')
  const spendBefore = stringBigInt(beforeTickWrapper?.spent_amount ?? tick?.spend_before)
  const spendAfter = stringBigInt(afterTickWrapper?.spent_amount ?? tick?.spend_after)
  const spendIncreased = tick?.spend_increased === true || bigintIncreased(spendBefore, spendAfter)
  const agentTradeEventFound = tick?.agent_trade_event_found === true
  return {
    status: 'ok',
    purpose: 'rescuegrid_demo_execution_report',
    phase: 'pass',
    generated_at: generatedAt,
    chain,
    worker_url: workerUrl,
    require_execution: Boolean(requireExecution),
    current_run_marker: currentRunMarker,
    owner_address: ownerAddress,
    delegated_agent_address: delegatedAgentAddress,
    wrapper_id: wrapperId,
    mandate_id: mandateId,
    strategy_hash: strategyHash,
    assertions: assertionsForOutcome(normalizedOutcome),
    create_tx_digest: createResolved?.digest || null,
    create_tx: txMeta(createResolved),
    revoke_tx_digest: revokeResolved?.digest || null,
    revoke_tx: txMeta(revokeResolved),
    tick_outcome: normalizedOutcome,
    action: tick?.action || null,
    code: tick?.code ?? null,
    blocker_codes: tick?.blocker_codes ?? [],
    tx_digest: tick?.tx_digest ?? null,
    tick_tx_digest: tick?.tx_digest ?? null,
    execution_claimed: tick?.execution_claimed === true,
    agent_trade_event_found: agentTradeEventFound,
    spend_before: spendBefore,
    spend_after: spendAfter,
    spend_increased: spendIncreased,
    strict_preflight: strictPreflight || null,
    post_revoke: {
      action: postRevokeTick?.action || null,
      code: postRevokeTick?.code || null,
      execution_claimed: postRevokeTick?.execution_claimed === true,
      final_policy_status: finalActivity?.policy?.status || null,
      final_runtime_state: finalActivity?.policy?.runtime_state || null,
      chain_event_types: (finalActivity?.events || []).map((event) => event.type),
    },
  }
}

export function writeDemoExecutionReportArtifact(report, { outPath } = {}) {
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
