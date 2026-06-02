#!/usr/bin/env node
// Secret-safe ChainDataProvider diagnostics.
//
// This script is read-only. It reports the selected Worker read provider,
// optional bounded probe results, and optional GraphQL-vs-JSON-RPC read
// comparisons without printing endpoint URLs or signer secrets.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  CHAIN_DATA_PROVIDER_GRAPHQL,
  CHAIN_DATA_PROVIDER_JSON_RPC,
  JsonRpcChainDataProvider,
  getChainDataProviderStatus,
  requireChainDataProvider,
} from '../src/chain-data-provider.js'
import { readWorkerDevVar } from './agent-key-loader.mjs'

const URL_PATTERN = /\bhttps?:\/\/[^\s"',)]+/gi
const REDACTED = '[redacted]'
const REDACTED_URL = '[redacted-url]'
const POLICY_FIELDS = [
  'wrapper_id',
  'mandate_id',
  'owner',
  'agent',
  'status',
  'budget_ceiling',
  'spent_amount',
  'budget_coin_type',
  'pool_id',
  'strategy_hash',
]

export function parseChainDataStatusArgs(argv = process.argv.slice(2)) {
  const flags = new Map()
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '-h') {
      flags.set('-h', 'true')
      continue
    }
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

function boolFlag(flags, name, defaultValue = false) {
  if (!flags.has(name)) return defaultValue
  const value = String(flags.get(name)).toLowerCase()
  return value !== 'false' && value !== '0' && value !== 'no'
}

function firstValue(...values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') return String(value).trim()
  }
  return undefined
}

function optionalDevVar(name) {
  try {
    return readWorkerDevVar(name)
  } catch {
    return undefined
  }
}

export function chainDataStatusEnv(env = process.env, { flags = new Map(), includeDevVars = env === process.env } = {}) {
  const devVar = (name) => includeDevVars ? optionalDevVar(name) : undefined
  const provider = firstValue(
    flags.get('--provider'),
    flags.get('--chain-data-provider'),
    env.CHAIN_DATA_PROVIDER,
    env.RESCUEGRID_CHAIN_DATA_PROVIDER,
    devVar('CHAIN_DATA_PROVIDER'),
    devVar('RESCUEGRID_CHAIN_DATA_PROVIDER'),
  )
  const endpoint = firstValue(
    flags.get('--endpoint'),
    flags.get('--graphql-url'),
    flags.get('--graphql-endpoint'),
    env.SUI_GRAPHQL_URL,
    env.SUI_GRAPHQL_ENDPOINT,
    env.GRAPHQL_URL,
    devVar('SUI_GRAPHQL_URL'),
    devVar('SUI_GRAPHQL_ENDPOINT'),
    devVar('GRAPHQL_URL'),
  )
  return {
    ...env,
    ...(provider ? { CHAIN_DATA_PROVIDER: provider } : {}),
    ...(endpoint ? { SUI_GRAPHQL_URL: endpoint } : {}),
  }
}

export function resolveChainDataStatusConfig(flags = new Map(), env = process.env) {
  return {
    json: boolFlag(flags, '--json', false),
    help: flags.has('--help') || flags.has('-h'),
    probe: boolFlag(flags, '--probe', false),
    owner: firstValue(flags.get('--owner'), flags.get('--owner-address')) || '',
    wrapper_id: firstValue(flags.get('--wrapper-id'), flags.get('--policy-id')) || '',
    endpoint: firstValue(
      flags.get('--endpoint'),
      flags.get('--graphql-url'),
      flags.get('--graphql-endpoint'),
      env.SUI_GRAPHQL_URL,
      env.SUI_GRAPHQL_ENDPOINT,
      env.GRAPHQL_URL,
    ) || '',
  }
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort()
}

function byWrapperId(policies = []) {
  return new Map((policies || []).filter((p) => p?.wrapper_id).map((p) => [String(p.wrapper_id), p]))
}

