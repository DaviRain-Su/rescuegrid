import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strategyHash } from '../core/strategy.js'
import { buildDemoExecutionReport } from '../worker/scripts/demo-execution-report.mjs'
import {
  applyActivationStrategyToWalletEvidenceArtifact,
  applyStrictExecutionReportToWalletEvidenceArtifact,
  buildWalletEvidence,
  collectFrontendPreflight,
  collectFrontendSourceGuardrails,
  collectWorkerPublicState,
  main,
  parseWalletEvidenceArtifact,
  parseArgs,
  serializeWalletEvidence,
  verifyWalletEvidenceArtifact,
  writeWalletEvidenceArtifact,
} from './wallet-clickthrough-evidence.mjs'
import deployment from '../core/deployment.js'
import packageJson from '../package.json' with { type: 'json' }

assert.equal(parseArgs(['--format', 'markdown']).get('--format'), 'markdown')
assert.equal(parseArgs(['--owner=0xabc']).get('--owner'), '0xabc')
assert.match(packageJson.scripts['wallet:evidence:verify'], /--execution-report \.rescuegrid\/demo-execute-report\.json/)
assert.match(packageJson.scripts['wallet:evidence:verify'], /--require-worker/)

const sourceFiles = new Map([
  ['src/providers.jsx', '<WalletProvider autoConnect={false}><RegisterEnoki /></WalletProvider>'],
  ['src/components/ZkLogin.jsx', "Connect a Sui wallet. The agent never touches your keys. <Button onPress={() => onAuth('demo')}>Explore the demo (no wallet)</Button><Button onPress={() => onAuth('readonly')}>Open Worker read-only</Button>"],
  ['src/api.js', "const BASE = import.meta.env.VITE_WORKER_URL || ''; function workerMissing(){ return { code: 'WORKER_NOT_CONFIGURED' } } if (!WORKER_CONFIGURED) return workerMissing()"],
  ['src/App.jsx', "function downloadWalletStrategyEvidenceFile() {} const walletStrategyEvidence = {}; <div>Activation strategy evidence ready</div>"],
])
const readFileImpl = (path) => {
  if (!sourceFiles.has(path)) throw new Error(`unexpected source read ${path}`)
  return sourceFiles.get(path)
}

const sourceGuardrails = collectFrontendSourceGuardrails({ readFileImpl })
assert.equal(sourceGuardrails.all_passed, true)
assert.equal(sourceGuardrails.wallet_auto_connect_disabled, true)
assert.equal(sourceGuardrails.explicit_worker_read_only_entry, true)
assert.equal(sourceGuardrails.activation_strategy_evidence_export, true)

const frontendState = await collectFrontendPreflight('http://frontend.test', {
  readFileImpl,
  fetchImpl: async (url) => {
    if (url.endsWith('/src/api.js')) {
      return {
        ok: true,
        status: 200,
        async text() {
          return "const BASE = import.meta.env.VITE_WORKER_URL || ''; function workerMissing(){ return { code: 'WORKER_NOT_CONFIGURED' } }"
        },
      }
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return '<!doctype html><html><head><title>RescueGrid</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>'
      },
    }
  },
})
assert.equal(frontendState.root.status, 'ok')
assert.equal(frontendState.root.contains_rescuegrid, true)
assert.equal(frontendState.root.has_vite_dev_entry, true)
assert.equal(frontendState.api_module.has_worker_url_binding, true)
assert.equal(frontendState.source_guardrails.all_passed, true)
assert.equal(frontendState.source_guardrails.activation_strategy_evidence_export, true)

const workerState = await collectWorkerPublicState('http://worker.test', {
  fetchImpl: async (url) => {
    if (url.endsWith('/api/runtime/status')) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: 'ok',
            chain: 'sui:testnet',
            agent: { address: deployment.agent.address },
            signer: {
              kind: 'worker-secret',
              available: true,
              expected_address: deployment.agent.address,
              signer_matches_expected: true,
              known_signer_kinds: ['worker-secret', 'cloud-per-user', 'waap'],
            },
            signer_capabilities: [
              {
                kind: 'worker-secret',
                selected: true,
                runtime_scope: 'cloud-worker',
                custody_model: 'worker-held-agent-key',
                execution_enabled: false,
                runner_configured: null,
              },
              {
                kind: 'cloud-per-user',
                selected: false,
                runtime_scope: 'cloud-worker',
                custody_model: 'seal-walrus-per-user-agent-key',
                execution_enabled: false,
                seal_walrus_required: true,
                per_user_agent_required: true,
                unavailable_code: 'PER_USER_CLOUD_SIGNER_NOT_VALIDATED',
              },
              {
                kind: 'waap',
                selected: false,
                runtime_scope: 'external-signer',
                custody_model: 'external-policy-signer',
                execution_enabled: false,
                runner_configured: false,
                unavailable_code: 'UNSUPPORTED_SIGNER',
              },
            ],
            external_signer: {
              kind: 'waap',
              selected: false,
              status: 'not_selected',
              available: false,
              submission_runner_configured: false,
              permission_token_configured: false,
              unavailable_code: 'UNSUPPORTED_SIGNER',
              secrets_returned: false,
            },
            cloud_per_user_signer: {
              kind: 'cloud-per-user',
              selected: false,
              status: 'not_selected',
              available: false,
              seal_walrus_required: true,
              per_user_agent_required: true,
              unavailable_code: 'PER_USER_CLOUD_SIGNER_NOT_VALIDATED',
              secrets_returned: false,
            },
            execution: { enabled: false, blocker_code: 'EXECUTION_DISABLED' },
            chain_data_provider: { kind: 'json-rpc' },
            monitoring_provider: { kind: 'timer-polling' },
          })
        },
      }
    }
    if (url.endsWith('/api/execution/readiness')) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: 'ok',
            chain: 'sui:testnet',
            scope: { executor_kind: 'deepbook', market_id: 'SUI_DBUSDC' },
            execution_ready: false,
            funding_ready: false,
            execution_claimed: false,
            blocker_codes: ['EXECUTION_DISABLED'],
            funding_blocker_codes: ['INSUFFICIENT_DBUSDC', 'INSUFFICIENT_DEEP'],
            signer: {
              kind: 'worker-secret',
              available: true,
              execution_enabled: false,
            },
            signer_capabilities: [
              {
                kind: 'worker-secret',
                selected: true,
                runtime_scope: 'cloud-worker',
                custody_model: 'worker-held-agent-key',
                execution_enabled: false,
                runner_configured: null,
              },
              {
                kind: 'cloud-per-user',
                selected: false,
                runtime_scope: 'cloud-worker',
                custody_model: 'seal-walrus-per-user-agent-key',
                execution_enabled: false,
                seal_walrus_required: true,
                per_user_agent_required: true,
                unavailable_code: 'PER_USER_CLOUD_SIGNER_NOT_VALIDATED',
              },
              {
                kind: 'waap',
                selected: false,
                runtime_scope: 'external-signer',
                custody_model: 'external-policy-signer',
                execution_enabled: false,
                runner_configured: false,
                unavailable_code: 'UNSUPPORTED_SIGNER',
              },
            ],
            external_signer: {
              kind: 'waap',
              selected: false,
              status: 'not_selected',
              available: false,
              submission_runner_configured: false,
              permission_token_configured: false,
              unavailable_code: 'UNSUPPORTED_SIGNER',
              secrets_returned: false,
            },
            cloud_per_user_signer: {
              kind: 'cloud-per-user',
              selected: false,
              status: 'not_selected',
              available: false,
              seal_walrus_required: true,
              per_user_agent_required: true,
              unavailable_code: 'PER_USER_CLOUD_SIGNER_NOT_VALIDATED',
              secrets_returned: false,
            },
            agent: { balance_manager_id: deployment.agent.balance_manager_id },
            balance_manager: { balances: { DBUSDC: '0', DEEP: '0' } },
          })
        },
      }
    }
    if (url.endsWith('/api/chain-data/status')) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: 'ok',
            chain: 'sui:testnet',
            provider_kind: 'json-rpc',
            provider_status: 'ready',
            worker_first: true,
            probe: { status: 'skipped' },
          })
        },
      }
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ service: 'rescuegrid-worker', chain: 'sui:testnet', agent: deployment.agent.address })
      },
    }
  },
})

