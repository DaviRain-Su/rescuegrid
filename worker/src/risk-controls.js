import { verifyPersonalMessageSignature } from '@mysten/sui/verify'

export const RISK_CONTROLS_DO_NAME = '__rescuegrid_risk_controls__'
export const OWNER_CONTROL_ACTION_SET_VENUE_STOP = 'set_venue_stop'
export const OWNER_CONTROL_TTL_MS = 10 * 60 * 1000

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/
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

export function buildVenueStopControlMessage({ owner, venue, stopped, nonce, issued_at_ms }) {
  const canonical = canonicalVenueName(venue)
  return JSON.stringify({
    app: 'RescueGrid',
    version: 1,
    chain: 'sui:testnet',
    action: OWNER_CONTROL_ACTION_SET_VENUE_STOP,
    owner,
    venue: canonical,
    venue_key: normalizeVenueKey(canonical),
    stopped: Boolean(stopped),
    nonce,
    issued_at_ms,
  })
}

export function parseVenueStopControlMessage(message, { nowMs = Date.now(), ttlMs = OWNER_CONTROL_TTL_MS } = {}) {
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
  if (parsed.action !== OWNER_CONTROL_ACTION_SET_VENUE_STOP) {
    throw controlError('BAD_CONTROL_ACTION', 'Unsupported owner control action.')
  }
  if (!SUI_ADDRESS_RE.test(parsed.owner || '')) {
    throw controlError('BAD_OWNER', 'Control message owner must be a Sui address.')
  }
  const venue = canonicalVenueName(parsed.venue)
  const venueKey = normalizeVenueKey(parsed.venue_key || venue)
  if (!venue || !venueKey || venueKey !== normalizeVenueKey(venue)) {
    throw controlError('BAD_VENUE', 'Control message venue is invalid.')
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

  return {
    owner: parsed.owner,
    venue,
    venue_key: venueKey,
    stopped: parsed.stopped,
    nonce: parsed.nonce,
    issued_at_ms: issuedAt,
  }
}

export async function verifyVenueStopControl({ owner, message, signature }, options = {}) {
  try {
    const control = parseVenueStopControlMessage(message, options)
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

export function isVenueStopped(venue, stoppedVenues = []) {
  const key = normalizeVenueKey(venue)
  return (Array.isArray(stoppedVenues) ? stoppedVenues : []).some((item) => {
    const itemVenue = typeof item === 'string' ? item : item?.venue || item?.venue_key
    return normalizeVenueKey(itemVenue) === key
  })
}