function fieldMismatches(selected, baseline, fields) {
  const mismatches = []
  for (const field of fields) {
    const selectedValue = selected?.[field] == null ? '' : String(selected[field])
    const baselineValue = baseline?.[field] == null ? '' : String(baseline[field])
    if (selectedValue !== baselineValue) {
      mismatches.push({ field, selected: selectedValue, json_rpc: baselineValue })
    }
  }
  return mismatches
}

export function comparePolicyListSnapshots({ selected = [], jsonRpc = [] } = {}) {
  const selectedById = byWrapperId(selected)
  const jsonRpcById = byWrapperId(jsonRpc)
  const selectedIds = sortedUnique([...selectedById.keys()])
  const jsonRpcIds = sortedUnique([...jsonRpcById.keys()])
  const missingInSelected = jsonRpcIds.filter((id) => !selectedById.has(id))
  const extraInSelected = selectedIds.filter((id) => !jsonRpcById.has(id))
  const commonIds = selectedIds.filter((id) => jsonRpcById.has(id))
  const mismatched_fields = commonIds.flatMap((wrapperId) => {
    const mismatches = fieldMismatches(selectedById.get(wrapperId), jsonRpcById.get(wrapperId), POLICY_FIELDS)
    return mismatches.map((mismatch) => ({ wrapper_id: wrapperId, ...mismatch }))
  })
  const matches = missingInSelected.length === 0 && extraInSelected.length === 0 && mismatched_fields.length === 0
  return {
    status: matches ? 'match' : 'mismatch',
    selected_count: selectedIds.length,
    json_rpc_count: jsonRpcIds.length,
    common_count: commonIds.length,
    missing_in_selected: missingInSelected,
    extra_in_selected: extraInSelected,
    mismatched_fields,
  }
}

function activityEventKeys(activity) {
  return sortedUnique((activity?.events || []).map((event) => `${event.type || 'unknown'}:${event.tx || event.digest || ''}`))
}

export function compareActivitySnapshots({ selected = {}, jsonRpc = {} } = {}) {
  const selectedOk = selected?.status === 'ok'
  const jsonRpcOk = jsonRpc?.status === 'ok'
  if (!selectedOk || !jsonRpcOk) {
    const status = selectedOk === jsonRpcOk && String(selected?.code || '') === String(jsonRpc?.code || '') ? 'match' : 'mismatch'
    return {
      status,
      selected_status: selected?.status || null,
      json_rpc_status: jsonRpc?.status || null,
      selected_code: selected?.code || null,
      json_rpc_code: jsonRpc?.code || null,
    }
  }

  const selectedPolicy = selected.policy || {}
  const jsonRpcPolicy = jsonRpc.policy || {}
  const selectedEvents = activityEventKeys(selected)
  const jsonRpcEvents = activityEventKeys(jsonRpc)
  const missingEvents = jsonRpcEvents.filter((key) => !selectedEvents.includes(key))
  const extraEvents = selectedEvents.filter((key) => !jsonRpcEvents.includes(key))
  const mismatched_fields = fieldMismatches(selectedPolicy, jsonRpcPolicy, POLICY_FIELDS)
  const matches = missingEvents.length === 0 && extraEvents.length === 0 && mismatched_fields.length === 0
  return {
    status: matches ? 'match' : 'mismatch',
    selected_event_count: selectedEvents.length,
    json_rpc_event_count: jsonRpcEvents.length,
    missing_events_in_selected: missingEvents,
    extra_events_in_selected: extraEvents,
    mismatched_fields,
  }
}

async function compareOwnerPolicies({ selectedProvider, jsonRpcProvider, owner }) {
  try {
    const [selected, jsonRpc] = await Promise.all([
      selectedProvider.listPoliciesByOwner(owner),
      jsonRpcProvider.listPoliciesByOwner(owner),
    ])
    return {
      name: 'owner_policy_list',
      owner,
      ...comparePolicyListSnapshots({ selected, jsonRpc }),
    }
  } catch (e) {
    return {
      name: 'owner_policy_list',
      owner,
      status: 'error',
      code: e?.code || 'OWNER_POLICY_COMPARE_FAILED',
      message: String(e?.message || e),
    }
  }
}

