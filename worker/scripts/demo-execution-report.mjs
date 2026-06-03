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

function stringOrNull(value) {
  return value == null ? null : String(value)
}

function numberOrNull(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function hexVector(value) {
  if (Array.isArray(value)) return `0x${value.map((b) => Number(b).toString(16).padStart(2, '0')).join('')}`
  if (value == null) return null
  return String(value)
}

function eventType(value) {
  if (!value) return null
  return String(value).split('::').pop()
}

function activityEventType(row = {}) {
  return eventType(row.type || row.chain_event || row.event_type)
}

function activityTxDigest(row = {}) {
  return row.tx || row.tx_digest || row.digest || null
}

function collectActivityRows(activity = {}) {
  const source = activity || {}
  return [
    ...(Array.isArray(source.events) ? source.events : []),
    ...(Array.isArray(source.chain_activity) ? source.chain_activity : []),
    ...(Array.isArray(source.activity) ? source.activity : []),
  ]
}

export function chainEventTypesFromActivity(activity = {}) {
  return [...new Set(collectActivityRows(activity).map(activityEventType).filter(Boolean))]
}

export function activityHasChainEvent(activity = {}, type) {
  return chainEventTypesFromActivity(activity).includes(type)
}

export function findActivityChainEvent(activity = {}, type, expectedDigest = null) {
  return collectActivityRows(activity).find((row) => (
    activityEventType(row) === type &&
    (!expectedDigest || activityTxDigest(row) === expectedDigest)
  )) || null
}

function normalizeHexAnchor(value) {
  return value == null ? null : String(value).toLowerCase()
}

function normalizeDigestAnchor(value) {
  return value == null ? null : String(value)
}

function hasPresentValue(value) {
  return value !== null && value !== undefined && String(value) !== ''
}

function txStatus(tx = {}) {
  return tx?.status || tx?.effects?.status?.status || null
}

function txTimestampMs(tx = {}) {
  return numberOrNull(tx?.timestamp_ms ?? tx?.timestampMs)
}

function missingTransactionSequenceEvidence(report = {}, event = null) {
  const missing = []
  const createDigest = report.create_tx_digest || report.create_tx?.digest || null
  const tickDigest = report.tick_tx_digest || report.tx_digest || null
  const revokeDigest = report.revoke_tx_digest || report.revoke_tx?.digest || null
  if (!createDigest || txStatus(report.create_tx) !== 'success') missing.push('create_tx_success')
  if (!revokeDigest || txStatus(report.revoke_tx) !== 'success') missing.push('revoke_tx_success')
  if (createDigest && tickDigest && revokeDigest && new Set([createDigest, tickDigest, revokeDigest]).size !== 3) {
    missing.push('transaction_digest_distinct')
  }

  const createTs = txTimestampMs(report.create_tx)
  const executedTs = numberOrNull(event?.executed_at_ms)
  const revokeTs = txTimestampMs(report.revoke_tx)
  if (createTs == null) missing.push('create_tx_timestamp_ms')
  if (revokeTs == null) missing.push('revoke_tx_timestamp_ms')
  if (createTs != null && executedTs != null && revokeTs != null && !(createTs <= executedTs && executedTs <= revokeTs)) {
    missing.push('transaction_time_order')
  }
  return missing
}

function missingPostRevokeEvidence(report = {}) {
  const missing = []
  const postRevoke = report.post_revoke || {}
  const chainEventTypes = Array.isArray(postRevoke.chain_event_types) ? postRevoke.chain_event_types : []
  if (postRevoke.action !== 'stopped_revoked') missing.push('post_revoke_action')
  if (postRevoke.code !== 'POLICY_REVOKED') missing.push('post_revoke_code')
  if (postRevoke.execution_claimed !== false) missing.push('post_revoke_execution_unclaimed')
  if (postRevoke.final_policy_status !== 'revoked') missing.push('post_revoke_policy_revoked')
  if (postRevoke.final_runtime_state !== 'Revoked') missing.push('post_revoke_runtime_revoked')
  for (const eventType of ['PolicyCreated', 'AgentTradeExecuted', 'PolicyRevoked']) {
    if (!chainEventTypes.includes(eventType)) missing.push(`chain_event:${eventType}`)
  }
  return missing
}

function agentTradeEventReportEvidence(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null
  return {
    type: eventType(event.type || event.event_type),
    tx_digest: stringOrNull(event.tx_digest || event.txDigest || event.id?.txDigest),
    mandate_id: stringOrNull(event.mandate_id),
    wrapper_id: stringOrNull(event.wrapper_id),
    agent: stringOrNull(event.agent),
    pool_id: stringOrNull(event.pool_id),
    quote_amount_spent: stringOrNull(event.quote_amount_spent),
    base_amount_received: stringOrNull(event.base_amount_received),
    spent_amount_after: stringOrNull(event.spent_amount_after),
    budget_ceiling: stringOrNull(event.budget_ceiling),
    slippage_bps: numberOrNull(event.slippage_bps),
    client_order_id: hexVector(event.client_order_id),
    executed_at_ms: numberOrNull(event.executed_at_ms ?? event.timestamp_ms),
  }
}

const REQUIRED_AGENT_TRADE_EVENT_FIELDS = [
  'agent',
  'pool_id',
  'quote_amount_spent',
  'base_amount_received',
  'spent_amount_after',
  'budget_ceiling',
  'slippage_bps',
  'client_order_id',
  'executed_at_ms',
]

export function strictDemoExecutionMissingEvidence(report = {}) {
  const missing = []
  const assertions = Array.isArray(report.assertions) ? report.assertions : []
  const txDigest = report.tick_tx_digest || report.tx_digest || null
  const event = report.agent_trade_event
  if (report.purpose !== 'rescuegrid_demo_execution_report') missing.push('purpose')
  if (report.chain !== 'sui:testnet') missing.push('chain')
  if (report.require_execution !== true) missing.push('require_execution')
  if (report.phase !== 'pass') missing.push('phase')
  if (!assertions.includes('G2-EXECUTE')) missing.push('assertions_G2_EXECUTE')
  if (report.tick_outcome !== 'executed' && report.action !== 'executed') missing.push('tick_outcome')
  if (!report.owner_address) missing.push('owner_address')
  if (!report.delegated_agent_address) missing.push('delegated_agent_address')
  if (!report.pool_id) missing.push('pool_id')
  if (!report.wrapper_id) missing.push('wrapper_id')
  if (!report.mandate_id) missing.push('mandate_id')
  if (!report.strategy_hash) missing.push('strategy_hash')
  if (report.execution_claimed !== true) missing.push('execution_claimed')
  if (!txDigest) missing.push('tick_tx_digest')
  if (report.agent_trade_event_found !== true) missing.push('agent_trade_event_found')
  if (report.spend_increased !== true) missing.push('spend_increased')
  missing.push(...missingPostRevokeEvidence(report))
  if (!event) return [...missing, 'agent_trade_event']
  if (event.type !== 'AgentTradeExecuted') missing.push('agent_trade_event_type')
  if (
    !event.tx_digest ||
    !txDigest ||
    normalizeDigestAnchor(event.tx_digest) !== normalizeDigestAnchor(txDigest)
  ) missing.push('agent_trade_event_tx_digest')
  if (
    !event.wrapper_id ||
    !report.wrapper_id ||
    normalizeHexAnchor(event.wrapper_id) !== normalizeHexAnchor(report.wrapper_id)
  ) missing.push('agent_trade_event_wrapper')
  if (
    !event.mandate_id ||
    !report.mandate_id ||
    normalizeHexAnchor(event.mandate_id) !== normalizeHexAnchor(report.mandate_id)
  ) missing.push('agent_trade_event_mandate')
  if (
    !event.agent ||
    !report.delegated_agent_address ||
    normalizeHexAnchor(event.agent) !== normalizeHexAnchor(report.delegated_agent_address)
  ) missing.push('agent_trade_event_agent')
  if (
    !event.pool_id ||
    !report.pool_id ||
    normalizeHexAnchor(event.pool_id) !== normalizeHexAnchor(report.pool_id)
  ) missing.push('agent_trade_event_pool')
  for (const field of REQUIRED_AGENT_TRADE_EVENT_FIELDS) {
    if (!hasPresentValue(event[field])) missing.push(`agent_trade_event_${field}`)
  }
  missing.push(...missingTransactionSequenceEvidence(report, event))
  return missing
}

export function assertStrictDemoExecutionReport(report = {}) {
  const missingEvidence = strictDemoExecutionMissingEvidence(report)
  if (missingEvidence.length === 0) return report
  const detail = {
    code: 'STRICT_EXECUTION_EVENT_INCOMPLETE',
    missing_live_evidence: missingEvidence,
    wrapper_id: report.wrapper_id || null,
    mandate_id: report.mandate_id || null,
    tick_tx_digest: report.tick_tx_digest || report.tx_digest || null,
  }
  throw new Error(`Strict demo execution report lacks structured AgentTradeExecuted evidence\n${JSON.stringify(detail, null, 2)}`)
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
  poolId = null,
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
  const agentTradeEvent = agentTradeEventReportEvidence(tick?.agent_trade_event)
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
    pool_id: poolId,
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
    agent_trade_event: agentTradeEvent,
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
      chain_event_types: chainEventTypesFromActivity(finalActivity),
    },
  }
}

export function writeDemoExecutionReportArtifact(report, { outPath } = {}) {
  if (!outPath) throw new Error('outPath is required')
  if (report?.require_execution === true) assertStrictDemoExecutionReport(report)
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
