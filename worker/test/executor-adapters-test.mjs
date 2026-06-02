import assert from 'node:assert/strict'
import {
  ADAPTER_INTERFACE_METHODS,
  EXECUTOR_KIND_DEEPBOOK,
  REGISTERED_EXECUTOR_KINDS,
  deepbookAdapter,
  getExecutorAdapter,
  listExecutorAdapters,
  unsupportedExecutor,
  unsupportedExecutorTarget,
  validateExecutorAdapter,
} from '../src/executor-adapters.js'
import { DEPLOYMENT } from '../src/sui-tx.js'

const WRAPPER_ID = '0x1111111111111111111111111111111111111111111111111111111111111111'
const MANDATE_ID = '0x2222222222222222222222222222222222222222222222222222222222222222'
const POOL = DEPLOYMENT.deepbook.pools.SUI_DBUSDC
const DEEP_POOL = DEPLOYMENT.deepbook.pools.DEEP_DBUSDC
const wrapper = {
  pool_id: POOL.pool_id,
  budget_ceiling: '500000000',
  spent_amount: '0',
  max_slippage_bps: 100,
}
const proposed = {
  pool_id: POOL.pool_id,
  amount: '100000000',
  estimated_slippage_bps: 80,
}

{
  assert.deepEqual(ADAPTER_INTERFACE_METHODS, [
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
  assert.deepEqual(validateExecutorAdapter(deepbookAdapter), {
    ok: true,
    kind: EXECUTOR_KIND_DEEPBOOK,
    missing_methods: [],
    missing_properties: [],
  })
  assert.equal(validateExecutorAdapter({ kind: 'bad' }).ok, false)
  assert.deepEqual(REGISTERED_EXECUTOR_KINDS, [EXECUTOR_KIND_DEEPBOOK])
  assert.deepEqual(listExecutorAdapters(), [{
    kind: EXECUTOR_KIND_DEEPBOOK,
    interface_methods: ADAPTER_INTERFACE_METHODS,
  }])
  assert.equal(getExecutorAdapter(EXECUTOR_KIND_DEEPBOOK), deepbookAdapter)
  assert.equal(getExecutorAdapter('cetus'), null)
  assert.equal(deepbookAdapter.supportsTarget(POOL.pool_id), true)
  assert.equal(deepbookAdapter.supportsTarget(DEEP_POOL.pool_id), true)
  assert.equal(deepbookAdapter.supportsTarget('0xBAD'), false)
  const unsupported = unsupportedExecutor('cetus')
  assert.equal(unsupported.action, 'blocked')
  assert.equal(unsupported.code, 'UNSUPPORTED_EXECUTOR')
  assert.equal(unsupported.execution_claimed, false)
  const unsupportedTarget = unsupportedExecutorTarget('deepbook', '0xBAD')
  assert.equal(unsupportedTarget.action, 'blocked')
  assert.equal(unsupportedTarget.code, 'UNSUPPORTED_EXECUTOR_TARGET')
  assert.equal(unsupportedTarget.execution_claimed, false)
}

{
  const plan = deepbookAdapter.planExecution({ wrapper, proposed })
  assert.equal(plan.executor_kind, 'deepbook')
  assert.equal(plan.target_id, POOL.pool_id)
  assert.equal(plan.target_supported, true)
  assert.equal(plan.pool_id, POOL.pool_id)
  assert.equal(plan.quote_amount, proposed.amount)
  assert.equal(plan.estimated_slippage_bps, proposed.estimated_slippage_bps)
  assert.equal(plan.action_type, DEPLOYMENT.rescuegrid.action_deepbook_rescue)
  assert.equal(plan.liquidity_gate.ok, true)
  assert.equal(plan.liquidity_gate.name, 'liquidity')
  assert.equal(plan.volume_gate.ok, true)
  assert.equal(plan.volume_gate.name, 'volume')
  assert.equal(deepbookAdapter.preview(plan).some((line) => line.includes('Executor: deepbook')), true)
  assert.ok(plan.preview.some((line) => line.includes('Executor: deepbook')))
  assert.ok(plan.preview.some((line) => line.includes('Expected event: AgentTradeExecuted')))
}

{
  const market = { pool_id: POOL.pool_id, price: '1000000', quantity: '1' }
  assert.equal(deepbookAdapter.readMarket({ market }), market)
  assert.equal(deepbookAdapter.readMarket(), null)
  assert.deepEqual(deepbookAdapter.parseExecutionResult({
    action: 'executed',
    tx_digest: '0xabc',
    submitted: true,
    execution_claimed: true,
    detail: 'ok',
  }), {
    action: 'executed',
    code: null,
    digest: '0xabc',
    submitted: true,
    execution_claimed: true,
    readiness_state: null,
    detail: 'ok',
  })
}

{
  const deepWrapper = { ...wrapper, pool_id: DEEP_POOL.pool_id }
  const deepProposed = { ...proposed, pool_id: DEEP_POOL.pool_id }
  const plan = deepbookAdapter.planExecution({ wrapper: deepWrapper, proposed: deepProposed })
  assert.equal(plan.target_supported, true, 'non-default registered DeepBook pools are supported')
  assert.equal(plan.pool_id, DEEP_POOL.pool_id)
  assert.equal(plan.pool, DEEP_POOL)
}

{
  const badWrapper = { ...wrapper, pool_id: '0xBAD' }
  const badPlan = deepbookAdapter.planExecution({ wrapper: badWrapper, proposed: { ...proposed, pool_id: '0xBAD' } })
  assert.equal(badPlan.target_supported, false)
  assert.equal(badPlan.pool, null)
}

{
  const plan = deepbookAdapter.planExecution({ wrapper, proposed })
  const tx = deepbookAdapter.buildPtb(plan, {
    wrapperId: WRAPPER_ID,
    mandateId: MANDATE_ID,
    wrapper,
    market: { price: '1000000', quantity: '1', baseReceived: '0' },
    nowMs: Date.UTC(2026, 5, 2, 15, 0, 0),
  })
  assert.equal(typeof tx.serialize, 'function', 'adapter returns an unsigned Transaction builder')
}

{
  const plan = deepbookAdapter.planExecution({ wrapper, proposed })
  assert.throws(
    () => deepbookAdapter.buildPtb({ ...plan, target_id: '0xBAD' }, {
      wrapperId: WRAPPER_ID,
      mandateId: MANDATE_ID,
      wrapper,
      market: {},
      nowMs: 1,
    }),
    /Executor target differs/,
  )
  assert.throws(
    () => deepbookAdapter.buildPtb({ ...plan, action_type: 255 }, {
      wrapperId: WRAPPER_ID,
      mandateId: MANDATE_ID,
      wrapper,
      market: {},
      nowMs: 1,
    }),
    /Executor action type mismatch/,
  )
}

console.log('\nALL EXECUTOR ADAPTER TESTS PASS')
