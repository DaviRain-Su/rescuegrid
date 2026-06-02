import assert from 'node:assert/strict'
import {
  EXECUTOR_KIND_DEEPBOOK,
  REGISTERED_EXECUTOR_KINDS,
  deepbookAdapter,
  getExecutorAdapter,
  unsupportedExecutor,
  unsupportedExecutorTarget,
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
  assert.deepEqual(REGISTERED_EXECUTOR_KINDS, [EXECUTOR_KIND_DEEPBOOK])
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
  assert.ok(plan.preview.some((line) => line.includes('Executor: deepbook')))
  assert.ok(plan.preview.some((line) => line.includes('Expected event: AgentTradeExecuted')))
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
