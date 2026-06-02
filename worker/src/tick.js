// E7 — agent tick. runTick() adds chain I/O + (gated) execution around the
// shared Runtime Core. Allowed actions (docs §7):
// no_op | blocked | executed | stopped_revoked | stopped_expired | error.
import { DEPLOYMENT } from './sui-tx.js'
import { buildFundingReadiness } from './read-surfaces.js'
import { EXECUTOR_KIND_DEEPBOOK } from './executor-adapters.js'
import {
  SIGNER_CODE_WAAP_APPROVAL_DENIED,
  SIGNER_CODE_WAAP_APPROVAL_PENDING,
  SIGNER_CODE_WAAP_NO_DIGEST,
  SIGNER_CODE_WAAP_POLICY_BLOCKED,
  SIGNER_CODE_WAAP_RUNNER_MISSING,
  SIGNER_CODE_WAAP_TIMEOUT,
  resolveSignerAdapter,
  signerExecutionEnabled,
} from './signer-adapters.js'
import { requireChainDataProvider } from './chain-data-provider.js'
import {
  buildProposedTrade,
  classifyExecutionResolution,
  decideTick,
  executionNonSuccess,
  fundingReadinessBlock,
  prepareRuntimeExecution,
  readinessBlock,
} from './runtime-core.js'

export const SIGNER_SUBMISSION_BLOCKER_CODES = Object.freeze([
  SIGNER_CODE_WAAP_APPROVAL_PENDING,
  SIGNER_CODE_WAAP_APPROVAL_DENIED,
  SIGNER_CODE_WAAP_POLICY_BLOCKED,
  SIGNER_CODE_WAAP_TIMEOUT,
  SIGNER_CODE_WAAP_NO_DIGEST,
  SIGNER_CODE_WAAP_RUNNER_MISSING,
])

export {
  EXECUTION_BLOCKER_LABELS,
  buildProposedTrade,
  classifyExecutionResolution,
  decideTick,
  fundingReadinessBlock,
  prepareRuntimeExecution,
} from './runtime-core.js'

function resolveProviderFromSource(source, env) {
  if (source && typeof source.readWrapper === 'function') return source
  return requireChainDataProvider(env, { client: source })
}

export async function validateExecutionPlan(chainSource, {
  wrapperId,
  mandateId,
  proposed,
  nowMs = undefined,
  expectedAgentId,
  executorKind = EXECUTOR_KIND_DEEPBOOK,
}) {
  const chainData = resolveProviderFromSource(chainSource)
  const wrapper = await chainData.readWrapper(wrapperId)
  if (!wrapper) return { action: 'error', code: 'WRAPPER_NOT_FOUND', detail: 'Wrapper not found on-chain.', execution_claimed: false }

  const clockMs = nowMs ?? await chainData.readClockTimestampMs()
  if (!Number.isFinite(clockMs)) return { action: 'error', code: 'CLOCK_UNAVAILABLE', detail: 'Sui Clock timestamp was not readable.', execution_claimed: false }
  const planContext = await prepareRuntimeExecution({
    wrapperId,
    mandateId: mandateId ?? wrapper.mandate_id,
    wrapper,
    proposed,
    nowMs: clockMs,
    executorKind,
    constructionPath: 'Worker/API non-executing plan validation',
  })
  if (!planContext.ok) return planContext.result
  const expectedPoolId = planContext.expected_target_id
  const plan = planContext.execution_plan

  if (mandateId && mandateId !== wrapper.mandate_id) {
    const mandate = { id: mandateId, revoked: false, expires_at_ms: String(clockMs + 1), agent: wrapper.agent }
    const decision = decideTick({
      wrapper,
      mandate,
      triggerMet: true,
      proposed,
      nowMs: clockMs,
      executionEnabled: true,
      expectedAgentId,
      expectedPoolId,
    })
    return {
      ...decision,
      wrapper_id: wrapperId,
      mandate_id: mandateId,
      wrapper_mandate_id: wrapper.mandate_id,
      construction_path: 'Worker/API non-executing plan validation',
      chain_time_source: 'sui_clock_object_0x6',
      submitted: false,
      execution_claimed: false,
      executor_kind: executorKind,
      execution_plan: plan,
    }
  }

  const mandate = await chainData.readMandate(wrapper.mandate_id)
  if (!mandate) return { action: 'error', code: 'MANDATE_NOT_FOUND', detail: 'Mandate not found on-chain.', execution_claimed: false }
  const decision = decideTick({
    wrapper,
    mandate,
    triggerMet: true,
    proposed,
    nowMs: clockMs,
    executionEnabled: true,
    expectedAgentId,
    expectedPoolId,
  })
  const planDecision = decision.action === 'execute'
    ? { action: 'validated', readiness_state: 'ready', detail: 'Plan passed Guardian pre-submit validation; no transaction was submitted.', guardian: decision.guardian }
    : decision
  return {
    ...planDecision,
    wrapper_id: wrapperId,
    mandate_id: wrapper.mandate_id,
    construction_path: 'Worker/API non-executing plan validation',
    chain_time_source: 'sui_clock_object_0x6',
    submitted: false,
    execution_claimed: false,
    executor_kind: executorKind,
    execution_plan: plan,
  }
}

