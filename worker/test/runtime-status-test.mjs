import assert from 'node:assert/strict'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { CHAIN_DATA_PROVIDER_GRAPHQL, CHAIN_DATA_PROVIDER_JSON_RPC } from '../src/chain-data-provider.js'
import { MONITORING_PROVIDER_GRPC, MONITORING_PROVIDER_TIMER_POLLING } from '../src/monitoring-provider.js'
import { getRuntimeStatus } from '../src/runtime-status.js'
import {
  SIGNER_CODE_PER_USER_CLOUD_SIGNER_NOT_VALIDATED,
  SIGNER_CODE_WAAP_RUNNER_MISSING,
  SIGNER_KIND_CLOUD_PER_USER,
  SIGNER_KIND_WAAP,
  SIGNER_KIND_WORKER_SECRET,
} from '../src/signer-adapters.js'
import { DEPLOYMENT } from '../src/sui-tx.js'

{
  const status = getRuntimeStatus({})
  assert.equal(status.status, 'ok')
  assert.equal(status.chain, 'sui:testnet')
  assert.equal(status.agent.address, DEPLOYMENT.agent.address)
  assert.equal(status.signer.kind, SIGNER_KIND_WORKER_SECRET)
  assert.equal(status.signer.available, false)
  assert.equal(status.signer.known_signer_kinds.includes(SIGNER_KIND_CLOUD_PER_USER), true)
  assert.equal(status.signer_capabilities.some((row) => row.kind === SIGNER_KIND_CLOUD_PER_USER && row.seal_walrus_required === true), true)
  assert.equal(status.signer_capabilities.some((row) => row.kind === SIGNER_KIND_WAAP && row.local_daemon_supported === true), true)
  assert.equal(status.external_signer.kind, SIGNER_KIND_WAAP)
  assert.equal(status.external_signer.selected, false)
  assert.equal(status.external_signer.cloud_worker_supported, false)
  assert.equal(status.external_signer.local_daemon_only, true)
  assert.equal(status.external_signer.permission_token_configured, false)
  assert.equal(status.external_signer.secrets_returned, false)
  assert.equal(status.cloud_per_user_signer.kind, SIGNER_KIND_CLOUD_PER_USER)
  assert.equal(status.cloud_per_user_signer.selected, false)
  assert.equal(status.cloud_per_user_signer.status, 'not_selected')
  assert.equal(status.cloud_per_user_signer.seal_walrus_required, true)
  assert.equal(status.cloud_per_user_signer.per_user_agent_required, true)
  assert.equal(status.cloud_per_user_signer.secrets_returned, false)
  assert.equal(status.execution.enabled, false)
  assert.equal(status.execution.blocker_code, 'EXECUTION_DISABLED')
  assert.equal(status.chain_data_provider.kind, CHAIN_DATA_PROVIDER_JSON_RPC)
  assert.equal(status.chain_data_provider.worker_first, true)
  assert.equal(status.monitoring_provider.kind, MONITORING_PROVIDER_TIMER_POLLING)
  assert.equal(status.monitoring_provider.provider_status, 'active')
  assert.equal(status.monitoring_provider.tick_driver, 'durable-object-alarm')
  assert.equal(status.monitoring_provider.execution_hot_path_unchanged, true)
  assert.equal(status.runtime.local_daemon_supported, true)
  assert.equal(status.runtime.per_user_cloud_signer_supported, true)
  assert.equal(status.runtime.per_user_cloud_signer_validated, false)
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
    SIGNER_KIND: SIGNER_KIND_CLOUD_PER_USER,
    EXECUTION_ENABLED: 'true',
    SEAL_ACCESS_TOKEN: 'seal-secret',
    WALRUS_ACCESS_TOKEN: 'walrus-secret',
  })
  assert.equal(status.signer.kind, SIGNER_KIND_CLOUD_PER_USER)
  assert.equal(status.signer.available, false)
  assert.equal(status.signer.address, null)
  assert.equal(status.signer.expected_address, DEPLOYMENT.agent.address)
  assert.equal(status.signer.unavailable_code, SIGNER_CODE_PER_USER_CLOUD_SIGNER_NOT_VALIDATED)
  assert.equal(status.execution.configured, true)
  assert.equal(status.execution.enabled, false)
  assert.equal(status.execution.blocker_code, SIGNER_CODE_PER_USER_CLOUD_SIGNER_NOT_VALIDATED)
  assert.equal(status.cloud_per_user_signer.selected, true)
  assert.equal(status.cloud_per_user_signer.status, 'unavailable')
  assert.equal(status.cloud_per_user_signer.seal_walrus_required, true)
  assert.equal(status.cloud_per_user_signer.movegate_passport_required, true)
  assert.equal(status.cloud_per_user_signer.unavailable_code, SIGNER_CODE_PER_USER_CLOUD_SIGNER_NOT_VALIDATED)
  assert.equal(JSON.stringify(status).includes('seal-secret'), false)
  assert.equal(JSON.stringify(status).includes('walrus-secret'), false)
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
  assert.equal(status.external_signer.selected, true)
  assert.equal(status.external_signer.status, 'unavailable')
  assert.equal(status.external_signer.waap_cli_enabled, false)
  assert.equal(status.external_signer.submission_runner_configured, false)
  assert.equal(status.execution.configured, true)
  assert.equal(status.execution.enabled, false)
  assert.equal(status.execution.blocker_code, 'UNSUPPORTED_SIGNER')
  assert.equal(status.chain_data_provider.kind, CHAIN_DATA_PROVIDER_GRAPHQL)
  assert.equal(status.chain_data_provider.graphql_configured, true)
}

