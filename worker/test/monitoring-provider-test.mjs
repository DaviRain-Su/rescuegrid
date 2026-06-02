import assert from 'node:assert/strict'
import {
  KNOWN_MONITORING_PROVIDER_KINDS,
  MONITORING_PROVIDER_GRPC,
  MONITORING_PROVIDER_TIMER_POLLING,
  configuredGrpcEndpoint,
  configuredMonitoringProviderKind,
  getMonitoringProviderStatus,
  unsupportedMonitoringProvider,
} from '../src/monitoring-provider.js'

{
  assert.equal(configuredMonitoringProviderKind({}), MONITORING_PROVIDER_TIMER_POLLING)
  assert.equal(configuredMonitoringProviderKind({ MONITORING_PROVIDER: 'timer' }), MONITORING_PROVIDER_TIMER_POLLING)
  assert.equal(configuredMonitoringProviderKind({ RESCUEGRID_MONITORING_PROVIDER: 'grpc-stream' }), MONITORING_PROVIDER_GRPC)
  assert.equal(configuredGrpcEndpoint({ SUI_GRPC_URL: 'https://grpc.example.test' }), 'https://grpc.example.test')
  assert.equal(unsupportedMonitoringProvider('bogus').code, 'UNSUPPORTED_MONITORING_PROVIDER')
}

{
  const status = getMonitoringProviderStatus({})
  assert.equal(status.kind, MONITORING_PROVIDER_TIMER_POLLING)
  assert.equal(status.provider_status, 'active')
  assert.equal(status.tick_driver, 'durable-object-alarm')
  assert.equal(status.trigger_source, 'timer')
  assert.equal(status.worker_first, true)
  assert.equal(status.execution_hot_path_unchanged, true)
  assert.equal(status.migration_ready, false)
  assert.equal(status.blocker_code, null)
  assert.deepEqual(status.known_provider_kinds, KNOWN_MONITORING_PROVIDER_KINDS)
}

{
  const status = getMonitoringProviderStatus({
    MONITORING_PROVIDER: MONITORING_PROVIDER_GRPC,
    SUI_GRPC_URL: 'https://grpc-secret.example.test?token=secret',
  })
  assert.equal(status.kind, MONITORING_PROVIDER_GRPC)
  assert.equal(status.provider_status, 'unavailable')
  assert.equal(status.grpc_configured, true)
  assert.equal(status.tick_driver, 'durable-object-alarm')
  assert.equal(status.trigger_source, 'timer')
  assert.equal(status.execution_hot_path_unchanged, true)
  assert.equal(status.blocker_code, 'GRPC_MONITORING_NOT_IMPLEMENTED')
  assert.equal(JSON.stringify(status).includes('grpc-secret.example'), false)
  assert.equal(JSON.stringify(status).includes('token=secret'), false)
}

{
  const status = getMonitoringProviderStatus({ MONITORING_PROVIDER: 'unknown-provider' })
  assert.equal(status.provider_status, 'unsupported')
  assert.equal(status.blocker_code, 'UNSUPPORTED_MONITORING_PROVIDER')
  assert.equal(status.error.code, 'UNSUPPORTED_MONITORING_PROVIDER')
}

console.log('\nALL MONITORING PROVIDER TESTS PASS')
