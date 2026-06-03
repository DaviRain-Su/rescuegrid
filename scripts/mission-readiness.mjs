#!/usr/bin/env node
// Secret-safe PRD readiness gate for RescueGrid.
//
// This is an audit/reporting script. It does not create policies, submit PTBs,
// run demo:execute, or mutate local daemon state.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import packageJson from '../package.json' with { type: 'json' }
import { buildExecutionReadiness } from '../worker/src/execution-readiness.js'
import { requireChainDataProvider } from '../worker/src/chain-data-provider.js'
import { executionGate, fundingHandoffEnv } from '../worker/scripts/funding-handoff.mjs'
import {
  SAFETY_NEGATIVE_REQUIRED_ASSERTIONS,
  SAFETY_NEGATIVE_REQUIRED_CODES,
} from '../worker/scripts/safety-negative-report.mjs'
import { verifyWalletEvidenceArtifact } from './wallet-clickthrough-evidence.mjs'

const DEFAULT_WALLET_ARTIFACT = '.rescuegrid/wallet-clickthrough-evidence.md'
const DEFAULT_EXECUTION_REPORT = '.rescuegrid/demo-execute-report.json'
const DEFAULT_SAFETY_REPORT = '.rescuegrid/safety-negative-report.json'
const DEFAULT_MISSION_REPORT = '.rescuegrid/mission-readiness-report.json'
const REQUIRED_SCRIPTS = [
  'build',
  'test:wallet-flow',
  'test:wallet-evidence',
  'test:mission-readiness',
  'test:demo-execution-report',
  'test:safety-negative-report',
  'wallet:evidence',
  'wallet:evidence:preflight',
  'wallet:evidence:verify',
  'mission:readiness',
  'mission:readiness:report',
  'funding:request',
  'funding:watch',
  'funding:watch:report',
  'demo:loop',
  'demo:execute',
  'demo:execute:report',
  'safety:negative',
  'safety:negative:report',
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

function pickPublicFields(row, fields = []) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return {}
  const out = {}
  for (const field of fields) {
    if (row[field] !== undefined) out[field] = row[field]
  }
  return out
}

function publicSignerCapabilities(rows = []) {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => pickPublicFields(row, [
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
    ]))
    .filter((row) => Object.keys(row).length > 0)
}

