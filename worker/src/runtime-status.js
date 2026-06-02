import { configuredChainDataProviderKind, configuredGraphqlEndpoint } from './chain-data-provider.js'
import { getMonitoringProviderStatus } from './monitoring-provider.js'
import { DEPLOYMENT } from './sui-tx.js'
import { signerAdapterStatus } from './signer-adapters.js'

export function getRuntimeStatus(env = {}, options = {}) {
  const signer = signerAdapterStatus(env, options)
  const chainDataProviderKind = configuredChainDataProviderKind(env)
  return {
    status: 'ok',
    chain: 'sui:testnet',
    agent: {
      address: DEPLOYMENT.agent.address,
      balance_manager_id: DEPLOYMENT.agent.balance_manager_id,
      passport_id: DEPLOYMENT.agent.passport_id,
    },
    signer,
    execution: {
      configured: env.EXECUTION_ENABLED === 'true',
      enabled: signer.execution_enabled,
      mode: signer.kind,
      blocker_code: signer.execution_enabled ? null : signer.unavailable_code || 'EXECUTION_DISABLED',
    },
    chain_data_provider: {
      kind: chainDataProviderKind,
      graphql_configured: Boolean(configuredGraphqlEndpoint(env)),
      worker_first: true,
    },
    monitoring_provider: getMonitoringProviderStatus(env),
    runtime: {
      cloud_worker: true,
      local_daemon_supported: true,
      mainnet_requires_external_signer: true,
    },
  }
}
