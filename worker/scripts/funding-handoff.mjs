#!/usr/bin/env node
// Build a secret-safe external funding request for the DeepBook execution gate.
//
// This script is read-only. It reports public BalanceManager / agent addresses,
// current Sui Testnet balances, missing DBUSDC/DEEP/SUI amounts and the exact
// strict validation command to rerun after funding. It never prints AGENT_KEY.
import { resolve } from 'node:path'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { DEPLOYMENT } from '../src/sui-tx.js'
import { requireChainDataProvider } from '../src/chain-data-provider.js'
import { buildExecutionReadiness } from '../src/execution-readiness.js'
import { readWorkerDevVar } from './agent-key-loader.mjs'

function parseArgs(argv = process.argv.slice(2)) {
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

function optionalDevVar(name) {
  try {
    return readWorkerDevVar(name)
  } catch {
    return undefined
  }
}

function firstValue(...values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') return String(value)
  }
  return undefined
}

export function fundingHandoffEnv(env = process.env, { includeDevVars = env === process.env } = {}) {
  const devVar = (name) => includeDevVars ? optionalDevVar(name) : undefined
  return {
    AGENT_KEY: firstValue(env.AGENT_KEY, devVar('AGENT_KEY')),
    EXECUTION_ENABLED: firstValue(env.EXECUTION_ENABLED, devVar('EXECUTION_ENABLED')),
    SIGNER_KIND: firstValue(env.SIGNER_KIND, env.RESCUEGRID_SIGNER_KIND, devVar('SIGNER_KIND'), devVar('RESCUEGRID_SIGNER_KIND')),
    RESCUEGRID_DAEMON_MODE: firstValue(env.RESCUEGRID_DAEMON_MODE, devVar('RESCUEGRID_DAEMON_MODE')),
    RESCUEGRID_WAAP_CLI_ENABLED: firstValue(env.RESCUEGRID_WAAP_CLI_ENABLED, env.WAAP_CLI_ENABLED, devVar('RESCUEGRID_WAAP_CLI_ENABLED'), devVar('WAAP_CLI_ENABLED')),
    RESCUEGRID_WAAP_SUI_ADDRESS: firstValue(env.RESCUEGRID_WAAP_SUI_ADDRESS, env.WAAP_SUI_ADDRESS, devVar('RESCUEGRID_WAAP_SUI_ADDRESS'), devVar('WAAP_SUI_ADDRESS')),
    RESCUEGRID_WAAP_CHAIN: firstValue(env.RESCUEGRID_WAAP_CHAIN, env.WAAP_CHAIN, env.RESCUEGRID_CHAIN, devVar('RESCUEGRID_WAAP_CHAIN'), devVar('WAAP_CHAIN'), devVar('RESCUEGRID_CHAIN')),
    RESCUEGRID_WAAP_RPC: firstValue(env.RESCUEGRID_WAAP_RPC, env.WAAP_RPC, devVar('RESCUEGRID_WAAP_RPC'), devVar('WAAP_RPC')),
    RESCUEGRID_WAAP_PERMISSION_TOKEN: firstValue(env.RESCUEGRID_WAAP_PERMISSION_TOKEN, env.WAAP_PERMISSION_TOKEN, devVar('RESCUEGRID_WAAP_PERMISSION_TOKEN'), devVar('WAAP_PERMISSION_TOKEN')),
    REQUIRED_DBUSDC_BALANCE: firstValue(env.REQUIRED_DBUSDC_BALANCE, devVar('REQUIRED_DBUSDC_BALANCE')),
    REQUIRED_DEEP_BALANCE: firstValue(env.REQUIRED_DEEP_BALANCE, devVar('REQUIRED_DEEP_BALANCE')),
    REQUIRED_AGENT_SUI_GAS_MIST: firstValue(env.REQUIRED_AGENT_SUI_GAS_MIST, devVar('REQUIRED_AGENT_SUI_GAS_MIST')),
  }
}

function requestedThresholds(flags) {
  return {
    dbusdc_threshold: firstValue(flags.get('--dbusdc-threshold'), flags.get('--required-dbusdc-balance'), flags.get('--required-dbusdc')),
    deep_threshold: firstValue(flags.get('--deep-threshold'), flags.get('--required-deep-balance'), flags.get('--required-deep')),
    sui_gas_threshold: firstValue(flags.get('--sui-gas-threshold'), flags.get('--required-sui-gas-mist'), flags.get('--required-sui-gas')),
  }
}

function bigintOrZero(value) {
  try {
    return BigInt(String(value ?? '0'))
  } catch {
    return 0n
  }
}