async function checkFunding(chainData, proposed, executionEnabled) {
  const [dbusdcBalance, deepBalance, suiBalance] = await Promise.all([
    chainData.readBalanceManagerBalance(DEPLOYMENT.deepbook.dbusdc_coin_type),
    chainData.readBalanceManagerBalance(DEPLOYMENT.deepbook.deep_coin_type),
    chainData.getAgentSuiGasBalance(DEPLOYMENT.agent.address),
  ])
  const funding = buildFundingReadiness({
    agentAddress: DEPLOYMENT.agent.address,
    balanceManagerId: DEPLOYMENT.agent.balance_manager_id,
    dbusdcBalance: dbusdcBalance.toString(),
    deepBalance: deepBalance.toString(),
    suiBalanceMist: String(suiBalance.totalBalance ?? '0'),
    executionEnabled,
    requiredDbusdcBalance: proposed.amount,
    requiredDeepBalance: '1',
    requiredSuiGasMist: '1',
  })
  return fundingReadinessBlock(funding)
}

function approvalStateForSignerCode(code) {
  if (code === SIGNER_CODE_WAAP_APPROVAL_PENDING) return 'pending'
  if (code === SIGNER_CODE_WAAP_APPROVAL_DENIED) return 'denied'
  if (code === SIGNER_CODE_WAAP_POLICY_BLOCKED) return 'policy_blocked'
  if (code === SIGNER_CODE_WAAP_TIMEOUT) return 'timeout'
  return null
}

export function signerSubmissionBlock(error, signerAdapter = {}) {
  const code = error?.code ? String(error.code) : null
  if (!SIGNER_SUBMISSION_BLOCKER_CODES.includes(code)) return null
  return readinessBlock({
    code,
    detail: `Execution blocked by ${signerAdapter.kind || 'signer'}: ${String(error?.message || code)}`,
    extra: {
      submitted: false,
      signer_kind: signerAdapter.kind || null,
      approval_state: approvalStateForSignerCode(code),
      execution_success_evidence: false,
    },
  })
}

/**
 * Full tick with chain reads + gated execution.
 * @param {object} env worker env (AGENT_KEY, EXECUTION_ENABLED, DEMO_MODE)
 * @param {object} p { wrapperId, forceTrigger, nowMs, market, executorKind, venueStops, riskControls, riskControlsUnavailable }
 * @returns {Promise<Record<string, any>>}
 */
