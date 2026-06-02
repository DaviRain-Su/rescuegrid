export const MONITORING_PROVIDER_TIMER_POLLING = 'timer-polling'
export const MONITORING_PROVIDER_GRPC = 'grpc'
export const KNOWN_MONITORING_PROVIDER_KINDS = Object.freeze([
  MONITORING_PROVIDER_TIMER_POLLING,
  MONITORING_PROVIDER_GRPC,
])

function normalizeMonitoringProviderKind(kind) {
  const value = String(kind || MONITORING_PROVIDER_TIMER_POLLING).trim().toLowerCase()
  if (value === 'timer' || value === 'polling' || value === 'durable-object-alarm') return MONITORING_PROVIDER_TIMER_POLLING
  if (value === 'grpc-stream' || value === 'sui-grpc') return MONITORING_PROVIDER_GRPC
  return value
}

export function configuredMonitoringProviderKind(env = {}) {
  return normalizeMonitoringProviderKind(
    env.MONITORING_PROVIDER
    || env.RESCUEGRID_MONITORING_PROVIDER
    || MONITORING_PROVIDER_TIMER_POLLING,
  )
}

export function configuredGrpcEndpoint(env = {}) {
  return String(env.SUI_GRPC_URL || env.SUI_GRPC_ENDPOINT || env.GRPC_URL || '').trim()
}

export function unsupportedMonitoringProvider(kind) {
  return {
    status: 'error',
    code: 'UNSUPPORTED_MONITORING_PROVIDER',
    provider_kind: kind || 'unknown',
    message: `Unsupported monitoring provider: ${kind || 'unknown'}. Current implementation supports timer-polling and a disabled grpc spike boundary.`,
  }
}

export function getMonitoringProviderStatus(env = {}) {
  const kind = configuredMonitoringProviderKind(env)
  const grpcEndpointConfigured = Boolean(configuredGrpcEndpoint(env))
  if (kind === MONITORING_PROVIDER_TIMER_POLLING) {
    return {
      kind,
      known_provider_kinds: KNOWN_MONITORING_PROVIDER_KINDS,
      provider_status: 'active',
      worker_first: true,
      tick_driver: 'durable-object-alarm',
      trigger_source: 'timer',
      grpc_configured: grpcEndpointConfigured,
      hot_path: 'runtime-core-tick',
      execution_hot_path_unchanged: true,
      migration_ready: false,
      blocker_code: null,
    }
  }
  if (kind === MONITORING_PROVIDER_GRPC) {
    return {
      kind,
      known_provider_kinds: KNOWN_MONITORING_PROVIDER_KINDS,
      provider_status: 'unavailable',
      worker_first: true,
      tick_driver: 'durable-object-alarm',
      trigger_source: 'timer',
      grpc_configured: grpcEndpointConfigured,
      hot_path: 'runtime-core-tick',
      execution_hot_path_unchanged: true,
      migration_ready: false,
      blocker_code: 'GRPC_MONITORING_NOT_IMPLEMENTED',
      unavailable_detail: grpcEndpointConfigured
        ? 'gRPC endpoint is configured, but streaming monitoring is not wired into Runtime Core or Durable Object scheduling.'
        : 'gRPC monitoring requires an endpoint and a reviewed Runtime Core integration before it can replace timer polling.',
    }
  }
  return {
    kind,
    known_provider_kinds: KNOWN_MONITORING_PROVIDER_KINDS,
    provider_status: 'unsupported',
    worker_first: true,
    tick_driver: 'durable-object-alarm',
    trigger_source: 'timer',
    grpc_configured: grpcEndpointConfigured,
    hot_path: 'runtime-core-tick',
    execution_hot_path_unchanged: true,
    migration_ready: false,
    blocker_code: 'UNSUPPORTED_MONITORING_PROVIDER',
    error: unsupportedMonitoringProvider(kind),
  }
}
