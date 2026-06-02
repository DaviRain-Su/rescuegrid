import assert from 'node:assert/strict'
import {
  PRIVATE_POLICY_RECORD_CONTRACTS,
  PRIVATE_RECORD_PROVIDER_NONE,
  PRIVATE_RECORD_PROVIDER_SEAL_WALRUS,
  configuredPrivateRecordProviderKind,
  getPrivatePolicyRecordContract,
  getPrivateRecordProviderStatus,
  privateRecordProviderConfig,
  unsupportedPrivateRecordProvider,
} from '../src/private-policy-records.js'

{
  assert.equal(configuredPrivateRecordProviderKind({}), PRIVATE_RECORD_PROVIDER_NONE)
  assert.equal(configuredPrivateRecordProviderKind({ PRIVATE_RECORD_PROVIDER: 'off' }), PRIVATE_RECORD_PROVIDER_NONE)
  assert.equal(configuredPrivateRecordProviderKind({ RESCUEGRID_PRIVATE_RECORD_PROVIDER: 'seal_walrus' }), PRIVATE_RECORD_PROVIDER_SEAL_WALRUS)
  assert.equal(privateRecordProviderConfig({ SEAL_CONFIGURED: 'true', WALRUS_CONFIGURED: 'false' }).seal_configured, true)
  assert.equal(privateRecordProviderConfig({ SEAL_CONFIGURED: 'true', WALRUS_CONFIGURED: 'false' }).walrus_configured, false)
  assert.equal(unsupportedPrivateRecordProvider('bogus').code, 'UNSUPPORTED_PRIVATE_RECORD_PROVIDER')
}

{
  const status = getPrivateRecordProviderStatus({})
  assert.equal(status.kind, PRIVATE_RECORD_PROVIDER_NONE)
  assert.equal(status.provider_status, 'disabled')
  assert.equal(status.worker_first, true)
  assert.equal(status.read_only_contract, true)
  assert.equal(status.client_side_encryption_required, true)
  assert.equal(status.signing_secret_allowed, false)
  assert.equal(status.storage_hot_path_unchanged, true)
  assert.equal(status.execution_hot_path_unchanged, true)
  assert.equal(status.blocker_code, 'PRIVATE_RECORDS_DISABLED')
}

{
  const status = getPrivateRecordProviderStatus({
    PRIVATE_RECORD_PROVIDER: PRIVATE_RECORD_PROVIDER_SEAL_WALRUS,
  })
  assert.equal(status.kind, PRIVATE_RECORD_PROVIDER_SEAL_WALRUS)
  assert.equal(status.provider_status, 'unavailable')
  assert.equal(status.seal_configured, false)
  assert.equal(status.walrus_configured, false)
  assert.equal(status.blocker_code, 'PRIVATE_RECORDS_CONFIG_REQUIRED')
}

{
  const status = getPrivateRecordProviderStatus({
    PRIVATE_RECORD_PROVIDER: PRIVATE_RECORD_PROVIDER_SEAL_WALRUS,
    SEAL_API_URL: 'https://seal-secret.example.test?token=seal-secret',
    WALRUS_API_URL: 'https://walrus-secret.example.test?token=walrus-secret',
  })
  const text = JSON.stringify(status)
  assert.equal(status.provider_status, 'not_validated')
  assert.equal(status.seal_configured, true)
  assert.equal(status.walrus_configured, true)
  assert.equal(status.blocker_code, 'PRIVATE_RECORDS_NOT_VALIDATED')
  assert.equal(text.includes('seal-secret.example'), false)
  assert.equal(text.includes('walrus-secret.example'), false)
  assert.equal(text.includes('token='), false)
}

{
  const contract = getPrivatePolicyRecordContract({
    PRIVATE_RECORD_PROVIDER: PRIVATE_RECORD_PROVIDER_SEAL_WALRUS,
    RESCUEGRID_SEAL_CONFIGURED: 'true',
    RESCUEGRID_WALRUS_CONFIGURED: 'true',
  })
  const text = JSON.stringify(contract)
  assert.equal(contract.status, 'ok')
  assert.equal(contract.chain, 'sui:testnet')
  assert.equal(contract.provider.kind, PRIVATE_RECORD_PROVIDER_SEAL_WALRUS)
  assert.equal(contract.provider.provider_status, 'not_validated')
  assert.deepEqual(contract.record_contracts.map((row) => row.id), [
    'strategy_snapshot',
    'backtest_report',
    'agent_reasoning_trace',
    'incident_report',
  ])
  assert.equal(contract.record_contracts.every((row) => row.client_side_encryption_required === true), true)
  assert.equal(contract.record_contracts.every((row) => row.signing_secret_allowed === false), true)
  assert.equal(contract.record_contracts.every((row) => row.disallowed_fields.includes('AGENT_KEY')), true)
  assert.equal(contract.record_contracts.every((row) => row.disallowed_fields.includes('owner_wallet_private_key')), true)
  assert.equal(contract.access_model.agent_can_decrypt_by_default, false)
  assert.equal(contract.access_model.worker_can_decrypt_by_default, false)
  assert.equal(contract.access_model.on_chain_payload_policy, 'hashes_and_blob_ids_only')
  assert.equal(text.includes('AGENT_KEY'), true, 'secret key name may appear only as disallowed schema metadata')
  assert.equal(text.includes('permission-secret'), false)
}

{
  const trace = PRIVATE_POLICY_RECORD_CONTRACTS.find((row) => row.id === 'agent_reasoning_trace')
  assert.equal(trace.encrypted_payload_fields.includes('operator_reasoning_summary'), true)
  assert.equal(trace.disallowed_fields.includes('raw model hidden reasoning'), true)
  assert.equal(trace.current_fallback.includes('public blocked/no-op'), true)
}

{
  const status = getPrivateRecordProviderStatus({ PRIVATE_RECORD_PROVIDER: 'bogus' })
  assert.equal(status.provider_status, 'unsupported')
  assert.equal(status.blocker_code, 'UNSUPPORTED_PRIVATE_RECORD_PROVIDER')
  assert.equal(status.error.code, 'UNSUPPORTED_PRIVATE_RECORD_PROVIDER')
}

console.log('\nALL PRIVATE POLICY RECORD TESTS PASS')
