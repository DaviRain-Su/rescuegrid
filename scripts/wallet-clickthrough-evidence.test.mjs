import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildWalletEvidence,
  collectFrontendPreflight,
  collectFrontendSourceGuardrails,
  collectWorkerPublicState,
  parseWalletEvidenceArtifact,
  parseArgs,
  serializeWalletEvidence,
  verifyWalletEvidenceArtifact,
  writeWalletEvidenceArtifact,
} from './wallet-clickthrough-evidence.mjs'
import deployment from '../core/deployment.js'

assert.equal(parseArgs(['--format', 'markdown']).get('--format'), 'markdown')
assert.equal(parseArgs(['--owner=0xabc']).get('--owner'), '0xabc')

const sourceFiles = new Map([
  ['src/providers.jsx', '<WalletProvider autoConnect={false}><RegisterEnoki /></WalletProvider>'],
  ['src/components/ZkLogin.jsx', "Connect a Sui wallet. The agent never touches your keys. <Button onPress={() => onAuth('demo')}>Explore the demo (no wallet)</Button><Button onPress={() => onAuth('readonly')}>Open Worker read-only</Button>"],
  ['src/api.js', "const BASE = import.meta.env.VITE_WORKER_URL || ''; function workerMissing(){ return { code: 'WORKER_NOT_CONFIGURED' } } if (!WORKER_CONFIGURED) return workerMissing()"],
])
const readFileImpl = (path) => {
  if (!sourceFiles.has(path)) throw new Error(`unexpected source read ${path}`)
  return sourceFiles.get(path)
}

