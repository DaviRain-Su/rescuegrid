import { createAdapterGate } from './executor-adapter-sdk.js'
import { buildExecutionTx } from './deepbook.js'
import { DEPLOYMENT } from './sui-tx.js'

export const EXECUTOR_KIND_DEEPBOOK = 'deepbook'

function findDeepbookPool(poolId) {
  return Object.values(DEPLOYMENT.deepbook.pools).find((pool) => pool.pool_id === poolId) || null
}

function deepbookLiquidityGate({ wrapper, market } = {}) {
  return createAdapterGate({
    name: 'liquidity',
    targetId: wrapper?.pool_id ?? market?.pool_id,
    source: 'deepbook-testnet-mvp',
    detail: 'DeepBook Testnet liquidity depth checks are explicit adapter metadata for now; live execution remains blocked by funding/readiness until usable DBUSDC/DEEP exists.',
  })
}

function deepbookVolumeGate({ wrapper, market } = {}) {
  return createAdapterGate({
    name: 'volume',
    targetId: wrapper?.pool_id ?? market?.pool_id,
    source: 'deepbook-testnet-mvp',
    detail: 'DeepBook Testnet volume checks are explicit adapter metadata for now; production adapters must replace this with sustained volume evidence before autonomous execution.',
  })
}

function deepbookPreview(plan) {
  return [
    `Executor: ${EXECUTOR_KIND_DEEPBOOK}`,
    `Target pool: ${plan.target_id}`,
    `Quote amount: ${plan.quote_amount}`,
    `Max estimated slippage: ${plan.estimated_slippage_bps}bps`,
    'Expected event: AgentTradeExecuted',
  ]
}

export const deepbookAdapter = {
  kind: EXECUTOR_KIND_DEEPBOOK,

  supportsTarget(targetId) {
    return !!findDeepbookPool(targetId)
  },

  targetId(wrapper) {
    return wrapper.pool_id
  },

  readMarket({ market } = {}) {
    return market ?? null
  },

  liquidityGate({ wrapper, market } = {}) {
    return deepbookLiquidityGate({ wrapper, market })
  },

  volumeGate({ wrapper, market } = {}) {
    return deepbookVolumeGate({ wrapper, market })
  },

  planExecution({ wrapper, proposed, market } = {}) {
    const pool = findDeepbookPool(wrapper.pool_id)
    const plan = {
      executor_kind: EXECUTOR_KIND_DEEPBOOK,
      target_id: wrapper.pool_id,
      target_supported: !!pool,
      pool_id: wrapper.pool_id,
      pool,
      action_type: DEPLOYMENT.rescuegrid.action_deepbook_rescue,
      quote_amount: proposed.amount,
      estimated_slippage_bps: proposed.estimated_slippage_bps,
      market_snapshot: market ?? null,
      liquidity_gate: deepbookLiquidityGate({ wrapper, market }),
      volume_gate: deepbookVolumeGate({ wrapper, market }),
    }
    return { ...plan, preview: deepbookPreview(plan) }
  },

  preview(plan) {
    return deepbookPreview(plan)
  },

  buildPtb(plan, context) {
    if (plan.executor_kind !== EXECUTOR_KIND_DEEPBOOK) throw new Error('Executor plan kind mismatch.')
    if (plan.target_id !== context.wrapper.pool_id) throw new Error('Executor target differs from Wrapper pool_id.')
    if (plan.action_type !== DEPLOYMENT.rescuegrid.action_deepbook_rescue) throw new Error('Executor action type mismatch.')
    if (!plan.pool) throw new Error('DeepBook pool is not configured for this target.')
    return buildExecutionTx({
      wrapperId: context.wrapperId,
      mandateId: context.mandateId,
      balanceManagerId: DEPLOYMENT.agent.balance_manager_id,
      pool: plan.pool,
      quoteAmount: plan.quote_amount,
      baseReceived: context.market?.baseReceived ?? '0',
      price: context.market?.price ?? '0',
      quantity: context.market?.quantity ?? '0',
      slippageBps: plan.estimated_slippage_bps,
      clientOrderId: context.nowMs,
      expireMs: context.nowMs + 3600_000,
    })
  },

  parseExecutionResult(result = {}) {
    return {
      action: result.action ?? 'unknown',
      code: result.code ?? null,
      digest: result.tx_digest ?? result.digest ?? null,
      submitted: Boolean(result.submitted),
      execution_claimed: Boolean(result.execution_claimed),
      readiness_state: result.readiness_state ?? null,
      detail: result.detail ?? null,
    }
  },
}