function publicExternalSigner(posture = null) {
  const publicPosture = pickPublicFields(posture, [
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
  return Object.keys(publicPosture).length === 0 ? null : publicPosture
}

function stringOrNull(value) {
  return value == null ? null : String(value)
}

function numberOrNull(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function hexVector(value) {
  if (Array.isArray(value)) return `0x${value.map((b) => Number(b).toString(16).padStart(2, '0')).join('')}`
  if (value == null) return null
  return String(value)
}

function eventType(value) {
  if (!value) return null
  return String(value).split('::').pop()
}

function publicAgentTradeEvent(event = null) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null
  return {
    type: eventType(event.type || event.event_type),
    tx_digest: stringOrNull(event.tx_digest || event.txDigest || event.id?.txDigest),
    mandate_id: stringOrNull(event.mandate_id),
    wrapper_id: stringOrNull(event.wrapper_id),
    agent: stringOrNull(event.agent),
    pool_id: stringOrNull(event.pool_id),
    quote_amount_spent: stringOrNull(event.quote_amount_spent),
    base_amount_received: stringOrNull(event.base_amount_received),
    spent_amount_after: stringOrNull(event.spent_amount_after),
    budget_ceiling: stringOrNull(event.budget_ceiling),
    slippage_bps: numberOrNull(event.slippage_bps),
    client_order_id: hexVector(event.client_order_id),
    executed_at_ms: numberOrNull(event.executed_at_ms ?? event.timestamp_ms),
  }
}

function hasPresentValue(value) {
  return value !== null && value !== undefined && String(value) !== ''
}

function missingAgentTradeEventEvidence(evidence) {
  const event = evidence.agent_trade_event
  if (!event) return ['agent_trade_event']
  const missing = []
  if (event.type !== 'AgentTradeExecuted') missing.push('agent_trade_event_type')
  if (
    !event.tx_digest ||
    !evidence.tick_tx_digest ||
    normalizeDigestAnchor(event.tx_digest) !== normalizeDigestAnchor(evidence.tick_tx_digest)
  ) missing.push('agent_trade_event_tx_digest')
  if (
    !event.wrapper_id ||
    !evidence.wrapper_id ||
    normalizeHexAnchor(event.wrapper_id) !== normalizeHexAnchor(evidence.wrapper_id)
  ) missing.push('agent_trade_event_wrapper')
  if (
    !event.mandate_id ||
    !evidence.mandate_id ||
    normalizeHexAnchor(event.mandate_id) !== normalizeHexAnchor(evidence.mandate_id)
  ) missing.push('agent_trade_event_mandate')
  for (const field of [
    'agent',
    'pool_id',
    'quote_amount_spent',
    'base_amount_received',
    'spent_amount_after',
    'budget_ceiling',
    'slippage_bps',
    'client_order_id',
    'executed_at_ms',
  ]) {
    if (!hasPresentValue(event[field])) missing.push(`agent_trade_event_${field}`)
  }
  return missing
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
        actual_clickthrough_completed: report.actual_clickthrough_completed === true,
        owner_address: report.fields?.owner_address || null,
        create_tx_digest: report.fields?.create_tx_digest || report.create_transaction?.digest || null,
        revoke_tx_digest: report.fields?.revoke_tx_digest || report.revoke_transaction?.digest || null,
        wrapper_id: report.fields?.wrapper_id || null,
        mandate_id: report.fields?.mandate_id || null,
        strategy_hash: report.fields?.strategy_hash || null,
        manual_evidence_fields: report.required_manual_fields || [],
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
      evidence: {
        actual_clickthrough_completed: report.actual_clickthrough_completed === true,
        worker_url: report.worker_url || null,
        missing_fields: report.missing_fields || [],
        missing_field_count: Array.isArray(report.missing_fields) ? report.missing_fields.length : 0,
        required_core_fields: report.required_core_fields || [],
        required_manual_fields: report.required_manual_fields || [],
      },
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
        signer_available: Boolean(readiness.signer?.available),
        signer_execution_enabled: Boolean(readiness.signer?.execution_enabled || readiness.execution?.enabled),
        signer_capabilities: publicSignerCapabilities(readiness.signer_capabilities),
        external_signer: publicExternalSigner(readiness.external_signer),
        execution_gate: executionGate(readiness),
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
      signer_available: Boolean(readiness.signer?.available),
      signer_execution_enabled: Boolean(readiness.signer?.execution_enabled || readiness.execution?.enabled),
      signer_unavailable_code: readiness.signer?.unavailable_code || readiness.execution?.blocker_code || null,
      signer_capabilities: publicSignerCapabilities(readiness.signer_capabilities),
      external_signer: publicExternalSigner(readiness.external_signer),
      execution_gate: executionGate(readiness),
      execution_claimed: readiness.execution_claimed === true,
    },
  })
}

function safetyReportEvidence(report) {
  return {
    chain: report?.chain || null,
    phase: report?.phase || null,
    active_wrapper_id: report?.active_policy?.wrapper_id || report?.active_wrapper_id || null,
    expired_wrapper_id: report?.expiring_policy?.wrapper_id || report?.expired_wrapper_id || null,
    revoke_tx_digest: report?.revoke_tx_digest || report?.active_revoke_tx_digest || null,
    validated_codes: Array.isArray(report?.validated_codes) ? report.validated_codes : [],
    missing_codes: Array.isArray(report?.missing_codes) ? report.missing_codes : [],
    all_pre_submission: report?.all_pre_submission === true,
    all_execution_unclaimed: report?.all_execution_unclaimed === true,
    all_spend_unchanged: report?.all_spend_unchanged === true,
    all_success_activity_unchanged: report?.all_success_activity_unchanged === true,
    chain_success_activity_total: Number(report?.chain_success_activity_total ?? 0),
  }
}

