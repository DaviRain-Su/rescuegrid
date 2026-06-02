// Shared RescueGrid Runtime Core.
//
// Cloud Worker ticks and the local daemon both use this module for the pure
// state machine, adapter selection, execution-plan preparation and execution
// result classification. Chain I/O, signing and log persistence stay in their
// runtime-specific callers.
import { runGuardian } from './guardian.js'
import { EXECUTOR_KIND_DEEPBOOK, getExecutorAdapter, listExecutorAdapters, unsupportedExecutor, unsupportedExecutorTarget } from './executor-adapters.js'
import { isGlobalStopped, isStrategyStopped, isVenueStopped, normalizeVenueKey } from './risk-controls.js'

export const RUNTIME_CORE_BOUNDARIES = Object.freeze({
  policy_reader: 'Loads MoveGate Mandate + RescuePolicyWrapper snapshots before a tick.',
  guardian: 'Checks Mandate, Wrapper, proposed trade and time before any PTB is submitted.',
  executor_adapter_registry: 'Selects protocol adapters and prepares unsigned execution plans.',
  activity_writer: 'Persists runtime-local activity without becoming chain authority.',
})

export function runtimeCoreStatus() {
  return {
    boundaries: RUNTIME_CORE_BOUNDARIES,
    registered_adapters: listExecutorAdapters(),
  }
}

export const EXECUTION_BLOCKER_LABELS = {
  EXECUTION_DISABLED: 'Execution disabled',
  UNSUPPORTED_SIGNER: 'Unsupported signer',
  INSUFFICIENT_DBUSDC: 'Insufficient DBUSDC',
  INSUFFICIENT_DEEP: 'Insufficient DEEP',
  INSUFFICIENT_GAS: 'Insufficient SUI gas',
  TRIGGER_NOT_MET: 'Trigger not met',
  POLICY_REVOKED: 'Policy revoked',
  POLICY_EXPIRED: 'Policy expired',
  OVER_BUDGET: 'Over budget',
  OVER_SLIPPAGE: 'Over slippage',
  WRONG_POOL: 'Wrong pool',
  WRONG_AGENT: 'Wrong agent',
  MANDATE_MISMATCH: 'Mandate/wrapper mismatch',
  EXECUTION_FAILED: 'Execution failed',
  UNRESOLVED_TRANSACTION: 'Unresolved transaction',
  INVALID_AUTHORIZATION: 'Invalid authorization',
  FORCE_TRIGGER_DISABLED: 'Force trigger disabled',
  UNSUPPORTED_EXECUTOR: 'Unsupported executor',
  UNSUPPORTED_EXECUTOR_TARGET: 'Unsupported executor target',
  GLOBAL_STOPPED: 'Global emergency stop',
  STRATEGY_STOPPED: 'Strategy emergency stop',
  VENUE_STOPPED: 'Venue emergency stop',
  RISK_CONTROLS_UNAVAILABLE: 'Risk controls unavailable',
}

function blockerLabel(code) {
  return EXECUTION_BLOCKER_LABELS[code] ?? code
}

export function readinessBlock({ action = 'blocked', code, detail, extra = {} }) {
  return {
    action,
    code,
    blocker_code: code,
    blocker_label: blockerLabel(code),
    blocker_codes: [code],
    blocker_labels: [blockerLabel(code)],
    readiness_state: action === 'no_op' ? 'monitoring' : 'blocked',
    execution_claimed: false,
    detail,
    ...extra,
  }
}

export function executionNonSuccess({ code = 'UNRESOLVED_TRANSACTION', detail, digest, submitted = false, extra = {} }) {
  return readinessBlock({
    action: 'error',
    code,
    detail,
    extra: {
      submitted,
      tx_digest: digest,
      readiness_state: 'blocked',
      execution_success_evidence: false,
      ...extra,
    },
  })
}