export async function runTick(env, p) {
  const client = (await import('./sui-tx.js')).getClient()
  const chainData = requireChainDataProvider(env, { client })
  const nowMs = p.nowMs ?? await chainData.readClockTimestampMs() ?? Date.now()
  const wrapper = await chainData.readWrapper(p.wrapperId)
  if (!wrapper) return { action: 'error', code: 'WRAPPER_NOT_FOUND', detail: 'Wrapper not found on-chain.', execution_claimed: false }
  const mandate = await chainData.readMandate(wrapper.mandate_id)
  if (!mandate) return { action: 'error', code: 'MANDATE_NOT_FOUND', detail: 'Mandate not found on-chain.', execution_claimed: false }

  // Trigger: force_trigger (demo) or a real price-drop evaluation supplied by the caller.
  const triggerMet = !!p.forceTrigger || !!(p.market && p.market.triggerMet)
  const proposed = buildProposedTrade({ wrapper, market: p.market })
  const signerAdapter = resolveSignerAdapter(env, { client, ...(p.signerOptions || {}) })
  const executionEnabled = signerExecutionEnabled(env, signerAdapter)

  const executorKind = p.executorKind || EXECUTOR_KIND_DEEPBOOK
  const planContext = await prepareRuntimeExecution({
    wrapperId: p.wrapperId,
    mandateId: wrapper.mandate_id,
    wrapper,
    mandate,
    proposed,
    nowMs,
    market: p.market,
    executorKind,
    constructionPath: 'Runtime Core tick',
  })
  if (!planContext.ok) return planContext.result
  const adapter = planContext.adapter
  const expectedPoolId = planContext.expected_target_id
  const plan = planContext.execution_plan
  const venue = plan.venue || adapter.venue || executorKind
  const decision = decideTick({
    wrapper,
    mandate,
    triggerMet,
    proposed,
    nowMs,
    executionEnabled,
    expectedAgentId: DEPLOYMENT.agent.address,
    expectedPoolId,
    wrapperId: p.wrapperId,
    owner: wrapper.owner,
    venue,
    riskControls: p.riskControls || {},
    stoppedVenues: p.venueStops || [],
    riskControlsUnavailable: p.riskControlsUnavailable === true,
  })
  if (decision.action !== 'execute') {
    if (decision.code === 'EXECUTION_DISABLED' && env?.EXECUTION_ENABLED === 'true' && !signerAdapter.available && signerAdapter.unavailable_code !== 'EXECUTION_DISABLED') {
      return {
        ...readinessBlock({
          code: signerAdapter.unavailable_code,
          detail: signerAdapter.unavailable_detail,
        }),
        signer_kind: signerAdapter.kind,
        wrapper_id: p.wrapperId,
        mandate_id: wrapper.mandate_id,
      }
    }
    return { ...decision, wrapper_id: p.wrapperId, mandate_id: wrapper.mandate_id }
  }

  const fundingBlock = await checkFunding(chainData, proposed, executionEnabled)
  if (fundingBlock) {
    return { action: 'blocked', ...fundingBlock, wrapper_id: p.wrapperId, mandate_id: wrapper.mandate_id }
  }

  // execute: build + sign + submit (only reached when executionEnabled)
  try {
    const tx = adapter.buildPtb(plan, { wrapperId: p.wrapperId, mandateId: wrapper.mandate_id, wrapper, market: planContext.market_snapshot, nowMs })
    const submitted = await signerAdapter.signAndSubmit(tx, { showEffects: true, showEvents: true })
    if (!submitted.digest) {
      return {
        ...executionNonSuccess({
          detail: 'Execution submission did not return a transaction digest; no success is claimed.',
          submitted: false,
        }),
        wrapper_id: p.wrapperId,
        mandate_id: wrapper.mandate_id,
      }
    }

    let resolved = submitted
    try {
      if (typeof client.waitForTransaction === 'function') {
        resolved = await client.waitForTransaction({
          digest: submitted.digest,
          options: { showEffects: true, showEvents: true },
        })
      }
    } catch (e) {
      return {
        ...executionNonSuccess({
          detail: `Execution remains unresolved: Sui RPC did not resolve digest ${submitted.digest}. ${String(e?.message || e)}`,
          digest: submitted.digest,
          submitted: true,
        }),
        wrapper_id: p.wrapperId,
        mandate_id: wrapper.mandate_id,
      }
    }

    let afterWrapper = null
    try {
      afterWrapper = await chainData.readWrapper(p.wrapperId)
    } catch {
      afterWrapper = null
    }
    const result = classifyExecutionResolution({
      submitted,
      resolved,
      beforeWrapper: wrapper,
      afterWrapper,
      wrapperId: p.wrapperId,
    })
    return { ...result, adapter_result: adapter.parseExecutionResult(result), wrapper_id: p.wrapperId, mandate_id: wrapper.mandate_id }
  } catch (e) {
    const signerBlock = signerSubmissionBlock(e, signerAdapter)
    if (signerBlock) {
      return {
        ...signerBlock,
        wrapper_id: p.wrapperId,
        mandate_id: wrapper.mandate_id,
      }
    }
    return {
      ...executionNonSuccess({
        detail: `Execution submission error: ${String(e?.message || e)}`,
        submitted: false,
      }),
      wrapper_id: p.wrapperId,
      mandate_id: wrapper.mandate_id,
    }
  }
}