assert.equal(workerState.root.status, 'ok')
assert.equal(workerState.runtime_status.signer_kind, 'worker-secret')
assert.equal(workerState.runtime_status.known_signer_kinds.includes('waap'), true)
assert.equal(workerState.runtime_status.known_signer_kinds.includes('cloud-per-user'), true)
assert.equal(workerState.runtime_status.selected_signer_capability.kind, 'worker-secret')
assert.equal(workerState.runtime_status.external_signer.kind, 'waap')
assert.equal(workerState.runtime_status.cloud_per_user_signer.kind, 'cloud-per-user')
assert.equal(workerState.runtime_status.cloud_per_user_signer.secrets_returned, false)
assert.deepEqual(workerState.execution_readiness.funding_blocker_codes, ['INSUFFICIENT_DBUSDC', 'INSUFFICIENT_DEEP'])
assert.equal(workerState.execution_readiness.selected_signer_capability.kind, 'worker-secret')
assert.equal(workerState.execution_readiness.external_signer.secrets_returned, false)
assert.equal(workerState.execution_readiness.cloud_per_user_signer.seal_walrus_required, true)
assert.equal(workerState.execution_readiness.cloud_per_user_signer.secrets_returned, false)
assert.equal(workerState.chain_data_status.worker_first, true)

const evidence = buildWalletEvidence({
  generatedAt: '2026-06-03T00:00:00.000Z',
  frontendUrl: 'http://localhost:5175/',
  workerUrl: 'http://localhost:8787/',
  ownerAddress: '0x1111111111111111111111111111111111111111111111111111111111111111',
  frontendState,
  workerState,
})
assert.equal(evidence.status, 'ok')
assert.equal(evidence.purpose, 'browser_wallet_clickthrough_evidence')
assert.equal(evidence.read_only, true)
assert.equal(evidence.actual_clickthrough_completed, false)
assert.equal(evidence.execution_claimed, false)
assert.equal(evidence.frontend.url, 'http://localhost:5175')
assert.equal(evidence.frontend.preflight_passed, true)
assert.equal(evidence.worker.url, 'http://localhost:8787')
assert.equal(evidence.worker.public_state_available, true)
assert.equal(evidence.worker.public_state_preflight_passed, true)
assert.equal(evidence.worker.public_state_checks.every((check) => check.status === 'passed'), true)
assert.equal(evidence.deployment.agent_address, deployment.agent.address)
const activationIndex = evidence.manual_flow.findIndex((step) => step.id === 'activation')
const strictWindowIndex = evidence.manual_flow.findIndex((step) => step.id === 'strict_execution_window')
const revokeIndex = evidence.manual_flow.findIndex((step) => step.id === 'revoke_policy')
assert(activationIndex >= 0)
assert(strictWindowIndex > activationIndex)
assert(revokeIndex > strictWindowIndex)
assert.match(evidence.manual_flow[strictWindowIndex].action, /same policy active/)
assert.match(evidence.manual_flow[activationIndex].action, /Activation strategy evidence banner/)
assert.equal(evidence.pass_conditions.some((row) => /Worker-built tx_json/.test(row)), true)
assert.equal(evidence.pass_conditions.some((row) => /DeepBook execution/.test(row)), true)
assert.equal(evidence.pass_conditions.some((row) => /demo:execute:wallet-report/.test(row)), true)
assert.equal(evidence.pass_conditions.some((row) => /UI activation strategy evidence JSON/.test(row)), true)
assert.equal(evidence.next_commands.strict_execution_report, 'npm run demo:execute:wallet-report -- --wrapper-id <wrapper_id> --strategy-file <activation_strategy_file> --create-tx-digest <create_tx_digest>')
assert.equal(evidence.next_commands.final_verify, 'npm run wallet:evidence:verify -- --input .rescuegrid/wallet-clickthrough-evidence.md --require-worker --execution-report .rescuegrid/demo-execute-report.json')

const json = serializeWalletEvidence(evidence, 'json')
assert.match(json, /browser_wallet_clickthrough_evidence/)
assert.equal(json.includes('permission-secret'), false)
assert.equal(json.includes('AGENT_KEY='), false)
assert.equal(json.includes('INTERNAL_AGENT_TICK_TOKEN='), false)

