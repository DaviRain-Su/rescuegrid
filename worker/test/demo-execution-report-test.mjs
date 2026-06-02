import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildDemoExecutionReport,
  writeDemoExecutionReportArtifact,
} from '../scripts/demo-execution-report.mjs'

function tx(digest) {
  return {
    digest,
    checkpoint: '42',
    timestampMs: '1760000000000',
    effects: { status: { status: 'success' } },
  }
}

const executed = buildDemoExecutionReport({
  generatedAt: '2026-06-03T00:00:00.000Z',
  workerUrl: 'http://localhost:8787',
  requireExecution: true,
  currentRunMarker: 'demo-loop-test',
  ownerAddress: '0xowner',
  delegatedAgentAddress: '0xagent',
  wrapperId: '0xwrapper',
  mandateId: '0xmandate',
  strategyHash: '0xstrategy',
  createResolved: tx('createDigest'),
  revokeResolved: tx('revokeDigest'),
  tickOutcome: 'executed',
  tick: {
    action: 'executed',
    tx_digest: 'tickDigest',
    execution_claimed: true,
    agent_trade_event_found: true,
    spend_increased: true,
  },
  beforeTickWrapper: { spent_amount: '0' },
  afterTickWrapper: { spent_amount: '1000' },
  postRevokeTick: { action: 'stopped_revoked', code: 'POLICY_REVOKED', execution_claimed: false },
  finalActivity: {
    policy: { status: 'revoked', runtime_state: 'Revoked' },
    events: [{ type: 'PolicyCreated' }, { type: 'AgentTradeExecuted' }, { type: 'PolicyRevoked' }],
  },
  strictPreflight: {
    signer: { kind: 'worker-secret', available: true },
    funding: { execution_ready: true },
  },
})

assert.equal(executed.purpose, 'rescuegrid_demo_execution_report')
assert.equal(executed.phase, 'pass')
assert.equal(executed.tick_outcome, 'executed')
assert.equal(executed.execution_claimed, true)
assert.equal(executed.agent_trade_event_found, true)
assert.equal(executed.spend_increased, true)
assert.equal(executed.tick_tx_digest, 'tickDigest')
assert.equal(executed.create_tx_digest, 'createDigest')
assert.equal(executed.revoke_tx_digest, 'revokeDigest')
assert.equal(executed.assertions.includes('G2-EXECUTE'), true)
assert.equal(executed.post_revoke.execution_claimed, false)
assert.equal(executed.post_revoke.chain_event_types.includes('AgentTradeExecuted'), true)

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
assert.equal(gated.spend_increased, false)
assert.equal(gated.assertions.includes('G2-DOCUMENTED-FUNDING-GATE'), true)
assert.equal(gated.assertions.includes('G2-EXECUTE'), false)

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
