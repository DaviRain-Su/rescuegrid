import assert from 'node:assert/strict'
import {
  ADAPTER_CONFORMANCE_REQUIREMENTS,
  ADAPTER_GATE_METHODS,
  ADAPTER_INTERFACE_METHODS,
  EXECUTOR_ADAPTER_SDK_VERSION,
  assertExecutorAdapterConformance,
  buildAdapterRegistry,
  createAdapterGate,
  describeExecutorAdapter,
  listRegisteredAdapters,
  validateExecutorAdapter,
} from '../src/executor-adapter-sdk.js'

function sampleAdapter(kind = 'sample') {
  return {
    kind,
    supportsTarget(targetId) {
      return targetId === 'target-1'
    },
    targetId(wrapper) {
      return wrapper.target_id
    },
    readMarket({ market } = {}) {
      return market ?? null
    },
    liquidityGate({ wrapper } = {}) {
      return createAdapterGate({
        name: 'liquidity',
        targetId: wrapper?.target_id,
        source: 'sdk-test',
        detail: 'liquidity gate ok',
      })
    },
    volumeGate({ wrapper } = {}) {
      return createAdapterGate({
        name: 'volume',
        targetId: wrapper?.target_id,
        source: 'sdk-test',
        detail: 'volume gate ok',
      })
    },
    planExecution({ wrapper, proposed } = {}) {
      return {
        executor_kind: kind,
        target_id: wrapper.target_id,
        target_supported: this.supportsTarget(wrapper.target_id),
        quote_amount: proposed.amount,
        estimated_slippage_bps: proposed.estimated_slippage_bps,
        preview: [`Executor: ${kind}`],
      }
    },
    preview(plan) {
      return plan.preview
    },
    buildPtb() {
      return { serialize: () => 'unsigned-ptb' }
    },
    parseExecutionResult(result = {}) {
      return { digest: result.digest ?? null }
    },
  }
}

{
  assert.equal(EXECUTOR_ADAPTER_SDK_VERSION, 'rescuegrid-executor-adapter-sdk/v0')
  assert.deepEqual(ADAPTER_GATE_METHODS, ['liquidityGate', 'volumeGate'])
  assert.deepEqual(ADAPTER_CONFORMANCE_REQUIREMENTS.required_methods, ADAPTER_INTERFACE_METHODS)
  assert.deepEqual(ADAPTER_CONFORMANCE_REQUIREMENTS.required_gates, ADAPTER_GATE_METHODS)
  assert.equal(ADAPTER_CONFORMANCE_REQUIREMENTS.signing_boundary.includes('unsigned PTBs'), true)
}

{
  const gate = createAdapterGate({
    name: 'liquidity',
    targetId: 'target-1',
    source: 'sdk-test',
    detail: 'blocked by test',
    ok: false,
    code: 'LOW_LIQUIDITY',
    extra: { evidence: 'unit-test' },
  })
  assert.deepEqual(gate, {
    name: 'liquidity',
    ok: false,
    code: 'LOW_LIQUIDITY',
    target_id: 'target-1',
    source: 'sdk-test',
    detail: 'blocked by test',
    evidence: 'unit-test',
  })
}

{
  const adapter = sampleAdapter()
  const conformance = validateExecutorAdapter(adapter)
  assert.deepEqual(conformance, {
    ok: true,
    kind: 'sample',
    missing_methods: [],
    missing_properties: [],
  })
  assert.deepEqual(assertExecutorAdapterConformance(adapter), conformance)
  assert.deepEqual(describeExecutorAdapter(adapter), {
    kind: 'sample',
    sdk_version: EXECUTOR_ADAPTER_SDK_VERSION,
    interface_methods: ADAPTER_INTERFACE_METHODS,
    gate_methods: ADAPTER_GATE_METHODS,
    conformance,
  })
}

{
  const adapter = sampleAdapter()
  const registry = buildAdapterRegistry([adapter])
  assert.equal(registry.get('sample'), adapter)
  assert.deepEqual(listRegisteredAdapters(registry), [describeExecutorAdapter(adapter)])
}

{
  assert.throws(
    () => buildAdapterRegistry([sampleAdapter('dupe'), sampleAdapter('dupe')]),
    /Duplicate executor adapter kind/,
  )
  assert.throws(
    () => assertExecutorAdapterConformance({ kind: 'broken' }),
    /supportsTarget/,
  )
  assert.deepEqual(validateExecutorAdapter({ kind: '' }), {
    ok: false,
    kind: '',
    missing_methods: ADAPTER_INTERFACE_METHODS,
    missing_properties: ['kind'],
  })
}

console.log('\nALL EXECUTOR ADAPTER SDK TESTS PASS')
