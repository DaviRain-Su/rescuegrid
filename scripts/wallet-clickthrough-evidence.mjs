#!/usr/bin/env node
// Prepare a secret-safe manual evidence artifact for the real browser wallet
// create/revoke flow. This script is read-only: it may fetch public Worker
// status endpoints, but it never creates a policy or submits a PTB.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import deployment from '../core/deployment.js'

const DEFAULT_FRONTEND_URL = 'http://localhost:5175'
const DEFAULT_WORKER_URL = 'http://localhost:8787'
const DEFAULT_TIMEOUT_MS = 2500

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

function summarizeRuntimeStatus(result) {
  const body = result?.body || {}
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
    chain_data_provider: body.chain_data_provider?.kind || null,
    monitoring_provider: body.monitoring_provider?.kind || null,
  }
}

function summarizeReadiness(result) {
  const body = result?.body || {}
  return {
    status: result?.status || 'unavailable',
    http_status: result?.http_status || 0,
    error: result?.error || null,
    chain: body.chain || null,
    scope: body.scope || null,
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

export function buildWalletEvidence({
  generatedAt = new Date().toISOString(),
  frontendUrl = DEFAULT_FRONTEND_URL,
  workerUrl = DEFAULT_WORKER_URL,
  ownerAddress = null,
  walletName = 'Slush or standard Sui wallet',
  workerState = {},
} = {}) {
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
    },
    worker: {
      url: normalizeUrl(workerUrl),
      public_state_available: workerStateAvailable(workerState),
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
        record: ['create_tx_digest', 'wrapper_id', 'mandate_id', 'strategy_hash', 'wallet_create_prompt_screenshot'],
      },
      {
        id: 'activation',
        action: 'Wait for the UI and Worker activity to show the created policy and Monitoring runtime state.',
        record: ['runtime_state_after_activate', 'policy_active_screenshot', 'activity_row_screenshot'],
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
      sign_in_screenshot: '',
      wallet_create_prompt_screenshot: '',
      create_tx_digest: '',
      wrapper_id: '',
      mandate_id: '',
      strategy_hash: '',
      runtime_state_after_activate: '',
      policy_active_screenshot: '',
      activity_row_screenshot: '',
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
    },
  }
}

function valueOrTodo(value) {
  return value == null || value === '' ? 'TODO' : String(value)
}

function markdown(evidence) {
  const state = evidence.worker.public_state || {}
  const blockers = [
    ...(state.execution_readiness?.blocker_codes || []),
    ...(state.execution_readiness?.funding_blocker_codes || []),
  ]
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
    `Runtime status: ${state.runtime_status?.status || 'unavailable'}`,
    `Signer kind: ${state.runtime_status?.signer_kind || 'n/a'}`,
    `Signer available: ${valueOrTodo(state.runtime_status?.signer_available)}`,
    `Execution enabled: ${valueOrTodo(state.runtime_status?.execution_enabled)}`,
    `Execution readiness: ${valueOrTodo(state.execution_readiness?.execution_ready)}`,
    `Funding readiness: ${valueOrTodo(state.execution_readiness?.funding_ready)}`,
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
    `- ${evidence.next_commands.mock_flow_test}`,
    `- ${evidence.next_commands.auth_wallet_test}`,
    `- ${evidence.next_commands.session_boundary_test}`,
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

function help() {
  console.log(`Build a RescueGrid browser wallet click-through evidence artifact.

Usage:
  npm run wallet:evidence
  npm run wallet:evidence -- --format markdown
  npm run wallet:evidence -- --format markdown --out .rescuegrid/wallet-clickthrough-evidence.md
  npm run wallet:evidence -- --frontend-url http://localhost:5175 --worker-url http://localhost:8787 --owner 0x...

This is read-only. It may fetch public Worker status/readiness endpoints, then
prints or writes a manual Slush / standard Sui wallet evidence checklist. It
does not create policies, submit PTBs, run demo:execute or print signing
secrets, Worker secrets, tick tokens or WaaP approval values.`)
}

export async function main(argv = process.argv.slice(2), env = process.env, options = {}) {
  const flags = parseArgs(argv)
  if (flags.has('--help') || flags.has('-h')) {
    help()
    return 0
  }

  const envFile = readSelectedEnv(flags.get('--env-file') || '.env.local')
  const frontendUrl = normalizeUrl(firstValue(
    flags.get('--frontend-url'),
    env.RESCUEGRID_FRONTEND_URL,
    env.FRONTEND_URL,
    envFile.RESCUEGRID_FRONTEND_URL,
    envFile.FRONTEND_URL,
    DEFAULT_FRONTEND_URL,
  ))
  const workerUrl = normalizeUrl(firstValue(
    flags.get('--worker-url'),
    env.RESCUEGRID_WORKER_URL,
    env.WORKER_URL,
    env.VITE_WORKER_URL,
    envFile.RESCUEGRID_WORKER_URL,
    envFile.WORKER_URL,
    envFile.VITE_WORKER_URL,
    DEFAULT_WORKER_URL,
  ))
  const timeoutMs = Number(flags.get('--timeout-ms') || DEFAULT_TIMEOUT_MS)
  const workerState = await collectWorkerPublicState(workerUrl, {
    fetchImpl: options.fetchImpl,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  })
  if (flags.has('--require-worker') && !workerStateAvailable(workerState)) {
    console.error(JSON.stringify({
      status: 'error',
      code: 'WORKER_UNAVAILABLE',
      worker_url: workerUrl,
      worker_state: workerState,
    }, null, 2))
    return 1
  }

  const evidence = buildWalletEvidence({
    frontendUrl,
    workerUrl,
    ownerAddress: flags.get('--owner') || flags.get('--owner-address') || null,
    walletName: flags.get('--wallet') || flags.get('--wallet-name') || 'Slush or standard Sui wallet',
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
      worker_public_state_available: evidence.worker.public_state_available,
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
