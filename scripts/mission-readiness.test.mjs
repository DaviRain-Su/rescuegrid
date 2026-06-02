import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildMissionReadinessReport,
  main,
} from './mission-readiness.mjs'

const requiredScripts = {
  build: 'vite build',
  'test:wallet-flow': 'node src/queries/wallet-flow.test.mjs',
  'test:wallet-evidence': 'node scripts/wallet-clickthrough-evidence.test.mjs',
  'test:mission-readiness': 'node scripts/mission-readiness.test.mjs',
  'test:demo-execution-report': 'npm --prefix worker run test:demo-execution-report',
  'test:safety-negative-report': 'npm --prefix worker run test:safety-negative-report',
  'wallet:evidence': 'node scripts/wallet-clickthrough-evidence.mjs',
  'wallet:evidence:preflight': 'node scripts/wallet-clickthrough-evidence.mjs --require-frontend --require-worker',
  'wallet:evidence:verify': 'node scripts/wallet-clickthrough-evidence.mjs --verify',
  'mission:readiness': 'node scripts/mission-readiness.mjs',
  'mission:readiness:report': 'node scripts/mission-readiness.mjs --out .rescuegrid/mission-readiness-report.json',
  'funding:request': 'node worker/scripts/funding-handoff.mjs',
  'funding:watch': 'node worker/scripts/funding-watch.mjs',
  'funding:watch:report': 'node worker/scripts/funding-watch.mjs --json --out .rescuegrid/funding-watch-report.json',
  'demo:loop': 'node worker/scripts/validate-demo-loop.mjs',
  'demo:execute': 'node worker/scripts/validate-demo-loop.mjs --require-execution',
  'demo:execute:report': 'node worker/scripts/validate-demo-loop.mjs --require-execution --out .rescuegrid/demo-execute-report.json',
  'safety:negative': 'node worker/scripts/validate-safety-negative-paths.mjs',
  'safety:negative:report': 'node worker/scripts/validate-safety-negative-paths.mjs --out .rescuegrid/safety-negative-report.json',
  'baseline:smoke': 'node scripts/baseline-smoke.mjs',
}

function verifiedWalletReport() {
  return {
    verified: true,
    fields: {
      owner_address: '0xowner',
      create_tx_digest: 'createDigest',
      wrapper_id: '0xwrapper',
      mandate_id: '0xmandate',
      strategy_hash: '0xstrategy',
      revoke_tx_digest: 'revokeDigest',
    },
  }
}

function readyFunding() {
  return {
    execution_ready: true,
    funding_ready: true,
    blocker_codes: [],
    funding_blocker_codes: [],
    execution_claimed: false,
    signer: { kind: 'worker-secret', available: true },
    balance_manager: { balances: { DBUSDC: '1000000', DEEP: '1' } },
  }
}

function safetyNegativeReport(overrides = {}) {
  return {
    purpose: 'rescuegrid_safety_negative_report',
    phase: 'pass',
    assertions: ['VAL-SAFETY-001', 'VAL-SAFETY-002', 'VAL-SAFETY-003', 'VAL-SAFETY-005', 'VAL-SAFETY-008'],
    required_codes: ['OVER_BUDGET', 'OVER_SLIPPAGE', 'WRONG_POOL', 'WRONG_AGENT', 'MANDATE_MISMATCH', 'POLICY_EXPIRED', 'POLICY_REVOKED'],
    validated_codes: ['OVER_BUDGET', 'OVER_SLIPPAGE', 'WRONG_POOL', 'WRONG_AGENT', 'MANDATE_MISMATCH', 'POLICY_EXPIRED', 'POLICY_REVOKED'],
    all_pre_submission: true,
    all_execution_unclaimed: true,
    all_spend_unchanged: true,
    all_success_activity_unchanged: true,
    chain_success_activity_total: 0,
    active_policy: { wrapper_id: '0xactive' },
    expiring_policy: { wrapper_id: '0xexpired' },
    revoke_tx_digest: 'revokeDigest',
    evidence: ['OVER_BUDGET', 'OVER_SLIPPAGE', 'WRONG_POOL', 'WRONG_AGENT', 'MANDATE_MISMATCH', 'POLICY_EXPIRED', 'POLICY_REVOKED'].map((code) => ({
      expected_code: code,
      observed_code: code,
      action: 'blocked',
      submitted: false,
      execution_claimed: false,
      spend_before: '0',
      spend_after: '0',
      success_activity_count_before: 0,
      success_activity_count_after: 0,
      chain_success_activity_count: 0,
    })),
    ...overrides,
  }
}

