import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  activityHasChainEvent,
  assertStrictDemoExecutionReport,
  buildDemoExecutionReport,
  chainEventTypesFromActivity,
  findActivityChainEvent,
  strictDemoExecutionMissingEvidence,
  writeDemoExecutionReportArtifact,
} from '../scripts/demo-execution-report.mjs'

function tx(digest, { checkpoint = '42', timestampMs = '1760000000000' } = {}) {
  return {
    digest,
    checkpoint,
    timestampMs,
    effects: { status: { status: 'success' } },
  }
}

const agentTradeEvent = {
  type: 'AgentTradeExecuted',
  tx_digest: 'tickDigest',
  mandate_id: '0xmandate',
  wrapper_id: '0xwrapper',
  agent: '0xagent',
  pool_id: '0xpool',
  quote_amount_spent: '1000',
  base_amount_received: '990',
  spent_amount_after: '1000',
  budget_ceiling: '1000000',
  slippage_bps: 0,
  client_order_id: '0x0102ff',
  executed_at_ms: 1760000000000,
}

function strictReport({
  tick = {},
  wrapperId = '0xwrapper',
  mandateId = '0xmandate',
  finalActivity = {
    policy: { status: 'revoked', runtime_state: 'Revoked' },
    events: [{ type: 'PolicyCreated' }, { type: 'AgentTradeExecuted' }, { type: 'PolicyRevoked' }],
  },
} = {}) {
  return buildDemoExecutionReport({
    generatedAt: '2026-06-03T00:00:00.000Z',
    workerUrl: 'http://localhost:8787',
    requireExecution: true,
    currentRunMarker: 'demo-loop-test',
    ownerAddress: '0xowner',
    delegatedAgentAddress: '0xagent',
    poolId: '0xpool',
    wrapperId,
    mandateId,
    strategyHash: '0xstrategy',
    createResolved: tx('createDigest', { checkpoint: '41', timestampMs: '1759999999000' }),
    revokeResolved: tx('revokeDigest', { checkpoint: '43', timestampMs: '1760000001000' }),
    tickOutcome: 'executed',
    tick: {
      action: 'executed',
      tx_digest: 'tickDigest',
      execution_claimed: true,
      agent_trade_event_found: true,
      agent_trade_event: agentTradeEvent,
      spend_increased: true,
      ...tick,
    },
    beforeTickWrapper: { spent_amount: '0' },
    afterTickWrapper: { spent_amount: '1000' },
    postRevokeTick: { action: 'stopped_revoked', code: 'POLICY_REVOKED', execution_claimed: false },
    finalActivity,
    strictPreflight: {
      signer: { kind: 'worker-secret', available: true },
      funding: { execution_ready: true },
    },
  })
}

const executed = strictReport()

assert.equal(executed.purpose, 'rescuegrid_demo_execution_report')
assert.equal(executed.phase, 'pass')
assert.equal(executed.tick_outcome, 'executed')
assert.equal(executed.execution_claimed, true)
assert.equal(executed.agent_trade_event_found, true)
assert.deepEqual(executed.agent_trade_event, agentTradeEvent)
assert.equal(executed.delegated_agent_address, '0xagent')
assert.equal(executed.pool_id, '0xpool')
assert.equal(executed.spend_increased, true)
assert.equal(executed.tick_tx_digest, 'tickDigest')
assert.equal(executed.create_tx_digest, 'createDigest')
assert.equal(executed.revoke_tx_digest, 'revokeDigest')
assert.equal(executed.create_tx.timestamp_ms, 1759999999000)
assert.equal(executed.revoke_tx.timestamp_ms, 1760000001000)
assert.equal(executed.assertions.includes('G2-EXECUTE'), true)
assert.equal(executed.post_revoke.execution_claimed, false)
assert.equal(executed.post_revoke.chain_event_types.includes('AgentTradeExecuted'), true)
assert.deepEqual(strictDemoExecutionMissingEvidence(executed), [])
assert.equal(assertStrictDemoExecutionReport(executed), executed)

const activityWithoutRawEvents = {
  policy: { status: 'revoked', runtime_state: 'Revoked' },
  chain_activity: [
    { chain_event: 'PolicyCreated', tx_digest: 'createDigest' },
    { chain_event: 'AgentTradeExecuted', tx_digest: 'tickDigest' },
  ],
  activity: [
    { chain_event: 'PolicyRevoked', tx: 'revokeDigest' },
    { chain_event: 'PolicyRevoked', tx: 'revokeDigest' },
  ],
}
assert.deepEqual(chainEventTypesFromActivity(activityWithoutRawEvents), ['PolicyCreated', 'AgentTradeExecuted', 'PolicyRevoked'])
assert.equal(activityHasChainEvent(activityWithoutRawEvents, 'PolicyRevoked'), true)
assert.equal(findActivityChainEvent(activityWithoutRawEvents, 'PolicyRevoked', 'revokeDigest').tx, 'revokeDigest')
assert.equal(findActivityChainEvent(activityWithoutRawEvents, 'PolicyRevoked', 'otherDigest'), null)
const executedFromFeedOnlyActivity = strictReport({ finalActivity: activityWithoutRawEvents })
assert.deepEqual(executedFromFeedOnlyActivity.post_revoke.chain_event_types, ['PolicyCreated', 'AgentTradeExecuted', 'PolicyRevoked'])

