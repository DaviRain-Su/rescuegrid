import assert from 'node:assert/strict'
import {
  buildExecutionReadiness,
  resolveExecutionReadinessThresholds,
} from '../src/execution-readiness.js'
import { getRuntimeStatus } from '../src/runtime-status.js'
import { SIGNER_KIND_WAAP } from '../src/signer-adapters.js'
import { DEPLOYMENT } from '../src/sui-tx.js'

function chainData({ dbusdc = '1000', deep = '10', suiMist = '1000000' } = {}) {
  return {
    async readBalanceManagerBalance(coinType) {
      if (coinType === DEPLOYMENT.deepbook.dbusdc_coin_type) return BigInt(dbusdc)
      if (coinType === DEPLOYMENT.deepbook.deep_coin_type) return BigInt(deep)
      throw new Error(`unexpected coin type ${coinType}`)
    },
    async getAgentSuiGasBalance(owner) {
      assert.equal(owner, DEPLOYMENT.agent.address)
      return { totalBalance: String(suiMist) }
    },
  }
}

function readyRuntimeStatus() {
  return {
    status: 'ok',
    chain: 'sui:testnet',
    signer: {
      kind: 'worker-secret',
      address: DEPLOYMENT.agent.address,
      expected_address: DEPLOYMENT.agent.address,
      signer_matches_expected: true,
      available: true,
      execution_configured: true,
      execution_enabled: true,
      unavailable_code: null,
      unavailable_detail: null,
    },
    execution: {
      configured: true,
      enabled: true,
      mode: 'worker-secret',
      blocker_code: null,
    },
  }
}

{
  const readiness = await buildExecutionReadiness({
    env: { AGENT_KEY: 'configured-for-status-only', EXECUTION_ENABLED: 'true' },
    chainData: chainData(),
    requested: { dbusdc_threshold: '100', deep_threshold: '1', sui_gas_threshold: '1000' },
  })
  assert.equal(readiness.status, 'ok')
  assert.equal(readiness.chain, 'sui:testnet')
  assert.equal(readiness.scope.executor_kind, 'deepbook')
  assert.equal(readiness.ready, false)
  assert.equal(readiness.execution_ready, false)
  assert.equal(readiness.funding_ready, true)
  assert.deepEqual(readiness.blocker_codes, ['INVALID_SIGNER_SECRET'])
  assert.equal(readiness.execution_claimed, false, 'readiness never claims a transaction execution')
  assert.equal(readiness.signer.kind, 'worker-secret')
  assert.equal(readiness.signer.address, null)
  assert.equal(readiness.signer.expected_address, DEPLOYMENT.agent.address)
  assert.equal(readiness.execution.enabled, false)
}

{
  const readiness = await buildExecutionReadiness({
    env: {},
    chainData: chainData(),
    requested: { dbusdc_threshold: '100', deep_threshold: '1', sui_gas_threshold: '1000' },
    runtimeStatus: readyRuntimeStatus(),
  })
  assert.equal(readiness.ready, true)
  assert.equal(readiness.execution_ready, true)
  assert.equal(readiness.funding_ready, true)
  assert.deepEqual(readiness.blocker_codes, [])
  assert.equal(readiness.execution_claimed, false, 'readiness never claims a transaction execution')
  assert.equal(readiness.signer.kind, 'worker-secret')
  assert.equal(readiness.execution.enabled, true)
}

{
  const readiness = await buildExecutionReadiness({
    env: { SIGNER_KIND: SIGNER_KIND_WAAP, EXECUTION_ENABLED: 'true' },
    chainData: chainData(),
  })
  assert.equal(readiness.funding_ready, true)
  assert.equal(readiness.execution_ready, false)
  assert.equal(readiness.ready, false)
  assert.deepEqual(readiness.blocker_codes, ['UNSUPPORTED_SIGNER'])
  assert.equal(readiness.signer.kind, SIGNER_KIND_WAAP)
}

{
  const readiness = await buildExecutionReadiness({
    env: {
      SIGNER_KIND: SIGNER_KIND_WAAP,
      RESCUEGRID_DAEMON_MODE: 'true',
      RESCUEGRID_WAAP_CLI_ENABLED: 'true',
      RESCUEGRID_WAAP_SUI_ADDRESS: DEPLOYMENT.agent.address,
      EXECUTION_ENABLED: 'true',
    },
    chainData: chainData(),
  })
  assert.equal(readiness.signer.kind, SIGNER_KIND_WAAP)
  assert.equal(readiness.signer.available, false)
  assert.equal(readiness.blocker_codes.includes('WAAP_RUNNER_MISSING'), true)
  assert.equal(readiness.funding_ready, true)
  assert.equal(readiness.execution_ready, false)
  assert.equal(readiness.execution_claimed, false)
}

{
  const env = {
    SIGNER_KIND: SIGNER_KIND_WAAP,
    RESCUEGRID_DAEMON_MODE: 'true',
    RESCUEGRID_WAAP_CLI_ENABLED: 'true',
    RESCUEGRID_WAAP_SUI_ADDRESS: DEPLOYMENT.agent.address,
    EXECUTION_ENABLED: 'true',
  }
  const readiness = await buildExecutionReadiness({
    env,
    chainData: chainData(),
    runtimeStatus: getRuntimeStatus(env, {
      waapCliRunner: async () => ({ stdout: JSON.stringify({ digest: '0xready' }) }),
    }),
  })
  assert.equal(readiness.signer.kind, SIGNER_KIND_WAAP)
  assert.equal(readiness.signer.available, true)
  assert.equal(readiness.funding_ready, true)
  assert.equal(readiness.execution_ready, true)
  assert.equal(readiness.execution_claimed, false)
}

{
  const thresholds = resolveExecutionReadinessThresholds(
    { REQUIRED_DBUSDC_BALANCE: '500', REQUIRED_DEEP_BALANCE: '5', REQUIRED_AGENT_SUI_GAS_MIST: '2000' },
    { dbusdc_threshold: '1', deep_threshold: '1', sui_gas_threshold: '1' },
  )
  assert.equal(thresholds.DBUSDC.required, '500')
  assert.equal(thresholds.DEEP.required, '5')
  assert.equal(thresholds.SUI_MIST.required, '2000')

  const readiness = await buildExecutionReadiness({
    env: { REQUIRED_DBUSDC_BALANCE: '500' },
    chainData: chainData({ dbusdc: '499' }),
    requested: { dbusdc_threshold: '1' },
    runtimeStatus: readyRuntimeStatus(),
  })
  assert.equal(readiness.funding_ready, false)
  assert.equal(readiness.execution_ready, false)
  assert.deepEqual(readiness.funding_blocker_codes, ['INSUFFICIENT_DBUSDC'])
}

console.log('\nALL EXECUTION READINESS TESTS PASS')
