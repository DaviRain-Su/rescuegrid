#!/usr/bin/env node
// Watch the DeepBook execution gate without creating policies while funding is
// still blocked. When --run-demo is set, strict demo execution is launched only
// after the shared execution-readiness contract reports ready.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { requireChainDataProvider } from '../src/chain-data-provider.js'
import { buildExecutionReadiness } from '../src/execution-readiness.js'
import { buildFundingHandoff, fundingHandoffEnv } from './funding-handoff.mjs'

export function parseFundingWatchArgs(argv = process.argv.slice(2)) {
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

function firstValue(...values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') return String(value)
  }
  return undefined
}

function positiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function requestedThresholds(flags) {
  return {
    dbusdc_threshold: firstValue(flags.get('--dbusdc-threshold'), flags.get('--required-dbusdc-balance'), flags.get('--required-dbusdc')),
    deep_threshold: firstValue(flags.get('--deep-threshold'), flags.get('--required-deep-balance'), flags.get('--required-deep')),
    sui_gas_threshold: firstValue(flags.get('--sui-gas-threshold'), flags.get('--required-sui-gas-mist'), flags.get('--required-sui-gas')),
  }
}

export function fundingWatchOptions(flags = new Map()) {
  return {
    format: String(flags.get('--format') || (flags.has('--json') ? 'json' : 'text')).toLowerCase(),
    wait: flags.has('--wait'),
    once: flags.has('--once') || !flags.has('--wait'),
    runDemo: flags.has('--run-demo') || flags.has('--execute'),
    failUntilReady: flags.has('--fail-until-ready'),
    intervalMs: positiveInt(flags.get('--interval-ms'), 30_000),
    maxAttempts: positiveInt(flags.get('--max-attempts'), flags.has('--wait') ? 120 : 1),
    workerUrl: firstValue(flags.get('--worker-url'), process.env.WORKER_URL),
    requested: requestedThresholds(flags),
  }
}

export function buildFundingWatchReport(readiness, {
  attempt = 1,
  maxAttempts = 1,
  generatedAt = new Date().toISOString(),
  runDemo = false,
} = {}) {
  const handoff = buildFundingHandoff(readiness, { generatedAt })
  return {
    status: 'ok',
    purpose: 'deepbook_execution_funding_watch',
    generated_at: generatedAt,
    attempt,
    max_attempts: maxAttempts,
    chain: handoff.chain,
    ready_for_strict_execution: handoff.ready_for_strict_execution,
    funding_ready: handoff.funding_ready,
    execution_ready: handoff.execution_ready,
    would_run_demo: Boolean(runDemo && handoff.execution_ready),
    policy_creation_allowed: Boolean(runDemo && handoff.execution_ready),
    policy_creation_blocked: Boolean(runDemo && !handoff.execution_ready),
    execution_claimed: false,
    blocker_codes: handoff.blocker_codes,
    blocker_labels: handoff.blocker_labels,
    signer: handoff.signer,
    funding_targets: handoff.funding_targets,
    next_verification: handoff.next_verification,
    source_of_truth: handoff.source_of_truth,
  }
}

function textReport(report) {
  const bm = report.funding_targets.balance_manager.required_assets
  const gas = report.funding_targets.agent_gas.required_assets
  const assets = [...bm, ...gas].map((row) => `${row.asset}: observed=${row.observed} required=${row.required} missing=${row.missing}`).join('; ')
  return [
    `RescueGrid funding watch ${report.attempt}/${report.max_attempts}`,
    `ready_for_strict_execution=${report.ready_for_strict_execution}`,
    `blockers=${report.blocker_codes.join(',') || 'none'}`,
    `assets=${assets}`,
    `policy_creation_allowed=${report.policy_creation_allowed}`,
  ].join('\n')
}

function printReport(report, format) {
  if (format === 'json') console.log(JSON.stringify(report, null, 2))
  else console.log(textReport(report))
}

function runStrictDemo({ workerUrl } = {}) {
  const args = ['worker/scripts/validate-demo-loop.mjs', '--require-execution']
  if (workerUrl) args.push('--worker-url', workerUrl)
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  }).status ?? 1
}

export async function runFundingWatch({
  options,
  env = process.env,
  loadReadiness = null,
  runDemo = runStrictDemo,
  sleep = delay,
  generatedAt = () => new Date().toISOString(),
  print = printReport,
} = {}) {
  const opts = options || fundingWatchOptions(new Map())
  const runtimeEnv = fundingHandoffEnv(env)
  const readinessLoader = loadReadiness || (() => buildExecutionReadiness({
    env: runtimeEnv,
    chainData: requireChainDataProvider(runtimeEnv),
    requested: opts.requested,
  }))

  let latestReport = null
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt += 1) {
    const readiness = await readinessLoader({ attempt, requested: opts.requested })
    latestReport = buildFundingWatchReport(readiness, {
      attempt,
      maxAttempts: opts.maxAttempts,
      generatedAt: generatedAt(),
      runDemo: opts.runDemo,
    })
    print(latestReport, opts.format)
    if (latestReport.execution_ready) {
      if (opts.runDemo) return runDemo({ workerUrl: opts.workerUrl })
      return 0
    }
    if (!opts.wait || attempt === opts.maxAttempts) break
    await sleep(opts.intervalMs)
  }

  if (opts.runDemo || opts.failUntilReady) return 1
  return 0
}

function help() {
  console.log(`Watch the RescueGrid DeepBook execution funding gate.

Usage:
  node worker/scripts/funding-watch.mjs --json
  node worker/scripts/funding-watch.mjs --wait --interval-ms 30000 --max-attempts 120
  node worker/scripts/funding-watch.mjs --wait --run-demo --worker-url http://localhost:8787

This is secret-safe. It reuses /api/execution/readiness semantics through the
shared Worker readiness helper. It never creates a policy while DBUSDC/DEEP/SUI
gas or signer checks are blocked. With --run-demo, it launches strict
demo:execute only after readiness is true.`)
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const flags = parseFundingWatchArgs(argv)
  if (flags.has('--help') || flags.has('-h')) {
    help()
    return 0
  }
  return runFundingWatch({ options: fundingWatchOptions(flags), env })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(JSON.stringify({ status: 'error', code: error.code || 'FUNDING_WATCH_ERROR', message: error.message }, null, 2))
    process.exit(1)
  })
}
