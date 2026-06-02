import { DEPLOYMENT } from './sui-tx.js'
import { buildFundingReadiness, resolveFundingThresholds } from './read-surfaces.js'
import { getRuntimeStatus } from './runtime-status.js'

function requestedThreshold(requested, ...keys) {
  for (const key of keys) {
    const value = requested?.[key]
    if (value != null && String(value).trim() !== '') return String(value)
  }
  return undefined
}

export function resolveExecutionReadinessThresholds(env = {}, requested = {}) {
  return resolveFundingThresholds({
    configured: {
      DBUSDC: env.REQUIRED_DBUSDC_BALANCE,
      DEEP: env.REQUIRED_DEEP_BALANCE,
      SUI_MIST: env.REQUIRED_AGENT_SUI_GAS_MIST,
    },
    requested: {
      DBUSDC: requestedThreshold(requested, 'DBUSDC', 'dbusdc_threshold', 'required_dbusdc_balance'),
      DEEP: requestedThreshold(requested, 'DEEP', 'deep_threshold', 'required_deep_balance'),
      SUI_MIST: requestedThreshold(requested, 'SUI_MIST', 'sui_gas_threshold', 'required_sui_gas_mist'),
    },
  })
}

export async function buildExecutionReadiness({ env = {}, chainData = null, requested = {}, runtimeStatus = null } = {}) {
  if (!chainData) throw new Error('chainData is required')
  const status = runtimeStatus || getRuntimeStatus(env)
  const thresholds = resolveExecutionReadinessThresholds(env, requested)
  const [dbusdcBalance, deepBalance, suiBalance] = await Promise.all([
    chainData.readBalanceManagerBalance(DEPLOYMENT.deepbook.dbusdc_coin_type),
    chainData.readBalanceManagerBalance(DEPLOYMENT.deepbook.deep_coin_type),
    chainData.getAgentSuiGasBalance(DEPLOYMENT.agent.address),
  ])
  const funding = buildFundingReadiness({
    agentAddress: DEPLOYMENT.agent.address,
    balanceManagerId: DEPLOYMENT.agent.balance_manager_id,
    dbusdcBalance: dbusdcBalance.toString(),
    deepBalance: deepBalance.toString(),
    suiBalanceMist: String(suiBalance.totalBalance ?? '0'),
    executionEnabled: status.execution?.enabled === true,
    requiredDbusdcBalance: thresholds.DBUSDC.required,
    requiredDeepBalance: thresholds.DEEP.required,
    requiredSuiGasMist: thresholds.SUI_MIST.required,
    thresholdMetadata: thresholds,
    executionBlockerCode: status.execution?.blocker_code || 'EXECUTION_DISABLED',
    executionBlockerLabel: status.signer?.unavailable_detail || 'Execution disabled',
  })
  return {
    status: 'ok',
    chain: status.chain || 'sui:testnet',
    scope: {
      executor_kind: 'deepbook',
      market_id: 'SUI_DBUSDC',
      pool_id: DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id,
      budget_coin_type: DEPLOYMENT.deepbook.dbusdc_coin_type,
    },
    agent: {
      address: DEPLOYMENT.agent.address,
      balance_manager_id: DEPLOYMENT.agent.balance_manager_id,
      passport_id: DEPLOYMENT.agent.passport_id,
    },
    signer: status.signer,
    signer_capabilities: status.signer_capabilities || [],
    external_signer: status.external_signer || null,
    execution: status.execution,
    runtime: status.runtime || null,
    balance_manager: {
      id: DEPLOYMENT.agent.balance_manager_id,
      holder: 'agent_balance_manager',
      balances: { DBUSDC: funding.balances.DBUSDC, DEEP: funding.balances.DEEP },
    },
    sui_gas: { holder: DEPLOYMENT.agent.address, balance_mist: funding.balances.SUI_MIST },
    thresholds,
    funding,
    readiness_state: funding.execution_readiness_state,
    ready: funding.execution_ready,
    funding_ready: funding.funding_ready,
    execution_ready: funding.execution_ready,
    blocker_codes: funding.execution_blocker_codes,
    blocker_labels: funding.execution_blocker_labels,
    blockers: funding.execution_blockers,
    funding_blocker_codes: funding.blocker_codes,
    funding_blocker_labels: funding.blocker_labels,
    funding_blockers: funding.blockers,
    execution_claimed: false,
    source_of_truth: [
      'runtime status signer adapter',
      'DeepBook BalanceManager read from Sui Testnet',
      'agent SUI gas balance from Sui Testnet',
    ],
  }
}
