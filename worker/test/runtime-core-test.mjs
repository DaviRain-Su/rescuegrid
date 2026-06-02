import assert from 'node:assert/strict'
import {
  RUNTIME_CORE_BOUNDARIES,
  buildProposedTrade,
  prepareRuntimeExecution,
  runtimeCoreStatus,
} from '../src/runtime-core.js'
import { DEPLOYMENT } from '../src/sui-tx.js'

const POOL = DEPLOYMENT.deepbook.pools.SUI_DBUSDC
const wrapper = {
  mandate_id: '0x2222222222222222222222222222222222222222222222222222222222222222',
  agent: DEPLOYMENT.agent.address,
  pool_id: POOL.pool_id,
  budget_ceiling: '500000000',
  spent_amount: '450000000',
  max_slippage_bps: 100,
}
const mandate = {
  id: wrapper.mandate_id,
  agent: DEPLOYMENT.agent.address,
  revoked: false,
  expires_at_ms: '1800000000000',
}
const market = {
  pool_id: POOL.pool_id,
  estimated_slippage_bps: 77,
  price: '1000000',
  quantity: '1',
}

{
  assert.equal(Object.hasOwn(RUNTIME_CORE_BOUNDARIES, 'policy_reader'), true)
  assert.equal(Object.hasOwn(RUNTIME_CORE_BOUNDARIES, 'guardian'), true)
  assert.equal(Object.hasOwn(RUNTIME_CORE_BOUNDARIES, 'executor_adapter_registry'), true)
  assert.equal(Object.hasOwn(RUNTIME_CORE_BOUNDARIES, 'activity_writer'), true)
  const status = runtimeCoreStatus()
  assert.equal(status.registered_adapters.length, 1)
  assert.equal(status.registered_adapters[0].kind, 'deepbook')
  assert.equal(status.registered_adapters[0].interface_methods.includes('buildPtb'), true)
}

{
  const proposed = buildProposedTrade({ wrapper, market })
  assert.equal(proposed.pool_id, POOL.pool_id)
  assert.equal(proposed.amount, '50000000', 'per-trade amount is capped by remaining budget')
  assert.equal(proposed.estimated_slippage_bps, 77)
}

{
  const proposed = buildProposedTrade({ wrapper, market })
  const prepared = await prepareRuntimeExecution({
    wrapperId: '0x1111111111111111111111111111111111111111111111111111111111111111',
    mandateId: wrapper.mandate_id,
    wrapper,
    mandate,
    proposed,
    nowMs: 1,
    market,
    executorKind: 'deepbook',
    constructionPath: 'runtime-core-test',
  })
  assert.equal(prepared.ok, true)
  assert.equal(prepared.executor_kind, 'deepbook')
  assert.equal(prepared.expected_target_id, POOL.pool_id)
  assert.equal(prepared.market_snapshot, market)
  assert.equal(prepared.execution_plan.executor_kind, 'deepbook')
  assert.equal(prepared.execution_plan.venue, 'DeepBook')
  assert.equal(prepared.execution_plan.liquidity_gate.ok, true)
  assert.equal(prepared.execution_plan.volume_gate.ok, true)
}

{
  const proposed = buildProposedTrade({ wrapper, market })
  const prepared = await prepareRuntimeExecution({
    wrapperId: '0x1111111111111111111111111111111111111111111111111111111111111111',
    mandateId: wrapper.mandate_id,
    wrapper,
    mandate,
    proposed,
    nowMs: 1,
    market,
    executorKind: 'cetus',
    constructionPath: 'runtime-core-test',
  })
  assert.equal(prepared.ok, false)
  assert.equal(prepared.result.code, 'UNSUPPORTED_EXECUTOR')
  assert.equal(prepared.result.construction_path, 'runtime-core-test')
}

{
  const badWrapper = { ...wrapper, pool_id: '0xBAD' }
  const proposed = buildProposedTrade({ wrapper: badWrapper, market: { ...market, pool_id: '0xBAD' } })
  const prepared = await prepareRuntimeExecution({
    wrapperId: '0x1111111111111111111111111111111111111111111111111111111111111111',
    mandateId: wrapper.mandate_id,
    wrapper: badWrapper,
    mandate,
    proposed,
    nowMs: 1,
    executorKind: 'deepbook',
    constructionPath: 'runtime-core-test',
  })
  assert.equal(prepared.ok, false)
  assert.equal(prepared.result.code, 'UNSUPPORTED_EXECUTOR_TARGET')
  assert.equal(prepared.result.execution_plan.target_supported, false)
}

console.log('\nALL RUNTIME CORE TESTS PASS')
