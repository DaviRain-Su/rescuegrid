import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildFundingHandoff,
  fundingHandoffEnv,
  serializeFundingHandoff,
  writeFundingHandoffArtifact,
} from '../scripts/funding-handoff.mjs'
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
    known_signer_kinds: ['worker-secret', 'waap'],
  },
  signer_capabilities: [
    {
      kind: 'worker-secret',
      selected: true,
      runtime_scope: 'cloud-worker',
      custody_model: 'worker-held-agent-key',
      available: true,
      execution_enabled: false,
      runner_configured: null,
    },
    {
      kind: 'waap',
      selected: false,
      runtime_scope: 'external-signer',
      custody_model: 'external-policy-signer',
      available: false,
      execution_enabled: false,
      runner_configured: false,
      unavailable_code: 'UNSUPPORTED_SIGNER',
      permission_token: 'super-secret',
      session_file: '/tmp/super-secret-session',
    },
  ],
  external_signer: {
    kind: 'waap',
    selected: false,
    status: 'not_selected',
    available: false,
    submission_runner_configured: false,
    permission_token_configured: false,
    secrets_returned: false,
    permission_token: 'super-secret',
    session_value: 'super-secret-session',
    raw_runner_output: 'super-secret-output',
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
assert.equal(handoff.next_verification.funding_watch_command, 'npm run funding:watch -- --json')
assert.equal(handoff.next_verification.funding_watch_report_command, 'npm run funding:watch:report')
assert.equal(handoff.next_verification.strict_execution_command, 'npm run demo:execute')
assert.equal(handoff.next_verification.strict_execution_report_command, 'npm run demo:execute:report')
assert.match(handoff.next_verification.wallet_strict_execution_report_command, /demo:execute:wallet-report/)
assert.match(handoff.next_verification.wallet_strict_execution_report_command, /activation_strategy_file/)
assert.match(handoff.next_verification.success_condition, /structured AgentTradeExecuted evidence/)
assert.match(handoff.next_verification.success_condition, /same wrapper\/mandate\/tick digest/)
assert.match(handoff.next_verification.success_condition, /distinct create\/tick\/revoke digests/)
assert.match(handoff.next_verification.success_condition, /create <= execute <= revoke timestamps/)
assert.deepEqual(handoff.execution_gate, {
  readiness_only: true,
  policy_creation_allowed: false,
  policy_creation_blocked: true,
  execution_claimed: false,
  strict_execution_report_required: true,
  strict_execution_report_path: '.rescuegrid/demo-execute-report.json',
  success_condition: handoff.next_verification.success_condition,
})
assert.equal(handoff.signer_capabilities.some((row) => row.kind === 'waap' && row.runner_configured === false), true)
assert.equal(handoff.external_signer.kind, 'waap')
assert.equal(handoff.external_signer.secrets_returned, false)
assert.equal(JSON.stringify(handoff).includes('super-secret'), false)
assert.equal(JSON.stringify(handoff).includes('"permission_token":'), false)
assert.equal(JSON.stringify(handoff).includes('"session_value":'), false)
assert.equal(JSON.stringify(handoff).includes('"raw_runner_output":'), false)

const markdown = serializeFundingHandoff(handoff, 'markdown')
assert.match(markdown, /RescueGrid Funding Request/)
assert.match(markdown, /DBUSDC coin type:/)
assert.match(markdown, /Signer: worker-secret/)
assert.match(markdown, /External signer: waap/)
assert.match(markdown, /Execution gate: readiness-only/)
assert.match(markdown, /Strict execution report required: \.rescuegrid\/demo-execute-report\.json/)
assert.match(markdown, /After funding, run:/)
assert.match(markdown, /npm run funding:watch:report/)
assert.match(markdown, /demo:execute:wallet-report/)
assert.match(markdown, /Success condition: Strict execution must preflight ready/)
assert.match(markdown, /structured AgentTradeExecuted evidence/)
assert.equal(markdown.includes('super-secret'), false)

const artifactDir = mkdtempSync(join(tmpdir(), 'rescuegrid-funding-'))
try {
  const artifactPath = join(artifactDir, 'funding-request.md')
  const artifact = writeFundingHandoffArtifact(handoff, { outPath: artifactPath, format: 'markdown' })
  assert.equal(artifact.path, artifactPath)
  assert.equal(artifact.format, 'markdown')
  assert(artifact.bytes > 100)
  const artifactBody = readFileSync(artifactPath, 'utf8')
  assert.match(artifactBody, /RescueGrid Funding Request/)
  assert.match(artifactBody, /missing 750/)
  assert.match(artifactBody, /readiness-only/)
  assert.match(artifactBody, /structured AgentTradeExecuted evidence/)
  assert.match(artifactBody, /demo:execute:wallet-report/)
  assert.equal(artifactBody.includes('super-secret'), false)
} finally {
  rmSync(artifactDir, { recursive: true, force: true })
}

const readyHandoff = buildFundingHandoff({
  ...readiness,
  execution_ready: true,
  funding_ready: true,
  blocker_codes: [],
  blocker_labels: [],
}, { generatedAt: '2026-06-03T00:00:00.000Z' })
assert.equal(readyHandoff.ready_for_strict_execution, true)
assert.equal(readyHandoff.execution_claimed, false)
assert.equal(readyHandoff.execution_gate.readiness_only, true)
assert.equal(readyHandoff.execution_gate.policy_creation_allowed, true)
assert.equal(readyHandoff.execution_gate.policy_creation_blocked, false)
assert.equal(readyHandoff.execution_gate.execution_claimed, false)
assert.equal(readyHandoff.execution_gate.strict_execution_report_required, true)

const env = fundingHandoffEnv({
  AGENT_KEY: 'super-secret',
  EXECUTION_ENABLED: 'true',
  RESCUEGRID_WAAP_PERMISSION_TOKEN: 'do-not-print',
  REQUIRED_DBUSDC_BALANCE: '500',
})
assert.deepEqual(env, {
  AGENT_KEY: 'super-secret',
  EXECUTION_ENABLED: 'true',
  SIGNER_KIND: undefined,
  RESCUEGRID_DAEMON_MODE: undefined,
  RESCUEGRID_WAAP_CLI_ENABLED: undefined,
  RESCUEGRID_WAAP_SUI_ADDRESS: undefined,
  RESCUEGRID_WAAP_CHAIN: undefined,
  RESCUEGRID_WAAP_RPC: undefined,
  RESCUEGRID_WAAP_PERMISSION_TOKEN: 'do-not-print',
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
assert.match(help.stdout, /--out/)
assert.equal(help.stdout.includes('AGENT_KEY='), false, 'help must not print secret assignment examples')

console.log('\nALL FUNDING HANDOFF TESTS PASS')
