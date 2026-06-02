import {
  buildAdapterRegistry,
  listRegisteredAdapters,
  unsupportedExecutor,
} from './executor-adapter-sdk.js'
import {
  EXECUTOR_KIND_DEEPBOOK,
  deepbookAdapter,
} from './deepbook-adapter.js'

export {
  ADAPTER_CONFORMANCE_REQUIREMENTS,
  ADAPTER_GATE_METHODS,
  ADAPTER_INTERFACE_METHODS,
  EXECUTOR_ADAPTER_SDK_VERSION,
  assertExecutorAdapterConformance,
  buildAdapterRegistry,
  createAdapterGate,
  describeExecutorAdapter,
  listRegisteredAdapters,
  unsupportedExecutor,
  unsupportedExecutorTarget,
  validateExecutorAdapter,
} from './executor-adapter-sdk.js'
export { EXECUTOR_KIND_DEEPBOOK, deepbookAdapter } from './deepbook-adapter.js'

export const REGISTERED_EXECUTOR_KINDS = [EXECUTOR_KIND_DEEPBOOK]

const ADAPTERS = buildAdapterRegistry([deepbookAdapter])

export function listExecutorAdapters() {
  return listRegisteredAdapters(ADAPTERS)
}

export function getExecutorAdapter(kind) {
  return ADAPTERS.get(kind) || null
}

export function requireExecutorAdapter(kind) {
  const adapter = getExecutorAdapter(kind)
  if (!adapter) throw Object.assign(new Error(`Unsupported executor: ${kind || 'unknown'}`), unsupportedExecutor(kind))
  return adapter
}
