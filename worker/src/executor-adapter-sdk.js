export const EXECUTOR_ADAPTER_SDK_VERSION = 'rescuegrid-executor-adapter-sdk/v0'

export const ADAPTER_INTERFACE_METHODS = Object.freeze([
  'supportsTarget',
  'targetId',
  'readMarket',
  'liquidityGate',
  'volumeGate',
  'planExecution',
  'preview',
  'buildPtb',
  'parseExecutionResult',
])

export const ADAPTER_GATE_METHODS = Object.freeze([
  'liquidityGate',
  'volumeGate',
])

export const ADAPTER_CONFORMANCE_REQUIREMENTS = Object.freeze({
  sdk_version: EXECUTOR_ADAPTER_SDK_VERSION,
  required_properties: Object.freeze(['kind']),
  required_methods: ADAPTER_INTERFACE_METHODS,
  required_gates: ADAPTER_GATE_METHODS,
  signing_boundary: 'Adapters build unsigned PTBs only; Runtime Core selects the signer and submits.',
})

export function createAdapterGate({ name, targetId, detail, source, ok = true, code = null, extra = {} }) {
  return {
    name,
    ok,
    code,
    target_id: targetId ?? null,
    source,
    detail,
    ...extra,
  }
}

export function validateExecutorAdapter(adapter) {
  const missingMethods = ADAPTER_INTERFACE_METHODS.filter((method) => typeof adapter?.[method] !== 'function')
  const missingProperties = typeof adapter?.kind === 'string' && adapter.kind.length > 0 ? [] : ['kind']
  return {
    ok: missingMethods.length === 0 && missingProperties.length === 0,
    kind: adapter?.kind ?? null,
    missing_methods: missingMethods,
    missing_properties: missingProperties,
  }
}

export function assertExecutorAdapterConformance(adapter) {
  const conformance = validateExecutorAdapter(adapter)
  if (!conformance.ok) {
    throw new Error(`Executor adapter ${adapter?.kind || 'unknown'} is missing required interface: ${[...conformance.missing_properties, ...conformance.missing_methods].join(', ')}`)
  }
  return conformance
}

export function describeExecutorAdapter(adapter) {
  const conformance = validateExecutorAdapter(adapter)
  return {
    kind: adapter?.kind ?? null,
    sdk_version: EXECUTOR_ADAPTER_SDK_VERSION,
    interface_methods: [...ADAPTER_INTERFACE_METHODS],
    gate_methods: [...ADAPTER_GATE_METHODS],
    conformance,
  }
}

export function buildAdapterRegistry(adapters) {
  const registry = new Map()
  for (const adapter of adapters) {
    assertExecutorAdapterConformance(adapter)
    if (registry.has(adapter.kind)) {
      throw new Error(`Duplicate executor adapter kind: ${adapter.kind}`)
    }
    registry.set(adapter.kind, adapter)
  }
  return registry
}

export function listRegisteredAdapters(registry) {
  return [...registry.values()].map(describeExecutorAdapter)
}

export function unsupportedExecutor(kind) {
  return {
    action: 'blocked',
    code: 'UNSUPPORTED_EXECUTOR',
    blocker_code: 'UNSUPPORTED_EXECUTOR',
    blocker_label: 'Unsupported executor',
    blocker_codes: ['UNSUPPORTED_EXECUTOR'],
    blocker_labels: ['Unsupported executor'],
    readiness_state: 'blocked',
    execution_claimed: false,
    detail: `Executor adapter is not registered: ${kind || 'unknown'}.`,
  }
}

export function unsupportedExecutorTarget(kind, targetId) {
  return {
    action: 'blocked',
    code: 'UNSUPPORTED_EXECUTOR_TARGET',
    blocker_code: 'UNSUPPORTED_EXECUTOR_TARGET',
    blocker_label: 'Unsupported executor target',
    blocker_codes: ['UNSUPPORTED_EXECUTOR_TARGET'],
    blocker_labels: ['Unsupported executor target'],
    readiness_state: 'blocked',
    execution_claimed: false,
    detail: `Executor adapter ${kind || 'unknown'} does not support target ${targetId || 'unknown'}.`,
  }
}