function toBigIntOrNull(value) {
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

function tradeEventsForWrapper(events, wrapperId) {
  return (events || []).filter((e) => {
    if (!String(e.type || '').endsWith('::policy::AgentTradeExecuted')) return false
    const eventWrapper = e.parsedJson?.wrapper_id ?? e.data?.wrapper_id
    return eventWrapper === wrapperId
  })
}

export function classifyExecutionResolution({ submitted, resolved, beforeWrapper, afterWrapper, wrapperId }) {
  const evidence = resolved ?? submitted ?? {}
  const digest = evidence.digest ?? submitted?.digest
  const status = evidence.effects?.status?.status
  if (status !== 'success') {
    const error = evidence.effects?.status?.error
    return executionNonSuccess({
      code: 'EXECUTION_FAILED',
      detail: `Execution failed: ${error || status || 'Sui RPC did not return successful effects.'}`,
      digest,
      submitted: Boolean(digest),
      extra: {
        effects_status: status ?? null,
      },
    })
  }

  const events = tradeEventsForWrapper(evidence.events, wrapperId)
  const beforeSpent = toBigIntOrNull(beforeWrapper?.spent_amount)
  const afterSpent = toBigIntOrNull(afterWrapper?.spent_amount)
  const spendIncreased = beforeSpent != null && afterSpent != null && afterSpent > beforeSpent
  const hasTradeEvent = events.length > 0

  if (!hasTradeEvent || !spendIncreased) {
    return executionNonSuccess({
      code: 'UNRESOLVED_TRANSACTION',
      detail: 'Execution remains unresolved: successful effects alone are not accepted without AgentTradeExecuted event evidence and an on-chain spend increase.',
      digest,
      submitted: Boolean(digest),
      extra: {
        effects_status: status,
        agent_trade_event_found: hasTradeEvent,
        spend_increased: spendIncreased,
        spend_before: beforeWrapper?.spent_amount ?? null,
        spend_after: afterWrapper?.spent_amount ?? null,
      },
    })
  }

  return {
    action: 'executed',
    detail: 'Rescue order executed with resolved Sui success, AgentTradeExecuted event, and on-chain spend increase.',
    tx_digest: digest,
    submitted: true,
    readiness_state: 'executed',
    execution_claimed: true,
    execution_success_evidence: true,
    effects_status: status,
    agent_trade_event_found: true,
    spend_increased: true,
    spend_before: beforeWrapper.spent_amount,
    spend_after: afterWrapper.spent_amount,
    spend_delta: (afterSpent - beforeSpent).toString(),
  }
}

/**
 * Pure decision. No I/O.
 * @param {object} a
 * @param {{mandate_id:string,pool_id:string,budget_ceiling:string,spent_amount:string,max_slippage_bps:number,agent?:string}} a.wrapper
 * @param {{id:string,revoked:boolean,expires_at_ms:number|string,agent?:string}} a.mandate
 * @param {boolean} a.triggerMet
 * @param {{pool_id:string,amount:string,estimated_slippage_bps:number,agent_id?:string}} a.proposed
 * @param {number} a.nowMs
 * @param {boolean} a.executionEnabled
 * @param {string=} a.expectedAgentId
 * @param {string=} a.expectedPoolId
 * @param {string=} a.wrapperId
 * @param {string=} a.owner
 * @param {string=} a.venue
 * @param {Array<string|object>=} a.stoppedVenues
 * @param {{globalStops?:Array<string|object>,strategyStops?:Array<string|object>,venueStops?:Array<string|object>}=} a.riskControls
 * @param {boolean=} a.riskControlsUnavailable
 * @returns {{action:string, reason?:number, detail:string, guardian?:object}}
 */
export function decideTick({ wrapper, mandate, triggerMet, proposed, nowMs, executionEnabled, expectedAgentId, expectedPoolId, wrapperId, owner, venue, stoppedVenues = [], riskControls = {}, riskControlsUnavailable = false }) {
  if (mandate.revoked) return readinessBlock({ action: 'stopped_revoked', code: 'POLICY_REVOKED', detail: 'Mandate revoked on-chain; halting.' })
  if (nowMs >= Number(mandate.expires_at_ms)) return readinessBlock({ action: 'stopped_expired', code: 'POLICY_EXPIRED', detail: 'Mandate expired; halting.' })
  if (expectedAgentId && (wrapper.agent !== expectedAgentId || mandate.agent !== expectedAgentId)) {
    return readinessBlock({ code: 'WRONG_AGENT', detail: 'Execution blocked: policy agent does not match the configured RescueGrid agent.' })
  }
  if (expectedPoolId && wrapper.pool_id !== expectedPoolId) {
    return readinessBlock({ code: 'WRONG_POOL', detail: 'Execution blocked: policy pool is outside the configured execution scope.' })
  }
  if (!triggerMet) return readinessBlock({ action: 'no_op', code: 'TRIGGER_NOT_MET', detail: 'Trigger condition not met; monitoring.' })
  if (riskControlsUnavailable) {
    return readinessBlock({
      code: 'RISK_CONTROLS_UNAVAILABLE',
      detail: 'Execution blocked: runtime risk controls could not be read before preparing a transaction.',
    })
  }
  const controlOwner = owner || wrapper.owner || null
  const globalStops = riskControls.globalStops || riskControls.global_stops || []
  const strategyStops = riskControls.strategyStops || riskControls.strategy_stops || []
  const venueControlStops = riskControls.venueStops || riskControls.venue_stops || stoppedVenues
  if (isGlobalStopped(controlOwner, globalStops)) {
    return readinessBlock({
      code: 'GLOBAL_STOPPED',
      detail: 'Execution blocked: owner global emergency stop is active.',
      extra: {
        owner: controlOwner,
      },
    })
  }
  if (wrapperId && isStrategyStopped(wrapperId, strategyStops, controlOwner)) {
    return readinessBlock({
      code: 'STRATEGY_STOPPED',
      detail: `Execution blocked: strategy emergency stop is active for ${wrapperId}.`,
      extra: {
        owner: controlOwner,
        wrapper_id: wrapperId,
        stopped_strategies: strategyStops,
      },
    })
  }
  if (venue && isVenueStopped(venue, venueControlStops, controlOwner)) {
    return readinessBlock({
      code: 'VENUE_STOPPED',
      detail: `Execution blocked: ${venue} venue emergency stop is active.`,
      extra: {
        owner: controlOwner,
        venue,
        venue_key: normalizeVenueKey(venue),
        stopped_venues: venueControlStops,
      },
    })
  }

  const guardian = runGuardian({ mandate, wrapper, proposed, nowMs })
  if (guardian.decision === 'block') {
    return readinessBlock({
      code: guardian.code ?? 'UNRESOLVED_TRANSACTION',
      detail: `Guardian blocked: ${guardian.label} — ${guardian.detail}`,
      extra: { reason: guardian.reason, guardian },
    })
  }
  if (!executionEnabled) {
    return readinessBlock({
      code: 'EXECUTION_DISABLED',
      detail: 'Execution blocked: EXECUTION_ENABLED is false or the agent key is unavailable; usable DBUSDC/DEEP funding must be verified before live execution.',
      extra: { guardian },
    })
  }
  return { action: 'execute', detail: 'Trigger met + Guardian passed; executing rescue order.', guardian }
}

/** Per-trade amount: one rung = budget/5, capped at remaining budget. */
export function perTradeAmount(wrapper) {
  const ceiling = BigInt(wrapper.budget_ceiling)
  const spent = BigInt(wrapper.spent_amount)
  const remaining = ceiling > spent ? ceiling - spent : 0n
  const rung = ceiling / 5n
  return (rung < remaining ? rung : remaining)
}

export function buildProposedTrade({ wrapper, market }) {
  const amount = perTradeAmount(wrapper)
  return {
    pool_id: wrapper.pool_id,
    amount: amount.toString(),
    estimated_slippage_bps: market?.estimated_slippage_bps ?? Math.min(80, wrapper.max_slippage_bps),
  }
}

export function fundingReadinessBlock(funding) {
  const blockers = funding?.execution_blockers ?? funding?.blockers ?? []
  if (blockers.length === 0) return null
  const primary = funding.funding_blockers?.[0] ?? blockers[0]
  return {
    code: primary.code,
    detail: `Execution blocked: ${blockers.map((b) => b.label).join('; ')}.`,
    balances: {
      dbusdc: funding.balances.DBUSDC,
      deep: funding.balances.DEEP,
      sui_mist: funding.balances.SUI_MIST,
      dbusdc_required: funding.thresholds.DBUSDC.required,
      deep_required: funding.thresholds.DEEP.required,
      sui_mist_required: funding.thresholds.SUI_MIST.required,
    },
    funding,
    execution_claimed: false,
    blocker_codes: funding.execution_blocker_codes ?? funding.blocker_codes,
    blocker_labels: funding.execution_blocker_labels ?? funding.blocker_labels,
  }
}

export async function prepareRuntimeExecution({
  wrapperId,
  mandateId,
  wrapper,
  mandate,
  proposed,
  nowMs,
  market,
  executorKind = EXECUTOR_KIND_DEEPBOOK,
  constructionPath = 'Runtime Core',
}) {
  const adapter = getExecutorAdapter(executorKind)
  if (!adapter) {
    return {
      ok: false,
      result: {
        ...unsupportedExecutor(executorKind),
        wrapper_id: wrapperId,
        mandate_id: mandateId ?? null,
        construction_path: constructionPath,
        submitted: false,
        execution_claimed: false,
      },
    }
  }

  const marketSnapshot = await adapter.readMarket({ wrapper, mandate, proposed, nowMs, market })
  const plan = await adapter.planExecution({ wrapper, mandate, proposed, nowMs, market: marketSnapshot })
  if (!plan.target_supported) {
    return {
      ok: false,
      result: {
        ...unsupportedExecutorTarget(executorKind, adapter.targetId(wrapper)),
        wrapper_id: wrapperId,
        mandate_id: mandateId ?? wrapper.mandate_id,
        construction_path: constructionPath,
        submitted: false,
        execution_claimed: false,
        execution_plan: plan,
      },
    }
  }

  return {
    ok: true,
    adapter,
    executor_kind: executorKind,
    expected_target_id: adapter.targetId(wrapper),
    market_snapshot: marketSnapshot,
    execution_plan: plan,
  }
}
