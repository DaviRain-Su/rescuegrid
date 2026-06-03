const FORBIDDEN_POLICY_INSPECT_PATTERNS = [
  /\bAgentPolicy\b/i,
  /\bAgentCap\b/i,
  /\bsponsored[-\s]?gas\b/i,
  /\bgas[-\s]?sponsor/i,
]

export function isLiveInspectSource(source = null) {
  return (source?.kind || 'demo') !== 'demo'
}

export function policyInspectCopy(source = null) {
  const live = isLiveInspectSource(source)
  return {
    live,
    objectLabel: live ? 'MoveGate Mandate + RescuePolicyWrapper' : 'Demo policy-shaped object',
    budgetLabel: live ? 'On-chain budget ceiling' : 'Demo budget ceiling',
    structLabel: live ? 'RescuePolicyWrapper · Move shared object' : 'Demo wrapper shape · move-like',
    auditLabelPrefix: live ? 'Audit trail' : 'Demo audit trail',
    auditEventNoun: live ? 'on-chain events' : 'simulated events',
    budgetCopy: live
      ? 'The wrapper checks cumulative spent_amount against budget_ceiling before recording an agent trade. Exceeding the cap aborts the transaction on-chain.'
      : 'This budget is local demo state. It previews the cap a real RescuePolicyWrapper would enforce after minting.',
    capabilityCopy: live
      ? 'MoveGate authorizes only the RescueGrid protocol/action, and the wrapper then enforces pool, budget, slippage and linked mandate constraints.'
      : 'The demo shape previews MoveGate + Wrapper constraints. Real enforcement comes from the shared objects once minted.',
    ownerSigningTitle: live ? 'Owner signs create/revoke only' : 'Owner-signing model',
    ownerSigningCopy: live
      ? 'The Worker builds unsigned tx_json; your wallet signs create/revoke. The agent never receives your owner key.'
      : 'Demo mode previews the owner-signed create/revoke path. No authority exists until a real wallet signs the policy transaction.',
    agentGasTitle: live ? 'Agent gas is explicit' : 'Execution gas model',
    agentGasCopy: live
      ? 'Autonomous execution needs the deployment agent to hold SUI gas plus funded DeepBook BalanceManager inventory; readiness checks block when either is missing.'
      : 'Demo mode spends no gas. Live execution requires agent gas and funded BalanceManager inventory.',
    triggerTitle: live ? 'Runtime watches DeepBook market data' : 'Trigger model',
    triggerCopy: live
      ? 'The Durable Object monitors the SUI/DBUSDC feed, then Guardian and the wrapper enforce budget, pool, slippage, revocation and expiry before submission.'
      : 'Demo mode previews the same trigger shape. Live checks rely on Worker market reads plus on-chain Mandate/Wrapper enforcement.',
    emptyActivityCopy: live ? 'No on-chain events yet - the agent is monitoring.' : 'No simulated events yet in this demo policy.',
  }
}

export function policyInspectCopyText(copy = policyInspectCopy()) {
  return Object.values(copy)
    .filter((value) => typeof value === 'string')
    .join('\n')
}

export function forbiddenPolicyInspectTerms(text) {
  return FORBIDDEN_POLICY_INSPECT_PATTERNS
    .filter((pattern) => pattern.test(String(text || '')))
    .map((pattern) => pattern.source)
}