const markdown = serializeWalletEvidence(evidence, 'markdown')
assert.match(markdown, /RescueGrid Wallet Click-Through Evidence/)
assert.match(markdown, /Slush/)
assert.match(markdown, /Sui Testnet/)
assert.match(markdown, /owner_address:/)
assert.match(markdown, /create_tx_digest: TODO/)
assert.match(markdown, /wrapper_id: TODO/)
assert.match(markdown, /Execution claimed: false/)
assert.match(markdown, /Frontend preflight: true/)
assert.match(markdown, /Public state preflight: true/)
assert.match(markdown, /activation_strategy_file: TODO/)
assert.match(markdown, /strict_execution_report_reference: TODO/)
assert.match(markdown, /Wallet auto-connect disabled: true/)
assert.match(markdown, /Activation strategy export present: true/)
assert.match(markdown, /Known signer kinds: worker-secret, cloud-per-user, waap/)
assert.match(markdown, /Runtime external signer: waap/)
assert.match(markdown, /Readiness signer posture: worker-secret/)
assert.match(markdown, /Readiness external signer: waap/)
assert.match(markdown, /## strict_execution_window/)
assert.match(markdown, /same wrapper lifecycle/)
assert.match(markdown, /npm run demo:execute:wallet-report/)
assert.match(markdown, /wallet:evidence:verify -- --input \.rescuegrid\/wallet-clickthrough-evidence\.md --require-worker --execution-report \.rescuegrid\/demo-execute-report\.json/)
assert.equal(markdown.includes('permission-secret'), false)
assert.equal(markdown.includes('AGENT_KEY='), false)
assert.equal(markdown.includes('INTERNAL_AGENT_TICK_TOKEN='), false)

const artifactDir = mkdtempSync(join(tmpdir(), 'rescuegrid-wallet-evidence-'))
try {
  const artifactPath = join(artifactDir, 'wallet-clickthrough-evidence.md')
  const artifact = writeWalletEvidenceArtifact(evidence, { outPath: artifactPath, format: 'markdown' })
  assert.equal(artifact.path, artifactPath)
  assert.equal(artifact.format, 'markdown')
  assert(artifact.bytes > 100)
  const artifactBody = readFileSync(artifactPath, 'utf8')
  assert.match(artifactBody, /Wallet Click-Through/)
  assert.match(artifactBody, /Actual click-through completed: false/)
  assert.match(artifactBody, /--require-worker/)
  assert.equal(artifactBody.includes('permission-secret'), false)
} finally {
  rmSync(artifactDir, { recursive: true, force: true })
}

const unavailable = await collectWorkerPublicState('http://worker.test', {
  fetchImpl: async () => {
    throw new Error('offline')
  },
  timeoutMs: 1,
})
assert.equal(unavailable.root.status, 'unavailable')
assert.equal(buildWalletEvidence({ workerState: unavailable }).worker.public_state_available, false)
assert.equal(buildWalletEvidence({ workerState: unavailable }).worker.public_state_preflight_passed, false)
const wrongChainWorkerEvidence = buildWalletEvidence({
  workerState: {
    ...workerState,
    runtime_status: {
      ...workerState.runtime_status,
      chain: 'sui:mainnet',
    },
  },
})
assert.equal(wrongChainWorkerEvidence.worker.public_state_available, true)
assert.equal(wrongChainWorkerEvidence.worker.public_state_preflight_passed, false)
assert.equal(wrongChainWorkerEvidence.worker.public_state_checks.find((check) => check.id === 'worker-public:chain').status, 'failed')
assert.equal(buildWalletEvidence({
  frontendState: {
    root: { status: 'ok', contains_rescuegrid: true, has_vite_dev_entry: true },
    source_guardrails: { all_passed: false },
  },
}).frontend.preflight_passed, false)

const STRATEGY_OWNER = '0x1111111111111111111111111111111111111111111111111111111111111111'
const STRATEGY_WRAPPER = '0x2222222222222222222222222222222222222222222222222222222222222222'
const STRATEGY_MANDATE = '0x3333333333333333333333333333333333333333333333333333333333333333'
const strategyFileDir = mkdtempSync(join(tmpdir(), 'rescuegrid-wallet-strategy-'))
const activationStrategy = {
  owner: STRATEGY_OWNER,
  agent: deployment.agent.address,
  pool_id: deployment.deepbook.pools.SUI_DBUSDC.pool_id,
  execution: {
    max_single_trade_amount: '100000000',
    max_slippage_bps: 100,
  },
}
const activationStrategyHash = strategyHash(activationStrategy)
const activationStrategyFile = join(strategyFileDir, 'wallet-strategy.json')
const activationStrategyArtifact = {
  purpose: 'rescuegrid_activation_strategy',
  artifact_version: 1,
  generated_at: '2026-06-03T00:00:00.000Z',
  chain: deployment.chain,
  network: 'Sui Testnet',
  owner_address: STRATEGY_OWNER,
  wrapper_id: STRATEGY_WRAPPER,
  mandate_id: STRATEGY_MANDATE,
  create_tx_digest: 'create-digest',
  strategy_hash: activationStrategyHash,
  strategy_file_suggested_path: '.rescuegrid/wallet-strategy.json',
  strategy: activationStrategy,
  activation: {
    status: 'ok',
    wrapper_id: STRATEGY_WRAPPER,
    runtime_state: 'Monitoring',
  },
}
writeFileSync(activationStrategyFile, `${JSON.stringify(activationStrategyArtifact, null, 2)}\n`, 'utf8')

const appliedStrategyMarkdown = applyActivationStrategyToWalletEvidenceArtifact({
  artifactText: markdown,
  strategyFilePath: activationStrategyFile,
})
assert.equal(appliedStrategyMarkdown.status, 'ok')
assert.equal(appliedStrategyMarkdown.purpose, 'browser_wallet_clickthrough_evidence_apply_strategy')
assert.equal(appliedStrategyMarkdown.format, 'markdown')
assert.equal(appliedStrategyMarkdown.applied_fields.includes('owner_address'), true)
assert.equal(appliedStrategyMarkdown.applied_fields.includes('activation_strategy_file'), true)
assert.equal(appliedStrategyMarkdown.applied_fields.includes('runtime_state_after_activate'), true)
assert.equal(appliedStrategyMarkdown.activation_strategy_file.computed_strategy_hash, activationStrategyHash)
assert.match(appliedStrategyMarkdown.artifact_text, /Actual click-through completed: false/)
assert.match(appliedStrategyMarkdown.artifact_text, new RegExp(`create_tx_digest: ${activationStrategyArtifact.create_tx_digest}`))
assert.match(appliedStrategyMarkdown.artifact_text, new RegExp(`wrapper_id: ${STRATEGY_WRAPPER}`))
assert.match(appliedStrategyMarkdown.artifact_text, new RegExp(`mandate_id: ${STRATEGY_MANDATE}`))
assert.match(appliedStrategyMarkdown.artifact_text, new RegExp(`strategy_hash: ${activationStrategyHash}`))
assert.match(appliedStrategyMarkdown.artifact_text, /runtime_state_after_activate: Monitoring/)
assert.match(appliedStrategyMarkdown.artifact_text, /revoke_tx_digest: TODO/)
const parsedAppliedMarkdown = parseWalletEvidenceArtifact(appliedStrategyMarkdown.artifact_text)
assert.equal(parsedAppliedMarkdown.fields.create_tx_digest, 'create-digest')
assert.equal(parsedAppliedMarkdown.fields.wrapper_id, STRATEGY_WRAPPER)
assert.equal(parsedAppliedMarkdown.fields.mandate_id, STRATEGY_MANDATE)
assert.equal(parsedAppliedMarkdown.fields.strategy_hash, activationStrategyHash)
assert.equal(parsedAppliedMarkdown.fields.activation_strategy_file, activationStrategyFile)
assert.equal(parsedAppliedMarkdown.fields.runtime_state_after_activate, 'Monitoring')
assert.equal(parsedAppliedMarkdown.metadata.actual_clickthrough_completed, false)
assert.equal(parsedAppliedMarkdown.metadata.wallet_name, 'Slush or standard Sui wallet')
assert.equal(parsedAppliedMarkdown.metadata.wallet_network, 'Sui Testnet')

const appliedStrategyJson = applyActivationStrategyToWalletEvidenceArtifact({
  artifactText: json,
  strategyFilePath: activationStrategyFile,
})
assert.equal(appliedStrategyJson.status, 'ok')
assert.equal(appliedStrategyJson.format, 'json')
const appliedJsonArtifact = JSON.parse(appliedStrategyJson.artifact_text)
assert.equal(appliedJsonArtifact.actual_clickthrough_completed, false)
assert.equal(appliedJsonArtifact.wallet.owner_address, STRATEGY_OWNER)
assert.equal(appliedJsonArtifact.evidence_fields.create_tx_digest, 'create-digest')
assert.equal(appliedJsonArtifact.evidence_fields.wrapper_id, STRATEGY_WRAPPER)
assert.equal(appliedJsonArtifact.evidence_fields.mandate_id, STRATEGY_MANDATE)
assert.equal(appliedJsonArtifact.evidence_fields.strategy_hash, activationStrategyHash)
assert.equal(appliedJsonArtifact.evidence_fields.activation_strategy_file, activationStrategyFile)
assert.equal(appliedJsonArtifact.evidence_fields.runtime_state_after_activate, 'Monitoring')

const applyStrategyConflict = applyActivationStrategyToWalletEvidenceArtifact({
  artifactText: markdown.replace('- wrapper_id: TODO', '- wrapper_id: 0x9999999999999999999999999999999999999999999999999999999999999999'),
  strategyFilePath: activationStrategyFile,
})
assert.equal(applyStrategyConflict.status, 'error')
assert.equal(applyStrategyConflict.code, 'ACTIVATION_STRATEGY_ARTIFACT_MISMATCH')
assert.equal(applyStrategyConflict.conflicts[0].field, 'wrapper_id')

const applyCliDir = mkdtempSync(join(tmpdir(), 'rescuegrid-wallet-apply-cli-'))
try {
  const applyCliArtifactPath = join(applyCliDir, 'wallet-clickthrough-evidence.md')
  writeFileSync(applyCliArtifactPath, markdown, 'utf8')
  const applyCli = spawnSync(process.execPath, [
    'scripts/wallet-clickthrough-evidence.mjs',
    '--apply-strategy',
    '--input',
    applyCliArtifactPath,
    '--strategy-file',
    activationStrategyFile,
  ], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })
  assert.equal(applyCli.status, 0, applyCli.stderr)
  assert.match(applyCli.stdout, /browser_wallet_clickthrough_evidence_apply_strategy/)
  const appliedCliBody = readFileSync(applyCliArtifactPath, 'utf8')
  assert.match(appliedCliBody, new RegExp(`wrapper_id: ${STRATEGY_WRAPPER}`))
  assert.match(appliedCliBody, /Actual click-through completed: false/)
} finally {
  rmSync(applyCliDir, { recursive: true, force: true })
}