function safetyLiveEvidenceMissing(report, evidenceRows = []) {
  const evidence = safetyReportEvidence(report)
  const observedCodes = new Set(evidenceRows.map((row) => row.observed_code || row.code || row.blocker_code).filter(Boolean))
  const missing = []
  if (evidence.chain !== 'sui:testnet') missing.push('chain')
  if (!evidence.active_wrapper_id) missing.push('active_wrapper_id')
  if (!evidence.expired_wrapper_id) missing.push('expired_wrapper_id')
  if (!evidence.revoke_tx_digest) missing.push('revoke_tx_digest')
  for (const code of SAFETY_NEGATIVE_REQUIRED_CODES) {
    if (!observedCodes.has(code)) missing.push(`evidence:${code}`)
  }
  return missing
}

export function summarizeSafetyNegativeEvidence(report) {
  if (!report) {
    return check({
      id: 'safety_negative_evidence',
      label: 'Live safety negative-path evidence',
      status: 'blocked',
      detail: 'safety negative report is missing',
      blocker_codes: ['SAFETY_NEGATIVE_REPORT_MISSING'],
    })
  }
  const assertions = Array.isArray(report.assertions) ? report.assertions : []
  const validatedCodes = Array.isArray(report.validated_codes) ? report.validated_codes : []
  const evidenceRows = Array.isArray(report.evidence) ? report.evidence : []
  const missingAssertions = SAFETY_NEGATIVE_REQUIRED_ASSERTIONS.filter((id) => !assertions.includes(id))
  const missingCodes = SAFETY_NEGATIVE_REQUIRED_CODES.filter((code) => !validatedCodes.includes(code))
  const missingLiveEvidence = safetyLiveEvidenceMissing(report, evidenceRows)
  const rowsProvePreSubmit = evidenceRows.every((row) => row.submitted === false)
  const rowsProveNoExecution = evidenceRows.every((row) => row.execution_claimed === false)
  const rowsProveSpendUnchanged = evidenceRows.every((row) => row.spend_unchanged === true || String(row.spend_before) === String(row.spend_after))
  const rowsProveNoSuccessActivity = evidenceRows.every((row) => {
    const apiUnchanged = row.success_activity_unchanged === true || Number(row.success_activity_count_before) === Number(row.success_activity_count_after)
    return apiUnchanged && Number(row.chain_success_activity_count || 0) === 0
  })
  const hasReportPass = report.phase === 'pass' &&
    report.purpose === 'rescuegrid_safety_negative_report' &&
    report.all_pre_submission === true &&
    report.all_execution_unclaimed === true &&
    report.all_spend_unchanged === true &&
    report.all_success_activity_unchanged === true &&
    Number(report.chain_success_activity_total || 0) === 0
  if (
    hasReportPass &&
    missingAssertions.length === 0 &&
    missingCodes.length === 0 &&
    missingLiveEvidence.length === 0 &&
    rowsProvePreSubmit &&
    rowsProveNoExecution &&
    rowsProveSpendUnchanged &&
    rowsProveNoSuccessActivity
  ) {
    return check({
      id: 'safety_negative_evidence',
      label: 'Live safety negative-path evidence',
      status: 'passed',
      detail: 'live Testnet validate-plan report proves all required negative paths blocked before submission without spend or execution success',
      evidence: safetyReportEvidence(report),
    })
  }
  return check({
    id: 'safety_negative_evidence',
    label: 'Live safety negative-path evidence',
    status: 'failed',
    detail: 'safety negative report does not prove all required pre-submit blockers',
    blocker_codes: ['SAFETY_NEGATIVE_NOT_PROVEN'],
    evidence: {
      ...safetyReportEvidence(report),
      missing_assertions: missingAssertions,
      missing_codes: missingCodes,
      missing_live_evidence: missingLiveEvidence,
      evidence_rows: evidenceRows.length,
    },
  })
}

