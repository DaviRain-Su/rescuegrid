#!/usr/bin/env node
// Prepare a secret-safe manual evidence artifact for the real browser wallet
// create/revoke flow. This script is read-only: it may fetch public Worker
// status endpoints, but it never creates a policy or submits a PTB.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import deployment from '../core/deployment.js'
import { strategyHash } from '../core/strategy.js'
import { getClient } from '../worker/src/sui-tx.js'
import { strictDemoExecutionMissingEvidence } from '../worker/scripts/demo-execution-report.mjs'

const DEFAULT_FRONTEND_URL = 'http://localhost:5175'
const DEFAULT_WORKER_URL = 'http://localhost:8787'
const DEFAULT_TIMEOUT_MS = 2500
const DEFAULT_STRICT_EXECUTION_REPORT = '.rescuegrid/demo-execute-report.json'
const REQUIRED_WALLET_CORE_FIELDS = [
  'owner_address',
  'create_tx_digest',
  'wrapper_id',
  'mandate_id',
  'strategy_hash',
  'revoke_tx_digest',
]
const REQUIRED_WALLET_MANUAL_FIELDS = [
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
]
const REQUIRED_LOCAL_OR_EXTERNAL_EVIDENCE_FIELDS = REQUIRED_WALLET_MANUAL_FIELDS.filter((field) => field.endsWith('_screenshot'))
const SECRET_LEAK_PATTERNS = [
  { id: 'agent-key', pattern: /\bAGENT_KEY["']?\s*[:=]\s*["']?(?!TODO\b|n\/a\b|not configured\b)\S+/i },
  { id: 'owner-key', pattern: /\bOWNER_KEY["']?\s*[:=]\s*["']?(?!TODO\b|n\/a\b|not configured\b)\S+/i },
  { id: 'private-key', pattern: /\b(private[_ -]?key|privateKey|signing[_ -]?secret|signingSecret|worker[_ -]?secret|workerSecret)["']?\s*[:=]\s*["']?(?!TODO\b|n\/a\b|not configured\b)\S+/i },
  { id: 'internal-agent-tick-token', pattern: /\bINTERNAL_AGENT_TICK_TOKEN["']?\s*[:=]\s*["']?(?!TODO\b|n\/a\b|not configured\b)\S+/i },
  { id: 'waap-permission-token', pattern: /\b(WAAP_PERMISSION_TOKEN|RESCUEGRID_WAAP_PERMISSION_TOKEN|permission_token|permissionToken)["']?\s*[:=]\s*["']?(?!TODO\b|n\/a\b|not configured\b|false\b|true\b|null\b)\S+/i },
  { id: 'waap-session', pattern: /\b(WAAP_SESSION|WAAP_SESSION_FILE|waap[_ -]?session|waapSession)["']?\s*[:=]\s*["']?(?!TODO\b|n\/a\b|not configured\b)\S+/i },
  { id: 'sui-private-key', pattern: /\bsuiprivkey[1-9A-HJ-NP-Za-km-z]{20,}/ },
  { id: 'seed-phrase', pattern: /\b(seed phrase|mnemonic)\s*[:=]\s*(?!TODO\b|n\/a\b|not captured\b)(\S+\s+){2,}\S+/i },
]

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Map()
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const [key, inlineValue] = arg.split('=')
    const nextValue = argv[i + 1]
    if (inlineValue != null) flags.set(key, inlineValue)
    else if (nextValue && !nextValue.startsWith('--')) {
      flags.set(key, nextValue)
      i += 1
    } else {
      flags.set(key, 'true')
    }
  }
  return flags
}

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '')
}

function firstValue(...values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') return String(value)
  }
  return undefined
}

function readSelectedEnv(path = '.env.local') {
  if (!existsSync(path)) return {}
  const text = readFileSync(path, 'utf8')
  const allowed = new Set(['VITE_WORKER_URL', 'RESCUEGRID_WORKER_URL', 'RESCUEGRID_FRONTEND_URL', 'FRONTEND_URL', 'WORKER_URL'])
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i <= 0) continue
    const key = line.slice(0, i).trim()
    if (!allowed.has(key)) continue
    out[key] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}

async function fetchJson(url, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') {
    return { status: 'unavailable', http_status: 0, error: 'fetch_unavailable' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { signal: controller.signal })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    return {
      status: res.ok && json ? 'ok' : 'unavailable',
      http_status: res.status,
      body: json,
      error: res.ok && json ? null : `http_${res.status}`,
    }
  } catch (e) {
    return {
      status: 'unavailable',
      http_status: 0,
      body: null,
      error: String(e?.name === 'AbortError' ? 'timeout' : e?.message || e),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchText(url, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') {
    return { status: 'unavailable', http_status: 0, text: '', error: 'fetch_unavailable' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { signal: controller.signal })
    const text = await res.text()
    return {
      status: res.ok ? 'ok' : 'unavailable',
      http_status: res.status,
      text,
      error: res.ok ? null : `http_${res.status}`,
    }
  } catch (e) {
    return {
      status: 'unavailable',
      http_status: 0,
      text: '',
      error: String(e?.name === 'AbortError' ? 'timeout' : e?.message || e),
    }
  } finally {
    clearTimeout(timer)
  }
}

function summarizeFrontendRoot(result) {
  const text = result?.text || ''
  return {
    status: result?.status || 'unavailable',
    http_status: result?.http_status || 0,
    error: result?.error || null,
    contains_rescuegrid: text.includes('RescueGrid'),
    has_vite_dev_entry: text.includes('/src/main.jsx'),
    has_built_asset_entry: /\/assets\/[^"']+\.js/.test(text),
    html_bytes: Buffer.byteLength(text),
  }
}

function summarizeFrontendApiModule(result) {
  const text = result?.text || ''
  return {
    status: result?.status || 'unavailable',
    http_status: result?.http_status || 0,
    error: result?.error || null,
    has_worker_url_binding: text.includes('VITE_WORKER_URL'),
    writes_require_worker: text.includes('WORKER_NOT_CONFIGURED') && text.includes('workerMissing'),
    module_bytes: Buffer.byteLength(text),
  }
}

function readSource(path, { readFileImpl = readFileSync } = {}) {
  try {
    return String(readFileImpl(path, 'utf8'))
  } catch (e) {
    return ''
  }
}

export function collectFrontendSourceGuardrails(options = {}) {
  const providers = readSource('src/providers.jsx', options)
  const signIn = readSource('src/components/ZkLogin.jsx', options)
  const api = readSource('src/api.js', options)
  const app = readSource('src/App.jsx', options)
  const checks = {
    wallet_auto_connect_disabled: /<WalletProvider\s+autoConnect=\{false\}/.test(providers),
    explicit_worker_read_only_entry: signIn.includes('Open Worker read-only') && signIn.includes("onAuth('readonly')"),
    explicit_no_wallet_demo_entry: signIn.includes('Explore the demo (no wallet)') && signIn.includes("onAuth('demo')"),
    signer_copy_keeps_keys_out: signIn.includes('never your keys') || signIn.includes('never touches your keys'),
    writes_require_worker_config: api.includes('WORKER_NOT_CONFIGURED') && api.includes('workerMissing'),
    activation_strategy_evidence_export: app.includes('downloadWalletStrategyEvidenceFile') &&
      app.includes('Activation strategy evidence ready') &&
      app.includes('walletStrategyEvidence'),
  }
  return {
    ...checks,
    all_passed: Object.values(checks).every(Boolean),
  }
}

export async function collectFrontendPreflight(frontendUrl, options = {}) {
  const base = normalizeUrl(frontendUrl)
  const [root, apiModule] = await Promise.all([
    fetchText(`${base}/`, options),
    fetchText(`${base}/src/api.js`, options),
  ])
  const rootSummary = summarizeFrontendRoot(root)
  const apiSummary = summarizeFrontendApiModule(apiModule)
  const sourceGuardrails = collectFrontendSourceGuardrails(options)
  return {
    root: rootSummary,
    api_module: apiSummary,
    source_guardrails: sourceGuardrails,
  }
}

function frontendPreflightPassed(frontendState = {}) {
  const root = frontendState.root || {}
  const source = frontendState.source_guardrails || {}
  return root.status === 'ok' &&
    root.contains_rescuegrid === true &&
    (root.has_vite_dev_entry === true || root.has_built_asset_entry === true) &&
    source.all_passed === true
}

function summarizeCloudPerUserSigner(posture = null) {
  if (!posture) return null
  return {
    kind: posture.kind || null,
    selected: posture.selected ?? null,
    status: posture.status || null,
    available: posture.available ?? null,
    seal_walrus_required: posture.seal_walrus_required ?? null,
    per_user_agent_required: posture.per_user_agent_required ?? null,
    unavailable_code: posture.unavailable_code || null,
    secrets_returned: posture.secrets_returned === true,
  }
}

function summarizeRuntimeStatus(result) {
  const body = result?.body || {}
  const selectedCapability = (body.signer_capabilities || []).find((row) => row.selected) || null
  const externalSigner = body.external_signer || null
  const cloudPerUserSigner = body.cloud_per_user_signer || null
  return {
    status: result?.status || 'unavailable',
    http_status: result?.http_status || 0,
    error: result?.error || null,
    chain: body.chain || null,
    agent_address: body.agent?.address || null,
    signer_kind: body.signer?.kind || null,
    signer_available: body.signer?.available ?? null,
    signer_expected_address: body.signer?.expected_address || null,
    signer_matches_expected: body.signer?.signer_matches_expected ?? null,
    execution_enabled: body.execution?.enabled ?? null,
    execution_blocker_code: body.execution?.blocker_code || null,
    known_signer_kinds: body.signer?.known_signer_kinds || [],
    signer_capability_kinds: (body.signer_capabilities || []).map((row) => row.kind).filter(Boolean),
    selected_signer_capability: selectedCapability ? {
      kind: selectedCapability.kind || null,
      runtime_scope: selectedCapability.runtime_scope || null,
      custody_model: selectedCapability.custody_model || null,
      execution_enabled: selectedCapability.execution_enabled ?? null,
      runner_configured: selectedCapability.runner_configured ?? null,
      unavailable_code: selectedCapability.unavailable_code || null,
    } : null,
    external_signer: externalSigner ? {
      kind: externalSigner.kind || null,
      selected: externalSigner.selected ?? null,
      status: externalSigner.status || null,
      available: externalSigner.available ?? null,
      submission_runner_configured: externalSigner.submission_runner_configured ?? null,
      permission_token_configured: externalSigner.permission_token_configured ?? null,
      unavailable_code: externalSigner.unavailable_code || null,
      secrets_returned: externalSigner.secrets_returned === true,
    } : null,
    cloud_per_user_signer: summarizeCloudPerUserSigner(cloudPerUserSigner),
    chain_data_provider: body.chain_data_provider?.kind || null,
    monitoring_provider: body.monitoring_provider?.kind || null,
  }
}

function summarizeReadiness(result) {
  const body = result?.body || {}
  const selectedCapability = (body.signer_capabilities || []).find((row) => row.selected) || null
  const externalSigner = body.external_signer || null
  const cloudPerUserSigner = body.cloud_per_user_signer || null
  return {
    status: result?.status || 'unavailable',
    http_status: result?.http_status || 0,
    error: result?.error || null,
    chain: body.chain || null,
    scope: body.scope || null,
    signer_kind: body.signer?.kind || null,
    signer_available: body.signer?.available ?? null,
    signer_execution_enabled: body.signer?.execution_enabled ?? body.execution?.enabled ?? null,
    signer_unavailable_code: body.signer?.unavailable_code || body.execution?.blocker_code || null,
    signer_capability_kinds: (body.signer_capabilities || []).map((row) => row.kind).filter(Boolean),
    selected_signer_capability: selectedCapability ? {
      kind: selectedCapability.kind || null,
      runtime_scope: selectedCapability.runtime_scope || null,
      custody_model: selectedCapability.custody_model || null,
      execution_enabled: selectedCapability.execution_enabled ?? null,
      runner_configured: selectedCapability.runner_configured ?? null,
      unavailable_code: selectedCapability.unavailable_code || null,
    } : null,
    external_signer: externalSigner ? {
      kind: externalSigner.kind || null,
      selected: externalSigner.selected ?? null,
      status: externalSigner.status || null,
      available: externalSigner.available ?? null,
      submission_runner_configured: externalSigner.submission_runner_configured ?? null,
      permission_token_configured: externalSigner.permission_token_configured ?? null,
      unavailable_code: externalSigner.unavailable_code || null,
      secrets_returned: externalSigner.secrets_returned === true,
    } : null,
    cloud_per_user_signer: summarizeCloudPerUserSigner(cloudPerUserSigner),
    execution_ready: body.execution_ready ?? null,
    funding_ready: body.funding_ready ?? null,
    execution_claimed: body.execution_claimed ?? false,
    blocker_codes: body.blocker_codes || [],
    funding_blocker_codes: body.funding_blocker_codes || [],
    balance_manager_id: body.agent?.balance_manager_id || body.balance_manager?.id || null,
    balances: body.balance_manager?.balances || body.funding?.balances || null,
  }
}

function summarizeChainData(result) {
  const body = result?.body || {}
  return {
    status: result?.status || 'unavailable',
    http_status: result?.http_status || 0,
    error: result?.error || null,
    chain: body.chain || null,
    provider_kind: body.provider_kind || body.chain_data_provider?.kind || null,
    provider_status: body.provider_status || null,
    worker_first: body.worker_first ?? null,
    probe_status: body.probe?.status || null,
  }
}

function summarizeRoot(result) {
  const body = result?.body || {}
  return {
    status: result?.status || 'unavailable',
    http_status: result?.http_status || 0,
    error: result?.error || null,
    service: body.service || null,
    chain: body.chain || null,
    agent: body.agent || null,
  }
}

export async function collectWorkerPublicState(workerUrl, options = {}) {
  const base = normalizeUrl(workerUrl)
  const [root, runtimeStatus, executionReadiness, chainDataStatus] = await Promise.all([
    fetchJson(`${base}/`, options),
    fetchJson(`${base}/api/runtime/status`, options),
    fetchJson(`${base}/api/execution/readiness`, options),
    fetchJson(`${base}/api/chain-data/status`, options),
  ])
  return {
    root: summarizeRoot(root),
    runtime_status: summarizeRuntimeStatus(runtimeStatus),
    execution_readiness: summarizeReadiness(executionReadiness),
    chain_data_status: summarizeChainData(chainDataStatus),
  }
}

function workerStateAvailable(workerState = {}) {
  return [
    workerState.root,
    workerState.runtime_status,
    workerState.execution_readiness,
    workerState.chain_data_status,
  ].every((row) => row?.status === 'ok')
}

function buildWorkerPublicStateChecks(workerState = {}) {
  const root = workerState.root || {}
  const runtime = workerState.runtime_status || {}
  const readiness = workerState.execution_readiness || {}
  const chainData = workerState.chain_data_status || {}
  return [
    createCheck({
      id: 'worker-public:endpoints',
      label: 'Worker public status endpoints are reachable',
      passed: workerStateAvailable(workerState),
      expected: 'root, runtime, execution readiness and chain-data status ok',
      actual: {
        root: root.status || null,
        runtime_status: runtime.status || null,
        execution_readiness: readiness.status || null,
        chain_data_status: chainData.status || null,
      },
    }),
    createCheck({
      id: 'worker-public:service',
      label: 'Worker root identifies RescueGrid service',
      passed: root.service === 'rescuegrid-worker',
      expected: 'rescuegrid-worker',
      actual: root.service || null,
    }),
    createCheck({
      id: 'worker-public:chain',
      label: 'Worker public status is for the deployed chain',
      passed: root.chain === deployment.chain && runtime.chain === deployment.chain && readiness.chain === deployment.chain,
      expected: deployment.chain,
      actual: { root: root.chain || null, runtime: runtime.chain || null, readiness: readiness.chain || null },
    }),
    createCheck({
      id: 'worker-public:agent',
      label: 'Worker runtime agent matches deployment',
      passed: runtime.agent_address === deployment.agent.address,
      expected: deployment.agent.address,
      actual: runtime.agent_address || null,
    }),
    createCheck({
      id: 'worker-public:signer-address',
      label: 'Worker signer posture matches expected deployment agent when available',
      passed: runtime.signer_matches_expected !== false && readiness.signer_available !== false,
      expected: 'signer matches expected deployment agent or remains unavailable with explicit posture',
      actual: {
        runtime_matches_expected: runtime.signer_matches_expected,
        readiness_signer_available: readiness.signer_available,
        runtime_signer_kind: runtime.signer_kind || null,
        readiness_signer_kind: readiness.signer_kind || null,
      },
    }),
    createCheck({
      id: 'worker-public:readiness-preflight-only',
      label: 'Execution readiness does not claim execution success',
      passed: readiness.execution_claimed === false,
      expected: false,
      actual: readiness.execution_claimed,
    }),
    createCheck({
      id: 'worker-public:chain-data-worker-first',
      label: 'Chain data status reports Worker-first reads',
      passed: chainData.worker_first === true && evidenceValuePresent(chainData.provider_kind),
      expected: 'worker_first=true with provider kind',
      actual: { worker_first: chainData.worker_first, provider_kind: chainData.provider_kind || null },
    }),
    createCheck({
      id: 'worker-public:no-external-signer-secrets',
      label: 'Worker public signer posture does not report signer secrets',
      passed: runtime.external_signer?.secrets_returned !== true &&
        readiness.external_signer?.secrets_returned !== true &&
        runtime.cloud_per_user_signer?.secrets_returned !== true &&
        readiness.cloud_per_user_signer?.secrets_returned !== true,
      expected: 'secrets_returned=false for external and cloud-per-user signer posture',
      actual: {
        runtime_external: runtime.external_signer?.secrets_returned ?? null,
        readiness_external: readiness.external_signer?.secrets_returned ?? null,
        runtime_cloud_per_user: runtime.cloud_per_user_signer?.secrets_returned ?? null,
        readiness_cloud_per_user: readiness.cloud_per_user_signer?.secrets_returned ?? null,
      },
    }),
  ]
}

function workerPublicStatePreflightPassed(workerState = {}) {
  return buildWorkerPublicStateChecks(workerState).every((check) => check.status === 'passed')
}

export function buildWalletEvidence({
  generatedAt = new Date().toISOString(),
  frontendUrl = DEFAULT_FRONTEND_URL,
  workerUrl = DEFAULT_WORKER_URL,
  ownerAddress = null,
  walletName = 'Slush or standard Sui wallet',
  frontendState = {},
  workerState = {},
} = {}) {
  const frontendPreflightOk = frontendPreflightPassed(frontendState)
  return {
    status: 'ok',
    purpose: 'browser_wallet_clickthrough_evidence',
    generated_at: generatedAt,
    chain: deployment.chain,
    generated_by: 'npm run wallet:evidence',
    read_only: true,
    actual_clickthrough_completed: false,
    execution_claimed: false,
    frontend: {
      url: normalizeUrl(frontendUrl),
      expected_route: 'Landing -> Sign in -> Dashboard -> New strategy',
      preflight_passed: frontendPreflightOk,
      public_state: frontendState,
    },
    worker: {
      url: normalizeUrl(workerUrl),
      public_state_available: workerStateAvailable(workerState),
      public_state_preflight_passed: workerPublicStatePreflightPassed(workerState),
      public_state_checks: buildWorkerPublicStateChecks(workerState),
      public_state: workerState,
    },
    deployment: {
      rescuegrid_package_id: deployment.rescuegrid.package_id,
      movegate_package_id: deployment.movegate.published_at,
      agent_address: deployment.agent.address,
      agent_passport_id: deployment.agent.passport_id,
      balance_manager_id: deployment.agent.balance_manager_id,
      deepbook_pool_id: deployment.deepbook.pools.SUI_DBUSDC.pool_id,
    },
    wallet: {
      wallet_name: walletName,
      network: 'Sui Testnet',
      owner_address: ownerAddress || 'TODO: record connected wallet owner address',
      expected_permissions: [
        'connect wallet account',
        'sign create_policy transaction built by the Worker',
        'sign revoke_policy transaction built by the Worker',
      ],
    },
    manual_flow: [
      {
        id: 'preflight',
        action: 'Start the local Worker, start Vite, open the frontend URL, connect the wallet on Sui Testnet.',
        record: ['wallet_name', 'owner_address', 'sign_in_screenshot'],
      },
      {
        id: 'create_policy',
        action: 'Open New strategy, use the SUI risk-response prompt, click Sign & deploy, and approve the wallet transaction.',
        record: ['create_tx_digest', 'wrapper_id', 'mandate_id', 'strategy_hash', 'activation_strategy_file', 'wallet_create_prompt_screenshot'],
      },
      {
        id: 'activation',
        action: 'Use the UI Activation strategy evidence banner to download the exact parsed strategy JSON used for creation, then wait for the UI and Worker activity to show the created policy and Monitoring runtime state.',
        record: ['activation_strategy_file', 'runtime_state_after_activate', 'policy_active_screenshot', 'activity_row_screenshot'],
      },
      {
        id: 'strict_execution_window',
        action: 'Keep this same policy active and run demo:execute:wallet-report with the wrapper id, create tx digest and strategy file before revoking it; final mission readiness requires the strict AgentTradeExecuted report and this wallet artifact to describe the same wrapper lifecycle.',
        record: ['wrapper_id', 'mandate_id', 'strategy_hash', 'create_tx_digest', 'activation_strategy_file', 'strict_execution_report_reference'],
      },
      {
        id: 'revoke_policy',
        action: 'Revoke the same policy from the UI and approve the wallet transaction.',
        record: ['revoke_tx_digest', 'mandate_id', 'wallet_revoke_prompt_screenshot'],
      },
      {
        id: 'post_revoke',
        action: 'Confirm the policy row, activity feed and policy detail show the revoked chain state.',
        record: ['policy_status_after_revoke', 'policy_revoked_screenshot', 'post_revoke_activity_screenshot'],
      },
    ],
    evidence_fields: {
      owner_address: ownerAddress || '',
      sign_in_screenshot: '',
      wallet_create_prompt_screenshot: '',
      create_tx_digest: '',
      wrapper_id: '',
      mandate_id: '',
      strategy_hash: '',
      activation_strategy_file: '',
      runtime_state_after_activate: '',
      policy_active_screenshot: '',
      activity_row_screenshot: '',
      strict_execution_report_reference: '',
      wallet_revoke_prompt_screenshot: '',
      revoke_tx_digest: '',
      policy_status_after_revoke: '',
      policy_revoked_screenshot: '',
      post_revoke_activity_screenshot: '',
    },
    pass_conditions: [
      'The app does not auto-enter the dashboard without an explicit wallet or read-only session.',
      'Create flow uses Worker-built tx_json and the browser wallet returns a create tx digest.',
      'PolicyCreated event yields a wrapper_id and mandate_id that match the UI/API row.',
      'Activation reaches Monitoring after the create transaction finalizes.',
      'Before revocation, the same active wrapper is available for demo:execute:wallet-report; the wallet artifact itself still does not claim DeepBook execution.',
      'The UI activation strategy evidence JSON used to create the wrapper is saved locally and hashes to the on-chain strategy_hash during wallet-report validation.',
      'The artifact records the strict execution report reference for this wrapper before the revoke step.',
      'Revoke flow uses Worker-built tx_json and the browser wallet returns a revoke tx digest.',
      'Post-revoke reads show chain-authoritative revoked status for the same wrapper and mandate.',
      'No seed phrase, signing secret, Worker secret, tick token, WaaP session value or approval token is captured in screenshots or artifacts.',
      'This artifact does not claim DeepBook execution; DBUSDC/DEEP funding and demo:execute remain separate gates.',
    ],
    next_commands: {
      generate_artifact: 'npm run wallet:evidence -- --format markdown --out .rescuegrid/wallet-clickthrough-evidence.md',
      mock_flow_test: 'npm run test:wallet-flow',
      auth_wallet_test: 'npm run test:auth-wallets',
      session_boundary_test: 'npm run test:session-mode',
      live_smoke_after_clickthrough: 'RESCUEGRID_FRONTEND_URL=http://localhost:5175 RESCUEGRID_WORKER_URL=http://localhost:8787 npm run baseline:smoke',
      preflight: 'npm run wallet:evidence:preflight',
      strict_execution_report: 'npm run demo:execute:wallet-report -- --wrapper-id <wrapper_id> --strategy-file <activation_strategy_file> --create-tx-digest <create_tx_digest>',
      final_verify: 'npm run wallet:evidence:verify -- --input .rescuegrid/wallet-clickthrough-evidence.md --require-worker --execution-report .rescuegrid/demo-execute-report.json',
    },
  }
}

function valueOrTodo(value) {
  return value == null || value === '' ? 'TODO' : String(value)
}

function signerPostureLine(posture) {
  if (!posture) return 'n/a'
  return [
    posture.kind || 'signer',
    posture.runtime_scope,
    posture.custody_model,
    posture.runner_configured === false ? 'runner missing' : null,
    posture.unavailable_code,
  ].filter(Boolean).join(' · ')
}

function externalSignerPostureLine(posture) {
  if (!posture) return 'n/a'
  return [
    posture.kind || 'external',
    posture.status || (posture.available ? 'available' : 'unavailable'),
    posture.submission_runner_configured === false ? 'runner missing' : null,
    posture.permission_token_configured === true ? 'permission token configured' : posture.permission_token_configured === false ? 'permission token not configured' : null,
    posture.unavailable_code,
  ].filter(Boolean).join(' · ')
}

function markdown(evidence) {
  const state = evidence.worker.public_state || {}
  const blockers = [...new Set([
    ...(state.execution_readiness?.blocker_codes || []),
    ...(state.execution_readiness?.funding_blocker_codes || []),
  ])]
  const fieldLines = Object.entries(evidence.evidence_fields).map(([key, value]) => (
    `- ${key}: ${valueOrTodo(value)}`
  ))
  const stepLines = evidence.manual_flow.flatMap((step) => [
    `## ${step.id}`,
    '',
    step.action,
    '',
    `Record: ${step.record.join(', ')}`,
    '',
  ])
  return [
    '# RescueGrid Wallet Click-Through Evidence',
    '',
    `Generated: ${evidence.generated_at}`,
    `Chain: ${evidence.chain}`,
    `Frontend: ${evidence.frontend.url}`,
    `Worker: ${evidence.worker.url}`,
    `Read-only artifact generation: ${evidence.read_only}`,
    `Actual click-through completed: ${evidence.actual_clickthrough_completed}`,
    `Execution claimed: ${evidence.execution_claimed}`,
    `Frontend preflight: ${evidence.frontend.preflight_passed}`,
    '',
    '## Frontend Preflight',
    '',
    `Root reachable: ${evidence.frontend.public_state?.root?.status || 'unavailable'}`,
    `Root contains RescueGrid: ${valueOrTodo(evidence.frontend.public_state?.root?.contains_rescuegrid)}`,
    `App entry present: ${valueOrTodo(Boolean(evidence.frontend.public_state?.root?.has_vite_dev_entry || evidence.frontend.public_state?.root?.has_built_asset_entry))}`,
    `Wallet auto-connect disabled: ${valueOrTodo(evidence.frontend.public_state?.source_guardrails?.wallet_auto_connect_disabled)}`,
    `Worker read-only entry explicit: ${valueOrTodo(evidence.frontend.public_state?.source_guardrails?.explicit_worker_read_only_entry)}`,
    `No-wallet demo entry explicit: ${valueOrTodo(evidence.frontend.public_state?.source_guardrails?.explicit_no_wallet_demo_entry)}`,
    `Activation strategy export present: ${valueOrTodo(evidence.frontend.public_state?.source_guardrails?.activation_strategy_evidence_export)}`,
    `Writes require Worker config: ${valueOrTodo(evidence.frontend.public_state?.source_guardrails?.writes_require_worker_config)}`,
    '',
    '## Deployment',
    '',
    `RescueGrid package: ${evidence.deployment.rescuegrid_package_id}`,
    `MoveGate package: ${evidence.deployment.movegate_package_id}`,
    `Agent: ${evidence.deployment.agent_address}`,
    `AgentPassport: ${evidence.deployment.agent_passport_id}`,
    `BalanceManager: ${evidence.deployment.balance_manager_id}`,
    `DeepBook pool: ${evidence.deployment.deepbook_pool_id}`,
    '',
    '## Worker Public State',
    '',
    `Public state available: ${evidence.worker.public_state_available}`,
    `Public state preflight: ${evidence.worker.public_state_preflight_passed}`,
    `Runtime status: ${state.runtime_status?.status || 'unavailable'}`,
    `Signer kind: ${state.runtime_status?.signer_kind || 'n/a'}`,
    `Signer available: ${valueOrTodo(state.runtime_status?.signer_available)}`,
    `Execution enabled: ${valueOrTodo(state.runtime_status?.execution_enabled)}`,
    `Known signer kinds: ${(state.runtime_status?.known_signer_kinds || state.runtime_status?.signer_capability_kinds || []).join(', ') || 'n/a'}`,
    `Runtime signer posture: ${signerPostureLine(state.runtime_status?.selected_signer_capability)}`,
    `Runtime external signer: ${externalSignerPostureLine(state.runtime_status?.external_signer)}`,
    `Execution readiness: ${valueOrTodo(state.execution_readiness?.execution_ready)}`,
    `Funding readiness: ${valueOrTodo(state.execution_readiness?.funding_ready)}`,
    `Readiness signer posture: ${signerPostureLine(state.execution_readiness?.selected_signer_capability)}`,
    `Readiness external signer: ${externalSignerPostureLine(state.execution_readiness?.external_signer)}`,
    `Blockers: ${blockers.join(', ') || 'none'}`,
    `Chain data provider: ${state.chain_data_status?.provider_kind || 'n/a'} (${state.chain_data_status?.provider_status || state.chain_data_status?.status || 'n/a'})`,
    '',
    '## Wallet',
    '',
    `Wallet: ${evidence.wallet.wallet_name}`,
    `Network: ${evidence.wallet.network}`,
    `Owner address: ${evidence.wallet.owner_address}`,
    '',
    ...stepLines,
    '## Evidence Fields',
    '',
    ...fieldLines,
    '',
    '## Pass Conditions',
    '',
    ...evidence.pass_conditions.map((condition) => `- ${condition}`),
    '',
    '## Next Commands',
    '',
    `- ${evidence.next_commands.generate_artifact}`,
    `- ${evidence.next_commands.mock_flow_test}`,
    `- ${evidence.next_commands.auth_wallet_test}`,
    `- ${evidence.next_commands.session_boundary_test}`,
    `- ${evidence.next_commands.preflight}`,
    `- ${evidence.next_commands.strict_execution_report}`,
    `- ${evidence.next_commands.final_verify}`,
    `- ${evidence.next_commands.live_smoke_after_clickthrough}`,
    '',
  ].join('\n')
}

export function serializeWalletEvidence(evidence, format = 'json') {
  const normalized = String(format || 'json').toLowerCase()
  if (normalized === 'markdown' || normalized === 'md') return markdown(evidence)
  return JSON.stringify(evidence, null, 2)
}

export function writeWalletEvidenceArtifact(evidence, { outPath, format = 'json' } = {}) {
  if (!outPath) throw new Error('outPath is required')
  const resolvedPath = resolve(String(outPath))
  const body = serializeWalletEvidence(evidence, format)
  const payload = body.endsWith('\n') ? body : `${body}\n`
  mkdirSync(dirname(resolvedPath), { recursive: true })
  writeFileSync(resolvedPath, payload, 'utf8')
  return {
    path: resolvedPath,
    format: String(format || 'json').toLowerCase(),
    bytes: Buffer.byteLength(payload),
  }
}

function stripCodeFence(value) {
  return String(value ?? '').trim().replace(/^`+|`+$/g, '').trim()
}

function evidenceValuePresent(value) {
  const normalized = stripCodeFence(value)
  return normalized !== '' && !/^TODO\b/i.test(normalized) && normalized !== 'n/a'
}

function normalizeHexLike(value) {
  return stripCodeFence(value).toLowerCase()
}

function normalizeStrategyHash(value) {
  const normalized = normalizeHexLike(value)
  if (!normalized) return normalized
  return normalized.startsWith('0x') ? normalized : `0x${normalized}`
}

function stripEmbeddedStrategyHash(strategy = {}) {
  const { strategy_hash: _strategyHash, ...unsignedStrategy } = JSON.parse(JSON.stringify(strategy || {}))
  return unsignedStrategy
}

function mergeEvidenceField(fields, key, value) {
  const normalized = stripCodeFence(value)
  if (!normalized) return
  if (!fields[key] || !evidenceValuePresent(fields[key])) fields[key] = normalized
}

function parseBooleanValue(value) {
  const normalized = stripCodeFence(value).toLowerCase()
  if (['true', 'yes', 'y', '1', 'completed', 'complete'].includes(normalized)) return true
  if (['false', 'no', 'n', '0', 'todo', 'pending', 'incomplete'].includes(normalized)) return false
  return null
}

export function parseWalletEvidenceArtifact(text) {
  const raw = String(text || '')
  const trimmed = raw.trim()
  if (!trimmed) {
    return { format: 'empty', fields: {}, metadata: {}, status: 'error', code: 'EMPTY_ARTIFACT' }
  }
  if (trimmed.startsWith('{')) {
    const json = JSON.parse(trimmed)
    return {
      format: 'json',
      fields: {
        ...(json.evidence_fields || {}),
        owner_address: json.evidence_fields?.owner_address || json.wallet?.owner_address || '',
      },
      metadata: {
        chain: json.chain || null,
        frontend_url: json.frontend?.url || null,
        worker_url: json.worker?.url || null,
        wallet_name: json.wallet?.wallet_name || null,
        wallet_network: json.wallet?.network || null,
        generated_at: json.generated_at || null,
        actual_clickthrough_completed: json.actual_clickthrough_completed === true,
      },
      status: 'ok',
    }
  }

  const fields = {}
  const metadata = {}
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    let match = line.match(/^- ([A-Za-z0-9_]+):\s*(.*)$/)
    if (match) {
      mergeEvidenceField(fields, match[1], match[2])
      continue
    }
    match = line.match(/^Owner address:\s*(.*)$/i)
    if (match) {
      mergeEvidenceField(fields, 'owner_address', match[1])
      continue
    }
    match = line.match(/^Worker:\s*(.*)$/i)
    if (match) {
      metadata.worker_url = stripCodeFence(match[1])
      continue
    }
    match = line.match(/^Frontend:\s*(.*)$/i)
    if (match) {
      metadata.frontend_url = stripCodeFence(match[1])
      continue
    }
    match = line.match(/^Chain:\s*(.*)$/i)
    if (match) {
      metadata.chain = stripCodeFence(match[1])
      continue
    }
    match = line.match(/^Wallet:\s*(.*)$/i)
    if (match) {
      metadata.wallet_name = stripCodeFence(match[1])
      continue
    }
    match = line.match(/^Network:\s*(.*)$/i)
    if (match) {
      metadata.wallet_network = stripCodeFence(match[1])
      continue
    }
    match = line.match(/^Generated:\s*(.*)$/i)
    if (match) {
      metadata.generated_at = stripCodeFence(match[1])
      continue
    }
    match = line.match(/^Actual click-through completed:\s*(.*)$/i)
    if (match) {
      metadata.actual_clickthrough_completed = parseBooleanValue(match[1])
    }
  }
  return { format: 'markdown', fields, metadata, status: 'ok' }
}

function hexFromMaybeVector(value) {
  if (typeof value === 'string') return normalizeStrategyHash(value)
  if (!Array.isArray(value)) return null
  return `0x${value.map((b) => Number(b).toString(16).padStart(2, '0')).join('')}`
}

function findPolicyEvent(tx, eventName) {
  return (tx?.events || []).find((event) => String(event.type).endsWith(`::policy::${eventName}`))
    || (tx?.events || []).find((event) => String(event.type).endsWith(`::${eventName}`))
    || null
}

function txStatus(tx) {
  return tx?.effects?.status?.status || tx?.effects?.status || null
}

function txSummary(tx, eventName) {
  const event = findPolicyEvent(tx, eventName)
  return {
    digest: tx?.digest || null,
    status: txStatus(tx),
    checkpoint: tx?.checkpoint || null,
    timestamp_ms: tx?.timestampMs || null,
    event_type: event?.type || null,
    event: event?.parsedJson || null,
  }
}

async function readTransaction(client, digest) {
  return client.getTransactionBlock({
    digest,
    options: { showEvents: true, showEffects: true, showObjectChanges: true },
  })
}

function createCheck({ id, label, passed, expected = null, actual = null, detail = null, skipped = false }) {
  return {
    id,
    label,
    status: skipped ? 'skipped' : passed ? 'passed' : 'failed',
    passed: skipped ? null : Boolean(passed),
    expected,
    actual,
    detail,
  }
}

function detectSecretLeaks(text) {
  return SECRET_LEAK_PATTERNS.filter(({ pattern }) => pattern.test(String(text || ''))).map(({ id }) => id)
}

function buildSecretLeakCheck(text) {
  const leaks = detectSecretLeaks(text)
  return createCheck({
    id: 'artifact:secret-scan',
    label: 'Artifact does not contain obvious secret assignments',
    passed: leaks.length === 0,
    expected: 'no AGENT_KEY, owner key, private key, tick token, WaaP token or seed phrase values',
    actual: leaks,
  })
}

function checkEqual(id, label, actual, expected, detail = null) {
  return createCheck({
    id,
    label,
    passed: normalizeHexLike(actual) === normalizeHexLike(expected),
    expected,
    actual,
    detail,
  })
}

function buildMissingChecks(fields, requiredFields) {
  return requiredFields.map((field) => createCheck({
    id: `field:${field}`,
    label: `${field} is present in the artifact`,
    passed: evidenceValuePresent(fields[field]),
    expected: 'present non-TODO value',
    actual: fields[field] || '',
  }))
}

function buildClickthroughCompletedCheck(metadata = {}) {
  return createCheck({
    id: 'manual:actual-clickthrough-completed',
    label: 'Artifact explicitly confirms the browser wallet click-through was completed',
    passed: metadata.actual_clickthrough_completed === true,
    expected: true,
    actual: metadata.actual_clickthrough_completed ?? null,
  })
}

function normalizeEvidenceReference(value) {
  const normalized = stripCodeFence(value)
  const markdownLink = normalized.match(/^\[[^\]]+\]\(([^)]+)\)$/)
  if (markdownLink) return markdownLink[1].trim()
  return normalized.replace(/^<|>$/g, '').trim()
}

function isExternalEvidenceReference(value) {
  return /^(https?|ipfs|ar|walrus):/i.test(value)
}

function localEvidencePath(value) {
  if (/^file:/i.test(value)) {
    try {
      return new URL(value)
    } catch {
      return value
    }
  }
  return resolve(value)
}

function buildEvidenceReferenceCheck(field, value, { readFileImpl = readFileSync } = {}) {
  const reference = normalizeEvidenceReference(value)
  if (!reference) {
    return createCheck({
      id: `manual-reference:${field}`,
      label: `${field} evidence reference is present`,
      passed: false,
      expected: 'local readable file or external URL reference',
      actual: value || '',
    })
  }
  if (isExternalEvidenceReference(reference)) {
    return createCheck({
      id: `manual-reference:${field}`,
      label: `${field} evidence reference is an external URL`,
      passed: true,
      expected: 'local readable file or external URL reference',
      actual: reference,
      detail: 'external references are not fetched by this secret-safe verifier',
    })
  }

  const resolvedPath = localEvidencePath(reference)
  try {
    const body = readFileImpl(resolvedPath)
    const bytes = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body || ''))
    return createCheck({
      id: `manual-reference:${field}`,
      label: `${field} local evidence file is readable and non-empty`,
      passed: bytes > 0,
      expected: 'readable non-empty file',
      actual: String(resolvedPath),
      detail: `${bytes} bytes`,
    })
  } catch (e) {
    return createCheck({
      id: `manual-reference:${field}`,
      label: `${field} local evidence file is readable and non-empty`,
      passed: false,
      expected: 'readable non-empty file',
      actual: String(resolvedPath),
      detail: String(e?.message || e),
    })
  }
}

function buildEvidenceReferenceChecks(fields, options = {}) {
  return REQUIRED_LOCAL_OR_EXTERNAL_EVIDENCE_FIELDS.map((field) => buildEvidenceReferenceCheck(field, fields[field], options))
}

function lifecycleValue(value) {
  return stripCodeFence(value).toLowerCase()
}

function buildManualLifecycleChecks(fields) {
  return [
    createCheck({
      id: 'manual:runtime-state-after-activate',
      label: 'Artifact records Monitoring runtime state after activation',
      passed: lifecycleValue(fields.runtime_state_after_activate) === 'monitoring',
      expected: 'Monitoring',
      actual: fields.runtime_state_after_activate || '',
    }),
    createCheck({
      id: 'manual:policy-status-after-revoke',
      label: 'Artifact records revoked policy status after revoke',
      passed: lifecycleValue(fields.policy_status_after_revoke) === 'revoked',
      expected: 'revoked',
      actual: fields.policy_status_after_revoke || '',
    }),
  ]
}

function buildWalletMetadataChecks(metadata = {}) {
  return [
    createCheck({
      id: 'wallet:wallet-name',
      label: 'Artifact records the browser wallet used for click-through',
      passed: evidenceValuePresent(metadata.wallet_name),
      expected: 'Slush or another standard Sui wallet name',
      actual: metadata.wallet_name || '',
    }),
    createCheck({
      id: 'wallet:network',
      label: 'Artifact records Sui Testnet wallet network',
      passed: stripCodeFence(metadata.wallet_network).toLowerCase() === 'sui testnet',
      expected: 'Sui Testnet',
      actual: metadata.wallet_network || '',
    }),
  ]
}

function normalizeReferencePath(value) {
  return stripCodeFence(value).replace(/\\/g, '/')
}

function sameReportReference(actual, expected) {
  const normalizedActual = normalizeReferencePath(actual)
  const normalizedExpected = normalizeReferencePath(expected)
  if (!normalizedExpected) return true
  if (normalizedActual === normalizedExpected) return true
  if (!normalizedActual) return false
  return resolve(normalizedActual) === resolve(normalizedExpected)
}

function buildStrictExecutionReportReferenceCheck(fields, expectedPath) {
  return createCheck({
    id: 'manual:strict-execution-report-reference',
    label: 'Strict execution report reference matches the expected report path',
    passed: sameReportReference(fields.strict_execution_report_reference, expectedPath),
    expected: expectedPath || 'not required',
    actual: fields.strict_execution_report_reference || '',
    skipped: !expectedPath,
  })
}

function checkDigestEqual(id, label, actual, expected, detail = null) {
  const normalizedActual = stripCodeFence(actual)
  const normalizedExpected = stripCodeFence(expected)
  return createCheck({
    id,
    label,
    passed: normalizedActual !== '' && normalizedActual === normalizedExpected,
    expected,
    actual,
    detail,
  })
}

function readActivationStrategyFile({ filePath, fields = {}, readFileImpl = readFileSync, compareFields = true }) {
  const rawPath = normalizeReferencePath(filePath)
  const resolvedPath = resolve(rawPath)
  const checks = []
  const summary = {
    path: rawPath,
    resolved_path: resolvedPath,
    purpose: null,
    artifact_version: null,
    strategy_hash: null,
    computed_strategy_hash: null,
    owner_address: null,
    wrapper_id: null,
    mandate_id: null,
    create_tx_digest: null,
    activation_runtime_state: null,
  }

  let raw = ''
  try {
    raw = readFileImpl(resolvedPath, 'utf8')
    checks.push(createCheck({
      id: 'activation-strategy:file-readable',
      label: 'Activation strategy file is readable',
      passed: true,
      expected: rawPath,
      actual: resolvedPath,
    }))
  } catch (e) {
    checks.push(createCheck({
      id: 'activation-strategy:file-readable',
      label: 'Activation strategy file is readable',
      passed: false,
      expected: rawPath,
      actual: resolvedPath,
      detail: String(e?.message || e),
    }))
    return { summary, checks }
  }

  const leaks = detectSecretLeaks(raw)
  checks.push(createCheck({
    id: 'activation-strategy:secret-scan',
    label: 'Activation strategy file does not contain obvious secret assignments',
    passed: leaks.length === 0,
    expected: 'no AGENT_KEY, owner key, private key, tick token, WaaP token or seed phrase values',
    actual: leaks,
  }))
  if (leaks.length > 0) return { summary, checks }

  let parsed = null
  try {
    parsed = JSON.parse(raw)
    checks.push(createCheck({
      id: 'activation-strategy:json-valid',
      label: 'Activation strategy file is valid JSON',
      passed: true,
      expected: 'valid JSON',
      actual: 'valid JSON',
    }))
  } catch (e) {
    checks.push(createCheck({
      id: 'activation-strategy:json-valid',
      label: 'Activation strategy file is valid JSON',
      passed: false,
      expected: 'valid JSON',
      actual: 'parse failed',
      detail: String(e?.message || e),
    }))
    return { summary, checks }
  }

  const strategy = parsed?.strategy && typeof parsed.strategy === 'object' ? parsed.strategy : parsed
  const strategyObjectValid = strategy && typeof strategy === 'object' && !Array.isArray(strategy)
  checks.push(createCheck({
    id: 'activation-strategy:strategy-object',
    label: 'Activation strategy file contains a strategy object',
    passed: strategyObjectValid,
    expected: 'JSON object or { strategy: object }',
    actual: Array.isArray(strategy) ? 'array' : typeof strategy,
  }))
  if (!strategyObjectValid) return { summary, checks }

  const unsignedStrategy = stripEmbeddedStrategyHash(strategy)
  const computedStrategyHash = strategyHash(unsignedStrategy)
  summary.purpose = parsed?.purpose || null
  summary.artifact_version = parsed?.artifact_version || null
  summary.strategy_hash = parsed?.strategy_hash || strategy?.strategy_hash || null
  summary.computed_strategy_hash = computedStrategyHash
  summary.owner_address = parsed?.owner_address || strategy?.owner || null
  summary.wrapper_id = parsed?.wrapper_id || null
  summary.mandate_id = parsed?.mandate_id || null
  summary.create_tx_digest = parsed?.create_tx_digest || null
  summary.activation_runtime_state = parsed?.activation?.runtime_state || null

  if (summary.strategy_hash) {
    checks.push(checkEqual(
      'activation-strategy:envelope-computed-strategy-hash',
      'Activation strategy envelope strategy_hash matches computed canonical hash',
      summary.strategy_hash,
      computedStrategyHash,
    ))
  }

  if (compareFields) {
    checks.push(
      checkEqual(
        'activation-strategy:strategy-hash',
        'Activation strategy file hashes to artifact strategy_hash',
        computedStrategyHash,
        fields.strategy_hash,
      ),
      checkEqual(
        'activation-strategy:owner',
        'Activation strategy owner matches wallet artifact',
        summary.owner_address,
        fields.owner_address,
        'owner may come from the UI evidence envelope or the strategy.owner field',
      ),
    )

    if (summary.strategy_hash) {
      checks.push(checkEqual(
        'activation-strategy:envelope-strategy-hash',
        'Activation strategy envelope strategy_hash matches wallet artifact',
        summary.strategy_hash,
        fields.strategy_hash,
      ))
    }
    if (summary.wrapper_id) {
      checks.push(checkEqual(
        'activation-strategy:wrapper',
        'Activation strategy wrapper_id matches wallet artifact',
        summary.wrapper_id,
        fields.wrapper_id,
      ))
    }
    if (summary.mandate_id) {
      checks.push(checkEqual(
        'activation-strategy:mandate',
        'Activation strategy mandate_id matches wallet artifact',
        summary.mandate_id,
        fields.mandate_id,
      ))
    }
    if (summary.create_tx_digest) {
      checks.push(checkEqual(
        'activation-strategy:create-digest',
        'Activation strategy create_tx_digest matches wallet artifact',
        summary.create_tx_digest,
        fields.create_tx_digest,
      ))
    }
  }

  return { summary, checks }
}

function mergeableFieldValuesMatch(key, existing, next) {
  if (!evidenceValuePresent(existing)) return true
  if (['owner_address', 'wrapper_id', 'mandate_id', 'strategy_hash'].includes(key)) {
    return normalizeHexLike(existing) === normalizeHexLike(next)
  }
  if (['activation_strategy_file', 'strict_execution_report_reference'].includes(key)) {
    return sameReportReference(existing, next)
  }
  if (['runtime_state_after_activate', 'policy_status_after_revoke'].includes(key)) {
    return stripCodeFence(existing).toLowerCase() === stripCodeFence(next).toLowerCase()
  }
  return stripCodeFence(existing) === stripCodeFence(next)
}

function activationSummaryUpdates(summary, strategyFilePath) {
  const updates = {
    owner_address: summary.owner_address,
    create_tx_digest: summary.create_tx_digest,
    wrapper_id: summary.wrapper_id,
    mandate_id: summary.mandate_id,
    strategy_hash: summary.computed_strategy_hash,
    activation_strategy_file: normalizeReferencePath(strategyFilePath),
  }
  if (summary.activation_runtime_state) {
    updates.runtime_state_after_activate = summary.activation_runtime_state
  }
  return Object.fromEntries(Object.entries(updates).filter(([, value]) => evidenceValuePresent(value)))
}

function buildActivationStrategyApplyConflicts(fields, updates) {
  return Object.entries(updates).flatMap(([key, value]) => {
    if (key === 'runtime_state_after_activate') return []
    if (mergeableFieldValuesMatch(key, fields[key], value)) return []
    return [{
      field: key,
      existing: fields[key],
      next: value,
    }]
  })
}

function buildEvidenceApplyConflicts(fields, updates, { allowedOverwriteFields = [] } = {}) {
  const allowed = new Set(allowedOverwriteFields)
  return Object.entries(updates).flatMap(([key, value]) => {
    if (allowed.has(key)) return []
    if (mergeableFieldValuesMatch(key, fields[key], value)) return []
    return [{
      field: key,
      existing: fields[key],
      next: value,
    }]
  })
}

function readStrictExecutionReportFile({ filePath, readFileImpl = readFileSync }) {
  const rawPath = normalizeReferencePath(filePath)
  const resolvedPath = resolve(rawPath)
  const checks = []
  const summary = {
    path: rawPath,
    resolved_path: resolvedPath,
    purpose: null,
    report_mode: null,
    chain: null,
    phase: null,
    owner_address: null,
    wrapper_id: null,
    mandate_id: null,
    strategy_hash: null,
    create_tx_digest: null,
    tick_tx_digest: null,
    revoke_tx_digest: null,
    policy_status_after_revoke: null,
    execution_claimed: null,
  }

  let raw = ''
  try {
    raw = readFileImpl(resolvedPath, 'utf8')
    checks.push(createCheck({
      id: 'strict-execution:file-readable',
      label: 'Strict execution report file is readable',
      passed: true,
      expected: rawPath,
      actual: resolvedPath,
    }))
  } catch (e) {
    checks.push(createCheck({
      id: 'strict-execution:file-readable',
      label: 'Strict execution report file is readable',
      passed: false,
      expected: rawPath,
      actual: resolvedPath,
      detail: String(e?.message || e),
    }))
    return { summary, checks }
  }

  const leaks = detectSecretLeaks(raw)
  checks.push(createCheck({
    id: 'strict-execution:secret-scan',
    label: 'Strict execution report does not contain obvious secret assignments',
    passed: leaks.length === 0,
    expected: 'no AGENT_KEY, owner key, private key, tick token, WaaP token or seed phrase values',
    actual: leaks,
  }))
  if (leaks.length > 0) return { summary, checks }

  let parsed = null
  try {
    parsed = JSON.parse(raw)
    checks.push(createCheck({
      id: 'strict-execution:json-valid',
      label: 'Strict execution report is valid JSON',
      passed: true,
      expected: 'valid JSON',
      actual: 'valid JSON',
    }))
  } catch (e) {
    checks.push(createCheck({
      id: 'strict-execution:json-valid',
      label: 'Strict execution report is valid JSON',
      passed: false,
      expected: 'valid JSON',
      actual: 'parse failed',
      detail: String(e?.message || e),
    }))
    return { summary, checks }
  }

  summary.purpose = parsed?.purpose || null
  summary.report_mode = parsed?.report_mode || null
  summary.chain = parsed?.chain || null
  summary.phase = parsed?.phase || null
  summary.owner_address = parsed?.owner_address || null
  summary.wrapper_id = parsed?.wrapper_id || null
  summary.mandate_id = parsed?.mandate_id || null
  summary.strategy_hash = parsed?.strategy_hash || null
  summary.create_tx_digest = parsed?.create_tx_digest || parsed?.create_tx?.digest || null
  summary.tick_tx_digest = parsed?.tick_tx_digest || parsed?.tx_digest || null
  summary.revoke_tx_digest = parsed?.revoke_tx_digest || parsed?.revoke_tx?.digest || null
  summary.policy_status_after_revoke = parsed?.post_revoke?.final_policy_status || parsed?.post_revoke?.final_runtime_state || null
  summary.execution_claimed = parsed?.execution_claimed === true

  const missingEvidence = strictDemoExecutionMissingEvidence(parsed)
  checks.push(
    createCheck({
      id: 'strict-execution:purpose',
      label: 'Strict execution report has the expected purpose',
      passed: summary.purpose === 'rescuegrid_demo_execution_report',
      expected: 'rescuegrid_demo_execution_report',
      actual: summary.purpose,
    }),
    createCheck({
      id: 'strict-execution:wallet-report-mode',
      label: 'Strict execution report comes from the browser-wallet same-wrapper validator',
      passed: summary.report_mode === 'wallet_created_policy',
      expected: 'wallet_created_policy',
      actual: summary.report_mode,
    }),
    createCheck({
      id: 'strict-execution:chain',
      label: 'Strict execution report is for the deployed chain',
      passed: summary.chain === deployment.chain,
      expected: deployment.chain,
      actual: summary.chain,
    }),
    createCheck({
      id: 'strict-execution:structured-evidence',
      label: 'Strict execution report proves structured AgentTradeExecuted evidence',
      passed: missingEvidence.length === 0,
      expected: 'no missing strict execution evidence',
      actual: missingEvidence,
    }),
  )

  return { summary, checks }
}

function strictExecutionReportUpdates(summary, reportFilePath) {
  const updates = {
    owner_address: summary.owner_address,
    create_tx_digest: summary.create_tx_digest,
    wrapper_id: summary.wrapper_id,
    mandate_id: summary.mandate_id,
    strategy_hash: summary.strategy_hash,
    revoke_tx_digest: summary.revoke_tx_digest,
    policy_status_after_revoke: summary.policy_status_after_revoke,
    strict_execution_report_reference: normalizeReferencePath(reportFilePath),
  }
  return Object.fromEntries(Object.entries(updates).filter(([, value]) => evidenceValuePresent(value)))
}

function buildStrictExecutionReportContinuityChecks(fields, summary = {}) {
  return [
    checkEqual(
      'strict-execution:owner',
      'Strict execution report owner matches wallet artifact',
      summary.owner_address,
      fields.owner_address,
    ),
    checkEqual(
      'strict-execution:wrapper',
      'Strict execution report wrapper_id matches wallet artifact',
      summary.wrapper_id,
      fields.wrapper_id,
    ),
    checkEqual(
      'strict-execution:mandate',
      'Strict execution report mandate_id matches wallet artifact',
      summary.mandate_id,
      fields.mandate_id,
    ),
    checkEqual(
      'strict-execution:strategy-hash',
      'Strict execution report strategy_hash matches wallet artifact',
      summary.strategy_hash,
      fields.strategy_hash,
    ),
    checkDigestEqual(
      'strict-execution:create-digest',
      'Strict execution report create_tx_digest matches wallet artifact',
      summary.create_tx_digest,
      fields.create_tx_digest,
    ),
    checkDigestEqual(
      'strict-execution:revoke-digest',
      'Strict execution report revoke_tx_digest matches wallet artifact',
      summary.revoke_tx_digest,
      fields.revoke_tx_digest,
    ),
  ]
}

function withTrailingNewline(text) {
  return String(text || '').endsWith('\n') ? String(text || '') : `${text}\n`
}

function applyUpdatesToJsonEvidenceArtifact(text, updates) {
  const artifact = JSON.parse(String(text || '{}'))
  artifact.evidence_fields = {
    ...(artifact.evidence_fields || {}),
    ...updates,
  }
  if (updates.owner_address) {
    artifact.wallet = {
      ...(artifact.wallet || {}),
      owner_address: updates.owner_address,
    }
  }
  return `${JSON.stringify(artifact, null, 2)}\n`
}

function replaceMarkdownFieldLine(line, updates, seen) {
  const field = line.match(/^(-\s*)([A-Za-z0-9_]+)(:\s*)(.*)$/)
  if (field && Object.prototype.hasOwnProperty.call(updates, field[2])) {
    seen.add(field[2])
    return `${field[1]}${field[2]}${field[3] || ': '}${updates[field[2]]}`
  }
  const owner = line.match(/^(Owner address:\s*)(.*)$/i)
  if (owner && updates.owner_address) {
    return `${owner[1]}${updates.owner_address}`
  }
  return line
}

function insertMissingMarkdownEvidenceFields(lines, updates, seen) {
  const missing = Object.entries(updates).filter(([key]) => !seen.has(key))
  if (missing.length === 0) return lines
  const headingIndex = lines.findIndex((line) => /^## Evidence Fields\s*$/i.test(line.trim()))
  const fieldLines = missing.map(([key, value]) => `- ${key}: ${value}`)
  if (headingIndex < 0) {
    return [...lines, '', '## Evidence Fields', '', ...fieldLines]
  }

  let insertIndex = headingIndex + 1
  while (insertIndex < lines.length && lines[insertIndex].trim() === '') insertIndex += 1
  return [
    ...lines.slice(0, insertIndex),
    ...fieldLines,
    ...lines.slice(insertIndex),
  ]
}

function applyUpdatesToMarkdownEvidenceArtifact(text, updates) {
  const seen = new Set()
  const lines = String(text || '').split(/\r?\n/)
  const replaced = lines.map((line) => replaceMarkdownFieldLine(line, updates, seen))
  return withTrailingNewline(insertMissingMarkdownEvidenceFields(replaced, updates, seen).join('\n'))
}

export function applyActivationStrategyToWalletEvidenceArtifact({
  artifactText,
  strategyFilePath,
  readFileImpl = readFileSync,
} = {}) {
  if (!strategyFilePath) {
    return {
      status: 'error',
      code: 'ACTIVATION_STRATEGY_FILE_REQUIRED',
      message: '--strategy-file is required',
    }
  }

  const parsed = parseWalletEvidenceArtifact(artifactText)
  if (parsed.status !== 'ok') {
    return {
      status: 'error',
      code: parsed.code || 'WALLET_EVIDENCE_ARTIFACT_INVALID',
      message: 'wallet evidence artifact could not be parsed',
    }
  }

  const activationStrategy = readActivationStrategyFile({
    filePath: strategyFilePath,
    fields: {},
    readFileImpl,
    compareFields: false,
  })
  const activationStrategyFailures = activationStrategy.checks.filter((check) => check.status === 'failed')
  if (activationStrategyFailures.length > 0) {
    const secretFailure = activationStrategyFailures.find((check) => check.id === 'activation-strategy:secret-scan')
    return {
      status: 'error',
      code: secretFailure ? 'ACTIVATION_STRATEGY_FILE_SECRET_LEAK' : 'ACTIVATION_STRATEGY_FILE_INVALID',
      activation_strategy_file: activationStrategy.summary,
      checks: activationStrategy.checks,
      secret_leak_patterns: secretFailure ? (secretFailure.actual || []) : undefined,
    }
  }

  const updates = activationSummaryUpdates(activationStrategy.summary, strategyFilePath)
  const conflicts = buildActivationStrategyApplyConflicts(parsed.fields || {}, updates)
  if (conflicts.length > 0) {
    return {
      status: 'error',
      code: 'ACTIVATION_STRATEGY_ARTIFACT_MISMATCH',
      activation_strategy_file: activationStrategy.summary,
      conflicts,
      checks: activationStrategy.checks,
    }
  }

  const artifact_text = parsed.format === 'json'
    ? applyUpdatesToJsonEvidenceArtifact(artifactText, updates)
    : applyUpdatesToMarkdownEvidenceArtifact(artifactText, updates)

  return {
    status: 'ok',
    purpose: 'browser_wallet_clickthrough_evidence_apply_strategy',
    format: parsed.format,
    applied_fields: Object.keys(updates),
    activation_strategy_file: activationStrategy.summary,
    checks: activationStrategy.checks,
    artifact_text,
  }
}

export function applyStrictExecutionReportToWalletEvidenceArtifact({
  artifactText,
  reportFilePath,
  readFileImpl = readFileSync,
} = {}) {
  if (!reportFilePath) {
    return {
      status: 'error',
      code: 'STRICT_EXECUTION_REPORT_REQUIRED',
      message: '--execution-report is required',
    }
  }

  const parsed = parseWalletEvidenceArtifact(artifactText)
  if (parsed.status !== 'ok') {
    return {
      status: 'error',
      code: parsed.code || 'WALLET_EVIDENCE_ARTIFACT_INVALID',
      message: 'wallet evidence artifact could not be parsed',
    }
  }

  const strictReport = readStrictExecutionReportFile({
    filePath: reportFilePath,
    readFileImpl,
  })
  const strictReportFailures = strictReport.checks.filter((check) => check.status === 'failed')
  if (strictReportFailures.length > 0) {
    const secretFailure = strictReportFailures.find((check) => check.id === 'strict-execution:secret-scan')
    return {
      status: 'error',
      code: secretFailure ? 'STRICT_EXECUTION_REPORT_SECRET_LEAK' : 'STRICT_EXECUTION_REPORT_INVALID',
      strict_execution_report: strictReport.summary,
      checks: strictReport.checks,
      secret_leak_patterns: secretFailure ? (secretFailure.actual || []) : undefined,
    }
  }

  const updates = strictExecutionReportUpdates(strictReport.summary, reportFilePath)
  const conflicts = buildEvidenceApplyConflicts(parsed.fields || {}, updates)
  if (conflicts.length > 0) {
    return {
      status: 'error',
      code: 'STRICT_EXECUTION_REPORT_ARTIFACT_MISMATCH',
      strict_execution_report: strictReport.summary,
      conflicts,
      checks: strictReport.checks,
    }
  }

  const artifact_text = parsed.format === 'json'
    ? applyUpdatesToJsonEvidenceArtifact(artifactText, updates)
    : applyUpdatesToMarkdownEvidenceArtifact(artifactText, updates)

  return {
    status: 'ok',
    purpose: 'browser_wallet_clickthrough_evidence_apply_report',
    format: parsed.format,
    applied_fields: Object.keys(updates),
    strict_execution_report: strictReport.summary,
    checks: strictReport.checks,
    artifact_text,
  }
}

function activityTxDigest(row = {}) {
  return row.tx || row.tx_digest || row.digest || null
}

function activityEventName(row = {}) {
  return row.chain_event || row.type || row.event_type || row.title || row.kind || null
}

function activityIncludesDigest(activity = [], digest, eventName = null) {
  return activity.some((row) => {
    const digestMatches = activityTxDigest(row) === digest
    if (!digestMatches) return false
    if (!eventName) return true
    return String(activityEventName(row) || '').includes(eventName)
  })
}

async function verifyWorkerDetail({ workerUrl, wrapperId, createDigest, revokeDigest, fetchImpl, timeoutMs, requireWorker }) {
  if (!workerUrl) {
    return [createCheck({
      id: 'worker:detail',
      label: 'Worker detail check',
      passed: false,
      skipped: !requireWorker,
      expected: requireWorker ? 'worker URL configured' : 'optional',
      actual: null,
      detail: 'worker URL not configured',
    })]
  }
  const result = await fetchJson(`${normalizeUrl(workerUrl)}/api/policies/${wrapperId}/activity`, { fetchImpl, timeoutMs })
  if (result.status !== 'ok') {
    return [createCheck({
      id: 'worker:detail',
      label: 'Worker detail endpoint is reachable',
      passed: false,
      skipped: !requireWorker,
      expected: requireWorker ? 'ok' : 'optional',
      actual: result.status,
      detail: result.error,
    })]
  }
  const body = result.body || {}
  const policy = body.policy || {}
  const activity = body.activity || []
  return [
    createCheck({
      id: 'worker:detail',
      label: 'Worker detail endpoint is reachable',
      passed: body.status === 'ok',
      expected: 'ok',
      actual: body.status,
    }),
    checkEqual('worker:wrapper', 'Worker detail wrapper id matches artifact', policy.wrapper_id, wrapperId),
    createCheck({
      id: 'worker:create-activity',
      label: 'Worker activity includes the create tx digest',
      passed: activityIncludesDigest(activity, createDigest, 'PolicyCreated') || activityIncludesDigest(activity, createDigest),
      expected: createDigest,
      actual: activity.map((row) => ({
        tx: activityTxDigest(row),
        event: activityEventName(row),
      })).filter((row) => row.tx).slice(0, 10),
    }),
    createCheck({
      id: 'worker:revoked',
      label: 'Worker detail shows revoked chain state after revoke',
      passed: policy.revoked === true || policy.runtime_state === 'Revoked' || policy.status === 'revoked',
      expected: 'revoked',
      actual: { revoked: policy.revoked, runtime_state: policy.runtime_state, status: policy.status },
    }),
    createCheck({
      id: 'worker:revoke-activity',
      label: 'Worker activity includes the revoke tx digest',
      passed: activityIncludesDigest(activity, revokeDigest, 'PolicyRevoked') || activityIncludesDigest(activity, revokeDigest),
      expected: revokeDigest,
      actual: activity.map((row) => ({
        tx: activityTxDigest(row),
        event: activityEventName(row),
      })).filter((row) => row.tx).slice(0, 10),
    }),
  ]
}

export async function verifyWalletEvidenceArtifact({
  artifactText,
  workerUrl = null,
  suiClient = null,
  readFileImpl = readFileSync,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  requireWorker = false,
  strictExecutionReportPath = null,
} = {}) {
  const parsed = parseWalletEvidenceArtifact(artifactText)
  const fields = parsed.fields || {}
  const checks = []
  const requiredFields = [...REQUIRED_WALLET_CORE_FIELDS, ...REQUIRED_WALLET_MANUAL_FIELDS]
  const secretCheck = buildSecretLeakCheck(artifactText)
  checks.push(secretCheck)
  checks.push(...buildMissingChecks(fields, requiredFields))
  checks.push(buildClickthroughCompletedCheck(parsed.metadata))
  const missing = [...new Set(checks.filter((check) => check.status === 'failed').map((check) => {
    if (check.id.startsWith('field:')) return check.id.replace('field:', '')
    if (check.id === 'manual:actual-clickthrough-completed') return 'actual_clickthrough_completed'
    return check.id
  }))]

  const report = {
    status: 'ok',
    purpose: 'browser_wallet_clickthrough_evidence_verification',
    verified: false,
    chain: parsed.metadata?.chain || deployment.chain,
    worker_url: workerUrl || parsed.metadata?.worker_url || null,
    wallet_name: parsed.metadata?.wallet_name || null,
    wallet_network: parsed.metadata?.wallet_network || null,
    fields: Object.fromEntries(requiredFields.map((field) => [field, fields[field] || ''])),
    actual_clickthrough_completed: parsed.metadata?.actual_clickthrough_completed === true,
    strict_execution_report_reference_expected: strictExecutionReportPath || null,
    required_core_fields: REQUIRED_WALLET_CORE_FIELDS,
    required_manual_fields: REQUIRED_WALLET_MANUAL_FIELDS,
    checks,
    create_transaction: null,
    revoke_transaction: null,
    activation_strategy_file: null,
    strict_execution_report: null,
    execution_claimed: false,
  }

  if (missing.length > 0) {
    if (secretCheck.status === 'failed') {
      report.status = 'error'
      report.code = 'SECRET_LEAK_DETECTED'
      report.secret_leak_patterns = secretCheck.actual || []
      return report
    }
    report.status = 'error'
    report.code = 'EVIDENCE_FIELDS_INCOMPLETE'
    report.missing_fields = missing
    return report
  }

  const manualEvidenceChecks = [
    ...buildWalletMetadataChecks(parsed.metadata),
    ...buildManualLifecycleChecks(fields),
    ...buildEvidenceReferenceChecks(fields, { readFileImpl }),
  ]
  report.checks.push(...manualEvidenceChecks)
  const manualEvidenceFailures = manualEvidenceChecks.filter((check) => check.status === 'failed')
  if (manualEvidenceFailures.length > 0) {
    report.status = 'error'
    report.code = 'WALLET_MANUAL_EVIDENCE_INVALID'
    report.manual_evidence_failures = manualEvidenceFailures.map((check) => ({
      field: check.id.replace(/^manual-reference:/, '').replace(/^manual:/, ''),
      expected: check.expected,
      actual: check.actual,
      detail: check.detail,
    }))
    return report
  }

  if (strictExecutionReportPath) {
    const referenceCheck = buildStrictExecutionReportReferenceCheck(fields, strictExecutionReportPath)
    report.checks.push(referenceCheck)
    if (referenceCheck.status === 'failed') {
      report.status = 'error'
      report.code = 'STRICT_EXECUTION_REFERENCE_MISMATCH'
      report.strict_execution_report_reference_mismatch = {
        expected: referenceCheck.expected,
        actual: referenceCheck.actual,
      }
      return report
    }
    const strictExecutionReport = readStrictExecutionReportFile({
      filePath: strictExecutionReportPath,
      readFileImpl,
    })
    report.strict_execution_report = strictExecutionReport.summary
    report.checks.push(...strictExecutionReport.checks)
    const strictReportFailures = strictExecutionReport.checks.filter((check) => check.status === 'failed')
    if (strictReportFailures.length > 0) {
      const secretFailure = strictReportFailures.find((check) => check.id === 'strict-execution:secret-scan')
      report.status = 'error'
      report.code = secretFailure ? 'STRICT_EXECUTION_REPORT_SECRET_LEAK' : 'STRICT_EXECUTION_REPORT_INVALID'
      if (secretFailure) report.secret_leak_patterns = secretFailure.actual || []
      return report
    }

    const strictContinuityChecks = buildStrictExecutionReportContinuityChecks(fields, strictExecutionReport.summary)
    report.checks.push(...strictContinuityChecks)
    const strictContinuityFailures = strictContinuityChecks.filter((check) => check.status === 'failed')
    if (strictContinuityFailures.length > 0) {
      report.status = 'error'
      report.code = 'STRICT_EXECUTION_REPORT_MISMATCH'
      report.strict_execution_report_mismatches = strictContinuityFailures.map((check) => ({
        field: check.id.replace('strict-execution:', ''),
        expected: check.expected,
        actual: check.actual,
      }))
      return report
    }
  }

  const activationStrategy = readActivationStrategyFile({
    filePath: fields.activation_strategy_file,
    fields,
    readFileImpl,
  })
  report.activation_strategy_file = activationStrategy.summary
  report.checks.push(...activationStrategy.checks)
  const activationStrategyFailures = activationStrategy.checks.filter((check) => check.status === 'failed')
  if (activationStrategyFailures.length > 0) {
    const secretFailure = activationStrategyFailures.find((check) => check.id === 'activation-strategy:secret-scan')
    report.status = 'error'
    report.code = secretFailure ? 'ACTIVATION_STRATEGY_FILE_SECRET_LEAK' : 'ACTIVATION_STRATEGY_FILE_INVALID'
    if (secretFailure) report.secret_leak_patterns = secretFailure.actual || []
    return report
  }

  const client = suiClient || getClient()
  const createTx = await readTransaction(client, fields.create_tx_digest)
  const revokeTx = await readTransaction(client, fields.revoke_tx_digest)
  const createEvent = findPolicyEvent(createTx, 'PolicyCreated')
  const revokeEvent = findPolicyEvent(revokeTx, 'PolicyRevoked')
  const createJson = createEvent?.parsedJson || {}
  const revokeJson = revokeEvent?.parsedJson || {}
  const expectedStrategyHash = normalizeStrategyHash(fields.strategy_hash)
  const actualStrategyHash = hexFromMaybeVector(createJson.strategy_hash)
  const expectedWorkerUrl = workerUrl || parsed.metadata?.worker_url || null

  report.create_transaction = txSummary(createTx, 'PolicyCreated')
  report.revoke_transaction = txSummary(revokeTx, 'PolicyRevoked')
  report.checks.push(
    createCheck({
      id: 'chain:create-status',
      label: 'Create transaction succeeded on Sui',
      passed: txStatus(createTx) === 'success',
      expected: 'success',
      actual: txStatus(createTx),
    }),
    createCheck({
      id: 'chain:create-event',
      label: 'Create transaction emitted PolicyCreated',
      passed: Boolean(createEvent),
      expected: 'PolicyCreated',
      actual: createEvent?.type || null,
    }),
    checkEqual('chain:create-wrapper', 'PolicyCreated wrapper id matches artifact', createJson.wrapper_id, fields.wrapper_id),
    checkEqual('chain:create-mandate', 'PolicyCreated mandate id matches artifact', createJson.mandate_id, fields.mandate_id),
    checkEqual('chain:create-owner', 'PolicyCreated owner matches artifact', createJson.owner, fields.owner_address),
    checkEqual('chain:create-strategy-hash', 'PolicyCreated strategy hash matches artifact', actualStrategyHash, expectedStrategyHash),
    createCheck({
      id: 'chain:revoke-status',
      label: 'Revoke transaction succeeded on Sui',
      passed: txStatus(revokeTx) === 'success',
      expected: 'success',
      actual: txStatus(revokeTx),
    }),
    createCheck({
      id: 'chain:revoke-event',
      label: 'Revoke transaction emitted PolicyRevoked',
      passed: Boolean(revokeEvent),
      expected: 'PolicyRevoked',
      actual: revokeEvent?.type || null,
    }),
    checkEqual('chain:revoke-wrapper', 'PolicyRevoked wrapper id matches artifact', revokeJson.wrapper_id, fields.wrapper_id),
    checkEqual('chain:revoke-mandate', 'PolicyRevoked mandate id matches artifact', revokeJson.mandate_id, fields.mandate_id),
    checkEqual('chain:revoke-owner', 'PolicyRevoked owner matches artifact', revokeJson.owner, fields.owner_address),
  )

  report.checks.push(...await verifyWorkerDetail({
    workerUrl: expectedWorkerUrl,
    wrapperId: fields.wrapper_id,
    createDigest: fields.create_tx_digest,
    revokeDigest: fields.revoke_tx_digest,
    fetchImpl,
    timeoutMs,
    requireWorker,
  }))

  const hardFailures = report.checks.filter((check) => check.status === 'failed')
  report.verified = hardFailures.length === 0
  if (!report.verified) {
    report.status = 'error'
    report.code = 'EVIDENCE_VERIFICATION_FAILED'
  }
  return report
}

function help() {
  console.log(`Build a RescueGrid browser wallet click-through evidence artifact.

Usage:
  npm run wallet:evidence
  npm run wallet:evidence:preflight
  npm run wallet:evidence -- --format markdown
  npm run wallet:evidence -- --format markdown --out .rescuegrid/wallet-clickthrough-evidence.md
  npm run wallet:evidence -- --frontend-url http://localhost:5175 --worker-url http://localhost:8787 --owner 0x...
  npm run wallet:evidence -- --apply-strategy --input .rescuegrid/wallet-clickthrough-evidence.md --strategy-file .rescuegrid/wallet-strategy-....json
  npm run wallet:evidence -- --apply-report --input .rescuegrid/wallet-clickthrough-evidence.md --execution-report .rescuegrid/demo-execute-report.json
  npm run wallet:evidence:verify -- --input .rescuegrid/wallet-clickthrough-evidence.md --require-worker --execution-report .rescuegrid/demo-execute-report.json

This is read-only. It may fetch public Worker status/readiness endpoints, then
prints or writes a manual Slush / standard Sui wallet evidence checklist. It
does not create policies, submit PTBs, run demo:execute or print signing
secrets, Worker secrets, tick tokens or WaaP approval values. With --verify the
CLI defaults to --execution-report ${DEFAULT_STRICT_EXECUTION_REPORT}; use
--skip-strict-execution-report only for lower-strength local debugging. The
strict verifier checks a filled artifact against public Sui transaction events
and optional Worker detail reads, verifies activation_strategy_file hashes to the
recorded strategy_hash without leaking secrets, requires the artifact's
strict_execution_report_reference to point at that report path, and verifies the
wallet-created strict report describes the same owner/wrapper lifecycle. With --apply-strategy
it reads the UI-downloaded activation strategy JSON, recomputes the canonical
hash, and fills only the matching owner/create/wrapper/mandate/hash fields in an
existing wallet evidence artifact without marking click-through complete. With
--apply-report it reads the wallet-created strict execution report, requires
structured AgentTradeExecuted evidence, and fills only the report reference plus
matching revoke/status lifecycle fields without marking click-through complete. With
--require-frontend / --require-worker it fails before
the manual click-through when the local services or login guardrails are not
ready. For final same-wrapper execution evidence, keep the wallet-created policy
active and run npm run demo:execute:wallet-report with the wrapper id, create tx
digest and activation_strategy_file before revoking in the browser wallet.`)
}

export async function main(argv = process.argv.slice(2), env = process.env, options = {}) {
  const flags = parseArgs(argv)
  if (flags.has('--help') || flags.has('-h')) {
    help()
    return 0
  }
  if (flags.has('--apply-strategy') && flags.has('--apply-report')) {
    console.error(JSON.stringify({
      status: 'error',
      code: 'APPLY_MODE_CONFLICT',
      message: '--apply-strategy and --apply-report must be run separately',
    }, null, 2))
    return 1
  }

  const envFile = readSelectedEnv(flags.get('--env-file') || '.env.local')
  const timeoutMs = Number(flags.get('--timeout-ms') || DEFAULT_TIMEOUT_MS)
  const frontendUrl = normalizeUrl(firstValue(
    flags.get('--frontend-url'),
    env.RESCUEGRID_FRONTEND_URL,
    env.FRONTEND_URL,
    envFile.RESCUEGRID_FRONTEND_URL,
    envFile.FRONTEND_URL,
    DEFAULT_FRONTEND_URL,
  ))
  const configuredWorkerUrl = firstValue(
    flags.get('--worker-url'),
    env.RESCUEGRID_WORKER_URL,
    env.WORKER_URL,
    env.VITE_WORKER_URL,
    envFile.RESCUEGRID_WORKER_URL,
    envFile.WORKER_URL,
    envFile.VITE_WORKER_URL,
  )
  const workerUrl = normalizeUrl(firstValue(configuredWorkerUrl, DEFAULT_WORKER_URL))

  if (flags.has('--verify')) {
    const inputPath = flags.get('--input') || flags.get('--artifact') || '.rescuegrid/wallet-clickthrough-evidence.md'
    const artifactText = readFileSync(resolve(String(inputPath)), 'utf8')
    const strictExecutionReportPath = flags.has('--skip-strict-execution-report')
      ? null
      : flags.get('--execution-report') || flags.get('--strict-execution-report') || DEFAULT_STRICT_EXECUTION_REPORT
    const report = await verifyWalletEvidenceArtifact({
      artifactText,
      workerUrl: configuredWorkerUrl ? normalizeUrl(configuredWorkerUrl) : null,
      suiClient: options.suiClient,
      readFileImpl: options.readFileImpl,
      fetchImpl: options.fetchImpl,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
      requireWorker: flags.has('--require-worker'),
      strictExecutionReportPath,
    })
    console.log(JSON.stringify(report, null, 2))
    return report.verified ? 0 : 1
  }

  if (flags.has('--apply-strategy')) {
    const inputPath = flags.get('--input') || flags.get('--artifact') || '.rescuegrid/wallet-clickthrough-evidence.md'
    const strategyFilePath = flags.get('--strategy-file') || flags.get('--activation-strategy-file')
    const outPath = flags.get('--out') || inputPath
    const artifactText = readFileSync(resolve(String(inputPath)), 'utf8')
    const result = applyActivationStrategyToWalletEvidenceArtifact({
      artifactText,
      strategyFilePath,
      readFileImpl: options.readFileImpl,
    })
    if (result.status !== 'ok') {
      console.error(JSON.stringify(result, null, 2))
      return 1
    }
    const resolvedOut = resolve(String(outPath))
    mkdirSync(dirname(resolvedOut), { recursive: true })
    writeFileSync(resolvedOut, result.artifact_text, 'utf8')
    const { artifact_text: _artifactText, ...summary } = result
    console.log(JSON.stringify({
      ...summary,
      input: resolve(String(inputPath)),
      out: resolvedOut,
      bytes: Buffer.byteLength(result.artifact_text),
    }, null, 2))
    return 0
  }

  if (flags.has('--apply-report')) {
    const inputPath = flags.get('--input') || flags.get('--artifact') || '.rescuegrid/wallet-clickthrough-evidence.md'
    const reportFilePath = flags.get('--execution-report') || flags.get('--strict-execution-report') || flags.get('--report-file')
    const outPath = flags.get('--out') || inputPath
    const artifactText = readFileSync(resolve(String(inputPath)), 'utf8')
    const result = applyStrictExecutionReportToWalletEvidenceArtifact({
      artifactText,
      reportFilePath,
      readFileImpl: options.readFileImpl,
    })
    if (result.status !== 'ok') {
      console.error(JSON.stringify(result, null, 2))
      return 1
    }
    const resolvedOut = resolve(String(outPath))
    mkdirSync(dirname(resolvedOut), { recursive: true })
    writeFileSync(resolvedOut, result.artifact_text, 'utf8')
    const { artifact_text: _artifactText, ...summary } = result
    console.log(JSON.stringify({
      ...summary,
      input: resolve(String(inputPath)),
      out: resolvedOut,
      bytes: Buffer.byteLength(result.artifact_text),
    }, null, 2))
    return 0
  }

  const [frontendState, workerState] = await Promise.all([
    collectFrontendPreflight(frontendUrl, {
      fetchImpl: options.fetchImpl,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
      readFileImpl: options.readFileImpl,
    }),
    collectWorkerPublicState(workerUrl, {
      fetchImpl: options.fetchImpl,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    }),
  ])
  if (flags.has('--require-frontend') && !frontendPreflightPassed(frontendState)) {
    console.error(JSON.stringify({
      status: 'error',
      code: 'FRONTEND_PREFLIGHT_FAILED',
      frontend_url: frontendUrl,
      frontend_state: frontendState,
    }, null, 2))
    return 1
  }
  if (flags.has('--require-worker') && !workerStateAvailable(workerState)) {
    const workerChecks = buildWorkerPublicStateChecks(workerState)
    console.error(JSON.stringify({
      status: 'error',
      code: 'WORKER_PREFLIGHT_FAILED',
      worker_url: workerUrl,
      worker_checks: workerChecks,
      worker_state: workerState,
    }, null, 2))
    return 1
  }
  if (flags.has('--require-worker') && !workerPublicStatePreflightPassed(workerState)) {
    console.error(JSON.stringify({
      status: 'error',
      code: 'WORKER_PREFLIGHT_FAILED',
      worker_url: workerUrl,
      worker_checks: buildWorkerPublicStateChecks(workerState),
      worker_state: workerState,
    }, null, 2))
    return 1
  }

  const evidence = buildWalletEvidence({
    frontendUrl,
    workerUrl,
    ownerAddress: flags.get('--owner') || flags.get('--owner-address') || null,
    walletName: flags.get('--wallet') || flags.get('--wallet-name') || 'Slush or standard Sui wallet',
    frontendState,
    workerState,
  })
  const format = String(flags.get('--format') || (flags.has('--markdown') ? 'markdown' : 'json')).toLowerCase()
  const outPath = flags.get('--out') || flags.get('--output')
  if (outPath) {
    const artifact = writeWalletEvidenceArtifact(evidence, { outPath, format })
    console.log(JSON.stringify({
      status: 'ok',
      purpose: evidence.purpose,
      artifact,
      chain: evidence.chain,
      frontend_preflight_passed: evidence.frontend.preflight_passed,
      worker_public_state_available: evidence.worker.public_state_available,
      worker_public_state_preflight_passed: evidence.worker.public_state_preflight_passed,
      actual_clickthrough_completed: evidence.actual_clickthrough_completed,
      execution_claimed: evidence.execution_claimed,
    }, null, 2))
  } else {
    console.log(serializeWalletEvidence(evidence, format))
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => {
    process.exitCode = code
  }).catch((e) => {
    console.error(e?.message || e)
    process.exitCode = 1
  })
}