function missingAmount(required, observed) {
  const requiredBig = bigintOrZero(required)
  const observedBig = bigintOrZero(observed)
  return requiredBig > observedBig ? (requiredBig - observedBig).toString() : '0'
}

function pickPublicFields(row = {}, fields = []) {
  const out = {}
  for (const field of fields) {
    if (row[field] !== undefined) out[field] = row[field]
  }
  return out
}

function publicSignerCapabilities(rows = []) {
  if (!Array.isArray(rows)) return []
  return rows.map((row) => pickPublicFields(row, [
    'kind',
    'selected',
    'runtime_scope',
    'custody_model',
    'address',
    'expected_address',
    'signer_matches_expected',
    'available',
    'execution_enabled',
    'unavailable_code',
    'unavailable_detail',
    'runner_configured',
    'cloud_worker_supported',
    'local_daemon_supported',
    'external_approval_required',
    'production_mainnet_allowed',
    'seal_walrus_required',
    'per_user_agent_required',
    'user_registration_required',
    'implementation_status',
  ]))
}

function publicExternalSigner(posture = null) {
  if (!posture) return null
  return pickPublicFields(posture, [
    'kind',
    'selected',
    'status',
    'available',
    'local_daemon_only',
    'cloud_worker_supported',
    'local_daemon_supported',
    'daemon_mode',
    'waap_cli_enabled',
    'submission_runner_configured',
    'waap_chain',
    'waap_rpc_configured',
    'permission_token_configured',
    'address',
    'expected_address',
    'signer_matches_expected',
    'unavailable_code',
    'unavailable_detail',
    'approval_state',
    'secrets_returned',
  ])
}

function publicCloudPerUserSigner(posture = null) {
  if (!posture) return null
  return pickPublicFields(posture, [
    'kind',
    'selected',
    'status',
    'available',
    'cloud_worker_supported',
    'local_daemon_supported',
    'seal_walrus_required',
    'per_user_agent_required',
    'user_registration_required',
    'movegate_passport_required',
    'decryptor_identity_required',
    'mvp_shared_key_fallback_kind',
    'production_mainnet_allowed',
    'address',
    'expected_address',
    'signer_matches_expected',
    'unavailable_code',
    'unavailable_detail',
    'secrets_returned',
  ])
}

function criterionByAsset(readiness, asset) {
  return (readiness?.funding?.criteria || []).find((row) => row.asset === asset) || {}
}

function assetFundingRow({ readiness, asset, coinType, holderKind }) {
  const row = criterionByAsset(readiness, asset)
  return {
    asset,
    coin_type: coinType,
    holder_kind: holderKind,
    holder: row.holder || (holderKind === 'agent_gas_address' ? readiness.agent?.address : readiness.balance_manager?.id),
    observed: row.observed_balance ?? row.observed ?? readiness.funding?.balances?.[asset] ?? '0',
    required: row.threshold ?? readiness.thresholds?.[asset]?.required ?? '1',
    missing: missingAmount(row.threshold ?? readiness.thresholds?.[asset]?.required ?? '1', row.observed_balance ?? row.observed ?? readiness.funding?.balances?.[asset] ?? '0'),
    usable: Boolean(row.usable),
    source_of_truth: row.source_of_truth || null,
    blocker_code: row.usable ? null : row.blocker_code,
  }
}

const STRICT_EXECUTION_REPORT_PATH = '.rescuegrid/demo-execute-report.json'
const STRICT_EXECUTION_SUCCESS_CONDITION = 'Strict execution must preflight ready, create a policy, force a tick, then prove structured AgentTradeExecuted evidence for the same wrapper/mandate/tick digest, execution_claimed=true, on-chain spend increase, distinct create/tick/revoke digests and create <= execute <= revoke timestamps.'

export function executionGate(readiness) {
  const policyCreationAllowed = Boolean(readiness.execution_ready)
  return {
    readiness_only: true,
    policy_creation_allowed: policyCreationAllowed,
    policy_creation_blocked: !policyCreationAllowed,
    execution_claimed: false,
    strict_execution_report_required: true,
    strict_execution_report_path: STRICT_EXECUTION_REPORT_PATH,
    success_condition: STRICT_EXECUTION_SUCCESS_CONDITION,
  }
}

