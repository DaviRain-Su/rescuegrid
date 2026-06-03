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
  'wallet:evidence:apply-report': 'node scripts/wallet-clickthrough-evidence.mjs --apply-report',
  'wallet:evidence:apply-strategy': 'node scripts/wallet-clickthrough-evidence.mjs --apply-strategy',
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
  'demo:execute:wallet-report': 'node worker/scripts/validate-wallet-policy-execution.mjs --out .rescuegrid/demo-execute-report.json',
  'safety:negative': 'node worker/scripts/validate-safety-negative-paths.mjs',
  'safety:negative:report': 'node worker/scripts/validate-safety-negative-paths.mjs --out .rescuegrid/safety-negative-report.json',
  'baseline:smoke': 'node scripts/baseline-smoke.mjs',
}

function verifiedWalletReport() {
  return {
    verified: true,
    actual_clickthrough_completed: true,
    required_manual_fields: [
      'sign_in_screenshot',
      'wallet_create_prompt_screenshot',
      'activation_strategy_file',
      'runtime_state_after_activate',
      'policy_active_screenshot',
      'activity_row_screenshot',
      'strict_execution_report_reference',
      'wallet_revoke_prompt_screenshot',
      'policy_status_after_revoke',
      'policy_revoked_screenshot',
      'post_revoke_activity_screenshot',
    ],
    fields: {
      owner_address: '0xowner',
      create_tx_digest: 'createDigest',
      wrapper_id: '0xwrapper',
      mandate_id: '0xmandate',
      strategy_hash: '0xstrategy',
      revoke_tx_digest: 'revokeDigest',
      sign_in_screenshot: 'screenshots/sign-in.png',
      wallet_create_prompt_screenshot: 'screenshots/create-approval.png',
      activation_strategy_file: '.rescuegrid/wallet-strategy.json',
      runtime_state_after_activate: 'Monitoring',
      policy_active_screenshot: 'screenshots/policy-active.png',
      activity_row_screenshot: 'screenshots/activity-created.png',
      strict_execution_report_reference: '.rescuegrid/demo-execute-report.json',
      wallet_revoke_prompt_screenshot: 'screenshots/revoke-approval.png',
      policy_status_after_revoke: 'revoked',
      policy_revoked_screenshot: 'screenshots/policy-revoked.png',
      post_revoke_activity_screenshot: 'screenshots/activity-revoked.png',
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
    signer_capabilities: [
      {
        kind: 'worker-secret',
        selected: true,
        available: true,
        execution_enabled: true,
        permission_token: 'super-secret',
        session_value: 'super-secret-session',
        raw_runner_output: 'super-secret-output',
      },
    ],
    external_signer: {
      kind: 'waap',
      selected: false,
      status: 'not_selected',
      permission_token_configured: false,
      secrets_returned: false,
      permission_token: 'super-secret',
      session_value: 'super-secret-session',
      raw_runner_output: 'super-secret-output',
    },
    balance_manager: { balances: { DBUSDC: '1000000', DEEP: '1' } },
  }
}

function assertNoSecretSignerPosture(value) {
  const json = JSON.stringify(value)
  assert.equal(json.includes('super-secret'), false)
  assert.equal(json.includes('super-secret-session'), false)
  assert.equal(json.includes('super-secret-output'), false)
  assert.equal(json.includes('"permission_token":'), false)
  assert.equal(json.includes('"session_value":'), false)
  assert.equal(json.includes('"raw_runner_output":'), false)
}

function safetyNegativeReport(overrides = {}) {
  return {
    purpose: 'rescuegrid_safety_negative_report',
    phase: 'pass',
    chain: 'sui:testnet',
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
    execution: { enabled: false, blocker_code: 'EXECUTION_DISABLED' },
    signer_capabilities: [
      { kind: 'worker-secret', selected: true, available: true, execution_enabled: false },
      {
        kind: 'waap',
        selected: false,
        available: false,
        runner_configured: false,
        permission_token: 'super-secret',
        session_value: 'super-secret-session',
        raw_runner_output: 'super-secret-output',
      },
    ],
    external_signer: {
      kind: 'waap',
      selected: false,
      status: 'not_selected',
      permission_token_configured: true,
      secrets_returned: false,
      permission_token: 'super-secret',
      session_value: 'super-secret-session',
      raw_runner_output: 'super-secret-output',
    },
    balance_manager: { balances: { DBUSDC: '0', DEEP: '0' } },
  }
}

function strictAgentTradeEvent(overrides = {}) {
  return {
    type: 'AgentTradeExecuted',
    tx_digest: 'tickDigest',
    mandate_id: '0xmandate',
    wrapper_id: '0xwrapper',
    agent: '0xagent',
    pool_id: '0xpool',
    quote_amount_spent: '1000',
    base_amount_received: '990',
    spent_amount_after: '1000',
    budget_ceiling: '1000000',
    slippage_bps: 20,
    client_order_id: '0xorder',
    executed_at_ms: 1760000000000,
    ...overrides,
  }
}

function strictExecutionReport(overrides = {}) {
  return {
    purpose: 'rescuegrid_demo_execution_report',
    chain: 'sui:testnet',
    phase: 'pass',
    require_execution: true,
    assertions: ['G2-CREATE', 'G2-ACTIVATE-MONITOR', 'G2-EXECUTE', 'G2-REVOKE', 'G2-POST-REVOKE-NO-EXECUTION'],
    create_tx_digest: 'createDigest',
    create_tx: { digest: 'createDigest', status: 'success', checkpoint: '41', timestamp_ms: 1759999999000 },
    revoke_tx_digest: 'revokeDigest',
    revoke_tx: { digest: 'revokeDigest', status: 'success', checkpoint: '43', timestamp_ms: 1760000001000 },
    tick_outcome: 'executed',
    execution_claimed: true,
    agent_trade_event_found: true,
    agent_trade_event: strictAgentTradeEvent(),
    spend_increased: true,
    tick_tx_digest: 'tickDigest',
    owner_address: '0xowner',
    delegated_agent_address: '0xagent',
    pool_id: '0xpool',
    wrapper_id: '0xwrapper',
    mandate_id: '0xmandate',
    strategy_hash: '0xstrategy',
    post_revoke: {
      action: 'stopped_revoked',
      code: 'POLICY_REVOKED',
      execution_claimed: false,
      final_policy_status: 'revoked',
      final_runtime_state: 'Revoked',
      chain_event_types: ['PolicyCreated', 'AgentTradeExecuted', 'PolicyRevoked'],
    },
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
  const fundingCheck = report.checks.find((row) => row.id === 'execution_funding_readiness')
  const executionCheck = report.checks.find((row) => row.id === 'strict_execution_evidence')
  const continuityCheck = report.checks.find((row) => row.id === 'mission_same_policy_continuity')
  const walletCheck = report.checks.find((row) => row.id === 'wallet_clickthrough')
  assert.equal(walletCheck.evidence.manual_evidence_fields.includes('strict_execution_report_reference'), true)
  assert.equal(walletCheck.evidence.strict_execution_report_reference, '.rescuegrid/demo-execute-report.json')
  assert.equal(fundingCheck.evidence.external_signer.permission_token_configured, false)
  assert.equal(fundingCheck.evidence.execution_gate.readiness_only, true)
  assert.equal(fundingCheck.evidence.execution_gate.policy_creation_allowed, true)
  assert.equal(fundingCheck.evidence.execution_gate.execution_claimed, false)
  assert.equal(fundingCheck.evidence.execution_gate.strict_execution_report_required, true)
  assert.equal(fundingCheck.evidence.execution_gate.strict_execution_report_path, '.rescuegrid/demo-execute-report.json')
  assert.equal(executionCheck.evidence.agent_trade_event.wrapper_id, '0xwrapper')
  assert.equal(executionCheck.evidence.agent_trade_event.mandate_id, '0xmandate')
  assert.equal(executionCheck.evidence.agent_trade_event.tx_digest, 'tickDigest')
  assert.equal(executionCheck.evidence.agent_trade_event.agent, '0xagent')
  assert.equal(executionCheck.evidence.agent_trade_event.pool_id, '0xpool')
  assert.equal(executionCheck.evidence.create_tx_timestamp_ms, 1759999999000)
  assert.equal(executionCheck.evidence.revoke_tx_timestamp_ms, 1760000001000)
  assert.equal(continuityCheck.status, 'passed')
  assert.equal(continuityCheck.evidence.wrapper_id, '0xwrapper')
  assertNoSecretSignerPosture(report)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport({ chain: 'sui:mainnet' }),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport(),
  })
  const safetyCheck = report.checks.find((row) => row.id === 'safety_negative_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(safetyCheck.status, 'failed')
  assert.equal(safetyCheck.evidence.missing_live_evidence.includes('chain'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport({ revoke_tx_digest: null }),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport(),
  })
  const safetyCheck = report.checks.find((row) => row.id === 'safety_negative_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(safetyCheck.status, 'failed')
  assert.equal(safetyCheck.evidence.missing_live_evidence.includes('revoke_tx_digest'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: {
      code: 'EVIDENCE_FIELDS_INCOMPLETE',
      actual_clickthrough_completed: false,
      worker_url: 'http://localhost:8787',
      missing_fields: ['owner_address', 'create_tx_digest'],
      required_core_fields: ['owner_address', 'create_tx_digest'],
      required_manual_fields: ['sign_in_screenshot'],
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
  const walletCheck = report.checks.find((row) => row.id === 'wallet_clickthrough')
  const fundingCheck = report.checks.find((row) => row.id === 'execution_funding_readiness')
  const continuityCheck = report.checks.find((row) => row.id === 'mission_same_policy_continuity')
  assert.equal(walletCheck.evidence.actual_clickthrough_completed, false)
  assert.equal(walletCheck.evidence.worker_url, 'http://localhost:8787')
  assert.equal(walletCheck.evidence.missing_field_count, 2)
  assert.deepEqual(walletCheck.evidence.required_core_fields, ['owner_address', 'create_tx_digest'])
  assert.deepEqual(walletCheck.evidence.required_manual_fields, ['sign_in_screenshot'])
  assert.equal(fundingCheck.evidence.signer_unavailable_code, 'EXECUTION_DISABLED')
  assert.equal(fundingCheck.evidence.signer_capabilities.some((row) => row.kind === 'waap'), true)
  assert.equal(fundingCheck.evidence.external_signer.kind, 'waap')
  assert.equal(fundingCheck.evidence.external_signer.permission_token_configured, true)
  assert.equal(fundingCheck.evidence.execution_gate.readiness_only, true)
  assert.equal(fundingCheck.evidence.execution_gate.policy_creation_allowed, false)
  assert.equal(fundingCheck.evidence.execution_gate.policy_creation_blocked, true)
  assert.equal(fundingCheck.evidence.execution_gate.execution_claimed, false)
  assert.equal(fundingCheck.evidence.execution_gate.strict_execution_report_required, true)
  assert.equal(continuityCheck.status, 'blocked')
  assert.equal(report.blocker_codes.includes('MISSION_CONTINUITY_MISMATCH'), false)
  assert.equal(report.next_actions.some((row) => /wallet:evidence -- --format markdown/.test(row)), true)
  assert.equal(report.next_actions.some((row) => /wallet:evidence:preflight/.test(row)), true)
  assert.equal(report.next_actions.some((row) => /wallet:evidence:apply-strategy/.test(row)), true)
  assert.equal(report.next_actions.some((row) => /wallet:evidence:apply-report/.test(row)), true)
  assert.equal(report.next_actions.some((row) => /demo:execute:wallet-report/.test(row)), true)
  assert.equal(report.next_actions.some((row) => /awaiting_wallet_revoke/.test(row)), true)
  assert.equal(report.next_actions.some((row) => /strict_execution_report_reference/.test(row)), true)
  assert.equal(report.next_actions.some((row) => /wallet:evidence:verify -- --input \.rescuegrid\/wallet-clickthrough-evidence\.md --require-worker/.test(row)), true)
  assert.equal(report.next_actions.some((row) => /--execution-report \.rescuegrid\/demo-execute-report\.json/.test(row)), true)
  assertNoSecretSignerPosture(report)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: {
      verified: false,
      code: 'STRICT_EXECUTION_REFERENCE_MISMATCH',
      checks: [{ id: 'manual:strict-execution-report-reference', status: 'failed' }],
      strict_execution_report_reference_mismatch: {
        expected: '.rescuegrid/demo-execute-report.json',
        actual: '.rescuegrid/other-demo-execute-report.json',
      },
    },
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport(),
  })
  const walletCheck = report.checks.find((row) => row.id === 'wallet_clickthrough')
  assert.equal(report.status, 'failed')
  assert.equal(walletCheck.status, 'failed')
  assert.equal(walletCheck.evidence.failed_checks.includes('manual:strict-execution-report-reference'), true)
  assert.equal(walletCheck.evidence.strict_execution_report_reference_mismatch.actual, '.rescuegrid/other-demo-execute-report.json')
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport({
      wrapper_id: '0xotherwrapper',
      agent_trade_event: strictAgentTradeEvent({ wrapper_id: '0xotherwrapper' }),
      revoke_tx_digest: 'otherRevokeDigest',
      revoke_tx: { digest: 'otherRevokeDigest', status: 'success', checkpoint: '43', timestamp_ms: 1760000001000 },
    }),
  })
  const continuityCheck = report.checks.find((row) => row.id === 'mission_same_policy_continuity')
  assert.equal(report.status, 'failed')
  assert.equal(report.full_prd_ready, false)
  assert.equal(report.execution_claimed, false)
  assert.equal(continuityCheck.status, 'failed')
  assert.equal(report.blocker_codes.includes('MISSION_CONTINUITY_MISMATCH'), true)
  assert.equal(continuityCheck.evidence.mismatches.some((row) => row.field === 'wrapper_id'), true)
  assert.equal(continuityCheck.evidence.mismatches.some((row) => row.field === 'revoke_tx_digest'), true)
  assert.equal(report.next_actions.some((row) => /same owner-created wrapper/.test(row)), true)
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
    executionReport: null,
  })
  assert.equal(report.status, 'blocked')
  assert.equal(report.next_actions.some((row) => /structured AgentTradeExecuted evidence/.test(row)), true)
  assert.equal(report.next_actions.some((row) => /demo:execute:wallet-report/.test(row)), true)
  assert.equal(report.next_actions.some((row) => /wallet_wrapper_id/.test(row)), true)
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
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport({ agent_trade_event: null }),
  })
  const executionCheck = report.checks.find((row) => row.id === 'strict_execution_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(executionCheck.status, 'failed')
  assert.equal(executionCheck.evidence.missing_live_evidence.includes('agent_trade_event'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport({
      agent_trade_event: strictAgentTradeEvent({ wrapper_id: '0xotherwrapper' }),
    }),
  })
  const executionCheck = report.checks.find((row) => row.id === 'strict_execution_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(executionCheck.status, 'failed')
  assert.equal(executionCheck.evidence.missing_live_evidence.includes('agent_trade_event_wrapper'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport({
      revoke_tx: { digest: 'revokeDigest', status: 'success', checkpoint: '42', timestamp_ms: 1759999999001 },
    }),
  })
  const executionCheck = report.checks.find((row) => row.id === 'strict_execution_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(executionCheck.status, 'failed')
  assert.equal(executionCheck.evidence.missing_live_evidence.includes('transaction_time_order'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport({
      tick_tx_digest: 'createDigest',
      tx_digest: 'createDigest',
      agent_trade_event: strictAgentTradeEvent({ tx_digest: 'createDigest' }),
    }),
  })
  const executionCheck = report.checks.find((row) => row.id === 'strict_execution_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(executionCheck.status, 'failed')
  assert.equal(executionCheck.evidence.missing_live_evidence.includes('transaction_digest_distinct'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport({
      create_tx: { digest: 'createDigest', status: 'success' },
    }),
  })
  const executionCheck = report.checks.find((row) => row.id === 'strict_execution_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(executionCheck.status, 'failed')
  assert.equal(executionCheck.evidence.missing_live_evidence.includes('create_tx_timestamp_ms'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport({
      delegated_agent_address: '0xagent',
      pool_id: '0xpool',
      agent_trade_event: strictAgentTradeEvent({
        agent: '0xotheragent',
        pool_id: '0xotherpool',
      }),
    }),
  })
  const executionCheck = report.checks.find((row) => row.id === 'strict_execution_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(executionCheck.status, 'failed')
  assert.equal(executionCheck.evidence.missing_live_evidence.includes('agent_trade_event_agent'), true)
  assert.equal(executionCheck.evidence.missing_live_evidence.includes('agent_trade_event_pool'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport({
      delegated_agent_address: null,
      pool_id: null,
    }),
  })
  const executionCheck = report.checks.find((row) => row.id === 'strict_execution_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(executionCheck.status, 'failed')
  assert.equal(executionCheck.evidence.missing_live_evidence.includes('delegated_agent_address'), true)
  assert.equal(executionCheck.evidence.missing_live_evidence.includes('pool_id'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport({ revoke_tx: { digest: 'revokeDigest', status: 'failure' } }),
  })
  const executionCheck = report.checks.find((row) => row.id === 'strict_execution_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(executionCheck.status, 'failed')
  assert.equal(executionCheck.evidence.missing_live_evidence.includes('revoke_tx_success'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport({
      post_revoke: {
        action: 'blocked',
        code: 'EXECUTION_DISABLED',
        execution_claimed: false,
        final_policy_status: 'active',
        final_runtime_state: 'Monitoring',
        chain_event_types: ['PolicyCreated', 'AgentTradeExecuted'],
      },
    }),
  })
  const executionCheck = report.checks.find((row) => row.id === 'strict_execution_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(executionCheck.status, 'failed')
  assert.equal(executionCheck.evidence.missing_live_evidence.includes('post_revoke_action'), true)
  assert.equal(executionCheck.evidence.missing_live_evidence.includes('chain_event:PolicyRevoked'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport({
      post_revoke: {
        action: 'stopped_revoked',
        code: 'POLICY_REVOKED',
        final_policy_status: 'revoked',
        final_runtime_state: 'Revoked',
        chain_event_types: ['PolicyCreated', 'AgentTradeExecuted', 'PolicyRevoked'],
      },
    }),
  })
  const executionCheck = report.checks.find((row) => row.id === 'strict_execution_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(executionCheck.status, 'failed')
  assert.equal(executionCheck.evidence.missing_live_evidence.includes('post_revoke_execution_unclaimed'), true)
}

{
  const report = buildMissionReadinessReport({
    scripts: requiredScripts,
    safetyReport: safetyNegativeReport(),
    walletReport: verifiedWalletReport(),
    fundingReadiness: readyFunding(),
    executionReport: strictExecutionReport({ assertions: ['G2-EXECUTE'] }),
  })
  const executionCheck = report.checks.find((row) => row.id === 'strict_execution_evidence')
  assert.equal(report.status, 'failed')
  assert.equal(executionCheck.status, 'failed')
  assert.equal(executionCheck.evidence.missing_live_evidence.includes('assertion:G2-REVOKE'), true)
}

{
  const tempDir = mkdtempSync(join(tmpdir(), 'rescuegrid-mission-readiness-'))
  const artifactPath = join(tempDir, 'wallet.md')
  writeFileSync(artifactPath, '- owner_address: 0xowner\n', 'utf8')
  const originalLog = console.log
  let output = ''
  let walletVerifierRequiredWorker = false
  let walletVerifierStrictExecutionPath = null
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
      verifyWallet: async ({ requireWorker, strictExecutionReportPath }) => {
        walletVerifierRequiredWorker = requireWorker === true
        walletVerifierStrictExecutionPath = strictExecutionReportPath
        throw new Error('synthetic wallet verifier failure')
      },
    })
    assert.equal(code, 1)
  } finally {
    console.log = originalLog
    rmSync(tempDir, { recursive: true, force: true })
  }
  const report = JSON.parse(output)
  assert.equal(walletVerifierRequiredWorker, true)
  assert.equal(walletVerifierStrictExecutionPath, '.rescuegrid/mission-readiness-test-missing-execution.json')
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
