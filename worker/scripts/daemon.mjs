#!/usr/bin/env node
// Local RescueGrid daemon scaffold.
//
// This runs the same Worker Runtime Core tick path from a local long-running
// process. Execution stays opt-in: without --execution-enabled the tick can
// monitor and surface blockers, but it cannot submit an agent PTB.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { DEPLOYMENT } from '../src/sui-tx.js'
import { runTick } from '../src/tick.js'
import { runtimeCoreStatus } from '../src/runtime-core.js'
import {
  KNOWN_SIGNER_KINDS,
  SIGNER_KIND_WORKER_SECRET,
} from '../src/signer-adapters.js'
import { readWorkerDevVar } from './agent-key-loader.mjs'

const DEFAULT_CONFIG_PATH = '.rescuegrid/daemon.json'
const DEFAULT_LOG_PATH = '.rescuegrid/daemon/activity.jsonl'
const DEFAULT_INTERVAL_MS = 60_000

export function parseDaemonArgs(argv = process.argv.slice(2)) {
  const commandParts = []
  const flags = new Map()
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      commandParts.push(arg)
      continue
    }
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
  return {
    command: commandParts.join(' ') || 'status',
    flags,
  }
}

function boolFlag(flags, name, defaultValue = false) {
  if (!flags.has(name)) return defaultValue
  const value = String(flags.get(name)).toLowerCase()
  return value !== 'false' && value !== '0' && value !== 'no'
}

function integerFlag(flags, name, defaultValue) {
  const value = flags.get(name)
  if (value == null) return defaultValue
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw Object.assign(new Error(`${name} must be a non-negative integer`), { code: 'BAD_DAEMON_CONFIG' })
  }
  return parsed
}

function splitList(value) {
  if (!value) return []
  return String(value).split(',').map((v) => v.trim()).filter(Boolean)
}