export function buildFundingHandoff(readiness, { generatedAt = new Date().toISOString() } = {}) {
  const dbusdc = assetFundingRow({
    readiness,
    asset: 'DBUSDC',
    coinType: DEPLOYMENT.deepbook.dbusdc_coin_type,
    holderKind: 'deepbook_balance_manager',
  })
  const deep = assetFundingRow({
    readiness,
    asset: 'DEEP',
    coinType: DEPLOYMENT.deepbook.deep_coin_type,
    holderKind: 'deepbook_balance_manager',
  })
  const suiGas = assetFundingRow({
    readiness,
    asset: 'SUI_MIST',
    coinType: '0x2::sui::SUI',
    holderKind: 'agent_gas_address',
  })

  return {
    status: 'ok',
    generated_at: generatedAt,
    purpose: 'external_deepbook_testnet_funding_request',
    chain: readiness.chain || DEPLOYMENT.chain,
    ready_for_strict_execution: Boolean(readiness.execution_ready),
    funding_ready: Boolean(readiness.funding_ready),
    execution_ready: Boolean(readiness.execution_ready),
    blocker_codes: readiness.blocker_codes || [],
    blocker_labels: readiness.blocker_labels || [],
    agent: {
      address: readiness.agent?.address || DEPLOYMENT.agent.address,
      passport_id: readiness.agent?.passport_id || DEPLOYMENT.agent.passport_id,
      balance_manager_id: readiness.agent?.balance_manager_id || DEPLOYMENT.agent.balance_manager_id,
    },
    signer: {
      kind: readiness.signer?.kind || 'worker-secret',
      address: readiness.signer?.address || null,
      expected_address: readiness.signer?.expected_address || DEPLOYMENT.agent.address,
      signer_matches_expected: Boolean(readiness.signer?.signer_matches_expected),
      available: Boolean(readiness.signer?.available),
      execution_configured: Boolean(readiness.signer?.execution_configured),
      execution_enabled: Boolean(readiness.signer?.execution_enabled),
      unavailable_code: readiness.signer?.unavailable_code || null,
      unavailable_detail: readiness.signer?.unavailable_detail || null,
      known_signer_kinds: readiness.signer?.known_signer_kinds || [],
    },
    signer_capabilities: publicSignerCapabilities(readiness.signer_capabilities),
    external_signer: publicExternalSigner(readiness.external_signer),
    cloud_per_user_signer: publicCloudPerUserSigner(readiness.cloud_per_user_signer),
    deepbook: {
      market_id: readiness.scope?.market_id || 'SUI_DBUSDC',
      pool_id: readiness.scope?.pool_id || DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id,
      balance_manager_funding_method: 'Use the DeepBook BalanceManager deposit flow; direct wallet transfer is not enough unless the BalanceManager read reflects the balance.',
      dbusdc_coin_type: DEPLOYMENT.deepbook.dbusdc_coin_type,
      deep_coin_type: DEPLOYMENT.deepbook.deep_coin_type,
    },
    funding_targets: {
      balance_manager: {
        id: readiness.balance_manager?.id || DEPLOYMENT.agent.balance_manager_id,
        required_assets: [dbusdc, deep],
      },
      agent_gas: {
        address: readiness.agent?.address || DEPLOYMENT.agent.address,
        required_assets: [suiGas],
      },
    },
    next_verification: {
      readiness_command: 'npm run daemon -- status --json',
      funding_watch_command: 'npm run funding:watch -- --json',
      funding_watch_report_command: 'npm run funding:watch:report',
      funding_proof_command: 'npm run funding:proof -- --tx <provider_funding_tx_digest> --json',
      funding_proof_report_command: 'npm run funding:proof:report -- --tx <provider_funding_tx_digest>',
      strict_execution_command: 'npm run demo:execute',
      strict_execution_report_command: 'npm run demo:execute:report',
      wallet_strict_execution_report_command: 'npm run demo:execute:wallet-report -- --wrapper-id <wrapper_id> --strategy-file <activation_strategy_file> --create-tx-digest <create_tx_digest>',
      success_condition: STRICT_EXECUTION_SUCCESS_CONDITION,
    },
    execution_gate: executionGate(readiness),
    source_of_truth: readiness.source_of_truth || [
      'runtime status signer adapter',
      'DeepBook BalanceManager read from Sui Testnet',
      'agent SUI gas balance from Sui Testnet',
    ],
    execution_claimed: false,
  }
}