async function compareWrapperActivity({ selectedProvider, jsonRpcProvider, wrapperId }) {
  try {
    const [selected, jsonRpc] = await Promise.all([
      selectedProvider.getActivity(wrapperId),
      jsonRpcProvider.getActivity(wrapperId),
    ])
    return {
      name: 'wrapper_activity',
      wrapper_id: wrapperId,
      ...compareActivitySnapshots({ selected, jsonRpc }),
    }
  } catch (e) {
    return {
      name: 'wrapper_activity',
      wrapper_id: wrapperId,
      status: 'error',
      code: e?.code || 'WRAPPER_ACTIVITY_COMPARE_FAILED',
      message: String(e?.message || e),
    }
  }
}

export async function buildChainDataStatusReport({
  env = process.env,
  probe = false,
  owner = '',
  wrapperId = '',
  endpoint = '',
  generatedAt = new Date().toISOString(),
} = {}, {
  getStatus = getChainDataProviderStatus,
  selectedProvider = null,
  jsonRpcProvider = null,
} = {}) {
  const providerOptions = endpoint ? { endpoint } : {}
  const providerStatus = await getStatus(env, { ...providerOptions, probe })
  const comparisons = []

  if (owner || wrapperId) {
    if (providerStatus.provider_kind === CHAIN_DATA_PROVIDER_JSON_RPC) {
      comparisons.push({
        name: 'provider_compare',
        status: 'skipped',
        reason: 'selected provider is already json-rpc',
      })
    } else if (!providerStatus.available) {
      comparisons.push({
        name: 'provider_compare',
        status: 'error',
        code: 'CHAIN_DATA_PROVIDER_UNAVAILABLE',
        message: 'Selected provider is unavailable; comparison cannot run.',
      })
    } else {
      const selected = selectedProvider || requireChainDataProvider(env, providerOptions)
      const baseline = jsonRpcProvider || new JsonRpcChainDataProvider()
      if (owner) comparisons.push(await compareOwnerPolicies({ selectedProvider: selected, jsonRpcProvider: baseline, owner }))
      if (wrapperId) comparisons.push(await compareWrapperActivity({ selectedProvider: selected, jsonRpcProvider: baseline, wrapperId }))
    }
  }

  const report = {
    status: 'ok',
    generated_at: generatedAt,
    chain: providerStatus.chain || 'sui:testnet',
    chain_data_provider: providerStatus,
    comparisons,
  }
  report.status = chainDataStatusExitCode(report) === 0 ? 'ok' : 'error'
  return report
}

function collectSensitiveValues(report, env = process.env) {
  const values = [
    env.SUI_GRAPHQL_URL,
    env.SUI_GRAPHQL_ENDPOINT,
    env.GRAPHQL_URL,
    env.AGENT_KEY,
    env.OWNER_KEY,
    env.INTERNAL_AGENT_TICK_TOKEN,
    env.RESCUEGRID_WAAP_PERMISSION_TOKEN,
    env.WAAP_PERMISSION_TOKEN,
  ]
  const endpointConfigured = report?.chain_data_provider?.endpoint
  if (endpointConfigured) values.push(endpointConfigured)
  return values.filter((value) => typeof value === 'string' && value.length >= 4)
}

export function redactString(value, sensitiveValues = []) {
  let out = String(value).replace(URL_PATTERN, REDACTED_URL)
  for (const secret of sensitiveValues) {
    out = out.split(secret).join(REDACTED)
  }
  return out
}

export function redactReportForPrint(value, { env = process.env, sensitiveValues = collectSensitiveValues(value, env) } = {}) {
  if (typeof value === 'string') return redactString(value, sensitiveValues)
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => redactReportForPrint(item, { env, sensitiveValues }))
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactReportForPrint(item, { env, sensitiveValues })]),
  )
}

export function chainDataStatusExitCode(report) {
  const provider = report?.chain_data_provider || {}
  if (provider.provider_status === 'probe_failed') return 1
  if (provider.probe?.status === 'error') return 1
  if (provider.provider_kind === CHAIN_DATA_PROVIDER_GRAPHQL && provider.available === false) return 1
  if ((report?.comparisons || []).some((comparison) => comparison.status === 'mismatch' || comparison.status === 'error')) return 1
  return 0
}