function reportTx(digest, timestampMs) {
  return {
    digest,
    checkpoint: String(timestampMs),
    timestampMs: String(timestampMs),
    effects: { status: { status: 'success' } },
  }
}

const strictTickDigest = 'tick-digest'
const strictExecutionReportFile = join(strategyFileDir, 'demo-execute-report.json')
const strictExecutionReport = buildDemoExecutionReport({
  generatedAt: '2026-06-03T00:00:00.000Z',
  workerUrl: 'http://worker.test',
  chain: deployment.chain,
  requireExecution: true,
  currentRunMarker: `wallet-policy-${STRATEGY_WRAPPER}`,
  ownerAddress: STRATEGY_OWNER,
  delegatedAgentAddress: deployment.agent.address,
  poolId: activationStrategy.pool_id,
  wrapperId: STRATEGY_WRAPPER,
  mandateId: STRATEGY_MANDATE,
  strategyHash: activationStrategyHash,
  createResolved: reportTx('create-digest', 1000),
  revokeResolved: reportTx('revoke-digest', 3000),
  tick: {
    action: 'executed',
    tx_digest: strictTickDigest,
    execution_claimed: true,
    agent_trade_event_found: true,
    agent_trade_event: {
      type: 'AgentTradeExecuted',
      tx_digest: strictTickDigest,
      mandate_id: STRATEGY_MANDATE,
      wrapper_id: STRATEGY_WRAPPER,
      agent: deployment.agent.address,
      pool_id: activationStrategy.pool_id,
      quote_amount_spent: '1000',
      base_amount_received: '990',
      spent_amount_after: '1000',
      budget_ceiling: '100000000',
      slippage_bps: 0,
      client_order_id: '0x0102',
      executed_at_ms: 2000,
    },
    spend_increased: true,
  },
  tickOutcome: 'executed',
  beforeTickWrapper: { spent_amount: '0' },
  afterTickWrapper: { spent_amount: '1000' },
  postRevokeTick: { action: 'stopped_revoked', code: 'POLICY_REVOKED', execution_claimed: false },
  finalActivity: {
    policy: { status: 'revoked', runtime_state: 'Revoked' },
    events: [{ type: 'PolicyCreated' }, { type: 'AgentTradeExecuted' }, { type: 'PolicyRevoked' }],
  },
  strictPreflight: {
    signer: { kind: 'worker-secret', available: true },
    funding: { execution_ready: true },
  },
})
strictExecutionReport.report_mode = 'wallet_created_policy'
writeFileSync(strictExecutionReportFile, `${JSON.stringify(strictExecutionReport, null, 2)}\n`, 'utf8')