function blockedFunding() {
  return {
    execution_ready: false,
    funding_ready: false,
    blocker_codes: ['EXECUTION_DISABLED', 'INSUFFICIENT_DBUSDC'],
    funding_blocker_codes: ['INSUFFICIENT_DBUSDC'],
    execution_claimed: false,
    signer: { kind: 'worker-secret', available: true },
    balance_manager: { balances: { DBUSDC: '0', DEEP: '0' } },
  }
}

function strictExecutionReport(overrides = {}) {
  return {
    phase: 'pass',
    assertions: ['G2-EXECUTE'],
    tick_outcome: 'executed',
    execution_claimed: true,
    agent_trade_event_found: true,
    spend_increased: true,
    tick_tx_digest: 'tickDigest',
    wrapper_id: '0xwrapper',
    mandate_id: '0xmandate',
    ...overrides,
  }
}

{
  const report = buildMissionReadinessReport({
    generatedAt: '2026-06-03T00:00:00.000Z',
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport(),
  })
  assert.equal(report.status, 'ready')
  assert.equal(report.full_prd_ready, true)
  assert.equal(report.execution_claimed, true)
  assert.deepEqual(report.blocker_codes, [])
  assert.equal(report.checks.every((row) => row.status === 'passed'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: {
      code: 'EVIDENCE_FIELDS_INCOMPLETE',
      missing_fields: ['owner_address', 'create_tx_digest'],
    },
    fundingReadiness: blockedFunding(),
    executionReport: null,
  })
  assert.equal(report.status, 'blocked')
  assert.equal(report.full_prd_ready, false)
  assert.equal(report.execution_claimed, false)
  assert.equal(report.blocker_codes.includes('WALLET_EVIDENCE_INCOMPLETE'), true)
  assert.equal(report.blocker_codes.includes('INSUFFICIENT_DBUSDC'), true)
  assert.equal(report.blocker_codes.includes('STRICT_EXECUTION_BLOCKED_BY_FUNDING'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: { ...requiredScripts, 'wallet:evidence:verify': '' },
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport(),
  })
  const scriptCheck = report.checks.find((row) => row.id === 'validation_scripts')
  assert.equal(report.status, 'failed')
  assert.equal(report.full_prd_ready, false)
  assert.equal(scriptCheck.status, 'failed')
  assert.deepEqual(scriptCheck.evidence.missing_scripts, ['wallet:evidence:verify'])
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport({ execution_claimed: false }),
  })
  const executionCheck = report.checks.find((row) => row.id === 'strict_execution_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(report.full_prd_ready, false)
  assert.equal(executionCheck.status, 'failed')
  assert.equal(report.blocker_codes.includes('STRICT_EXECUTION_NOT_PROVEN'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport({ agent_trade_event_found: false }),
  })
  const executionCheck = report.checks.find((row) => row.id === 'strict_execution_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(executionCheck.status, 'failed')
  assert.equal(executionCheck.evidence.agent_trade_event_found, false)
}

{
  const tempDir = mkdtempSync(join(tmpdir(), 'rescuegrid-mission-readiness-'))
  const artifactPath = join(tempDir, 'wallet.md')
  writeFileSync(artifactPath, '- owner_address: 0xowner\n', 'utf8')
  const originalLog = console.log
  let output = ''
  console.log = (value) => {
    output += `${value}\n`
  }
  try {
    const code = await main([
      '--skip-live-funding',
      '--wallet-artifact',
      artifactPath,
      '--execution-report',
      '.rescuegrid/mission-readiness-test-missing-execution.json',
    ], {}, {
      fundingReadiness: null,
      verifyWallet: async () => {
        throw new Error('synthetic wallet verifier failure')
      },
    })
    assert.equal(code, 1)
  } finally {
    console.log = originalLog
    rmSync(tempDir, { recursive: true, force: true })
  }
  const report = JSON.parse(output)
  assert.equal(report.status, 'failed')
  assert.equal(report.blocker_codes.includes('WALLET_EVIDENCE_MISMATCH'), true)
}

{
  const originalLog = console.log
  let output = ''
  console.log = (value) => {
    output += `${value}\n`
  }
  try {
    const code = await main([
      '--skip-live-funding',
      '--wallet-artifact',
      '.rescuegrid/mission-readiness-test-missing-wallet.md',
      '--safety-report',
      '.rescuegrid/mission-readiness-test-missing-safety.json',
      '--execution-report',
      '.rescuegrid/mission-readiness-test-missing-execution.json',
    ], {}, { fundingReadiness: null })
    assert.equal(code, 1)
  } finally {
    console.log = originalLog
  }
  const report = JSON.parse(output)
  assert.equal(report.status, 'blocked')
  assert.equal(report.blocker_codes.includes('WALLET_EVIDENCE_MISSING'), true)
  assert.equal(report.blocker_codes.includes('SAFETY_NEGATIVE_REPORT_MISSING'), true)
  assert.equal(report.blocker_codes.includes('FUNDING_READINESS_NOT_CHECKED'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport({
      validated_codes: ['OVER_BUDGET'],
      missing_codes: ['POLICY_REVOKED'],
    }),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport(),
  })
  const safetyCheck = report.checks.find((row) => row.id === 'safety_negative_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(report.full_prd_ready, false)
  assert.equal(safetyCheck.status, 'failed')
  assert.equal(report.blocker_codes.includes('SAFETY_NEGATIVE_NOT_PROVEN'), true)
}

{
  const tempDir = mkdtempSync(join(tmpdir(), 'rescuegrid-mission-readiness-out-'))
  const outPath = join(tempDir, 'nested', 'mission-readiness-report.json')
  const originalLog = console.log
  let output = ''
  console.log = (value) => {
    output += `${value}\n`
  }
  try {
    const code = await main([
      '--wallet-artifact',
      join(tempDir, 'missing-wallet.md'),
      '--execution-report',
      join(tempDir, 'missing-execution.json'),
      '--out',
      outPath,
    ], {}, {
      fundingReadiness: blockedFunding(),
      safetyReport: safetyNegativeReport(),
    })
    assert.equal(code, 1)
  } finally {
    console.log = originalLog
  }
  const stdoutReport = JSON.parse(output)
  const artifactReport = JSON.parse(readFileSync(outPath, 'utf8'))
  assert.equal(stdoutReport.status, 'blocked')
  assert.deepEqual(artifactReport, stdoutReport)
  assert.equal(artifactReport.blocker_codes.includes('WALLET_EVIDENCE_MISSING'), true)
  rmSync(tempDir, { recursive: true, force: true })
}

{
  const help = spawnSync(process.execPath, ['scripts/mission-readiness.mjs', '--help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /mission readiness/i)
  assert.match(help.stdout, /safety-report/)
  assert.match(help.stdout, /--out/)
  assert.equal(help.stdout.includes('AGENT_KEY='), false)
  assert.equal(help.stdout.includes('INTERNAL_AGENT_TICK_TOKEN='), false)
  assert.equal(help.stdout.includes('WAAP_PERMISSION_TOKEN='), false)
}
