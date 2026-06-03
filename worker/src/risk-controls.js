import { verifyPersonalMessageSignature } from '@mysten/sui/verify'

export const RISK_CONTROLS_DO_NAME = '__rescuegrid_risk_controls__'
export const OWNER_CONTROL_ACTION_SET_GLOBAL_STOP = 'set_global_stop'
export const OWNER_CONTROL_ACTION_SET_STRATEGY_STOP = 'set_strategy_stop'
export const OWNER_CONTROL_ACTION_SET_VENUE_STOP = 'set_venue_stop'
export const OWNER_CONTROL_TTL_MS = 10 * 60 * 1000

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/
const WRAPPER_ID_RE = /^0x[0-9a-fA-F]{64}$/
const OWNER_CONTROL_ACTIONS = new Set([
  OWNER_CONTROL_ACTION_SET_GLOBAL_STOP,
  OWNER_CONTROL_ACTION_SET_STRATEGY_STOP,
  OWNER_CONTROL_ACTION_SET_VENUE_STOP,
])
const VENUE_ALIASES = new Map([
  ['deepbook', 'DeepBook'],
  ['deepbook-v3', 'DeepBook'],
  ['cetus', 'Cetus'],
  ['bluefin-spot', 'Bluefin Spot'],
  ['bluefin-pro', 'Bluefin Pro'],
  ['scallop', 'Scallop'],
  ['navi', 'NAVI'],
  ['suilend', 'Suilend'],
  ['turbos', 'Turbos'],
  ['momentum', 'Momentum'],
  ['bucket', 'Bucket'],
  ['alphalend', 'AlphaLend'],
])

function controlError(code, message, status = 400) {
  const err = new Error(message)
  err.code = code
  err.status = status
  return err
}

