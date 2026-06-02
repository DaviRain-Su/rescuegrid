export const MAX_RUNTIME_ACTIVITY = 50

const ACTION_META = {
  activated: {
    kind: 'policy',
    title: 'Agent runtime activated',
    detail: 'Durable Object runtime registered this policy and scheduled autonomous ticks.',
  },
  no_op: {
    kind: 'monitor',
    title: 'Agent tick · no action',
    detail: 'Trigger condition was not met; the agent kept monitoring.',
  },
  blocked: {
    kind: 'guardian',
    title: 'Agent tick blocked',
    detail: 'Guardian or funding readiness blocked execution before any transaction was submitted.',
  },
  executed: {
    kind: 'exec',
    title: 'Agent trade executed',
    detail: 'Execution was submitted and resolved with on-chain evidence.',
  },
  stopped_revoked: {
    kind: 'guardian',
    title: 'Agent stopped · revoked',
    detail: 'Mandate is revoked on-chain; the runtime stopped future ticks.',
  },
  stopped_expired: {
    kind: 'guardian',
    title: 'Agent stopped · expired',
    detail: 'Mandate is expired on-chain; the runtime stopped future ticks.',
  },
  error: {
    kind: 'fail',
    title: 'Agent tick error',
    detail: 'Runtime tick failed without claiming execution success.',
  },
}

export function shortWrapperId(wrapperId) {
  if (!wrapperId || typeof wrapperId !== 'string') return 'runtime'
  return wrapperId.length > 12 ? `${wrapperId.slice(0, 6)}…${wrapperId.slice(-4)}` : wrapperId
}