function markdown(handoff) {
  const bmAssets = handoff.funding_targets.balance_manager.required_assets
  const gasAssets = handoff.funding_targets.agent_gas.required_assets
  const assetLines = [...bmAssets, ...gasAssets].map((row) => (
    `- ${row.asset}: observed ${row.observed}, required ${row.required}, missing ${row.missing}, holder ${row.holder}`
  ))
  return [
    '# RescueGrid Funding Request',
    '',
    `Chain: ${handoff.chain}`,
    `Ready for strict execution: ${handoff.ready_for_strict_execution}`,
    `Blockers: ${handoff.blocker_codes.join(', ') || 'none'}`,
    `Signer: ${handoff.signer.kind} (${handoff.signer.unavailable_code || (handoff.signer.execution_enabled ? 'execution enabled' : 'execution gated')})`,
    handoff.external_signer ? `External signer: ${handoff.external_signer.kind} · ${handoff.external_signer.status} · runner_configured=${handoff.external_signer.submission_runner_configured}` : null,
    `Execution gate: readiness-only; policy_creation_allowed=${handoff.execution_gate.policy_creation_allowed}; execution_claimed=false`,
    `Strict execution report required: ${handoff.execution_gate.strict_execution_report_path}`,
    '',
    `Agent: ${handoff.agent.address}`,
    `BalanceManager: ${handoff.agent.balance_manager_id}`,
    `DeepBook market: ${handoff.deepbook.market_id}`,
    `DeepBook pool: ${handoff.deepbook.pool_id}`,
    '',
    'Required assets:',
    ...assetLines,
    '',
    `DBUSDC coin type: ${handoff.deepbook.dbusdc_coin_type}`,
    `DEEP coin type: ${handoff.deepbook.deep_coin_type}`,
    '',
    `Funding method: ${handoff.deepbook.balance_manager_funding_method}`,
    '',
    'After funding, run:',
    `- ${handoff.next_verification.readiness_command}`,
    `- ${handoff.next_verification.funding_watch_command}`,
    `- ${handoff.next_verification.funding_watch_report_command}`,
    `- ${handoff.next_verification.funding_proof_command}`,
    `- ${handoff.next_verification.funding_proof_report_command}`,
    `- ${handoff.next_verification.strict_execution_command}`,
    `- ${handoff.next_verification.strict_execution_report_command}`,
    `- ${handoff.next_verification.wallet_strict_execution_report_command}`,
    '',
    `Success condition: ${handoff.next_verification.success_condition}`,
    '',
  ].filter((line) => line != null).join('\n')
}

export function serializeFundingHandoff(handoff, format = 'json') {
  const normalized = String(format || 'json').toLowerCase()
  if (normalized === 'markdown' || normalized === 'md') return markdown(handoff)
  return JSON.stringify(handoff, null, 2)
}

export function writeFundingHandoffArtifact(handoff, { outPath, format = 'json' } = {}) {
  if (!outPath) throw new Error('outPath is required')
  const resolvedPath = resolve(String(outPath))
  const body = serializeFundingHandoff(handoff, format)
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
  console.log(`Build a RescueGrid external funding handoff.

Usage:
  node worker/scripts/funding-handoff.mjs [--json]
  node worker/scripts/funding-handoff.mjs --format markdown
  node worker/scripts/funding-handoff.mjs --format markdown --out .rescuegrid/funding-request.md
  node worker/scripts/funding-handoff.mjs --dbusdc-threshold <amount> --deep-threshold <amount> --sui-gas-threshold <mist>

This is read-only. It prints public Sui Testnet agent, BalanceManager, coin type,
current balance and missing-amount evidence for the DBUSDC/DEEP execution gate.
No AGENT_KEY, owner key, token or WaaP session value is printed.`)
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const flags = parseArgs(argv)
  if (flags.has('--help') || flags.has('-h')) {
    help()
    return 0
  }
  const runtimeEnv = fundingHandoffEnv(env)
  const readiness = await buildExecutionReadiness({
    env: runtimeEnv,
    chainData: requireChainDataProvider(runtimeEnv),
    requested: requestedThresholds(flags),
  })
  const handoff = buildFundingHandoff(readiness)
  const format = String(flags.get('--format') || (flags.has('--markdown') ? 'markdown' : 'json')).toLowerCase()
  const outPath = flags.get('--out') || flags.get('--output')
  if (outPath) {
    const artifact = writeFundingHandoffArtifact(handoff, { outPath, format })
    console.log(JSON.stringify({
      status: 'ok',
      purpose: handoff.purpose,
      artifact,
      chain: handoff.chain,
      ready_for_strict_execution: handoff.ready_for_strict_execution,
      blocker_codes: handoff.blocker_codes,
      execution_claimed: false,
    }, null, 2))
  } else {
    console.log(serializeFundingHandoff(handoff, format))
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(JSON.stringify({ status: 'error', code: error.code || 'FUNDING_HANDOFF_ERROR', message: error.message }, null, 2))
    process.exit(1)
  })
}