function executionReportEvidence(report) {
  const assertions = Array.isArray(report?.assertions) ? report.assertions : []
  const postRevokeExecutionClaimed = report?.post_revoke?.execution_claimed
  return {
    purpose: report?.purpose || null,
    chain: report?.chain || null,
    phase: report?.phase || null,
    require_execution: report?.require_execution === true,
    owner_address: report?.owner_address || null,
    delegated_agent_address: report?.delegated_agent_address || null,
    pool_id: report?.pool_id || null,
    wrapper_id: report?.wrapper_id || null,
    mandate_id: report?.mandate_id || null,
    strategy_hash: report?.strategy_hash || null,
    create_tx_digest: report?.create_tx_digest || report?.create_tx?.digest || null,
    create_tx_status: report?.create_tx?.status || null,
    revoke_tx_digest: report?.revoke_tx_digest || report?.revoke_tx?.digest || null,
    revoke_tx_status: report?.revoke_tx?.status || null,
    tick_outcome: report?.tick_outcome || null,
    tick_tx_digest: report?.tick_tx_digest || report?.tx_digest || null,
    agent_trade_event_found: report?.agent_trade_event_found === true,
    agent_trade_event: publicAgentTradeEvent(report?.agent_trade_event),
    spend_increased: report?.spend_increased === true,
    post_revoke: {
      action: report?.post_revoke?.action || null,
      code: report?.post_revoke?.code || null,
      execution_claimed: typeof postRevokeExecutionClaimed === 'boolean' ? postRevokeExecutionClaimed : null,
      final_policy_status: report?.post_revoke?.final_policy_status || null,
      final_runtime_state: report?.post_revoke?.final_runtime_state || null,
      chain_event_types: Array.isArray(report?.post_revoke?.chain_event_types) ? report.post_revoke.chain_event_types : [],
    },
    assertions,
  }
}

const STRICT_EXECUTION_REQUIRED_ASSERTIONS = [
  'G2-CREATE',
  'G2-ACTIVATE-MONITOR',
  'G2-EXECUTE',
  'G2-REVOKE',
  'G2-POST-REVOKE-NO-EXECUTION',
]

