import { buildExecutionTx } from './deepbook.js'
import { DEPLOYMENT } from './sui-tx.js'

export const EXECUTOR_KIND_DEEPBOOK = 'deepbook'
export const REGISTERED_EXECUTOR_KINDS = [EXECUTOR_KIND_DEEPBOOK]

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

function findDeepbookPool(poolId) {
  return Object.values(DEPLOYMENT.deepbook.pools).find((pool) => pool.pool_id === poolId) || null
}

export const deepbookAdapter = {
  kind: EXECUTOR_KIND_DEEPBOOK,

  targetId(wrapper) {
    return wrapper.pool_id
  },

  planExecution({ wrapper, proposed }) {
    const pool = findDeepbookPool(wrapper.pool_id)
    return {
      executor_kind: EXECUTOR_KIND_DEEPBOOK,
      target_id: wrapper.pool_id,
      pool_id: wrapper.pool_id,
      pool,
      action_type: DEPLOYMENT.rescuegrid.action_deepbook_rescue,
      quote_amount: proposed.amount,
      estimated_slippage_bps: proposed.estimated_slippage_bps,
      preview: [
        `Executor: ${EXECUTOR_KIND_DEEPBOOK}`,
        `Target pool: ${wrapper.pool_id}`,
        `Quote amount: ${proposed.amount}`,
        `Max estimated slippage: ${proposed.estimated_slippage_bps}bps`,
        'Expected event: AgentTradeExecuted',
      ],
    }
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
}

const ADAPTERS = new Map([[deepbookAdapter.kind, deepbookAdapter]])

export function getExecutorAdapter(kind) {
  return ADAPTERS.get(kind) || null
}

export function requireExecutorAdapter(kind) {
  const adapter = getExecutorAdapter(kind)
  if (!adapter) throw Object.assign(new Error(`Unsupported executor: ${kind || 'unknown'}`), unsupportedExecutor(kind))
  return adapter
}