export function normalizeVenueKey(venue) {
  return String(venue || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function canonicalVenueName(venue) {
  const raw = String(venue || '').trim().replace(/\s+/g, ' ')
  const key = normalizeVenueKey(raw)
  return VENUE_ALIASES.get(key) || raw
}

function baseControlMessage({ owner, action, stopped, nonce, issued_at_ms }) {
  return {
    app: 'RescueGrid',
    version: 1,
    chain: 'sui:testnet',
    action,
    owner,
    stopped: Boolean(stopped),
    nonce,
    issued_at_ms,
  }
}

export function normalizeWrapperId(wrapperId) {
  const id = String(wrapperId || '').trim()
  return WRAPPER_ID_RE.test(id) ? id : ''
}

export function buildGlobalStopControlMessage({ owner, stopped, nonce, issued_at_ms }) {
  return JSON.stringify(baseControlMessage({
    owner,
    action: OWNER_CONTROL_ACTION_SET_GLOBAL_STOP,
    stopped,
    nonce,
    issued_at_ms,
  }))
}

export function buildStrategyStopControlMessage({ owner, wrapper_id, stopped, nonce, issued_at_ms }) {
  return JSON.stringify({
    ...baseControlMessage({
      owner,
      action: OWNER_CONTROL_ACTION_SET_STRATEGY_STOP,
      stopped,
      nonce,
      issued_at_ms,
    }),
    wrapper_id: normalizeWrapperId(wrapper_id) || wrapper_id,
  })
}

export function buildVenueStopControlMessage({ owner, venue, stopped, nonce, issued_at_ms }) {
  const canonical = canonicalVenueName(venue)
  return JSON.stringify({
    ...baseControlMessage({
      owner,
      action: OWNER_CONTROL_ACTION_SET_VENUE_STOP,
      stopped,
      nonce,
      issued_at_ms,
    }),
    venue: canonical,
    venue_key: normalizeVenueKey(canonical),
  })
}

export function buildRiskControlMessage({ action, ...params }) {
  if (action === OWNER_CONTROL_ACTION_SET_GLOBAL_STOP) return buildGlobalStopControlMessage(params)
  if (action === OWNER_CONTROL_ACTION_SET_STRATEGY_STOP) return buildStrategyStopControlMessage(params)
  if (action === OWNER_CONTROL_ACTION_SET_VENUE_STOP) return buildVenueStopControlMessage(params)
  throw controlError('BAD_CONTROL_ACTION', 'Unsupported owner control action.')
}

export function parseRiskControlMessage(message, { nowMs = Date.now(), ttlMs = OWNER_CONTROL_TTL_MS } = {}) {
  if (typeof message !== 'string' || message.length === 0 || message.length > 4096) {
    throw controlError('BAD_CONTROL_MESSAGE', 'Control message must be a bounded JSON string.')
  }

  let parsed
  try {
    parsed = JSON.parse(message)
  } catch {
    throw controlError('BAD_CONTROL_MESSAGE', 'Control message is not valid JSON.')
  }

  if (parsed?.app !== 'RescueGrid' || parsed?.version !== 1 || parsed?.chain !== 'sui:testnet') {
    throw controlError('BAD_CONTROL_MESSAGE', 'Control message domain does not match RescueGrid Sui Testnet.')
  }
  if (!OWNER_CONTROL_ACTIONS.has(parsed.action)) {
    throw controlError('BAD_CONTROL_ACTION', 'Unsupported owner control action.')
  }
  if (!SUI_ADDRESS_RE.test(parsed.owner || '')) {
    throw controlError('BAD_OWNER', 'Control message owner must be a Sui address.')
  }
  if (typeof parsed.stopped !== 'boolean') {
    throw controlError('BAD_STOP_STATE', 'Control message stopped must be boolean.')
  }
  if (typeof parsed.nonce !== 'string' || parsed.nonce.length < 8 || parsed.nonce.length > 128) {
    throw controlError('BAD_NONCE', 'Control message nonce is invalid.')
  }
  const issuedAt = Number(parsed.issued_at_ms)
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) {
    throw controlError('BAD_ISSUED_AT', 'Control message issued_at_ms is invalid.')
  }
  if (issuedAt > nowMs + 60_000 || nowMs - issuedAt > ttlMs) {
    throw controlError('CONTROL_EXPIRED', 'Control message is expired or issued in the future.', 403)
  }

  const control = {
    action: parsed.action,
    owner: parsed.owner,
    stopped: parsed.stopped,
    nonce: parsed.nonce,
    issued_at_ms: issuedAt,
  }

  if (parsed.action === OWNER_CONTROL_ACTION_SET_GLOBAL_STOP) {
    return { ...control, scope: 'global', target_key: 'global' }
  }

  if (parsed.action === OWNER_CONTROL_ACTION_SET_STRATEGY_STOP) {
    const wrapperId = normalizeWrapperId(parsed.wrapper_id)
    if (!wrapperId) throw controlError('BAD_WRAPPER_ID', 'Control message wrapper_id is invalid.')
    return { ...control, scope: 'strategy', wrapper_id: wrapperId, target_key: wrapperId }
  }

  const venue = canonicalVenueName(parsed.venue)
  const venueKey = normalizeVenueKey(parsed.venue_key || venue)
  if (!venue || !venueKey || venueKey !== normalizeVenueKey(venue)) {
    throw controlError('BAD_VENUE', 'Control message venue is invalid.')
  }
  return { ...control, scope: 'venue', venue, venue_key: venueKey, target_key: venueKey }
}

export function parseVenueStopControlMessage(message, options = {}) {
  const control = parseRiskControlMessage(message, options)
  if (control.action !== OWNER_CONTROL_ACTION_SET_VENUE_STOP) {
    throw controlError('BAD_CONTROL_ACTION', 'Control message is not a venue stop action.')
  }
  return control
}

export function riskControlStorageKey(control) {
  return `${control.owner}:${control.action}:${control.target_key}`
}

/**
 * @param {Record<string, any>} [recordsByKey]
 * @param {string | null} [owner]
 */
export function buildRiskControlView(recordsByKey = {}, owner = null) {
  const records = Object.values(recordsByKey || {})
    .filter((r) => !owner || r.owner === owner)
    .sort((a, b) => Number(b.updated_ms || 0) - Number(a.updated_ms || 0))
  const active = records.filter((r) => r.stopped)
  const globalRecords = active.filter((r) => r.action === OWNER_CONTROL_ACTION_SET_GLOBAL_STOP)
  const strategyRecords = active.filter((r) => r.action === OWNER_CONTROL_ACTION_SET_STRATEGY_STOP)
  const venueRecords = active.filter((r) => r.action === OWNER_CONTROL_ACTION_SET_VENUE_STOP)
  return {
    status: 'ok',
    owner,
    global_stopped: globalRecords.length > 0,
    global_stop: globalRecords[0] ?? null,
    global_stops: globalRecords,
    strategy_stops: strategyRecords.map((r) => r.wrapper_id),
    strategy_stop_records: strategyRecords,
    venue_stops: venueRecords.map((r) => r.venue),
    venue_stop_records: venueRecords,
    control_records: records,
    updated_ms: records[0]?.updated_ms ?? null,
  }
}

/**
 * @param {Record<string, any>} [recordsByKey]
 * @param {string | null} [owner]
 */
export function buildVenueStopControlView(recordsByKey = {}, owner = null) {
  const view = buildRiskControlView(recordsByKey, owner)
  return {
    status: 'ok',
    owner: view.owner,
    venue_stops: view.venue_stops,
    venue_stop_records: view.venue_stop_records,
    updated_ms: view.updated_ms,
  }
}

/**
 * @param {{
 *   recordsByKey?: Record<string, any>,
 *   nonces?: Record<string, number>,
 *   control?: Record<string, any> | null,
 *   nowMs?: number,
 *   venueOnly?: boolean,
 * }} [args]
 */
export function applyRiskControlToState({
  recordsByKey = {},
  nonces = {},
  control = null,
  nowMs = Date.now(),
  venueOnly = false,
} = {}) {
  if (!control?.owner || !control?.action || !control?.target_key || typeof control.stopped !== 'boolean' || !control?.nonce) {
    return {
      ok: false,
      status: 400,
      body: { status: 'error', code: 'BAD_CONTROL', message: 'Verified risk control required.' },
    }
  }
  if (venueOnly && control.action !== OWNER_CONTROL_ACTION_SET_VENUE_STOP) {
    return {
      ok: false,
      status: 400,
      body: { status: 'error', code: 'BAD_CONTROL_ACTION', message: 'Venue stop endpoint only accepts venue stop controls.' },
    }
  }
  const nonceKey = `${control.owner}:${control.nonce}`
  if (nonces[nonceKey]) {
    return {
      ok: false,
      status: 409,
      body: { status: 'error', code: 'CONTROL_REPLAYED', message: 'Owner control nonce was already used.' },
    }
  }
  const nextRecordsByKey = {
    ...(recordsByKey || {}),
    [riskControlStorageKey(control)]: {
      action: control.action,
      scope: control.scope,
      target_key: control.target_key,
      wrapper_id: control.wrapper_id ?? null,
      venue: control.venue ?? null,
      venue_key: control.venue_key ?? null,
      stopped: control.stopped,
      owner: control.owner,
      updated_ms: nowMs,
      issued_at_ms: control.issued_at_ms,
    },
  }
  const nextNonces = Object.fromEntries([...Object.entries(nonces || {}), [nonceKey, nowMs]].slice(-100))
  const view = buildRiskControlView(nextRecordsByKey, control.owner)
  return {
    ok: true,
    status: 200,
    recordsByKey: nextRecordsByKey,
    nonces: nextNonces,
    body: {
      ...view,
      status: 'ok',
      action: control.action,
      scope: control.scope,
      target_key: control.target_key,
      wrapper_id: control.wrapper_id ?? null,
      venue: control.venue ?? null,
      venue_key: control.venue_key ?? null,
      stopped: control.stopped,
      updated_ms: nowMs,
    },
  }
}

export async function verifyRiskControl({ owner, message, signature }, options = {}) {
  try {
    const control = parseRiskControlMessage(message, options)
    if (owner && owner !== control.owner) {
      throw controlError('OWNER_MISMATCH', 'Request owner does not match signed owner.', 403)
    }
    if (typeof signature !== 'string' || signature.length === 0) {
      throw controlError('SIGNATURE_REQUIRED', 'Owner signature is required.', 403)
    }
    await verifyPersonalMessageSignature(new TextEncoder().encode(message), signature, { address: control.owner })
    return { ok: true, control }
  } catch (e) {
    return {
      ok: false,
      status: e.status || 403,
      body: {
        status: 'error',
        code: e.code || 'INVALID_OWNER_CONTROL_SIGNATURE',
        message: String(e.message || e),
      },
    }
  }
}

export async function verifyVenueStopControl(input, options = {}) {
  const result = await verifyRiskControl(input, options)
  if (result.ok && result.control.action !== OWNER_CONTROL_ACTION_SET_VENUE_STOP) {
    return {
      ok: false,
      status: 400,
      body: { status: 'error', code: 'BAD_CONTROL_ACTION', message: 'Control message is not a venue stop action.' },
    }
  }
  return result
}

function ownerMatches(item, owner) {
  return !owner || !item?.owner || item.owner === owner
}

export function isGlobalStopped(owner, globalStops = []) {
  return (Array.isArray(globalStops) ? globalStops : []).some((item) => {
    if (typeof item === 'string') return item === owner
    return item?.stopped !== false && ownerMatches(item, owner)
  })
}

export function isVenueStopped(venue, stoppedVenues = [], owner = null) {
  const key = normalizeVenueKey(venue)
  return (Array.isArray(stoppedVenues) ? stoppedVenues : []).some((item) => {
    const itemVenue = typeof item === 'string' ? item : item?.venue || item?.venue_key
    return normalizeVenueKey(itemVenue) === key && ownerMatches(item, owner)
  })
}

export function isStrategyStopped(wrapperId, stoppedStrategies = [], owner = null) {
  const id = normalizeWrapperId(wrapperId)
  return !!id && (Array.isArray(stoppedStrategies) ? stoppedStrategies : []).some((item) => {
    const itemId = typeof item === 'string' ? item : item?.wrapper_id
    return normalizeWrapperId(itemId) === id && ownerMatches(item, owner)
  })
}
