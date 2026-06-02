import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  buildFundingWatchReport,
  fundingWatchOptions,
  parseFundingWatchArgs,
  runFundingWatch,
} from '../scripts/funding-watch.mjs'
import { DEPLOYMENT } from '../src/sui-tx.js'

function readiness({ executionReady = false } = {}) {
  return {
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
      address: executionReady ? DEPLOYMENT.agent.address : null,
      expected_address: DEPLOYMENT.agent.address,
      signer_matches_expected: executionReady,
      available: executionReady,
      execution_configured: executionReady,
      execution_enabled: executionReady,
      unavailable_code: executionReady ? null : 'EXECUTION_DISABLED',
    },
    execution_ready: executionReady,
    funding_ready: executionReady,
    blocker_codes: executionReady ? [] : ['EXECUTION_DISABLED', 'INSUFFICIENT_DBUSDC'],
    blocker_labels: executionReady ? [] : ['Execution disabled', 'BalanceManager DBUSDC below required threshold'],
    balance_manager: { id: DEPLOYMENT.agent.balance_manager_id },
    funding: {
      criteria: [
        {
          holder: DEPLOYMENT.agent.balance_manager_id,
          asset: 'DBUSDC',
          threshold: '100',
          observed_balance: executionReady ? '100' : '0',
          usable: executionReady,
          blocker_code: 'INSUFFICIENT_DBUSDC',
          source_of_truth: 'test BM read',
        },
        {
          holder: DEPLOYMENT.agent.balance_manager_id,
          asset: 'DEEP',
          threshold: '1',
          observed_balance: executionReady ? '1' : '0',
          usable: executionReady,
          blocker_code: 'INSUFFICIENT_DEEP',
          source_of_truth: 'test BM read',
        },
        {
          holder: DEPLOYMENT.agent.address,
          asset: 'SUI_MIST',
          threshold: '1',
          observed_balance: '1000',
          usable: true,
          blocker_code: 'INSUFFICIENT_GAS',
          source_of_truth: 'test gas read',
        },
      ],
    },
    source_of_truth: ['test runtime', 'test chain'],
  }
}

{
  const flags = parseFundingWatchArgs(['--json', '--wait', '--max-attempts', '7', '--dbusdc-threshold=100'])
  const opts = fundingWatchOptions(flags)
  assert.equal(opts.format, 'json')
  assert.equal(opts.wait, true)
  assert.equal(opts.once, false)
  assert.equal(opts.maxAttempts, 7)
  assert.equal(opts.requested.dbusdc_threshold, '100')
}

{
  const report = buildFundingWatchReport(readiness({ executionReady: false }), {
    attempt: 2,
    maxAttempts: 3,
    generatedAt: '2026-06-03T00:00:00.000Z',
    runDemo: true,
  })
  assert.equal(report.purpose, 'deepbook_execution_funding_watch')
  assert.equal(report.execution_ready, false)
  assert.equal(report.would_run_demo, false)
  assert.equal(report.policy_creation_allowed, false)
  assert.equal(report.policy_creation_blocked, true)
  assert.equal(report.execution_claimed, false)
  assert.equal(report.funding_targets.balance_manager.required_assets[0].missing, '100')
  assert.equal(JSON.stringify(report).includes('super-secret'), false)
}

{
  let demoCalls = 0
  const code = await runFundingWatch({
    options: fundingWatchOptions(parseFundingWatchArgs(['--json', '--run-demo'])),
    loadReadiness: async () => readiness({ executionReady: false }),
    runDemo: async () => {
      demoCalls += 1
      return 0
    },
    generatedAt: () => '2026-06-03T00:00:00.000Z',
    print: () => {},
  })
  assert.equal(code, 1)
  assert.equal(demoCalls, 0, 'blocked funding must not launch strict demo')
}

{
  let demoCalls = 0
  const code = await runFundingWatch({
    options: fundingWatchOptions(parseFundingWatchArgs(['--json', '--run-demo', '--worker-url', 'http://localhost:8787'])),
    loadReadiness: async () => readiness({ executionReady: true }),
    runDemo: async ({ workerUrl }) => {
      demoCalls += 1
      assert.equal(workerUrl, 'http://localhost:8787')
      return 0
    },
    generatedAt: () => '2026-06-03T00:00:00.000Z',
    print: () => {},
  })
  assert.equal(code, 0)
  assert.equal(demoCalls, 1)
}

{
  let attempts = 0
  const code = await runFundingWatch({
    options: fundingWatchOptions(parseFundingWatchArgs(['--json', '--wait', '--max-attempts', '2', '--interval-ms', '1'])),
    loadReadiness: async () => {
      attempts += 1
      return readiness({ executionReady: attempts === 2 })
    },
    sleep: async () => {},
    generatedAt: () => '2026-06-03T00:00:00.000Z',
    print: () => {},
  })
  assert.equal(code, 0)
  assert.equal(attempts, 2)
}

const help = spawnSync(process.execPath, ['scripts/funding-watch.mjs', '--help'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})
assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /funding gate/i)
assert.match(help.stdout, /--run-demo/i)
assert.equal(help.stdout.includes('AGENT_KEY='), false, 'help must not print secret assignment examples')

console.log('\nALL FUNDING WATCH TESTS PASS')
