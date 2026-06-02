#!/usr/bin/env node
// Secret-safe PRD readiness gate for RescueGrid.
//
// This is an audit/reporting script. It does not create policies, submit PTBs,
// run demo:execute, or mutate local daemon state.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import packageJson from '../package.json' with { type: 'json' }
import { buildExecutionReadiness } from '../worker/src/execution-readiness.js'
import { requireChainDataProvider } from '../worker/src/chain-data-provider.js'
import { fundingHandoffEnv } from '../worker/scripts/funding-handoff.mjs'
import { verifyWalletEvidenceArtifact } from './wallet-clickthrough-evidence.mjs'

const DEFAULT_WALLET_ARTIFACT = '.rescuegrid/wallet-clickthrough-evidence.md'
const DEFAULT_EXECUTION_REPORT = '.rescuegrid/demo-execute-report.json'
const REQUIRED_SCRIPTS = [
  'build',
  'test:wallet-flow',
  'test:wallet-evidence',
  'test:mission-readiness',
  'test:demo-execution-report',
  'wallet:evidence',
  'wallet:evidence:verify',
  'mission:readiness',
  'funding:request',
  'funding:watch',
  'demo:loop',
  'demo:execute',
  'demo:execute:report',
  'safety:negative',
  'baseline:smoke',
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

function check({ id, label, status, detail = null, evidence = null, blocker_codes = [] }) {
  return {
    id,
    label,
    status,
    passed: status === 'passed',
    detail,
    blocker_codes,
    evidence,
  }
}

function missingScripts(scripts = {}) {
  return REQUIRED_SCRIPTS.filter((name) => !scripts[name])
}

export function summarizeWalletReport(report) {
  if (!report) {
    return check({
      id: 'wallet_clickthrough',
      label: 'Real browser wallet create/revoke evidence',
      status: 'blocked',
      detail: 'wallet click-through artifact is missing',
      blocker_codes: ['WALLET_EVIDENCE_MISSING'],
    })
  }
  if (report.verified === true) {
    return check({
      id: 'wallet_clickthrough',
      label: 'Real browser wallet create/revoke evidence',
      status: 'passed',
      detail: 'filled artifact verified against Sui PolicyCreated / PolicyRevoked events',
      evidence: {
        create_tx_digest: report.fields?.create_tx_digest || report.create_transaction?.digest || null,
        revoke_tx_digest: report.fields?.revoke_tx_digest || report.revoke_transaction?.digest || null,
        wrapper_id: report.fields?.wrapper_id || null,
        mandate_id: report.fields?.mandate_id || null,
      },
    })
  }
  if (report.code === 'EVIDENCE_FIELDS_INCOMPLETE') {
    return check({
      id: 'wallet_clickthrough',
      label: 'Real browser wallet create/revoke evidence',
      status: 'blocked',
      detail: 'wallet evidence artifact exists but still has TODO or missing fields',
      blocker_codes: ['WALLET_EVIDENCE_INCOMPLETE'],
      evidence: { missing_fields: report.missing_fields || [] },
    })
  }
  return check({
    id: 'wallet_clickthrough',
    label: 'Real browser wallet create/revoke evidence',
    status: 'failed',
    detail: report.code || 'wallet evidence verification failed',
    blocker_codes: ['WALLET_EVIDENCE_MISMATCH'],
    evidence: {
      failed_checks: (report.checks || []).filter((row) => row.status === 'failed').map((row) => row.id),
    },
  })
}

export function summarizeFundingReadiness(readiness) {
  if (!readiness) {
    return check({
      id: 'execution_funding_readiness',
      label: 'Strict DeepBook execution preflight readiness',
      status: 'blocked',
      detail: 'funding readiness was not checked',
      blocker_codes: ['FUNDING_READINESS_NOT_CHECKED'],
    })
  }
  if (readiness.execution_ready === true) {
    return check({
      id: 'execution_funding_readiness',
      label: 'Strict DeepBook execution preflight readiness',
      status: 'passed',
      detail: 'signer, execution flag, BalanceManager DBUSDC/DEEP and agent gas are ready',
      evidence: {
        blocker_codes: [],
        balances: readiness.balance_manager?.balances || readiness.funding?.balances || null,
        signer_kind: readiness.signer?.kind || null,
      },
    })
  }
  return check({
    id: 'execution_funding_readiness',
    label: 'Strict DeepBook execution preflight readiness',
    status: 'blocked',
    detail: readiness.error
      ? `strict execution readiness check failed: ${readiness.error}`
      : 'strict execution is still gated before policy creation',
    blocker_codes: readiness.blocker_codes || ['EXECUTION_NOT_READY'],
    evidence: {
      funding_blocker_codes: readiness.funding_blocker_codes || [],
      balances: readiness.balance_manager?.balances || readiness.funding?.balances || null,
      signer_kind: readiness.signer?.kind || null,
      execution_claimed: readiness.execution_claimed === true,
    },
  })
}

function executionReportEvidence(report) {
  const assertions = Array.isArray(report?.assertions) ? report.assertions : []
  return {
    phase: report?.phase || null,
    wrapper_id: report?.wrapper_id || null,
    mandate_id: report?.mandate_id || null,
    tick_outcome: report?.tick_outcome || null,
    tick_tx_digest: report?.tick_tx_digest || report?.tx_digest || null,
    agent_trade_event_found: report?.agent_trade_event_found === true,
    spend_increased: report?.spend_increased === true,
    assertions,
  }
}

export function summarizeStrictExecutionEvidence(report, fundingCheck) {
  if (!report) {
    return check({
      id: 'strict_execution_evidence',
      label: 'AgentTradeExecuted strict execution evidence',
      status: 'blocked',
      detail: fundingCheck?.status === 'passed'
        ? 'funding preflight is ready; run npm run demo:execute and provide its pass report'
        : 'strict execution cannot run until funding readiness is passed',
      blocker_codes: fundingCheck?.status === 'passed'
        ? ['STRICT_EXECUTION_REPORT_MISSING']
        : ['STRICT_EXECUTION_BLOCKED_BY_FUNDING'],
    })
  }
  const assertions = Array.isArray(report.assertions) ? report.assertions : []
  const hasExecutionAssertion = assertions.includes('G2-EXECUTE')
  const txDigest = report.tick_tx_digest || report.tx_digest || null
  const executionClaimed = report.execution_claimed === true
  const eventProven = report.agent_trade_event_found === true
  const spendProven = report.spend_increased === true
  const tickExecuted = report.tick_outcome === 'executed' || report.action === 'executed'
  if (report.phase === 'pass' && hasExecutionAssertion && executionClaimed && txDigest && eventProven && spendProven && tickExecuted) {
    return check({
      id: 'strict_execution_evidence',
      label: 'AgentTradeExecuted strict execution evidence',
      status: 'passed',
      detail: 'strict demo execution report includes G2-EXECUTE, AgentTradeExecuted evidence, spend increase and a tick tx digest',
      evidence: executionReportEvidence(report),
    })
  }
  return check({
    id: 'strict_execution_evidence',
    label: 'AgentTradeExecuted strict execution evidence',
    status: 'failed',
    detail: 'execution report does not prove AgentTradeExecuted strict execution',
    blocker_codes: ['STRICT_EXECUTION_NOT_PROVEN'],
    evidence: executionReportEvidence(report),
  })
}

export function buildMissionReadinessReport({
  generatedAt = new Date().toISOString(),
  scripts = packageJson.scripts,
  walletReport = null,
  fundingReadiness = null,
  executionReport = null,
} = {}) {
  const missing = missingScripts(scripts)
  const scriptCheck = check({
    id: 'validation_scripts',
    label: 'Required validation commands are present',
    status: missing.length === 0 ? 'passed' : 'failed',
    detail: missing.length === 0 ? 'all required package scripts are registered' : 'required package scripts are missing',
    blocker_codes: missing.length === 0 ? [] : ['VALIDATION_SCRIPT_MISSING'],
    evidence: { missing_scripts: missing },
  })
  const walletCheck = summarizeWalletReport(walletReport)
  const fundingCheck = summarizeFundingReadiness(fundingReadiness)
  const strictExecutionCheck = summarizeStrictExecutionEvidence(executionReport, fundingCheck)
  const checks = [scriptCheck, walletCheck, fundingCheck, strictExecutionCheck]
  const blockers = checks.flatMap((row) => row.status === 'passed' ? [] : row.blocker_codes)
  const fullPrdReady = checks.every((row) => row.status === 'passed')
  const hasFailedCheck = checks.some((row) => row.status === 'failed')
  return {
    status: fullPrdReady ? 'ready' : hasFailedCheck ? 'failed' : 'blocked',
    purpose: 'rescuegrid_prd_mission_readiness',
    generated_at: generatedAt,
    chain: 'sui:testnet',
    full_prd_ready: fullPrdReady,
    execution_claimed: strictExecutionCheck.status === 'passed',
    blocker_codes: blockers,
    checks,
    next_actions: fullPrdReady ? [] : nextActions({ walletCheck, fundingCheck, strictExecutionCheck }),
  }
}

function nextActions({ walletCheck, fundingCheck, strictExecutionCheck }) {
  const actions = []
  if (walletCheck?.status !== 'passed') {
    actions.push('Run the real Slush / standard Sui wallet create+revoke flow, fill .rescuegrid/wallet-clickthrough-evidence.md, then run npm run wallet:evidence:verify -- --input .rescuegrid/wallet-clickthrough-evidence.md.')
  }
  if (fundingCheck?.status !== 'passed') {
    actions.push('Send the DBUSDC/DEEP funding handoff to an external funding provider, then rerun npm run funding:watch -- --json.')
  }
  if (fundingCheck?.status === 'passed' && strictExecutionCheck?.status !== 'passed') {
    actions.push('Run npm run demo:execute:report to write .rescuegrid/demo-execute-report.json proving G2-EXECUTE, AgentTradeExecuted, execution_claimed=true and spend increase.')
  }
  return actions
}

async function loadWalletReport({ artifactPath, verifyWallet = verifyWalletEvidenceArtifact }) {
  if (!existsSync(artifactPath)) return null
  const artifactText = readFileSync(artifactPath, 'utf8')
  return verifyWallet({ artifactText })
}

async function loadFundingReadiness({ env = process.env, skipLiveFunding = false } = {}) {
  if (skipLiveFunding) return null
  const runtimeEnv = fundingHandoffEnv(env)
  return buildExecutionReadiness({
    env: runtimeEnv,
    chainData: requireChainDataProvider(runtimeEnv),
  })
}

function loadExecutionReport(path) {
  if (!path || !existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

function help() {
  console.log(`Audit RescueGrid PRD mission readiness.

Usage:
  npm run mission:readiness
  npm run mission:readiness -- --wallet-artifact .rescuegrid/wallet-clickthrough-evidence.md
  npm run mission:readiness -- --execution-report .rescuegrid/demo-execute-report.json
  npm run mission:readiness -- --skip-live-funding

This is read-only. It checks validation command registration, wallet click-through
evidence, execution funding readiness and strict AgentTradeExecuted evidence.
It does not create policies, submit PTBs, run demo:execute or print secrets.`)
}

export async function main(argv = process.argv.slice(2), env = process.env, options = {}) {
  const flags = parseArgs(argv)
  if (flags.has('--help') || flags.has('-h')) {
    help()
    return 0
  }
  const walletArtifact = resolve(String(flags.get('--wallet-artifact') || DEFAULT_WALLET_ARTIFACT))
  const executionReportPath = resolve(String(flags.get('--execution-report') || DEFAULT_EXECUTION_REPORT))
  let walletReport = null
  try {
    walletReport = await loadWalletReport({
      artifactPath: walletArtifact,
      verifyWallet: options.verifyWallet,
    })
  } catch (e) {
    walletReport = {
      status: 'error',
      code: 'WALLET_EVIDENCE_VERIFY_FAILED',
      verified: false,
      checks: [],
      error: String(e?.message || e),
    }
  }
  let fundingReadiness = null
  try {
    fundingReadiness = options.fundingReadiness || await loadFundingReadiness({
      env,
      skipLiveFunding: flags.has('--skip-live-funding'),
    })
  } catch (e) {
    fundingReadiness = {
      execution_ready: false,
      blocker_codes: ['FUNDING_READINESS_CHECK_FAILED'],
      funding_blocker_codes: [],
      execution_claimed: false,
      error: String(e?.message || e),
    }
  }
  const executionReport = options.executionReport ?? loadExecutionReport(executionReportPath)
  const report = buildMissionReadinessReport({
    walletReport,
    fundingReadiness,
    executionReport,
  })
  console.log(JSON.stringify(report, null, 2))
  return report.full_prd_ready ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => {
    process.exitCode = code
  }).catch((e) => {
    console.error(e?.message || e)
    process.exitCode = 1
  })
}
