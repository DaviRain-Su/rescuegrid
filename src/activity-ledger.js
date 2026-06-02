export function evidenceRowsFor(a = {}) {
  const structured = Array.isArray(a.execution_blockers) && a.execution_blockers.length
    ? a.execution_blockers
    : Array.isArray(a.blockers) && a.blockers.length
      ? a.blockers
      : []
  if (structured.length) return structured
  return (Array.isArray(a.blocker_codes) ? a.blocker_codes : []).map((code, i) => ({
    code,
    label: a.blocker_labels?.[i] || code,
    observed: null,
    required: null,
  }))
}

export function signerBlockerCodesFor(a = {}) {
  return (Array.isArray(a.blocker_codes) ? a.blocker_codes : [])
    .map((code) => String(code))
    .filter((code) => /^WAAP_|^SIGNER_|^INVALID_SIGNER_SECRET$|^UNSUPPORTED_SIGNER$/.test(code))
}

export function signerEvidenceRowsFor(a = {}) {
  const rows = []
  const signerCodes = signerBlockerCodesFor(a)
  if (a.signer_kind) {
    rows.push({ label: 'Signer', value: a.signer_kind, color: 'var(--sui)' })
  }
  if (a.approval_state) {
    rows.push({ label: 'Approval state', value: a.approval_state, color: 'var(--warn)' })
  }
  if (signerCodes.length > 0) {
    rows.push({ label: 'Signer code', value: signerCodes.join(', '), color: 'var(--danger)' })
  }
  return rows
}

const STRATEGY_LABELS = {
  'rescue-grid': 'Rescue Grid',
  dca: 'DCA Ladder',
  hedge: 'Hedge',
  'funding-arb': 'Funding / Perps',
  'spot-arb': 'Spot Spread',
  'lp-manage': 'LP Manager',
  lending: 'Yield Router',
}

const VENUE_MATCHERS = [
  ['Bluefin Pro', /bluefin pro|sui-perp|perp hedge|funding/i],
  ['Bluefin Spot', /bluefin spot/i],
  ['DeepBook', /deepbook|deepbook v3|clob|grid rung|dca|rescue grid/i],
  ['Cetus', /cetus/i],
  ['Turbos', /turbos/i],
  ['Momentum', /momentum/i],
  ['Scallop', /scallop/i],
  ['NAVI', /\bnavi\b/i],
  ['Suilend', /suilend/i],
  ['AlphaLend', /alphalend/i],
  ['Sui policy', /policy authority|mandate|wrapper|revoked/i],
]

export function policyLookup(policies = []) {
  const byName = new Map()
  const byId = new Map()
  ;(policies || []).forEach((p) => {
    if (p?.name) byName.set(String(p.name), p)
    if (p?.id) byId.set(String(p.id), p)
    if (p?._wrapperId) byId.set(String(p._wrapperId), p)
  })
  return { byName, byId }
}

export function inferStrategy(a = {}, lookup = policyLookup()) {
  const p = lookup.byName.get(String(a.policy || '')) || lookup.byId.get(String(a.wrapper_id || '')) || lookup.byId.get(String(a.policy_id || ''))
  const id = a.strategy || p?.strategy || (
    /dca|accumulation/i.test(`${a.policy} ${a.title}`) ? 'dca'
    : /funding|perp/i.test(`${a.policy} ${a.title} ${a.detail}`) ? 'funding-arb'
    : /spread|arb/i.test(`${a.policy} ${a.title} ${a.detail}`) ? 'spot-arb'
    : /lp|range/i.test(`${a.policy} ${a.title} ${a.detail}`) ? 'lp-manage'
    : /lend|yield/i.test(`${a.policy} ${a.title} ${a.detail}`) ? 'lending'
    : /hedge/i.test(`${a.policy} ${a.title} ${a.detail}`) ? 'hedge'
    : 'rescue-grid'
  )
  return { id, label: STRATEGY_LABELS[id] || id || 'Strategy' }
}

export function inferVenue(a = {}) {
  const explicit = a.venue || a.protocol || a.adapter || a.venue_name
  if (explicit) return String(explicit)
  const hay = `${a.policy || ''} ${a.title || ''} ${a.detail || ''} ${a.chain_event || ''}`
  const hit = VENUE_MATCHERS.find(([, re]) => re.test(hay))
  return hit ? hit[0] : 'Sui venue'
}

export function outcomeOfActivity(a = {}) {
  if (a.kind === 'guardian' || a.kind === 'fail') return 'blocked'
  if (a.kind === 'monitor') return 'planned'
  return 'executed'
}

export function statusOfActivity(a = {}, outcome = outcomeOfActivity(a)) {
  if (a.kind === 'retry') return { id: 'retry', label: 'Retry' }
  if (a.kind === 'fail') return { id: 'failed', label: 'Failed' }
  if (outcome === 'blocked') return { id: 'blocked', label: 'Guardian block' }
  if (outcome === 'planned') return { id: 'planned', label: 'No action' }
  if (a.kind === 'policy') return { id: 'policy', label: 'Policy' }
  return { id: 'executed', label: 'Executed' }
}

export function approvalOfActivity(a = {}) {
  if (a.requireApproval || a.requires_approval || a.human_approval_required) return 'required'
  if (a.approval_state && a.approval_state !== 'not-required') return 'required'
  if ((Array.isArray(a.blocker_codes) ? a.blocker_codes : []).some((code) => String(code).startsWith('WAAP_APPROVAL_'))) return 'required'
  if (/approve|approval|sign-off|supervised|awaiting/i.test(`${a.title || ''} ${a.detail || ''}`)) return 'required'
  return 'not-required'
}

export function txOrOrderId(a = {}) {
  const txId = a.tx_digest || a.tx || null
  const orderId = a.order_id || a.venue_order_id || a.client_order_id || a.orderId || null
  return { txId, orderId }
}

export function makeLedgerRow(a = {}, i = 0, lookup = policyLookup()) {
  const outcome = outcomeOfActivity(a)
  const status = statusOfActivity(a, outcome)
  const strategy = inferStrategy(a, lookup)
  const venue = inferVenue(a)
  const approval = approvalOfActivity(a)
  const ids = txOrOrderId(a)
  const hasGuardianBlock = outcome === 'blocked' || evidenceRowsFor(a).length > 0
  const hasSignerBlock = signerEvidenceRowsFor(a).length > 0
  return {
    activity: a,
    key: a.id || a.dedupe_key || ids.txId || `${a.t}-${a.title}-${i}`,
    outcome,
    status,
    strategy,
    venue,
    approval,
    hasGuardianBlock,
    hasSignerBlock,
    plannedExecuted: outcome === 'executed' ? 'executed' : outcome === 'blocked' ? 'blocked' : 'planned',
    ...ids,
  }
}
