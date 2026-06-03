import assert from 'node:assert/strict'
import {
  archivalReplayDiagnostic,
  chainDataProviderDiagnostic,
  privatePolicyRecordDiagnostic,
} from './data-source-diagnostics.js'

const chain = chainDataProviderDiagnostic({
  status: 'ok',
  provider_status: 'ready',
  provider_kind: 'graphql',
  transport: 'graphql',
  available: true,
  probe: { status: 'ok' },
  read_model: {
    owner_policy_list: 'graphql',
    wrapper_activity: 'json-rpc-fallback',
  },
}, { isPending: false }, { workerConfigured: true })

assert.equal(chain.available, true)
assert.equal(chain.tone, 'safe')
assert.deepEqual(chain.metrics, [
  ['Provider', 'graphql'],
  ['Transport', 'graphql'],
  ['Probe', 'ok'],
])
assert.equal(chain.readModelRows.find((row) => row.id === 'wrapper_activity').warn, true)
assert.equal(chain.readModelRows.find((row) => row.id === 'owner_policy_list').warn, false)
assert.equal(chain.probeError, null)

const probeFailed = chainDataProviderDiagnostic({
  status: 'ok',
  provider_status: 'probe_failed',
  provider_kind: 'graphql',
  transport: 'graphql',
  available: false,
  probe: { status: 'error', code: 'GRAPHQL_PROBE_FAILED', message: 'schema mismatch' },
}, { isPending: false }, { workerConfigured: true })

assert.equal(probeFailed.tone, 'warn')
assert.match(probeFailed.probeError, /GRAPHQL_PROBE_FAILED/)
assert.match(probeFailed.probeError, /schema mismatch/)

const archival = archivalReplayDiagnostic({
  status: 'ok',
  provider: {
    kind: 'none',
    provider_status: 'disabled',
    replay_only: true,
    blocker_code: 'ARCHIVAL_REPLAY_DISABLED',
  },
  query_contracts: [
    { id: 'historical_activity', label: 'Historical activity', must_not_claim_execution: true },
    { id: 'performance_replay', label: 'Performance replay', must_not_claim_execution: true },
    { id: 'judge_demo_replay', label: 'Judge demo replay', must_not_claim_execution: true },
  ],
}, { isError: false }, { workerConfigured: true })

assert.equal(archival.available, true)
assert.equal(archival.tone, 'warn')
assert.deepEqual(archival.metrics, [
  ['Provider', 'none'],
  ['Contracts', 3],
  ['Replay only', 'yes'],
])
assert.equal(archival.blocker, 'ARCHIVAL_REPLAY_DISABLED')
assert.equal(archival.contractRows.every((row) => row.mustNotClaimExecution), true)
assert.match(archival.hotPath, /unchanged/)

const privateRecords = privatePolicyRecordDiagnostic({
  status: 'ok',
  provider: {
    kind: 'seal-walrus',
    provider_status: 'not_validated',
    blocker_code: 'PRIVATE_RECORDS_NOT_VALIDATED',
  },
  object_contract: {
    implementation_status: 'contract_only',
    blocker_code: 'POLICY_PRIVATE_RECORD_MOVE_NOT_IMPLEMENTED',
  },
  record_contracts: [
    { id: 'strategy_snapshot', label: 'Strategy snapshot', client_side_encryption_required: true },
  ],
  operation_contracts: [{ id: 'create_policy_private_record' }, { id: 'add_private_record_version' }],
  event_contracts: [{ id: 'PolicyPrivateRecordCreated' }],
}, { isError: false }, { workerConfigured: true })

assert.equal(privateRecords.available, true)
assert.equal(privateRecords.tone, 'warn')
assert.deepEqual(privateRecords.metrics, [
  ['Provider', 'seal-walrus'],
  ['Records', 1],
  ['Object', 'contract_only'],
])
assert.equal(privateRecords.recordRows[0].encryptionRequired, true)
assert.equal(privateRecords.operationsCount, 2)
assert.equal(privateRecords.eventsCount, 1)
assert.equal(privateRecords.blocker, 'POLICY_PRIVATE_RECORD_MOVE_NOT_IMPLEMENTED')

const noWorker = chainDataProviderDiagnostic(null, {}, { workerConfigured: false })
assert.equal(noWorker.available, false)
assert.equal(noWorker.statusLabel, 'worker not configured')
assert.equal(noWorker.tone, 'neutral')

console.log('ALL DATA SOURCE DIAGNOSTIC TESTS PASS')
