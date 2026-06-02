#!/usr/bin/env node
// Build a secret-safe external funding request for the DeepBook execution gate.
//
// This script is read-only. It reports public BalanceManager / agent addresses,
// current Sui Testnet balances, missing DBUSDC/DEEP/SUI amounts and the exact
// strict validation command to rerun after funding. It never prints AGENT_KEY.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
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
    },
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
      strict_execution_command: 'npm run demo:execute',
      success_condition: 'Strict execution must preflight ready, create a policy, force a tick, then prove AgentTradeExecuted, execution_claimed=true and on-chain spend increase.',
    },
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
    `- ${handoff.next_verification.strict_execution_command}`,
    '',
  ].join('\n')
}

function help() {
  console.log(`Build a RescueGrid external funding handoff.

Usage:
  node worker/scripts/funding-handoff.mjs [--json]
  node worker/scripts/funding-handoff.mjs --format markdown
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
  if (format === 'markdown') console.log(markdown(handoff))
  else console.log(JSON.stringify(handoff, null, 2))
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(JSON.stringify({ status: 'error', code: error.code || 'FUNDING_HANDOFF_ERROR', message: error.message }, null, 2))
    process.exit(1)
  })
}
