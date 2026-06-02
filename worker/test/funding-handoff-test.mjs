import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { buildFundingHandoff, fundingHandoffEnv } from '../scripts/funding-handoff.mjs'
import { DEPLOYMENT } from '../src/sui-tx.js'

const readiness = {
  status: 'ok',
  chain: 'sui:testnet',
  scope: {
    market_id: 'SUI_DBUSDC',
    pool_id: DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id,
  },
  agent: {
    address: DEPLOYMENT.agent.address,
    passport_id: DEPLOYMENT.agent.passport_id,
    balance_manager_id: DEPLOYMENT.agent.balance_manager_id,
  },
  signer: {
    kind: 'worker-secret',
    address: DEPLOYMENT.agent.address,
    expected_address: DEPLOYMENT.agent.address,
    signer_matches_expected: true,
    available: true,
    execution_configured: false,
    execution_enabled: false,
    unavailable_code: null,
  },
  execution_ready: false,
  funding_ready: false,
  blocker_codes: ['EXECUTION_DISABLED', 'INSUFFICIENT_DBUSDC', 'INSUFFICIENT_DEEP'],
  blocker_labels: ['Execution disabled'],
  balance_manager: { id: DEPLOYMENT.agent.balance_manager_id },
  funding: {
    criteria: [
      {
        holder: DEPLOYMENT.agent.balance_manager_id,
        asset: 'DBUSDC',
        threshold: '1000',
        observed_balance: '250',
        usable: false,
        blocker_code: 'INSUFFICIENT_DBUSDC',
        source_of_truth: 'test BM read',
      },
      {
        holder: DEPLOYMENT.agent.balance_manager_id,
        asset: 'DEEP',
        threshold: '10',
        observed_balance: '0',
        usable: false,
        blocker_code: 'INSUFFICIENT_DEEP',
        source_of_truth: 'test BM read',
      },
      {
        holder: DEPLOYMENT.agent.address,
        asset: 'SUI_MIST',
        threshold: '1',
        observed_balance: '1000000',
        usable: true,
        blocker_code: 'INSUFFICIENT_GAS',
        source_of_truth: 'test gas read',
      },
    ],
  },
  source_of_truth: ['test runtime', 'test chain'],
}

const handoff = buildFundingHandoff(readiness, { generatedAt: '2026-06-03T00:00:00.000Z' })
assert.equal(handoff.status, 'ok')
assert.equal(handoff.purpose, 'external_deepbook_testnet_funding_request')
assert.equal(handoff.execution_claimed, false)
assert.equal(handoff.agent.balance_manager_id, DEPLOYMENT.agent.balance_manager_id)
assert.equal(handoff.deepbook.dbusdc_coin_type, DEPLOYMENT.deepbook.dbusdc_coin_type)
assert.equal(handoff.deepbook.deep_coin_type, DEPLOYMENT.deepbook.deep_coin_type)
assert.equal(handoff.funding_targets.balance_manager.required_assets[0].asset, 'DBUSDC')
assert.equal(handoff.funding_targets.balance_manager.required_assets[0].missing, '750')
assert.equal(handoff.funding_targets.balance_manager.required_assets[1].missing, '10')
assert.equal(handoff.funding_targets.agent_gas.required_assets[0].missing, '0')
assert.equal(handoff.next_verification.strict_execution_command, 'npm run demo:execute')
assert.equal(JSON.stringify(handoff).includes('super-secret'), false)

const env = fundingHandoffEnv({
  AGENT_KEY: 'super-secret',
  EXECUTION_ENABLED: 'true',
  REQUIRED_DBUSDC_BALANCE: '500',
})
assert.deepEqual(env, {
  AGENT_KEY: 'super-secret',
  EXECUTION_ENABLED: 'true',
  SIGNER_KIND: undefined,
  REQUIRED_DBUSDC_BALANCE: '500',
  REQUIRED_DEEP_BALANCE: undefined,
  REQUIRED_AGENT_SUI_GAS_MIST: undefined,
})

const help = spawnSync(process.execPath, ['scripts/funding-handoff.mjs', '--help'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})
assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /external funding handoff/i)
assert.match(help.stdout, /DBUSDC\/DEEP execution gate/i)
assert.equal(help.stdout.includes('AGENT_KEY='), false, 'help must not print secret assignment examples')

console.log('\nALL FUNDING HANDOFF TESTS PASS')