function strictExecutionMissingEvidence(report, assertions = []) {
  const evidence = executionReportEvidence(report)
  const missing = []
  if (evidence.purpose !== 'rescuegrid_demo_execution_report') missing.push('purpose')
  if (evidence.chain !== 'sui:testnet') missing.push('chain')
  if (evidence.require_execution !== true) missing.push('require_execution')
  if (!evidence.owner_address) missing.push('owner_address')
  if (!evidence.delegated_agent_address) missing.push('delegated_agent_address')
  if (!evidence.pool_id) missing.push('pool_id')
  if (!evidence.wrapper_id) missing.push('wrapper_id')
  if (!evidence.mandate_id) missing.push('mandate_id')
  if (!evidence.strategy_hash) missing.push('strategy_hash')
  if (!evidence.create_tx_digest || evidence.create_tx_status !== 'success') missing.push('create_tx_success')
  if (!evidence.revoke_tx_digest || evidence.revoke_tx_status !== 'success') missing.push('revoke_tx_success')
  for (const id of STRICT_EXECUTION_REQUIRED_ASSERTIONS) {
    if (!assertions.includes(id)) missing.push(`assertion:${id}`)
  }
  if (evidence.post_revoke.action !== 'stopped_revoked') missing.push('post_revoke_action')
  if (evidence.post_revoke.code !== 'POLICY_REVOKED') missing.push('post_revoke_code')
  if (evidence.post_revoke.execution_claimed !== false) missing.push('post_revoke_execution_unclaimed')
  if (evidence.post_revoke.final_policy_status !== 'revoked') missing.push('post_revoke_policy_revoked')
  if (evidence.post_revoke.final_runtime_state !== 'Revoked') missing.push('post_revoke_runtime_revoked')
  for (const eventType of ['PolicyCreated', 'AgentTradeExecuted', 'PolicyRevoked']) {
    if (!evidence.post_revoke.chain_event_types.includes(eventType)) missing.push(`chain_event:${eventType}`)
  }
  missing.push(...missingAgentTradeEventEvidence(evidence))
  if (
    evidence.agent_trade_event?.agent &&
    evidence.delegated_agent_address &&
    normalizeHexAnchor(evidence.agent_trade_event.agent) !== normalizeHexAnchor(evidence.delegated_agent_address)
  ) missing.push('agent_trade_event_agent')
  if (
    evidence.agent_trade_event?.pool_id &&
    evidence.pool_id &&
    normalizeHexAnchor(evidence.agent_trade_event.pool_id) !== normalizeHexAnchor(evidence.pool_id)
  ) missing.push('agent_trade_event_pool')
  return missing
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
  const missingLiveEvidence = strictExecutionMissingEvidence(report, assertions)
  if (
    report.phase === 'pass' &&
    hasExecutionAssertion &&
    executionClaimed &&
    txDigest &&
    eventProven &&
    spendProven &&
    tickExecuted &&
    missingLiveEvidence.length === 0
  ) {
    return check({
      id: 'strict_execution_evidence',
      label: 'AgentTradeExecuted strict execution evidence',
      status: 'passed',
      detail: 'strict demo execution report proves create, execute, revoke and post-revoke no-execution for one wrapper',
      evidence: executionReportEvidence(report),
    })
  }
  return check({
    id: 'strict_execution_evidence',
    label: 'AgentTradeExecuted strict execution evidence',
    status: 'failed',
    detail: 'execution report does not prove AgentTradeExecuted strict execution',
    blocker_codes: ['STRICT_EXECUTION_NOT_PROVEN'],
    evidence: {
      ...executionReportEvidence(report),
      missing_live_evidence: missingLiveEvidence,
    },
  })
}

