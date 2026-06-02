// E7 — decideTick state-machine unit tests (docs §8 / §7 actions).
import { buildFundingReadiness } from '../src/read-surfaces.js'
import { classifyExecutionResolution, decideTick, fundingReadinessBlock } from '../src/tick.js'

let fail = 0
const check = (name, got, want) => {
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${got}, want ${want})`}`)
}

const MID = '0xMANDATE'
const OWNER = '0x1111111111111111111111111111111111111111111111111111111111111111'
const AGENT = '0xAGENT'
const POOL = '0xPOOL'
const base = {
  wrapper: { mandate_id: MID, agent: AGENT, pool_id: POOL, budget_ceiling: '1000000', spent_amount: '0', max_slippage_bps: 100 },
  mandate: { id: MID, agent: AGENT, revoked: false, expires_at_ms: 10_000 },
  triggerMet: true,
  proposed: { pool_id: POOL, amount: '100000', estimated_slippage_bps: 50 },
  nowMs: 1_000,
  executionEnabled: true,
}
const run = (o) => decideTick({ ...base, ...o })

check('revoked -> stopped_revoked', run({ mandate: { id: MID, revoked: true, expires_at_ms: 10_000 } }).action, 'stopped_revoked')
check('revoked exposes stable code', run({ mandate: { id: MID, revoked: true, expires_at_ms: 10_000 } }).code, 'POLICY_REVOKED')
check('expired -> stopped_expired', run({ nowMs: 20_000 }).action, 'stopped_expired')
check('expired exposes stable code', run({ nowMs: 20_000 }).code, 'POLICY_EXPIRED')
check('no trigger -> no_op', run({ triggerMet: false }).action, 'no_op')
check('no trigger exposes stable code', run({ triggerMet: false }).code, 'TRIGGER_NOT_MET')
check('no trigger never claims execution', run({ triggerMet: false }).execution_claimed, false)
check('stopped venue does not spam before trigger', run({ triggerMet: false, venue: 'DeepBook', stoppedVenues: ['DeepBook'] }).action, 'no_op')
check('stopped venue -> blocked when trigger fires', run({ venue: 'DeepBook', stoppedVenues: ['DeepBook'] }).action, 'blocked')
check('stopped venue exposes stable code', run({ venue: 'DeepBook', stoppedVenues: ['DeepBook'] }).code, 'VENUE_STOPPED')
check('stopped venue never claims execution', run({ venue: 'DeepBook', stoppedVenues: ['DeepBook'] }).execution_claimed, false)
check('risk controls unavailable blocks triggered execution', run({ riskControlsUnavailable: true }).code, 'RISK_CONTROLS_UNAVAILABLE')
check('wrong agent -> blocked', run({ expectedAgentId: AGENT, wrapper: { ...base.wrapper, agent: '0xOTHER' } }).action, 'blocked')
check('wrong agent exposes stable code', run({ expectedAgentId: AGENT, wrapper: { ...base.wrapper, agent: '0xOTHER' } }).code, 'WRONG_AGENT')
check('wrong pool -> blocked', run({ expectedPoolId: POOL, wrapper: { ...base.wrapper, pool_id: '0xBAD' } }).action, 'blocked')
check('wrong pool exposes stable code', run({ expectedPoolId: POOL, wrapper: { ...base.wrapper, pool_id: '0xBAD' } }).code, 'WRONG_POOL')
check('guardian block -> blocked', run({ proposed: { pool_id: POOL, amount: '100000', estimated_slippage_bps: 150 } }).action, 'blocked')
check('guardian block exposes stable code', run({ proposed: { pool_id: POOL, amount: '100000', estimated_slippage_bps: 150 } }).code, 'OVER_SLIPPAGE')
const safetyCases = [
  ['over-budget plan', { proposed: { pool_id: POOL, amount: '1000001', estimated_slippage_bps: 50 } }, 'OVER_BUDGET'],
  ['over-slippage plan', { proposed: { pool_id: POOL, amount: '100000', estimated_slippage_bps: 101 } }, 'OVER_SLIPPAGE'],
  ['proposed wrong pool plan', { proposed: { pool_id: '0xBAD', amount: '100000', estimated_slippage_bps: 50 } }, 'WRONG_POOL'],
  ['proposed wrong agent plan', { proposed: { pool_id: POOL, amount: '100000', estimated_slippage_bps: 50, agent_id: '0xOTHER' } }, 'WRONG_AGENT'],
  ['mandate-wrapper mismatch plan', { wrapper: { ...base.wrapper, mandate_id: '0xOTHER' } }, 'MANDATE_MISMATCH'],
]
for (const [name, override, code] of safetyCases) {
  const decision = run(override)
  check(`${name} -> blocked before submission`, decision.action, 'blocked')
  check(`${name} exposes ${code}`, decision.code, code)
  check(`${name} never claims execution`, decision.execution_claimed, false)
}
check('trigger+pass+enabled -> execute', run({}).action, 'execute')
const disabled = run({ executionEnabled: false })
check('trigger+pass+disabled -> blocked (gated)', disabled.action, 'blocked')
check('disabled gate uses stable code', disabled.code, 'EXECUTION_DISABLED')
// precedence: revoked before trigger/execute
check('revoked beats execute', run({ mandate: { id: MID, revoked: true, expires_at_ms: 10_000 }, executionEnabled: true }).action, 'stopped_revoked')