const appliedReportMarkdown = applyStrictExecutionReportToWalletEvidenceArtifact({
  artifactText: appliedStrategyMarkdown.artifact_text,
  reportFilePath: strictExecutionReportFile,
})
assert.equal(appliedReportMarkdown.status, 'ok')
assert.equal(appliedReportMarkdown.purpose, 'browser_wallet_clickthrough_evidence_apply_report')
assert.equal(appliedReportMarkdown.format, 'markdown')
assert.equal(appliedReportMarkdown.applied_fields.includes('strict_execution_report_reference'), true)
assert.equal(appliedReportMarkdown.applied_fields.includes('revoke_tx_digest'), true)
assert.equal(appliedReportMarkdown.strict_execution_report.report_mode, 'wallet_created_policy')
assert.match(appliedReportMarkdown.artifact_text, /Actual click-through completed: false/)
assert.match(appliedReportMarkdown.artifact_text, /revoke_tx_digest: revoke-digest/)
assert.match(appliedReportMarkdown.artifact_text, /policy_status_after_revoke: revoked/)
assert.match(appliedReportMarkdown.artifact_text, new RegExp(`strict_execution_report_reference: ${strictExecutionReportFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
const parsedAppliedReportMarkdown = parseWalletEvidenceArtifact(appliedReportMarkdown.artifact_text)
assert.equal(parsedAppliedReportMarkdown.fields.revoke_tx_digest, 'revoke-digest')
assert.equal(parsedAppliedReportMarkdown.fields.policy_status_after_revoke, 'revoked')
assert.equal(parsedAppliedReportMarkdown.fields.strict_execution_report_reference, strictExecutionReportFile)
assert.equal(parsedAppliedReportMarkdown.metadata.actual_clickthrough_completed, false)

const appliedReportJson = applyStrictExecutionReportToWalletEvidenceArtifact({
  artifactText: appliedStrategyJson.artifact_text,
  reportFilePath: strictExecutionReportFile,
})
assert.equal(appliedReportJson.status, 'ok')
assert.equal(appliedReportJson.format, 'json')
const appliedReportJsonArtifact = JSON.parse(appliedReportJson.artifact_text)
assert.equal(appliedReportJsonArtifact.actual_clickthrough_completed, false)
assert.equal(appliedReportJsonArtifact.evidence_fields.revoke_tx_digest, 'revoke-digest')
assert.equal(appliedReportJsonArtifact.evidence_fields.policy_status_after_revoke, 'revoked')
assert.equal(appliedReportJsonArtifact.evidence_fields.strict_execution_report_reference, strictExecutionReportFile)

const applyReportConflict = applyStrictExecutionReportToWalletEvidenceArtifact({
  artifactText: appliedStrategyMarkdown.artifact_text.replace('- revoke_tx_digest: TODO', '- revoke_tx_digest: other-revoke-digest'),
  reportFilePath: strictExecutionReportFile,
})
assert.equal(applyReportConflict.status, 'error')
assert.equal(applyReportConflict.code, 'STRICT_EXECUTION_REPORT_ARTIFACT_MISMATCH')
assert.equal(applyReportConflict.conflicts[0].field, 'revoke_tx_digest')

const nonWalletStrictReportFile = join(strategyFileDir, 'demo-execute-report-non-wallet.json')
writeFileSync(
  nonWalletStrictReportFile,
  `${JSON.stringify({ ...strictExecutionReport, report_mode: 'self_contained_demo' }, null, 2)}\n`,
  'utf8',
)
const nonWalletStrictApplyReport = applyStrictExecutionReportToWalletEvidenceArtifact({
  artifactText: appliedStrategyMarkdown.artifact_text,
  reportFilePath: nonWalletStrictReportFile,
})
assert.equal(nonWalletStrictApplyReport.status, 'error')
assert.equal(nonWalletStrictApplyReport.code, 'STRICT_EXECUTION_REPORT_INVALID')
assert.equal(
  nonWalletStrictApplyReport.checks.find((check) => check.id === 'strict-execution:wallet-report-mode').status,
  'failed',
)

const nonStrictExecutionReportFile = join(strategyFileDir, 'demo-execute-report-non-strict.json')
writeFileSync(
  nonStrictExecutionReportFile,
  `${JSON.stringify({ ...strictExecutionReport, require_execution: false }, null, 2)}\n`,
  'utf8',
)
const nonStrictApplyReport = applyStrictExecutionReportToWalletEvidenceArtifact({
  artifactText: appliedStrategyMarkdown.artifact_text,
  reportFilePath: nonStrictExecutionReportFile,
})
assert.equal(nonStrictApplyReport.status, 'error')
assert.equal(nonStrictApplyReport.code, 'STRICT_EXECUTION_REPORT_INVALID')
const nonStrictStructuredEvidence = nonStrictApplyReport.checks.find((check) => check.id === 'strict-execution:structured-evidence')
assert.equal(nonStrictStructuredEvidence.status, 'failed')
assert.equal(nonStrictStructuredEvidence.actual.includes('require_execution'), true)

const secretStrictReportFile = join(strategyFileDir, 'demo-execute-report-secret.json')
writeFileSync(
  secretStrictReportFile,
  `${JSON.stringify({ ...strictExecutionReport, AGENT_KEY: 'suiprivkey1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' }, null, 2)}\n`,
  'utf8',
)
const secretStrictApplyReport = applyStrictExecutionReportToWalletEvidenceArtifact({
  artifactText: appliedStrategyMarkdown.artifact_text,
  reportFilePath: secretStrictReportFile,
})
assert.equal(secretStrictApplyReport.status, 'error')
assert.equal(secretStrictApplyReport.code, 'STRICT_EXECUTION_REPORT_SECRET_LEAK')
assert.equal(secretStrictApplyReport.secret_leak_patterns.includes('agent-key'), true)

const applyReportCliDir = mkdtempSync(join(tmpdir(), 'rescuegrid-wallet-apply-report-cli-'))
try {
  const applyReportCliArtifactPath = join(applyReportCliDir, 'wallet-clickthrough-evidence.md')
  writeFileSync(applyReportCliArtifactPath, appliedStrategyMarkdown.artifact_text, 'utf8')
  const applyReportCli = spawnSync(process.execPath, [
    'scripts/wallet-clickthrough-evidence.mjs',
    '--apply-report',
    '--input',
    applyReportCliArtifactPath,
    '--execution-report',
    strictExecutionReportFile,
  ], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })
  assert.equal(applyReportCli.status, 0, applyReportCli.stderr)
  assert.match(applyReportCli.stdout, /browser_wallet_clickthrough_evidence_apply_report/)
  const appliedReportCliBody = readFileSync(applyReportCliArtifactPath, 'utf8')
  assert.match(appliedReportCliBody, /revoke_tx_digest: revoke-digest/)
  assert.match(appliedReportCliBody, /Actual click-through completed: false/)
} finally {
  rmSync(applyReportCliDir, { recursive: true, force: true })
}

const screenshotDir = join(strategyFileDir, 'screenshots')
mkdirSync(screenshotDir, { recursive: true })
const screenshotFiles = {
  signIn: join(screenshotDir, 'sign-in.png'),
  createPrompt: join(screenshotDir, 'create-approval.png'),
  policyActive: join(screenshotDir, 'policy-active.png'),
  activityCreated: join(screenshotDir, 'activity-created.png'),
  revokePrompt: join(screenshotDir, 'revoke-approval.png'),
  policyRevoked: join(screenshotDir, 'policy-revoked.png'),
  activityRevoked: join(screenshotDir, 'activity-revoked.png'),
}
for (const [name, filePath] of Object.entries(screenshotFiles)) {
  writeFileSync(filePath, `local wallet evidence ${name}\n`, 'utf8')
}

const filledArtifact = `# RescueGrid Wallet Click-Through Evidence

Generated: 2026-06-03T00:00:00.000Z
Chain: sui:testnet
Frontend: http://localhost:5175
Worker: http://worker.test
Actual click-through completed: true

## Wallet

Wallet: Slush
Network: Sui Testnet
Owner address: ${STRATEGY_OWNER}

## Evidence Fields

- owner_address: ${STRATEGY_OWNER}
- create_tx_digest: create-digest
- wrapper_id: ${STRATEGY_WRAPPER}
- mandate_id: ${STRATEGY_MANDATE}
- strategy_hash: ${activationStrategyHash}
- activation_strategy_file: ${activationStrategyFile}
- sign_in_screenshot: ${screenshotFiles.signIn}
- wallet_create_prompt_screenshot: ${screenshotFiles.createPrompt}
- runtime_state_after_activate: Monitoring
- policy_active_screenshot: ${screenshotFiles.policyActive}
- activity_row_screenshot: ${screenshotFiles.activityCreated}
- strict_execution_report_reference: .rescuegrid/demo-execute-report.json
- wallet_revoke_prompt_screenshot: ${screenshotFiles.revokePrompt}
- revoke_tx_digest: revoke-digest
- policy_status_after_revoke: revoked
- policy_revoked_screenshot: ${screenshotFiles.policyRevoked}
- post_revoke_activity_screenshot: ${screenshotFiles.activityRevoked}
`

const parsedArtifact = parseWalletEvidenceArtifact(filledArtifact)
assert.equal(parsedArtifact.status, 'ok')
assert.equal(parsedArtifact.format, 'markdown')
assert.equal(parsedArtifact.metadata.worker_url, 'http://worker.test')
assert.equal(parsedArtifact.metadata.actual_clickthrough_completed, true)
assert.equal(parsedArtifact.metadata.wallet_name, 'Slush')
assert.equal(parsedArtifact.metadata.wallet_network, 'Sui Testnet')
assert.equal(parsedArtifact.fields.wrapper_id, STRATEGY_WRAPPER)
assert.equal(parsedArtifact.fields.activation_strategy_file, activationStrategyFile)
assert.equal(parsedArtifact.fields.strict_execution_report_reference, '.rescuegrid/demo-execute-report.json')

const coreOnlyArtifact = `# RescueGrid Wallet Click-Through Evidence

Generated: 2026-06-03T00:00:00.000Z
Chain: sui:testnet
Worker: http://worker.test
Actual click-through completed: true

## Evidence Fields

- owner_address: ${STRATEGY_OWNER}
- create_tx_digest: create-digest
- wrapper_id: ${STRATEGY_WRAPPER}
- mandate_id: ${STRATEGY_MANDATE}
- strategy_hash: ${activationStrategyHash}
- revoke_tx_digest: revoke-digest
`
const coreOnlyReport = await verifyWalletEvidenceArtifact({
  artifactText: coreOnlyArtifact,
  suiClient: {
    async getTransactionBlock() {
      throw new Error('should not read chain when manual click-through fields are missing')
    },
  },
})
assert.equal(coreOnlyReport.status, 'error')
assert.equal(coreOnlyReport.code, 'EVIDENCE_FIELDS_INCOMPLETE')
assert.equal(coreOnlyReport.missing_fields.includes('sign_in_screenshot'), true)
assert.equal(coreOnlyReport.missing_fields.includes('activation_strategy_file'), true)
assert.equal(coreOnlyReport.missing_fields.includes('strict_execution_report_reference'), true)

const secretLeakReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact.replace(
    `sign_in_screenshot: ${screenshotFiles.signIn}`,
    `sign_in_screenshot: ${screenshotFiles.signIn} AGENT_KEY=suiprivkey1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq`,
  ),
  suiClient: {
    async getTransactionBlock() {
      throw new Error('should not read chain when the artifact contains a secret')
    },
  },
})
assert.equal(secretLeakReport.status, 'error')
assert.equal(secretLeakReport.code, 'SECRET_LEAK_DETECTED')
assert.equal(secretLeakReport.secret_leak_patterns.includes('agent-key'), true)

const secretLeakCases = [
  ['agent-key', '"AGENT_KEY": "suiprivkey1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"'],
  ['owner-key', 'OWNER_KEY: suiprivkey1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'],
  ['private-key', 'privateKey: suiprivkey1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'],
  ['internal-agent-tick-token', '"INTERNAL_AGENT_TICK_TOKEN": "tick-secret"'],
  ['waap-permission-token', 'permissionToken: waap-secret'],
  ['waap-session', 'waapSession: local-session-secret'],
]
for (const [expectedPattern, secretSnippet] of secretLeakCases) {
  const report = await verifyWalletEvidenceArtifact({
    artifactText: filledArtifact.replace(
      `sign_in_screenshot: ${screenshotFiles.signIn}`,
      `sign_in_screenshot: ${screenshotFiles.signIn} ${secretSnippet}`,
    ),
    suiClient: {
      async getTransactionBlock() {
        throw new Error(`should not read chain for ${expectedPattern}`)
      },
    },
  })
  assert.equal(report.status, 'error')
  assert.equal(report.code, 'SECRET_LEAK_DETECTED')
  assert.equal(report.secret_leak_patterns.includes(expectedPattern), true)
}

const safePublicPostureReport = await verifyWalletEvidenceArtifact({
  artifactText: `${coreOnlyArtifact}\npermission_token: false\nwaapSession: TODO\n`,
  suiClient: {
    async getTransactionBlock() {
      throw new Error('should not read chain when manual fields are missing')
    },
  },
})
assert.equal(safePublicPostureReport.status, 'error')
assert.equal(safePublicPostureReport.code, 'EVIDENCE_FIELDS_INCOMPLETE')
assert.equal(safePublicPostureReport.secret_leak_patterns, undefined)

const missingScreenshotReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact.replace(screenshotFiles.signIn, join(strategyFileDir, 'missing-sign-in.png')),
  suiClient: {
    async getTransactionBlock() {
      throw new Error('should not read chain when local screenshot evidence is missing')
    },
  },
})
assert.equal(missingScreenshotReport.status, 'error')
assert.equal(missingScreenshotReport.code, 'WALLET_MANUAL_EVIDENCE_INVALID')
assert.equal(
  missingScreenshotReport.manual_evidence_failures.some((row) => row.field === 'sign_in_screenshot'),
  true,
)

const wrongWalletNetworkReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact.replace('Network: Sui Testnet', 'Network: Sui Mainnet'),
  suiClient: {
    async getTransactionBlock() {
      throw new Error('should not read chain when wallet network is not testnet')
    },
  },
})
assert.equal(wrongWalletNetworkReport.status, 'error')
assert.equal(wrongWalletNetworkReport.code, 'WALLET_MANUAL_EVIDENCE_INVALID')
assert.equal(
  wrongWalletNetworkReport.manual_evidence_failures.some((row) => row.field === 'wallet:network'),
  true,
)

const missingActivationStrategyFileReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact.replace(activationStrategyFile, join(strategyFileDir, 'missing-wallet-strategy.json')),
  suiClient: {
    async getTransactionBlock() {
      throw new Error('should not read chain when activation strategy file is missing')
    },
  },
})
assert.equal(missingActivationStrategyFileReport.status, 'error')
assert.equal(missingActivationStrategyFileReport.code, 'ACTIVATION_STRATEGY_FILE_INVALID')
assert.equal(
  missingActivationStrategyFileReport.checks.find((check) => check.id === 'activation-strategy:file-readable').status,
  'failed',
)

const mismatchedActivationStrategyFile = join(strategyFileDir, 'wallet-strategy-mismatch.json')
writeFileSync(
  mismatchedActivationStrategyFile,
  `${JSON.stringify({
    ...activationStrategyArtifact,
    wrapper_id: '0x9999999999999999999999999999999999999999999999999999999999999999',
    strategy: { ...activationStrategy, execution: { ...activationStrategy.execution, max_single_trade_amount: '1' } },
  }, null, 2)}\n`,
  'utf8',
)
const mismatchedActivationStrategyReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact.replace(activationStrategyFile, mismatchedActivationStrategyFile),
  suiClient: {
    async getTransactionBlock() {
      throw new Error('should not read chain when activation strategy file mismatches')
    },
  },
})
assert.equal(mismatchedActivationStrategyReport.status, 'error')
assert.equal(mismatchedActivationStrategyReport.code, 'ACTIVATION_STRATEGY_FILE_INVALID')
assert.equal(
  mismatchedActivationStrategyReport.checks.find((check) => check.id === 'activation-strategy:strategy-hash').status,
  'failed',
)
assert.equal(
  mismatchedActivationStrategyReport.checks.find((check) => check.id === 'activation-strategy:wrapper').status,
  'failed',
)

const secretActivationStrategyFile = join(strategyFileDir, 'wallet-strategy-secret.json')
writeFileSync(
  secretActivationStrategyFile,
  `${JSON.stringify({ ...activationStrategyArtifact, AGENT_KEY: 'suiprivkey1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' }, null, 2)}\n`,
  'utf8',
)
const secretActivationStrategyReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact.replace(activationStrategyFile, secretActivationStrategyFile),
  suiClient: {
    async getTransactionBlock() {
      throw new Error('should not read chain when activation strategy file contains a secret')
    },
  },
})
assert.equal(secretActivationStrategyReport.status, 'error')
assert.equal(secretActivationStrategyReport.code, 'ACTIVATION_STRATEGY_FILE_SECRET_LEAK')
assert.equal(secretActivationStrategyReport.secret_leak_patterns.includes('agent-key'), true)

const secretActivationStrategyApplyReport = applyActivationStrategyToWalletEvidenceArtifact({
  artifactText: markdown,
  strategyFilePath: secretActivationStrategyFile,
})
assert.equal(secretActivationStrategyApplyReport.status, 'error')
assert.equal(secretActivationStrategyApplyReport.code, 'ACTIVATION_STRATEGY_FILE_SECRET_LEAK')
assert.equal(secretActivationStrategyApplyReport.secret_leak_patterns.includes('agent-key'), true)

let chainReads = 0
const fakeSuiClient = {
  async getTransactionBlock({ digest, options }) {
    chainReads += 1
    assert.equal(options.showEvents, true)
    if (digest === 'create-digest') {
      return {
        digest,
        checkpoint: '1',
        timestampMs: '1000',
        effects: { status: { status: 'success' } },
        events: [{
          type: `${deployment.rescuegrid.package_id}::policy::PolicyCreated`,
          parsedJson: {
            owner: STRATEGY_OWNER,
            wrapper_id: STRATEGY_WRAPPER,
            mandate_id: STRATEGY_MANDATE,
            strategy_hash: activationStrategyHash,
          },
        }],
      }
    }
    if (digest === 'revoke-digest') {
      return {
        digest,
        checkpoint: '2',
        timestampMs: '2000',
        effects: { status: { status: 'success' } },
        events: [{
          type: `${deployment.rescuegrid.package_id}::policy::PolicyRevoked`,
          parsedJson: {
            owner: STRATEGY_OWNER,
            wrapper_id: STRATEGY_WRAPPER,
            mandate_id: STRATEGY_MANDATE,
          },
        }],
      }
    }
    throw new Error(`unexpected digest ${digest}`)
  },
}
const fakeWorkerFetch = async (url) => {
  assert.equal(String(url), `http://worker.test/api/policies/${STRATEGY_WRAPPER}/activity`)
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        status: 'ok',
        policy: {
          wrapper_id: STRATEGY_WRAPPER,
          revoked: true,
          runtime_state: 'Revoked',
        },
        activity: [
          { chain_event: 'PolicyCreated', tx: 'create-digest' },
          { chain_event: 'PolicyRevoked', tx: 'revoke-digest' },
        ],
      })
    },
  }
}
const verifiedReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact,
  suiClient: fakeSuiClient,
  fetchImpl: fakeWorkerFetch,
})
assert.equal(verifiedReport.status, 'ok')
assert.equal(verifiedReport.verified, true)
assert.equal(verifiedReport.actual_clickthrough_completed, true)
assert.equal(verifiedReport.wallet_name, 'Slush')
assert.equal(verifiedReport.wallet_network, 'Sui Testnet')
assert.equal(verifiedReport.execution_claimed, false)
assert.equal(verifiedReport.required_manual_fields.includes('strict_execution_report_reference'), true)
assert.equal(verifiedReport.required_manual_fields.includes('activation_strategy_file'), true)
assert.equal(verifiedReport.fields.activation_strategy_file, activationStrategyFile)
assert.equal(verifiedReport.activation_strategy_file.computed_strategy_hash, activationStrategyHash)
assert.equal(verifiedReport.activation_strategy_file.wrapper_id, STRATEGY_WRAPPER)
assert.equal(verifiedReport.fields.strict_execution_report_reference, '.rescuegrid/demo-execute-report.json')
assert.equal(verifiedReport.checks.every((check) => check.status === 'passed'), true)
assert.equal(verifiedReport.checks.find((check) => check.id === 'manual:runtime-state-after-activate').status, 'passed')
assert.equal(verifiedReport.checks.find((check) => check.id === 'manual:policy-status-after-revoke').status, 'passed')
assert.equal(verifiedReport.checks.find((check) => check.id === 'manual-reference:sign_in_screenshot').status, 'passed')
assert.equal(verifiedReport.checks.find((check) => check.id === 'wallet:network').status, 'passed')
assert.equal(verifiedReport.checks.some((check) => check.id === 'activation-strategy:strategy-hash'), true)
assert.equal(verifiedReport.checks.some((check) => check.id === 'worker:create-activity'), true)
assert.equal(chainReads, 2)

