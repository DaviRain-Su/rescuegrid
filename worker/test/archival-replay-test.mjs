import assert from 'node:assert/strict'
import {
  ARCHIVAL_REPLAY_PROVIDER_ARCHIVAL_STORE,
  ARCHIVAL_REPLAY_PROVIDER_NONE,
  ARCHIVAL_REPLAY_QUERY_CONTRACTS,
  configuredArchivalReplayEndpoint,
  configuredArchivalReplayProviderKind,
  getArchivalReplayContract,
  getArchivalReplayProviderStatus,
  unsupportedArchivalReplayProvider,
} from '../src/archival-replay.js'

{
  assert.equal(configuredArchivalReplayProviderKind({}), ARCHIVAL_REPLAY_PROVIDER_NONE)
  assert.equal(configuredArchivalReplayProviderKind({ ARCHIVAL_REPLAY_PROVIDER: 'disabled' }), ARCHIVAL_REPLAY_PROVIDER_NONE)
  assert.equal(configuredArchivalReplayProviderKind({ RESCUEGRID_ARCHIVAL_REPLAY_PROVIDER: 'sui-archival-store' }), ARCHIVAL_REPLAY_PROVIDER_ARCHIVAL_STORE)
  assert.equal(configuredArchivalReplayEndpoint({ SUI_ARCHIVAL_STORE_URL: 'https://archival.example.test' }), 'https://archival.example.test')
  assert.equal(unsupportedArchivalReplayProvider('bogus').code, 'UNSUPPORTED_ARCHIVAL_REPLAY_PROVIDER')
}

{
  const status = getArchivalReplayProviderStatus({})
  assert.equal(status.kind, ARCHIVAL_REPLAY_PROVIDER_NONE)
  assert.equal(status.provider_status, 'disabled')
  assert.equal(status.endpoint_configured, false)
  assert.equal(status.worker_first, true)
  assert.equal(status.replay_only, true)
  assert.equal(status.execution_hot_path_unchanged, true)
  assert.equal(status.activity_hot_path_unchanged, true)
  assert.equal(status.blocker_code, 'ARCHIVAL_REPLAY_DISABLED')
}

{
  const status = getArchivalReplayProviderStatus({
    ARCHIVAL_REPLAY_PROVIDER: ARCHIVAL_REPLAY_PROVIDER_ARCHIVAL_STORE,
    SUI_ARCHIVAL_STORE_URL: 'https://archival-secret.example.test?token=secret',
  })
  assert.equal(status.kind, ARCHIVAL_REPLAY_PROVIDER_ARCHIVAL_STORE)
  assert.equal(status.provider_status, 'not_validated')
  assert.equal(status.endpoint_configured, true)
  assert.equal(status.blocker_code, 'ARCHIVAL_REPLAY_NOT_VALIDATED')
  assert.equal(JSON.stringify(status).includes('archival-secret.example'), false)
  assert.equal(JSON.stringify(status).includes('token=secret'), false)
}

{
  const contract = getArchivalReplayContract()
  assert.equal(contract.status, 'ok')
  assert.equal(contract.chain, 'sui:testnet')
  assert.equal(contract.provider.kind, ARCHIVAL_REPLAY_PROVIDER_NONE)
  assert.equal(contract.query_contracts.length, 3)
  assert.deepEqual(contract.query_contracts.map((q) => q.id), [
    'historical_activity',
    'performance_replay',
    'judge_demo_replay',
  ])
  assert.equal(contract.query_contracts.every((q) => q.must_not_claim_execution === true), true)
  assert.equal(contract.invariants.some((row) => row.includes('Worker remains the replay contract')), true)
  assert.equal(JSON.stringify(contract).includes('AGENT_KEY'), false)
}

{
  assert.equal(ARCHIVAL_REPLAY_QUERY_CONTRACTS[0].required_outputs.includes('events[] sorted by checkpoint/timestamp'), true)
  assert.equal(ARCHIVAL_REPLAY_QUERY_CONTRACTS[1].consumers.includes('Active Strategy Detail'), true)
  assert.equal(ARCHIVAL_REPLAY_QUERY_CONTRACTS[2].required_outputs.includes('execution_claimed flags'), true)
}

console.log('\nALL ARCHIVAL REPLAY TESTS PASS')