function readJsonFile(path) {
  if (!path || !existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readLocalAgentKey() {
  if (process.env.AGENT_KEY) return process.env.AGENT_KEY
  try {
    return readWorkerDevVar('AGENT_KEY')
  } catch {
    return null
  }
}

export function resolveDaemonConfig({ flags = new Map(), env = process.env } = {}) {
  const configPath = resolve(String(flags.get('--config') || env.RESCUEGRID_DAEMON_CONFIG || DEFAULT_CONFIG_PATH))
  const fileConfig = readJsonFile(configPath)
  const watchedPolicies = [
    ...splitList(fileConfig.watched_policies),
    ...splitList(env.RESCUEGRID_DAEMON_POLICIES),
    ...splitList(flags.get('--wrapper-id') || flags.get('--wrapper-ids')),
  ]

  return {
    config_path: configPath,
    chain: String(flags.get('--chain') || env.RESCUEGRID_CHAIN || fileConfig.chain || 'sui:testnet'),
    agent_address: String(flags.get('--agent-address') || env.RESCUEGRID_AGENT_ADDRESS || fileConfig.agent_address || DEPLOYMENT.agent.address),
    signer_kind: String(flags.get('--signer-kind') || env.SIGNER_KIND || env.RESCUEGRID_SIGNER_KIND || fileConfig.signer_kind || SIGNER_KIND_WORKER_SECRET),
    execution_enabled: boolFlag(flags, '--execution-enabled', env.EXECUTION_ENABLED === 'true' || fileConfig.execution_enabled === true),
    demo_mode: boolFlag(flags, '--demo-mode', env.RESCUEGRID_DEMO_MODE === 'true' || fileConfig.demo_mode === true),
    force_trigger: boolFlag(flags, '--force-trigger', false),
    tick_interval_ms: integerFlag(flags, '--interval-ms', Number(fileConfig.tick_interval_ms || env.RESCUEGRID_DAEMON_INTERVAL_MS || DEFAULT_INTERVAL_MS)),
    max_ticks: integerFlag(flags, '--max-ticks', Number(fileConfig.max_ticks || 0)),
    log_path: resolve(String(flags.get('--log') || env.RESCUEGRID_DAEMON_LOG || fileConfig.log_path || DEFAULT_LOG_PATH)),
    watched_policies: [...new Set(watchedPolicies)],
  }
}

export function validateDaemonConfig(config, { requirePolicies = false } = {}) {
  if (!['sui:testnet', 'sui:devnet', 'sui:mainnet'].includes(config.chain)) {
    return { ok: false, code: 'UNSUPPORTED_CHAIN', message: `Unsupported daemon chain: ${config.chain}` }
  }
  if (!KNOWN_SIGNER_KINDS.includes(config.signer_kind)) {
    return { ok: false, code: 'UNKNOWN_SIGNER_KIND', message: `Unknown signer kind: ${config.signer_kind}` }
  }
  if (config.chain === 'sui:mainnet' && config.signer_kind === SIGNER_KIND_WORKER_SECRET) {
    return {
      ok: false,
      code: 'MAINNET_REQUIRES_EXTERNAL_SIGNER',
      message: 'Mainnet daemon policies require an external signer mode before any PTB can be accepted.',
    }
  }
  if (config.agent_address !== DEPLOYMENT.agent.address) {
    return {
      ok: false,
      code: 'LOCAL_AGENT_MISMATCH',
      message: 'This build only supports the deployed RescueGrid agent address; revoke/recreate policies before changing the local agent.',
      expected_agent: DEPLOYMENT.agent.address,
      actual_agent: config.agent_address,
    }
  }
  if (config.force_trigger && !config.demo_mode) {
    return { ok: false, code: 'FORCE_TRIGGER_DISABLED', message: 'force_trigger requires --demo-mode or RESCUEGRID_DEMO_MODE=true.' }
  }
  if (requirePolicies && config.watched_policies.length === 0) {
    return { ok: false, code: 'NO_WATCHED_POLICIES', message: 'At least one --wrapper-id or watched_policies entry is required.' }
  }
  for (const wrapperId of config.watched_policies) {
    if (!/^0x[0-9a-fA-F]+$/.test(wrapperId)) {
      return { ok: false, code: 'BAD_WRAPPER_ID', message: `Invalid wrapper id: ${wrapperId}` }
    }
  }
  return { ok: true }
}

export function daemonStatus(config) {
  const runtimeCore = runtimeCoreStatus()
  return {
    status: 'ok',
    chain: config.chain,
    agent_address: config.agent_address,
    signer_kind: config.signer_kind,
    execution_enabled: config.execution_enabled,
    demo_mode: config.demo_mode,
    registered_adapters: runtimeCore.registered_adapters.map((adapter) => adapter.kind),
    runtime_core: runtimeCore,
    known_signer_kinds: KNOWN_SIGNER_KINDS,
    watched_policies: config.watched_policies,
    tick_interval_ms: config.tick_interval_ms,
    log_path: config.log_path,
  }
}

function runtimeEnv(config) {
  return {
    EXECUTION_ENABLED: config.execution_enabled ? 'true' : 'false',
    RESCUEGRID_DEMO_MODE: config.demo_mode ? 'true' : 'false',
    SIGNER_KIND: config.signer_kind,
    AGENT_KEY: readLocalAgentKey() || undefined,
  }
}

function publicTickResult(result, wrapperId) {
  return {
    ts: new Date().toISOString(),
    wrapper_id: wrapperId,
    action: result.action,
    code: result.code ?? null,
    readiness_state: result.readiness_state ?? null,
    execution_claimed: Boolean(result.execution_claimed),
    tx_digest: result.tx_digest ?? null,
    signer_kind: result.signer_kind ?? null,
    detail: result.detail ?? null,
  }
}

function readLogLines(logPath) {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
}

export function appendDaemonLog(logPath, entry) {
  mkdirSync(dirname(logPath), { recursive: true })
  const lines = readLogLines(logPath)
  if (entry.tx_digest && lines.some((line) => {
    try {
      return JSON.parse(line).tx_digest === entry.tx_digest
    } catch {
      return false
    }
  })) {
    return { appended: false, duplicate_tx_digest: entry.tx_digest }
  }
  writeFileSync(logPath, `${JSON.stringify(entry)}\n`, { flag: 'a' })
  return { appended: true }
}

export function readDaemonLogs(logPath, limit = 20) {
  const safeLimit = Math.max(0, Number(limit) || 20)
  return readLogLines(logPath).slice(-safeLimit).map((line) => JSON.parse(line))
}

export async function tickWatchedPolicy(config, wrapperId) {
  const result = await runTick(runtimeEnv(config), {
    wrapperId,
    forceTrigger: config.force_trigger,
  })
  const entry = publicTickResult(result, wrapperId)
  appendDaemonLog(config.log_path, entry)
  return entry
}

export async function runDaemon(config, { onEntry } = {}) {
  const validation = validateDaemonConfig(config, { requirePolicies: true })
  if (!validation.ok) throw Object.assign(new Error(validation.message), validation)

  const maxTicks = config.max_ticks || Number.POSITIVE_INFINITY
  const entries = []
  for (let tick = 0; tick < maxTicks; tick += 1) {
    for (const wrapperId of config.watched_policies) {
      const entry = await tickWatchedPolicy(config, wrapperId)
      entries.push(entry)
      if (onEntry) onEntry(entry)
    }
    if (tick + 1 < maxTicks) await delay(config.tick_interval_ms)
  }
  return entries
}

function print(value, json = false) {
  if (json) {
    console.log(JSON.stringify(value, null, 2))
    return
  }
  if (Array.isArray(value)) {
    value.forEach((row) => console.log(JSON.stringify(row)))
    return
  }
  for (const [key, rowValue] of Object.entries(value)) {
    console.log(`${key}: ${Array.isArray(rowValue) ? rowValue.join(',') : rowValue}`)
  }
}

function help() {
  console.log(`RescueGrid local daemon.

Usage:
  node worker/scripts/daemon.mjs status [--json]
  node worker/scripts/daemon.mjs tick --wrapper-id <0x...> [--demo-mode --force-trigger] [--execution-enabled]
  node worker/scripts/daemon.mjs run --wrapper-id <0x...>[,<0x...>] [--max-ticks <n>] [--interval-ms 60000]
  node worker/scripts/daemon.mjs logs [--limit 20] [--json]

run streams one JSON object per tick and runs until stopped unless --max-ticks is set.

Config file:
  ${DEFAULT_CONFIG_PATH}

Supported fields:
  chain, agent_address, signer_kind, execution_enabled, demo_mode,
  tick_interval_ms, watched_policies, log_path`)
}

export async function main(argv = process.argv.slice(2)) {
  const { command, flags } = parseDaemonArgs(argv)
  if (flags.has('--help') || command === 'help') {
    help()
    return 0
  }

  const json = boolFlag(flags, '--json', false)
  const config = resolveDaemonConfig({ flags })
  const validate = command === 'logs'
    ? validateDaemonConfig(config)
    : validateDaemonConfig(config, { requirePolicies: ['tick', 'run'].includes(command) })
  if (!validate.ok) {
    print({ status: 'error', ...validate }, true)
    return 1
  }

  if (command === 'status') {
    print(daemonStatus(config), json)
    return 0
  }
  if (command === 'logs') {
    print(readDaemonLogs(config.log_path, integerFlag(flags, '--limit', 20)), json)
    return 0
  }
  if (command === 'tick') {
    const rows = []
    for (const wrapperId of config.watched_policies) rows.push(await tickWatchedPolicy(config, wrapperId))
    print(rows, json)
    return 0
  }
  if (command === 'run') {
    await runDaemon(config, { onEntry: (entry) => console.log(JSON.stringify(entry)) })
    return 0
  }

  print({ status: 'error', code: 'UNKNOWN_COMMAND', message: `Unknown daemon command: ${command}` }, true)
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(JSON.stringify({ status: 'error', code: error.code || 'DAEMON_ERROR', message: error.message }, null, 2))
    process.exit(1)
  })
}