const filledArtifactWithStrictReport = filledArtifact.replace(
  '.rescuegrid/demo-execute-report.json',
  strictExecutionReportFile,
)
const strictExecutionReferenceReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifactWithStrictReport,
  suiClient: fakeSuiClient,
  fetchImpl: fakeWorkerFetch,
  strictExecutionReportPath: strictExecutionReportFile,
})
assert.equal(strictExecutionReferenceReport.verified, true)
assert.equal(strictExecutionReferenceReport.strict_execution_report_reference_expected, strictExecutionReportFile)
assert.equal(strictExecutionReferenceReport.strict_execution_report.wrapper_id, STRATEGY_WRAPPER)
assert.equal(strictExecutionReferenceReport.checks.find((check) => check.id === 'manual:strict-execution-report-reference').status, 'passed')
assert.equal(strictExecutionReferenceReport.checks.find((check) => check.id === 'strict-execution:structured-evidence').status, 'passed')
assert.equal(strictExecutionReferenceReport.checks.find((check) => check.id === 'strict-execution:wrapper').status, 'passed')
assert.equal(chainReads, 4)

{
  const verifyCliDir = mkdtempSync(join(tmpdir(), 'rescuegrid-wallet-verify-cli-'))
  const verifyCliArtifactPath = join(verifyCliDir, 'wallet-clickthrough-evidence.md')
  writeFileSync(verifyCliArtifactPath, filledArtifact, 'utf8')
  const originalLog = console.log
  let output = ''
  let defaultStrictReportRead = false
  console.log = (value) => {
    output += `${value}\n`
  }
  try {
    const code = await main([
      '--verify',
      '--worker-url',
      'http://worker.test',
      '--input',
      verifyCliArtifactPath,
    ], {}, {
      suiClient: fakeSuiClient,
      fetchImpl: fakeWorkerFetch,
      readFileImpl: (filePath, ...args) => {
        const normalized = String(filePath).replace(/\\/g, '/')
        if (normalized.endsWith('/.rescuegrid/demo-execute-report.json')) {
          defaultStrictReportRead = true
          return `${JSON.stringify(strictExecutionReport, null, 2)}\n`
        }
        return readFileSync(filePath, ...args)
      },
    })
    assert.equal(code, 0)
  } finally {
    console.log = originalLog
    rmSync(verifyCliDir, { recursive: true, force: true })
  }
  const cliReport = JSON.parse(output)
  assert.equal(defaultStrictReportRead, true)
  assert.equal(cliReport.verified, true)
  assert.equal(cliReport.strict_execution_report_reference_expected, '.rescuegrid/demo-execute-report.json')
  assert.equal(cliReport.strict_execution_report.report_mode, 'wallet_created_policy')
  assert.equal(cliReport.strict_execution_report.wrapper_id, STRATEGY_WRAPPER)
  assert.equal(cliReport.checks.find((check) => check.id === 'worker:detail').status, 'passed')
}