function formatReadModel(readModel = {}) {
  return Object.entries(readModel).map(([key, value]) => `${key}=${value}`).join(', ') || 'unknown'
}

export function formatChainDataStatus(report) {
  const provider = report.chain_data_provider || {}
  const lines = [
    `ChainDataProvider: ${provider.provider_kind || 'unknown'} ${provider.provider_status || 'unknown'}`,
    `Transport: ${provider.transport || 'unknown'}`,
    `Endpoint: ${provider.endpoint_configured ? 'configured' : 'not configured'}`,
    `Probe: ${provider.probe?.status || 'unknown'}`,
    `Read model: ${formatReadModel(provider.read_model)}`,
  ]
  if (provider.error) lines.push(`Provider error: ${provider.error.code || 'error'} ${provider.error.message || ''}`.trim())
  if (provider.probe?.status === 'error') lines.push(`Probe error: ${provider.probe.code || 'error'} ${provider.probe.message || ''}`.trim())
  for (const comparison of report.comparisons || []) {
    if (comparison.status === 'skipped') {
      lines.push(`${comparison.name}: skipped (${comparison.reason})`)
    } else if (comparison.name === 'owner_policy_list') {
      lines.push(`${comparison.name}: ${comparison.status} selected=${comparison.selected_count ?? 'n/a'} json-rpc=${comparison.json_rpc_count ?? 'n/a'}`)
    } else if (comparison.name === 'wrapper_activity') {
      lines.push(`${comparison.name}: ${comparison.status} selected_events=${comparison.selected_event_count ?? 'n/a'} json-rpc_events=${comparison.json_rpc_event_count ?? 'n/a'}`)
    } else {
      lines.push(`${comparison.name}: ${comparison.status}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function help() {
  console.log(`Inspect RescueGrid ChainDataProvider status.

Usage:
  npm run chain-data:status -- [--json]
  npm run chain-data:status -- --probe --json
  npm run chain-data:status -- --provider graphql --endpoint <url> --probe --json
  npm run chain-data:status -- --provider graphql --owner <0x...> --wrapper-id <0x...> --json

Options:
  --provider <json-rpc|graphql>  Override CHAIN_DATA_PROVIDER.
  --endpoint <url>               Configure Sui GraphQL endpoint for this run.
  --probe                        Run bounded provider probe.
  --owner <0x...>                Compare selected provider owner policy list against JSON-RPC.
  --wrapper-id <0x...>           Compare selected provider wrapper activity against JSON-RPC.
  --json                         Print JSON instead of concise text.

This is read-only. It never prints AGENT_KEY, owner keys, WaaP tokens or GraphQL
endpoint URLs. GraphQL balance, gas and market reads may still fall back to
JSON-RPC until their query shapes are validated.`)
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const flags = parseChainDataStatusArgs(argv)
  const runtimeEnv = chainDataStatusEnv(env, { flags })
  const config = resolveChainDataStatusConfig(flags, runtimeEnv)
  if (config.help) {
    help()
    return 0
  }
  const report = await buildChainDataStatusReport({
    env: runtimeEnv,
    probe: config.probe,
    owner: config.owner,
    wrapperId: config.wrapper_id,
    endpoint: config.endpoint,
  })
  const printable = redactReportForPrint(report, { env: runtimeEnv })
  if (config.json) console.log(JSON.stringify(printable, null, 2))
  else process.stdout.write(formatChainDataStatus(printable))
  return chainDataStatusExitCode(report)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code)).catch((error) => {
    const flags = parseChainDataStatusArgs(process.argv.slice(2))
    const runtimeEnv = chainDataStatusEnv(process.env, { flags })
    const message = redactString(error?.message || String(error), collectSensitiveValues(null, runtimeEnv))
    console.error(JSON.stringify({ status: 'error', code: error?.code || 'CHAIN_DATA_STATUS_ERROR', message }, null, 2))
    process.exit(1)
  })
}