const unfundedDisabled = fundingReadinessBlock(buildFundingReadiness({
  agentAddress: OWNER,
  balanceManagerId: '0xBALANCEMANAGER',
  dbusdcBalance: '0',
  deepBalance: '0',
  suiBalanceMist: '1000000',
  executionEnabled: false,
  requiredDbusdcBalance: '100000',
  requiredDeepBalance: '1',
  requiredSuiGasMist: '1',
}))
check('funding block prefers missing DBUSDC as primary blocker', unfundedDisabled.code, 'INSUFFICIENT_DBUSDC')
check('funding block includes disabled flag', unfundedDisabled.blocker_codes.includes('EXECUTION_DISABLED'), true)
check('funding block includes missing DEEP', unfundedDisabled.blocker_codes.includes('INSUFFICIENT_DEEP'), true)
check('funding block never claims execution', unfundedDisabled.execution_claimed, false)

const WRAPPER_ID = '0xWRAP'
const beforeWrapper = { spent_amount: '0' }
const afterUnchangedWrapper = { spent_amount: '0' }
const afterSpentWrapper = { spent_amount: '100000' }
const failedDigest = classifyExecutionResolution({
  submitted: { digest: 'failed-digest', effects: { status: { status: 'failure', error: 'MoveAbort' } } },
  beforeWrapper,
  afterWrapper: afterUnchangedWrapper,
  wrapperId: WRAPPER_ID,
})
check('failed execution digest remains error', failedDigest.action, 'error')
check('failed execution digest uses stable failure code', failedDigest.code, 'EXECUTION_FAILED')
check('failed execution digest is submitted but not claimed', failedDigest.submitted, true)
check('failed execution digest never claims execution', failedDigest.execution_claimed, false)

const successWithoutEvidence = classifyExecutionResolution({
  submitted: { digest: 'unresolved-digest', effects: { status: { status: 'success' } } },
  resolved: { digest: 'unresolved-digest', effects: { status: { status: 'success' } }, events: [] },
  beforeWrapper,
  afterWrapper: afterUnchangedWrapper,
  wrapperId: WRAPPER_ID,
})
check('success effects without event/spend remains error', successWithoutEvidence.action, 'error')
check('success effects without event/spend is unresolved', successWithoutEvidence.code, 'UNRESOLVED_TRANSACTION')
check('success effects without event/spend never claims execution', successWithoutEvidence.execution_claimed, false)

const resolvedSuccess = classifyExecutionResolution({
  submitted: { digest: 'success-digest', effects: { status: { status: 'success' } } },
  resolved: {
    digest: 'success-digest',
    effects: { status: { status: 'success' } },
    events: [{ type: '0x1::policy::AgentTradeExecuted', parsedJson: { wrapper_id: WRAPPER_ID } }],
  },
  beforeWrapper,
  afterWrapper: afterSpentWrapper,
  wrapperId: WRAPPER_ID,
})
check('resolved success with event and spend is executed', resolvedSuccess.action, 'executed')
check('resolved success can claim execution', resolvedSuccess.execution_claimed, true)
check('resolved success records spend delta', resolvedSuccess.spend_delta, '100000')

console.log(fail === 0 ? '\nALL TICK TESTS PASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