{
  const verifyCliDir = mkdtempSync(join(tmpdir(), 'rescuegrid-wallet-verify-cli-worker-required-'))
  const verifyCliArtifactPath = join(verifyCliDir, 'wallet-clickthrough-evidence.md')
  writeFileSync(verifyCliArtifactPath, filledArtifact, 'utf8')
  const originalLog = console.log
  let output = ''
  console.log = (value) => {
    output += `${value}\n`
  }
  try {
    const code = await main([
      '--verify',
      '--worker-url',
      'http://worker.test',
      '--input',
      verifyCliArtifactPath,
    ], {}, {
      suiClient: fakeSuiClient,
      fetchImpl: async () => { throw new Error('worker offline') },
      readFileImpl: (filePath, ...args) => {
        const normalized = String(filePath).replace(/\\/g, '/')
        if (normalized.endsWith('/.rescuegrid/demo-execute-report.json')) {
          return `${JSON.stringify(strictExecutionReport, null, 2)}\n`
        }
        return readFileSync(filePath, ...args)
      },
    })
    assert.equal(code, 1)
  } finally {
    console.log = originalLog
    rmSync(verifyCliDir, { recursive: true, force: true })
  }
  const cliReport = JSON.parse(output)
  assert.equal(cliReport.verified, false)
  assert.equal(cliReport.code, 'EVIDENCE_VERIFICATION_FAILED')
  assert.equal(cliReport.checks.find((check) => check.id === 'worker:detail').status, 'failed')
}

{
  const verifyCliDir = mkdtempSync(join(tmpdir(), 'rescuegrid-wallet-verify-cli-worker-skip-'))
  const verifyCliArtifactPath = join(verifyCliDir, 'wallet-clickthrough-evidence.md')
  writeFileSync(verifyCliArtifactPath, filledArtifact, 'utf8')
  const originalLog = console.log
  let output = ''
  console.log = (value) => {
    output += `${value}\n`
  }
  try {
    const code = await main([
      '--verify',
      '--skip-worker-detail',
      '--worker-url',
      'http://worker.test',
      '--input',
      verifyCliArtifactPath,
    ], {}, {
      suiClient: fakeSuiClient,
      fetchImpl: async () => { throw new Error('worker offline') },
      readFileImpl: (filePath, ...args) => {
        const normalized = String(filePath).replace(/\\/g, '/')
        if (normalized.endsWith('/.rescuegrid/demo-execute-report.json')) {
          return `${JSON.stringify(strictExecutionReport, null, 2)}\n`
        }
        return readFileSync(filePath, ...args)
      },
    })
    assert.equal(code, 0)
  } finally {
    console.log = originalLog
    rmSync(verifyCliDir, { recursive: true, force: true })
  }
  const cliReport = JSON.parse(output)
  assert.equal(cliReport.verified, true)
  assert.equal(cliReport.checks.find((check) => check.id === 'worker:detail').status, 'skipped')
}