const sourceGuardrails = collectFrontendSourceGuardrails({ readFileImpl })
assert.equal(sourceGuardrails.all_passed, true)
assert.equal(sourceGuardrails.wallet_auto_connect_disabled, true)
assert.equal(sourceGuardrails.explicit_worker_read_only_entry, true)

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
              known_signer_kinds: ['worker-secret', 'waap'],
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
assert.equal(workerState.runtime_status.selected_signer_capability.kind, 'worker-secret')
assert.equal(workerState.runtime_status.external_signer.kind, 'waap')
assert.deepEqual(workerState.execution_readiness.funding_blocker_codes, ['INSUFFICIENT_DBUSDC', 'INSUFFICIENT_DEEP'])
assert.equal(workerState.execution_readiness.selected_signer_capability.kind, 'worker-secret')
assert.equal(workerState.execution_readiness.external_signer.secrets_returned, false)
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
assert.equal(evidence.next_commands.final_verify, 'npm run wallet:evidence:verify -- --input .rescuegrid/wallet-clickthrough-evidence.md --require-worker')

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
assert.match(markdown, /activation_strategy_file: TODO/)
assert.match(markdown, /strict_execution_report_reference: TODO/)
assert.match(markdown, /Wallet auto-connect disabled: true/)
assert.match(markdown, /Known signer kinds: worker-secret, waap/)
assert.match(markdown, /Runtime external signer: waap/)
assert.match(markdown, /Readiness signer posture: worker-secret/)
assert.match(markdown, /Readiness external signer: waap/)
assert.match(markdown, /## strict_execution_window/)
assert.match(markdown, /same wrapper lifecycle/)
assert.match(markdown, /npm run demo:execute:wallet-report/)
assert.match(markdown, /wallet:evidence:verify -- --input \.rescuegrid\/wallet-clickthrough-evidence\.md --require-worker/)
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
assert.equal(buildWalletEvidence({
  frontendState: {
    root: { status: 'ok', contains_rescuegrid: true, has_vite_dev_entry: true },
    source_guardrails: { all_passed: false },
  },
}).frontend.preflight_passed, false)

const filledArtifact = `# RescueGrid Wallet Click-Through Evidence

Generated: 2026-06-03T00:00:00.000Z
Chain: sui:testnet
Frontend: http://localhost:5175
Worker: http://worker.test
Actual click-through completed: true

## Wallet

Wallet: Slush
Network: Sui Testnet
Owner address: 0x1111111111111111111111111111111111111111111111111111111111111111

## Evidence Fields

- owner_address: 0x1111111111111111111111111111111111111111111111111111111111111111
- create_tx_digest: create-digest
- wrapper_id: 0x2222222222222222222222222222222222222222222222222222222222222222
- mandate_id: 0x3333333333333333333333333333333333333333333333333333333333333333
- strategy_hash: 0xabc123
- activation_strategy_file: .rescuegrid/wallet-strategy.json
- sign_in_screenshot: screenshots/sign-in.png
- wallet_create_prompt_screenshot: screenshots/create-approval.png
- runtime_state_after_activate: Monitoring
- policy_active_screenshot: screenshots/policy-active.png
- activity_row_screenshot: screenshots/activity-created.png
- strict_execution_report_reference: .rescuegrid/demo-execute-report.json
- wallet_revoke_prompt_screenshot: screenshots/revoke-approval.png
- revoke_tx_digest: revoke-digest
- policy_status_after_revoke: revoked
- policy_revoked_screenshot: screenshots/policy-revoked.png
- post_revoke_activity_screenshot: screenshots/activity-revoked.png
`

const parsedArtifact = parseWalletEvidenceArtifact(filledArtifact)
assert.equal(parsedArtifact.status, 'ok')
assert.equal(parsedArtifact.format, 'markdown')
assert.equal(parsedArtifact.metadata.worker_url, 'http://worker.test')
assert.equal(parsedArtifact.metadata.actual_clickthrough_completed, true)
assert.equal(parsedArtifact.fields.wrapper_id, '0x2222222222222222222222222222222222222222222222222222222222222222')
assert.equal(parsedArtifact.fields.activation_strategy_file, '.rescuegrid/wallet-strategy.json')
assert.equal(parsedArtifact.fields.strict_execution_report_reference, '.rescuegrid/demo-execute-report.json')

const coreOnlyArtifact = `# RescueGrid Wallet Click-Through Evidence

Generated: 2026-06-03T00:00:00.000Z
Chain: sui:testnet
Worker: http://worker.test
Actual click-through completed: true

## Evidence Fields

- owner_address: 0x1111111111111111111111111111111111111111111111111111111111111111
- create_tx_digest: create-digest
- wrapper_id: 0x2222222222222222222222222222222222222222222222222222222222222222
- mandate_id: 0x3333333333333333333333333333333333333333333333333333333333333333
- strategy_hash: 0xabc123
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
    'sign_in_screenshot: screenshots/sign-in.png',
    'sign_in_screenshot: screenshots/sign-in.png AGENT_KEY=suiprivkey1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
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
      'sign_in_screenshot: screenshots/sign-in.png',
      `sign_in_screenshot: screenshots/sign-in.png ${secretSnippet}`,
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
            owner: '0x1111111111111111111111111111111111111111111111111111111111111111',
            wrapper_id: '0x2222222222222222222222222222222222222222222222222222222222222222',
            mandate_id: '0x3333333333333333333333333333333333333333333333333333333333333333',
            strategy_hash: '0xabc123',
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
            owner: '0x1111111111111111111111111111111111111111111111111111111111111111',
            wrapper_id: '0x2222222222222222222222222222222222222222222222222222222222222222',
            mandate_id: '0x3333333333333333333333333333333333333333333333333333333333333333',
          },
        }],
      }
    }
    throw new Error(`unexpected digest ${digest}`)
  },
}
const fakeWorkerFetch = async (url) => {
  assert.equal(String(url), 'http://worker.test/api/policies/0x2222222222222222222222222222222222222222222222222222222222222222/activity')
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        status: 'ok',
        policy: {
          wrapper_id: '0x2222222222222222222222222222222222222222222222222222222222222222',
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
assert.equal(verifiedReport.execution_claimed, false)
assert.equal(verifiedReport.required_manual_fields.includes('strict_execution_report_reference'), true)
assert.equal(verifiedReport.required_manual_fields.includes('activation_strategy_file'), true)
assert.equal(verifiedReport.fields.activation_strategy_file, '.rescuegrid/wallet-strategy.json')
assert.equal(verifiedReport.fields.strict_execution_report_reference, '.rescuegrid/demo-execute-report.json')
assert.equal(verifiedReport.checks.every((check) => check.status === 'passed'), true)
assert.equal(verifiedReport.checks.some((check) => check.id === 'worker:create-activity'), true)
assert.equal(chainReads, 2)

const absoluteReferenceReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact,
  suiClient: fakeSuiClient,
  fetchImpl: fakeWorkerFetch,
  strictExecutionReportPath: join(process.cwd(), '.rescuegrid/demo-execute-report.json'),
})
assert.equal(absoluteReferenceReport.verified, true)
assert.equal(absoluteReferenceReport.strict_execution_report_reference_expected, join(process.cwd(), '.rescuegrid/demo-execute-report.json'))
assert.equal(absoluteReferenceReport.checks.find((check) => check.id === 'manual:strict-execution-report-reference').status, 'passed')
assert.equal(chainReads, 4)

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
          wrapper_id: '0x2222222222222222222222222222222222222222222222222222222222222222',
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
assert.equal(help.stdout.includes('AGENT_KEY='), false)
assert.equal(help.stdout.includes('INTERNAL_AGENT_TICK_TOKEN='), false)

console.log('\nALL WALLET CLICK-THROUGH EVIDENCE TESTS PASS')
