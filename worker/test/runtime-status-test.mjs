import assert from 'node:assert/strict'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { CHAIN_DATA_PROVIDER_GRAPHQL, CHAIN_DATA_PROVIDER_JSON_RPC } from '../src/chain-data-provider.js'
import { getRuntimeStatus } from '../src/runtime-status.js'
import { SIGNER_KIND_WAAP, SIGNER_KIND_WORKER_SECRET } from '../src/signer-adapters.js'
import { DEPLOYMENT } from '../src/sui-tx.js'

{
  const status = getRuntimeStatus({})
  assert.equal(status.status, 'ok')
  assert.equal(status.chain, 'sui:testnet')
  assert.equal(status.agent.address, DEPLOYMENT.agent.address)
  assert.equal(status.signer.kind, SIGNER_KIND_WORKER_SECRET)
  assert.equal(status.signer.available, false)
  assert.equal(status.execution.enabled, false)
  assert.equal(status.execution.blocker_code, 'EXECUTION_DISABLED')
  assert.equal(status.chain_data_provider.kind, CHAIN_DATA_PROVIDER_JSON_RPC)
  assert.equal(status.chain_data_provider.worker_first, true)
  assert.equal(status.runtime.local_daemon_supported, true)
}

{
  const status = getRuntimeStatus({
    AGENT_KEY: 'not-a-sui-private-key',
    EXECUTION_ENABLED: 'true',
  })
  assert.equal(status.signer.available, false)
  assert.equal(status.signer.address, null)
  assert.equal(status.signer.expected_address, DEPLOYMENT.agent.address)
  assert.equal(status.signer.unavailable_code, 'INVALID_SIGNER_SECRET')
  assert.equal(status.execution.configured, true)
  assert.equal(status.execution.enabled, false)
  assert.equal(status.execution.blocker_code, 'INVALID_SIGNER_SECRET')
}

{
  const otherKey = Ed25519Keypair.generate()
  const otherAddress = otherKey.getPublicKey().toSuiAddress()
  const status = getRuntimeStatus({
    AGENT_KEY: otherKey.getSecretKey(),
    EXECUTION_ENABLED: 'true',
  })
  assert.equal(status.signer.available, false)
  assert.equal(status.signer.address, otherAddress)
  assert.equal(status.signer.expected_address, DEPLOYMENT.agent.address)
  assert.equal(status.signer.signer_matches_expected, false)
  assert.equal(status.signer.unavailable_code, 'SIGNER_ADDRESS_MISMATCH')
  assert.equal(status.execution.enabled, false)
  assert.equal(status.execution.blocker_code, 'SIGNER_ADDRESS_MISMATCH')
}

{
  const status = getRuntimeStatus({
    SIGNER_KIND: SIGNER_KIND_WAAP,
    EXECUTION_ENABLED: 'true',
    CHAIN_DATA_PROVIDER: CHAIN_DATA_PROVIDER_GRAPHQL,
    SUI_GRAPHQL_URL: 'https://example.test/graphql',
  })
  assert.equal(status.signer.kind, SIGNER_KIND_WAAP)
  assert.equal(status.signer.available, false)
  assert.equal(status.signer.unavailable_code, 'UNSUPPORTED_SIGNER')
  assert.equal(status.execution.configured, true)
  assert.equal(status.execution.enabled, false)
  assert.equal(status.execution.blocker_code, 'UNSUPPORTED_SIGNER')
  assert.equal(status.chain_data_provider.kind, CHAIN_DATA_PROVIDER_GRAPHQL)
  assert.equal(status.chain_data_provider.graphql_configured, true)
}

{
  const status = getRuntimeStatus({
    SIGNER_KIND: SIGNER_KIND_WAAP,
    RESCUEGRID_DAEMON_MODE: 'true',
    RESCUEGRID_WAAP_CLI_ENABLED: 'true',
    RESCUEGRID_WAAP_SUI_ADDRESS: DEPLOYMENT.agent.address,
    RESCUEGRID_WAAP_PERMISSION_TOKEN: 'permission-secret',
    EXECUTION_ENABLED: 'true',
  })
  assert.equal(status.signer.kind, SIGNER_KIND_WAAP)
  assert.equal(status.signer.available, true)
  assert.equal(status.signer.address, DEPLOYMENT.agent.address)
  assert.equal(status.signer.signer_matches_expected, true)
  assert.equal(status.execution.enabled, true)
  assert.equal(status.execution.blocker_code, null)
  assert.equal(JSON.stringify(status).includes('permission-secret'), false)
}

console.log('\nALL RUNTIME STATUS TESTS PASS')