{
  const verifyCliDir = mkdtempSync(join(tmpdir(), 'rescuegrid-wallet-verify-cli-skip-'))
  const verifyCliArtifactPath = join(verifyCliDir, 'wallet-clickthrough-evidence.md')
  writeFileSync(verifyCliArtifactPath, filledArtifact, 'utf8')
  const originalLog = console.log
  let output = ''
  console.log = (value) => {
    output += `${value}\n`
  }
  try {
    const code = await main([
      '--verify',
      '--skip-strict-execution-report',
      '--worker-url',
      'http://worker.test',
      '--input',
      verifyCliArtifactPath,
    ], {}, {
      suiClient: fakeSuiClient,
      fetchImpl: fakeWorkerFetch,
      readFileImpl: (filePath, ...args) => {
        const normalized = String(filePath).replace(/\\/g, '/')
        if (normalized.endsWith('/.rescuegrid/demo-execute-report.json')) {
          throw new Error('should not read strict report when explicitly skipped')
        }
        return readFileSync(filePath, ...args)
      },
    })
    assert.equal(code, 0)
  } finally {
    console.log = originalLog
    rmSync(verifyCliDir, { recursive: true, force: true })
  }
  const cliReport = JSON.parse(output)
  assert.equal(cliReport.verified, true)
  assert.equal(cliReport.strict_execution_report_reference_expected, null)
  assert.equal(cliReport.strict_execution_report, null)
}

const referenceMismatchReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact,
  strictExecutionReportPath: '.rescuegrid/other-demo-execute-report.json',
  suiClient: {
    async getTransactionBlock() {
      throw new Error('should not read chain when strict execution report reference mismatches')
    },
  },
})
assert.equal(referenceMismatchReport.status, 'error')
assert.equal(referenceMismatchReport.code, 'STRICT_EXECUTION_REFERENCE_MISMATCH')
assert.equal(referenceMismatchReport.strict_execution_report_reference_mismatch.expected, '.rescuegrid/other-demo-execute-report.json')
assert.equal(referenceMismatchReport.strict_execution_report_reference_mismatch.actual, '.rescuegrid/demo-execute-report.json')

const strictExecutionReportMismatchFile = join(strategyFileDir, 'demo-execute-report-wrapper-mismatch.json')
writeFileSync(
  strictExecutionReportMismatchFile,
  `${JSON.stringify({
    ...strictExecutionReport,
    wrapper_id: '0x9999999999999999999999999999999999999999999999999999999999999999',
    agent_trade_event: {
      ...strictExecutionReport.agent_trade_event,
      wrapper_id: '0x9999999999999999999999999999999999999999999999999999999999999999',
    },
  }, null, 2)}\n`,
  'utf8',
)
const strictExecutionMismatchReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact.replace('.rescuegrid/demo-execute-report.json', strictExecutionReportMismatchFile),
  strictExecutionReportPath: strictExecutionReportMismatchFile,
  suiClient: {
    async getTransactionBlock() {
      throw new Error('should not read chain when strict execution report mismatches wallet artifact')
    },
  },
})
assert.equal(strictExecutionMismatchReport.status, 'error')
assert.equal(strictExecutionMismatchReport.code, 'STRICT_EXECUTION_REPORT_MISMATCH')
assert.equal(strictExecutionMismatchReport.strict_execution_report_mismatches.some((row) => row.field === 'wrapper'), true)

const secretStrictVerifyReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact.replace('.rescuegrid/demo-execute-report.json', secretStrictReportFile),
  strictExecutionReportPath: secretStrictReportFile,
  suiClient: {
    async getTransactionBlock() {
      throw new Error('should not read chain when strict execution report contains a secret')
    },
  },
})
assert.equal(secretStrictVerifyReport.status, 'error')
assert.equal(secretStrictVerifyReport.code, 'STRICT_EXECUTION_REPORT_SECRET_LEAK')
assert.equal(secretStrictVerifyReport.secret_leak_patterns.includes('agent-key'), true)

const missingCreateActivityReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact,
  suiClient: fakeSuiClient,
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        status: 'ok',
        policy: {
          wrapper_id: STRATEGY_WRAPPER,
          revoked: true,
          runtime_state: 'Revoked',
        },
        activity: [{ chain_event: 'PolicyRevoked', tx: 'revoke-digest' }],
      })
    },
  }),
})
assert.equal(missingCreateActivityReport.verified, false)
assert.equal(missingCreateActivityReport.code, 'EVIDENCE_VERIFICATION_FAILED')
assert.equal(missingCreateActivityReport.checks.find((check) => check.id === 'worker:create-activity').status, 'failed')

const optionalWorkerReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact.replace('http://worker.test', 'http://worker-offline.test'),
  suiClient: fakeSuiClient,
  fetchImpl: async () => { throw new Error('offline') },
})
assert.equal(optionalWorkerReport.verified, true)
assert.equal(optionalWorkerReport.checks.some((check) => check.id === 'worker:detail' && check.status === 'skipped'), true)

const requireWorkerWithoutUrlReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact.replace('Worker: http://worker.test\n', ''),
  suiClient: fakeSuiClient,
  fetchImpl: async () => { throw new Error('should not fetch without URL') },
  requireWorker: true,
})
assert.equal(requireWorkerWithoutUrlReport.verified, false)
assert.equal(requireWorkerWithoutUrlReport.code, 'EVIDENCE_VERIFICATION_FAILED')
assert.equal(requireWorkerWithoutUrlReport.checks.find((check) => check.id === 'worker:detail').status, 'failed')

const incompleteReport = await verifyWalletEvidenceArtifact({
  artifactText: markdown,
  suiClient: {
    async getTransactionBlock() {
      throw new Error('should not read chain when required fields are missing')
    },
  },
})
assert.equal(incompleteReport.status, 'error')
assert.equal(incompleteReport.code, 'EVIDENCE_FIELDS_INCOMPLETE')
assert(incompleteReport.missing_fields.includes('create_tx_digest'))
assert(incompleteReport.missing_fields.includes('actual_clickthrough_completed'))
assert(incompleteReport.missing_fields.includes('strict_execution_report_reference'))

const help = spawnSync(process.execPath, ['scripts/wallet-clickthrough-evidence.mjs', '--help'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})
assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /wallet click-through evidence/i)
assert.match(help.stdout, /--verify/)
assert.match(help.stdout, /--out/)
assert.match(help.stdout, /--require-frontend/)
assert.match(help.stdout, /--execution-report/)
assert.match(help.stdout, /--skip-strict-execution-report/)
assert.match(help.stdout, /--skip-worker-detail/)
assert.match(
  help.stdout,
  /wallet:evidence:verify -- --input \.rescuegrid\/wallet-clickthrough-evidence\.md --require-worker --execution-report \.rescuegrid\/demo-execute-report\.json/,
)
assert.match(help.stdout, /--apply-strategy/)
assert.match(help.stdout, /--apply-report/)
assert.equal(help.stdout.includes('AGENT_KEY='), false)
assert.equal(help.stdout.includes('INTERNAL_AGENT_TICK_TOKEN='), false)

rmSync(strategyFileDir, { recursive: true, force: true })

console.log('\nALL WALLET CLICK-THROUGH EVIDENCE TESTS PASS')