const missingStructuredEvent = strictReport({
  tick: {
    agent_trade_event: {
      ...agentTradeEvent,
      agent: '0xotheragent',
      pool_id: '0xotherpool',
      quote_amount_spent: '',
      wrapper_id: '0xotherwrapper',
      tx_digest: 'otherTickDigest',
    },
  },
})
const missingEvidence = strictDemoExecutionMissingEvidence(missingStructuredEvent)
assert.equal(missingEvidence.includes('agent_trade_event_quote_amount_spent'), true)
assert.equal(missingEvidence.includes('agent_trade_event_wrapper'), true)
assert.equal(missingEvidence.includes('agent_trade_event_tx_digest'), true)
assert.equal(missingEvidence.includes('agent_trade_event_agent'), true)
assert.equal(missingEvidence.includes('agent_trade_event_pool'), true)
assert.throws(
  () => assertStrictDemoExecutionReport(missingStructuredEvent),
  /STRICT_EXECUTION_EVENT_INCOMPLETE/,
)

const duplicateDigestReport = strictReport({
  tick: { tx_digest: 'createDigest', agent_trade_event: { ...agentTradeEvent, tx_digest: 'createDigest' } },
})
assert.equal(strictDemoExecutionMissingEvidence(duplicateDigestReport).includes('transaction_digest_distinct'), true)

const outOfOrderReport = strictReport()
outOfOrderReport.revoke_tx.timestamp_ms = 1759999999001
assert.equal(strictDemoExecutionMissingEvidence(outOfOrderReport).includes('transaction_time_order'), true)

const missingTxTimestampReport = strictReport()
delete missingTxTimestampReport.create_tx.timestamp_ms
assert.equal(strictDemoExecutionMissingEvidence(missingTxTimestampReport).includes('create_tx_timestamp_ms'), true)

const missingAgentAndPool = strictReport()
delete missingAgentAndPool.delegated_agent_address
delete missingAgentAndPool.pool_id
const missingAgentPoolEvidence = strictDemoExecutionMissingEvidence(missingAgentAndPool)
assert.equal(missingAgentPoolEvidence.includes('delegated_agent_address'), true)
assert.equal(missingAgentPoolEvidence.includes('pool_id'), true)
assert.equal(missingAgentPoolEvidence.includes('agent_trade_event_agent'), true)
assert.equal(missingAgentPoolEvidence.includes('agent_trade_event_pool'), true)

const gated = buildDemoExecutionReport({
  tickOutcome: 'gated',
  tick: {
    action: 'blocked',
    code: 'INSUFFICIENT_DBUSDC',
    blocker_codes: ['INSUFFICIENT_DBUSDC'],
    execution_claimed: false,
  },
  beforeTickWrapper: { spent_amount: '0' },
  afterTickWrapper: { spent_amount: '0' },
})

assert.equal(gated.execution_claimed, false)
assert.equal(gated.agent_trade_event_found, false)
assert.equal(gated.agent_trade_event, null)
assert.equal(gated.spend_increased, false)
assert.equal(gated.assertions.includes('G2-DOCUMENTED-FUNDING-GATE'), true)
assert.equal(gated.assertions.includes('G2-EXECUTE'), false)

const strictGated = buildDemoExecutionReport({
  requireExecution: true,
  tickOutcome: 'gated',
  tick: {
    action: 'blocked',
    code: 'INSUFFICIENT_DBUSDC',
    blocker_codes: ['INSUFFICIENT_DBUSDC'],
    execution_claimed: false,
  },
})
assert.throws(
  () => writeDemoExecutionReportArtifact(strictGated, { outPath: join(tmpdir(), 'strict-gated-demo-execute-report.json') }),
  /STRICT_EXECUTION_EVENT_INCOMPLETE/,
)

const artifactDir = mkdtempSync(join(tmpdir(), 'rescuegrid-demo-execution-report-'))
try {
  const artifactPath = join(artifactDir, 'demo-execute-report.json')
  const artifact = writeDemoExecutionReportArtifact(executed, { outPath: artifactPath })
  assert.equal(artifact.path, artifactPath)
  assert.equal(artifact.format, 'json')
  assert(artifact.bytes > 500)
  const body = readFileSync(artifactPath, 'utf8')
  assert.match(body, /rescuegrid_demo_execution_report/)
  assert.match(body, /G2-EXECUTE/)
  assert.equal(body.includes('AGENT_KEY='), false)
  assert.equal(body.includes('INTERNAL_AGENT_TICK_TOKEN='), false)
  assert.equal(body.includes('WAAP_PERMISSION_TOKEN='), false)
} finally {
  rmSync(artifactDir, { recursive: true, force: true })
}

console.log('\nALL DEMO EXECUTION REPORT TESTS PASS')