function normalizeHexAnchor(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeDigestAnchor(value) {
  return String(value || '').trim()
}

function compareMissionAnchor({ field, walletValue, executionValue, hex = true }) {
  const normalize = hex ? normalizeHexAnchor : normalizeDigestAnchor
  const wallet = normalize(walletValue)
  const execution = normalize(executionValue)
  if (!wallet || !execution || wallet !== execution) {
    return {
      field,
      wallet: walletValue || null,
      execution: executionValue || null,
    }
  }
  return null
}

export function summarizeMissionContinuity(walletCheck, strictExecutionCheck) {
  if (walletCheck?.status !== 'passed' || strictExecutionCheck?.status !== 'passed') {
    return check({
      id: 'mission_same_policy_continuity',
      label: 'Same-policy browser wallet and execution evidence',
      status: 'blocked',
      detail: 'same-wrapper continuity cannot be checked until wallet and strict execution evidence both pass',
      evidence: {
        wallet_check_status: walletCheck?.status || null,
        strict_execution_check_status: strictExecutionCheck?.status || null,
      },
    })
  }
  const wallet = walletCheck.evidence || {}
  const execution = strictExecutionCheck.evidence || {}
  const mismatches = [
    compareMissionAnchor({ field: 'owner_address', walletValue: wallet.owner_address, executionValue: execution.owner_address }),
    compareMissionAnchor({ field: 'wrapper_id', walletValue: wallet.wrapper_id, executionValue: execution.wrapper_id }),
    compareMissionAnchor({ field: 'mandate_id', walletValue: wallet.mandate_id, executionValue: execution.mandate_id }),
    compareMissionAnchor({ field: 'strategy_hash', walletValue: wallet.strategy_hash, executionValue: execution.strategy_hash }),
    compareMissionAnchor({ field: 'create_tx_digest', walletValue: wallet.create_tx_digest, executionValue: execution.create_tx_digest, hex: false }),
    compareMissionAnchor({ field: 'revoke_tx_digest', walletValue: wallet.revoke_tx_digest, executionValue: execution.revoke_tx_digest, hex: false }),
  ].filter(Boolean)
  if (mismatches.length === 0) {
    return check({
      id: 'mission_same_policy_continuity',
      label: 'Same-policy browser wallet and execution evidence',
      status: 'passed',
      detail: 'wallet click-through and strict execution report describe the same owner-created wrapper lifecycle',
      evidence: {
        owner_address: wallet.owner_address,
        wrapper_id: wallet.wrapper_id,
        mandate_id: wallet.mandate_id,
        strategy_hash: wallet.strategy_hash,
        create_tx_digest: wallet.create_tx_digest,
        revoke_tx_digest: wallet.revoke_tx_digest,
      },
    })
  }
  return check({
    id: 'mission_same_policy_continuity',
    label: 'Same-policy browser wallet and execution evidence',
    status: 'failed',
    detail: 'wallet click-through evidence and strict execution report do not describe the same policy lifecycle',
    blocker_codes: ['MISSION_CONTINUITY_MISMATCH'],
    evidence: {
      wallet: {
        owner_address: wallet.owner_address || null,
        wrapper_id: wallet.wrapper_id || null,
        mandate_id: wallet.mandate_id || null,
        strategy_hash: wallet.strategy_hash || null,
        create_tx_digest: wallet.create_tx_digest || null,
        revoke_tx_digest: wallet.revoke_tx_digest || null,
      },
      execution: {
        owner_address: execution.owner_address || null,
        wrapper_id: execution.wrapper_id || null,
        mandate_id: execution.mandate_id || null,
        strategy_hash: execution.strategy_hash || null,
        create_tx_digest: execution.create_tx_digest || null,
        revoke_tx_digest: execution.revoke_tx_digest || null,
      },
      mismatches,
    },
  })
}

export function buildMissionReadinessReport({
  generatedAt = new Date().toISOString(),
  scripts = packageJson.scripts,
  walletReport = null,
  fundingReadiness = null,
  executionReport = null,
  safetyReport = null,
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
  const safetyCheck = summarizeSafetyNegativeEvidence(safetyReport)
  const walletCheck = summarizeWalletReport(walletReport)
  const fundingCheck = summarizeFundingReadiness(fundingReadiness)
  const strictExecutionCheck = summarizeStrictExecutionEvidence(executionReport, fundingCheck)
  const continuityCheck = summarizeMissionContinuity(walletCheck, strictExecutionCheck)
  const checks = [scriptCheck, safetyCheck, walletCheck, fundingCheck, strictExecutionCheck, continuityCheck]
  const blockers = checks.flatMap((row) => row.status === 'passed' ? [] : row.blocker_codes)
  const fullPrdReady = checks.every((row) => row.status === 'passed')
  const hasFailedCheck = checks.some((row) => row.status === 'failed')
  return {
    status: fullPrdReady ? 'ready' : hasFailedCheck ? 'failed' : 'blocked',
    purpose: 'rescuegrid_prd_mission_readiness',
    generated_at: generatedAt,
    chain: 'sui:testnet',
    full_prd_ready: fullPrdReady,
    execution_claimed: strictExecutionCheck.status === 'passed' && continuityCheck.status === 'passed',
    blocker_codes: blockers,
    checks,
    next_actions: fullPrdReady ? [] : nextActions({ safetyCheck, walletCheck, fundingCheck, strictExecutionCheck, continuityCheck }),
  }
}

function nextActions({ safetyCheck, walletCheck, fundingCheck, strictExecutionCheck, continuityCheck }) {
  const actions = []
  if (safetyCheck?.status !== 'passed') {
    actions.push('Run npm run safety:negative:report with a live local Worker to write .rescuegrid/safety-negative-report.json proving all required validate-plan blockers.')
  }
  if (walletCheck?.status !== 'passed') {
    actions.push('Run npm run wallet:evidence -- --format markdown --out .rescuegrid/wallet-clickthrough-evidence.md, then npm run wallet:evidence:preflight before the real Slush / standard Sui wallet flow. Create and activate the policy first, keep the same wrapper active for strict execution evidence before revoking it, then set Actual click-through completed: true, fill tx/object plus screenshot evidence fields, and run npm run wallet:evidence:verify -- --input .rescuegrid/wallet-clickthrough-evidence.md --require-worker.')
  }
  if (fundingCheck?.status !== 'passed') {
    actions.push('Send the DBUSDC/DEEP funding handoff to an external funding provider, then rerun npm run funding:watch -- --json and npm run funding:watch:report.')
  }
  if (fundingCheck?.status === 'passed' && strictExecutionCheck?.status !== 'passed') {
    actions.push('Run npm run demo:execute:report to write .rescuegrid/demo-execute-report.json proving create -> execute -> revoke -> post-revoke no-execution with structured AgentTradeExecuted evidence for the same wrapper/mandate/tick digest, execution_claimed=true and spend increase.')
  }
  if (continuityCheck?.status === 'failed') {
    actions.push('Rerun the browser wallet flow and strict demo execution evidence for the same owner-created wrapper so owner, wrapper, mandate, strategy hash and create/revoke tx digests match.')
  }
  return actions
}

async function loadWalletReport({ artifactPath, verifyWallet = verifyWalletEvidenceArtifact }) {
  if (!existsSync(artifactPath)) return null
  const artifactText = readFileSync(artifactPath, 'utf8')
  return verifyWallet({ artifactText, requireWorker: true })
}

async function loadFundingReadiness({ env = process.env, skipLiveFunding = false } = {}) {
  if (skipLiveFunding) return null
  const runtimeEnv = fundingHandoffEnv(env)
  return buildExecutionReadiness({
    env: runtimeEnv,
    chainData: requireChainDataProvider(runtimeEnv),
  })
}

function loadJsonReport(path) {
  if (!path || !existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function writeMissionReadinessArtifact(report, outPath = DEFAULT_MISSION_REPORT) {
  const resolved = resolve(String(outPath))
  mkdirSync(dirname(resolved), { recursive: true })
  writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return resolved
}

function help() {
  console.log(`Audit RescueGrid PRD mission readiness.

Usage:
  npm run mission:readiness
  npm run mission:readiness:report
  npm run mission:readiness -- --wallet-artifact .rescuegrid/wallet-clickthrough-evidence.md
  npm run mission:readiness -- --safety-report .rescuegrid/safety-negative-report.json
  npm run mission:readiness -- --execution-report .rescuegrid/demo-execute-report.json
  npm run mission:readiness -- --out .rescuegrid/mission-readiness-report.json
  npm run mission:readiness -- --skip-live-funding

This is read-only. It checks validation command registration, wallet click-through
evidence, live safety-negative evidence, execution funding readiness and strict
structured AgentTradeExecuted evidence. It does not create policies, submit PTBs, run
demo:execute or print secrets. --out writes the same report as a gitignored
artifact even when status is blocked.`)
}

export async function main(argv = process.argv.slice(2), env = process.env, options = {}) {
  const flags = parseArgs(argv)
  if (flags.has('--help') || flags.has('-h')) {
    help()
    return 0
  }
  const walletArtifact = resolve(String(flags.get('--wallet-artifact') || DEFAULT_WALLET_ARTIFACT))
  const safetyReportPath = resolve(String(flags.get('--safety-report') || DEFAULT_SAFETY_REPORT))
  const executionReportPath = resolve(String(flags.get('--execution-report') || DEFAULT_EXECUTION_REPORT))
  const reportOutPath = flags.get('--out') || flags.get('--report-out') || flags.get('--output') || null
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
  const safetyReport = options.safetyReport ?? loadJsonReport(safetyReportPath)
  const executionReport = options.executionReport ?? loadJsonReport(executionReportPath)
  const report = buildMissionReadinessReport({
    walletReport,
    fundingReadiness,
    executionReport,
    safetyReport,
  })
  if (reportOutPath) {
    writeMissionReadinessArtifact(report, reportOutPath)
  }
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