function dateParts(timestampMs) {
  const ms = Number(timestampMs)
  const d = Number.isFinite(ms) ? new Date(ms) : new Date()
  return { date: d.toISOString().slice(0, 10), t: d.toISOString().slice(11, 19) }
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function normalizeEvidenceRows(value) {
  return Array.isArray(value)
    ? value.filter(Boolean).map((row) => ({
        code: row.code ? String(row.code) : row.blocker_code ? String(row.blocker_code) : null,
        label: row.label ? String(row.label) : row.asset ? String(row.asset) : null,
        holder: row.holder ? String(row.holder) : null,
        asset: row.asset ? String(row.asset) : null,
        observed: row.observed != null ? String(row.observed) : row.observed_balance != null ? String(row.observed_balance) : null,
        required: row.required != null ? String(row.required) : row.threshold != null ? String(row.threshold) : null,
        usable: row.usable === true,
      }))
    : []
}

function txDigestOf(value) {
  return value?.tx_digest || value?.tx || null
}

export function runtimeEventDedupeKey(event) {
  const txDigest = txDigestOf(event)
  if (txDigest) return `tx:${txDigest}`
  const action = String(event?.action || '')
  if (action === 'activated' && event?.wrapper_id) return `runtime:${event.wrapper_id}:activated`
  return event?.dedupe_key || null
}

function runtimeEventStrength(event) {
  if (event?.action === 'executed' && event?.execution_claimed && event?.execution_success_evidence) return 4
  if (event?.action === 'executed' && event?.execution_claimed) return 3
  if (txDigestOf(event)) return 2
  return 1
}

function activityItemDedupeKey(item) {
  const txDigest = txDigestOf(item)
  return txDigest ? `tx:${txDigest}` : null
}

function activityItemStrength(item) {
  if (item?.source === 'chain' && item?.kind === 'exec') return 5
  if (item?.source === 'chain') return 4
  if (item?.execution_claimed && item?.execution_success_evidence) return 3
  if (item?.execution_claimed) return 2
  if (txDigestOf(item)) return 1
  return 0
}

/**
 * @param {Record<string, any>} result
 * @param {{wrapperId?: string | null, nowMs?: number}=} options
 */
export function runtimeEventFromTickResult(result, { wrapperId, nowMs = Date.now() } = {}) {
  const action = String(result?.action || 'error')
  const meta = ACTION_META[action] || ACTION_META.error
  const code = result?.code || result?.blocker_code || null
  const blockerCodes = normalizeStringArray(result?.blocker_codes || (code ? [code] : []))
  const blockerLabels = normalizeStringArray(result?.blocker_labels)
  const funding = result?.funding || null
  const blockers = normalizeEvidenceRows(funding?.blockers || result?.blockers)
  const executionBlockers = normalizeEvidenceRows(funding?.execution_blockers || result?.execution_blockers || blockers)
  const fundingCriteria = normalizeEvidenceRows(funding?.criteria || result?.funding_criteria || result?.criteria)
  const detail = String(result?.detail || (blockerLabels.length ? blockerLabels.join('; ') : meta.detail))
  const txDigest = result?.tx_digest || result?.tx || null
  const eventWrapperId = wrapperId || result?.wrapper_id || null
  const dedupeKey = runtimeEventDedupeKey({ action, wrapper_id: eventWrapperId, tx_digest: txDigest })
  const idParts = [nowMs, eventWrapperId || 'unknown', action, txDigest || code || 'runtime']
  return {
    id: dedupeKey || idParts.map(String).join(':'),
    dedupe_key: dedupeKey,
    source: 'runtime',
    timestamp_ms: nowMs,
    wrapper_id: eventWrapperId,
    mandate_id: result?.mandate_id || null,
    action,
    code,
    blocker_code: code,
    blocker_codes: blockerCodes,
    blocker_labels: blockerLabels,
    readiness_state: result?.readiness_state || null,
    execution_claimed: Boolean(result?.execution_claimed),
    execution_success_evidence: Boolean(result?.execution_success_evidence),
    title: meta.title,
    detail,
    tx: txDigest,
    tx_digest: txDigest,
    spend_delta: result?.spend_delta || null,
    spend_before: result?.spend_before || null,
    spend_after: result?.spend_after || null,
    balances: result?.balances || null,
    funding,
    blockers,
    execution_blockers: executionBlockers,
    funding_criteria: fundingCriteria,
  }
}

/**
 * @param {unknown} error
 * @param {{wrapperId?: string | null, nowMs?: number}=} options
 */
export function runtimeErrorEvent(error, { wrapperId, nowMs = Date.now() } = {}) {
  return runtimeEventFromTickResult({
    action: 'error',
    code: 'RUNTIME_ERROR',
    blocker_code: 'RUNTIME_ERROR',
    blocker_codes: ['RUNTIME_ERROR'],
    blocker_labels: ['Runtime error'],
    detail: `Runtime error: ${String(error?.message || error)}`,
    execution_claimed: false,
  }, { wrapperId, nowMs })
}

export function appendRuntimeActivity(events, event, max = MAX_RUNTIME_ACTIVITY) {
  const prior = Array.isArray(events) ? events : []
  const key = runtimeEventDedupeKey(event)
  if (key) {
    const existing = prior.find((item) => runtimeEventDedupeKey(item) === key)
    if (existing && runtimeEventStrength(existing) >= runtimeEventStrength(event)) {
      return prior.slice(0, max)
    }
    return [event, ...prior.filter((item) => runtimeEventDedupeKey(item) !== key)].slice(0, max)
  }
  return [event, ...prior].slice(0, max)
}

export function runtimeEventToFeedItem(event, policyLabel = shortWrapperId(event?.wrapper_id)) {
  const action = String(event?.action || 'error')
  const meta = ACTION_META[action] || ACTION_META.error
  const { date, t } = dateParts(event?.timestamp_ms)
  const spendDelta = event?.spend_delta != null ? Number(event.spend_delta) / 1e6 : 0
  return {
    id: event?.id || null,
    dedupe_key: event?.dedupe_key || runtimeEventDedupeKey(event),
    t,
    date,
    kind: meta.kind,
    policy: policyLabel,
    title: event?.title || meta.title,
    detail: event?.detail || meta.detail,
    amount: action === 'executed' ? -Math.abs(spendDelta) : 0,
    tx: event?.tx_digest || event?.tx || null,
    risk: null,
    mode: 'cloud',
    source: 'runtime',
    timestamp_ms: Number(event?.timestamp_ms) || 0,
    wrapper_id: event?.wrapper_id || null,
    mandate_id: event?.mandate_id || null,
    action,
    tx_digest: event?.tx_digest || event?.tx || null,
    blocker_codes: normalizeStringArray(event?.blocker_codes),
    blocker_labels: normalizeStringArray(event?.blocker_labels),
    blockers: normalizeEvidenceRows(event?.blockers),
    execution_blockers: normalizeEvidenceRows(event?.execution_blockers),
    funding_criteria: normalizeEvidenceRows(event?.funding_criteria),
    balances: event?.balances || null,
    execution_claimed: Boolean(event?.execution_claimed),
    execution_success_evidence: Boolean(event?.execution_success_evidence),
  }
}

export function sortActivityItems(items) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => Number(b.timestamp_ms || 0) - Number(a.timestamp_ms || 0))
}

export function dedupeActivityItems(items) {
  const out = []
  const keyed = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const key = activityItemDedupeKey(item)
    if (!key) {
      out.push(item)
      continue
    }
    const existingIndex = keyed.get(key)
    if (existingIndex == null) {
      keyed.set(key, out.length)
      out.push(item)
      continue
    }
    const existing = out[existingIndex]
    const stronger = activityItemStrength(item) > activityItemStrength(existing)
    if (stronger) out[existingIndex] = item
  }
  return out
}

export function mergeActivityItems(...groups) {
  return sortActivityItems(dedupeActivityItems(groups.flat()))
}