{
  const status = getRuntimeStatus({
    MONITORING_PROVIDER: MONITORING_PROVIDER_GRPC,
    SUI_GRPC_URL: 'https://grpc-secret.example.test?token=secret',
  })
  assert.equal(status.monitoring_provider.kind, MONITORING_PROVIDER_GRPC)
  assert.equal(status.monitoring_provider.provider_status, 'unavailable')
  assert.equal(status.monitoring_provider.grpc_configured, true)
  assert.equal(status.monitoring_provider.blocker_code, 'GRPC_MONITORING_NOT_IMPLEMENTED')
  assert.equal(status.monitoring_provider.tick_driver, 'durable-object-alarm')
  assert.equal(JSON.stringify(status).includes('grpc-secret.example'), false)
  assert.equal(JSON.stringify(status).includes('token=secret'), false)
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
  assert.equal(status.signer.available, false)
  assert.equal(status.signer.address, DEPLOYMENT.agent.address)
  assert.equal(status.signer.signer_matches_expected, true)
  assert.equal(status.signer.unavailable_code, SIGNER_CODE_WAAP_RUNNER_MISSING)
  assert.equal(status.execution.enabled, false)
  assert.equal(status.execution.blocker_code, SIGNER_CODE_WAAP_RUNNER_MISSING)
  assert.equal(status.external_signer.selected, true)
  assert.equal(status.external_signer.permission_token_configured, true)
  assert.equal(status.external_signer.submission_runner_configured, false)
  assert.equal(status.external_signer.status, 'unavailable')
  assert.equal(JSON.stringify(status).includes('permission-secret'), false)
}

{
  const status = getRuntimeStatus({
    SIGNER_KIND: SIGNER_KIND_WAAP,
    RESCUEGRID_DAEMON_MODE: 'true',
    RESCUEGRID_WAAP_CLI_ENABLED: 'true',
    RESCUEGRID_WAAP_SUI_ADDRESS: DEPLOYMENT.agent.address,
    RESCUEGRID_WAAP_PERMISSION_TOKEN: 'permission-secret',
    EXECUTION_ENABLED: 'true',
  }, {
    waapCliRunner: async () => ({ stdout: JSON.stringify({ digest: '0xready' }) }),
  })
  assert.equal(status.runtime.cloud_worker, false)
  assert.equal(status.runtime.local_daemon, true)
  assert.equal(status.signer.kind, SIGNER_KIND_WAAP)
  assert.equal(status.signer.available, true)
  assert.equal(status.execution.enabled, true)
  assert.equal(status.execution.blocker_code, null)
  assert.equal(status.external_signer.status, 'available')
  assert.equal(status.external_signer.approval_state, 'ready_for_approval')
  assert.equal(status.external_signer.submission_runner_configured, true)
  assert.equal(JSON.stringify(status).includes('permission-secret'), false)
}

console.log('\nALL RUNTIME STATUS TESTS PASS')
