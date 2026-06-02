// Frontend client for the RescueGrid Worker API.
// Configure VITE_WORKER_URL to point at the deployed/dev Worker. Reads are
// Worker-first and fall back to direct chain reads when the Worker is absent or
// temporarily unavailable; writes require the Worker contract.
import * as chainRead from './chain-read.js'

const BASE = import.meta.env.VITE_WORKER_URL || ''

export const WORKER_CONFIGURED = !!BASE
export const ENOKI_CONFIGURED =
  !!import.meta.env.VITE_ENOKI_API_KEY && !!import.meta.env.VITE_GOOGLE_CLIENT_ID

function workerMissing() {
  return {
    status: 'error',
    code: 'WORKER_NOT_CONFIGURED',
    message: 'Set VITE_WORKER_URL to use the RescueGrid Worker.',
  }
}

async function parseJson(res) {
  const json = await res.json().catch(() => ({
    status: 'error',
    code: 'BAD_RESPONSE',
    message: `Worker returned HTTP ${res.status}.`,
  }))
  if (!res.ok && json.status !== 'error') {
    return { status: 'error', code: `HTTP_${res.status}`, message: `Worker returned HTTP ${res.status}.` }
  }
  return json
}

async function post(path, body) {
  if (!WORKER_CONFIGURED) return workerMissing()
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parseJson(res)
}

async function workerGet(path) {
  if (!WORKER_CONFIGURED) throw new Error('Worker not configured.')
  const res = await fetch(BASE + path)
  const json = await parseJson(res)
  if (json.status === 'error') throw new Error(json.message || json.code || 'Worker read failed.')
  return json
}

async function read(path, fallback) {
  if (!WORKER_CONFIGURED) {
    const result = await fallback()
    return { ...result, source: 'chain_fallback', worker_error: 'WORKER_NOT_CONFIGURED' }
  }
  try {
    const result = await workerGet(path)
    return { ...result, source: 'worker' }
  } catch (e) {
    const result = await fallback()
    return { ...result, source: 'chain_fallback', worker_error: String(e?.message || e) }
  }
}

/** POST /api/intents/parse — NL -> structured strategy + hash + preview. */
export function parseIntent(owner, text, defaults = {}) {
  return post('/api/intents/parse', { owner, text, defaults })
}

/** POST /api/policies — returns { tx_json } unsigned tx for zkLogin signing. */
export function buildPolicyTx(owner, strategy, strategy_hash) {
  return post('/api/policies', { owner, strategy, strategy_hash, confirmed: true })
}

/** POST /api/policies/:id/activate — register the Durable Object runtime. */
export function activatePolicy(wrapperId, strategy = null) {
  return post(`/api/policies/${wrapperId}/activate`, strategy ? { strategy } : {})
}

/** GET /api/policies/:id/activity — chain-authoritative policy + events. */
export function getActivity(wrapperId) {
  return workerGet(`/api/policies/${wrapperId}/activity`).catch((e) => ({
    status: 'error',
    code: WORKER_CONFIGURED ? 'WORKER_READ_FAILED' : 'WORKER_NOT_CONFIGURED',
    message: String(e?.message || e),
  }))
}

/** GET /api/policies?owner= — policies owned by an address (PolicyCreated events). */
export function listPolicies(owner) {
  return read(`/api/policies?owner=${owner}`, () => chainRead.listPolicies(owner))
}

/** GET /api/activity?owner= — merged on-chain activity feed for an owner. */
export function listActivity(owner) {
  return read(`/api/activity?owner=${owner}`, () => chainRead.getActivity(owner))
}

/** GET /api/summary?owner= — real portfolio aggregates + positions. */
export function getSummary(owner) {
  return read(`/api/summary?owner=${owner}`, () => chainRead.getSummary(owner))
}

/** GET /api/market — live SUI/DBUSDC price from the DeepBook indexer. */
export function getMarket() {
  return read('/api/market', () => chainRead.getMarket())
}

/** GET /api/protocols — Sui-only protocol coverage registry for watch/adapters. */
export function getProtocols() {
  return workerGet('/api/protocols').catch((e) => ({
    status: 'error',
    code: WORKER_CONFIGURED ? 'WORKER_READ_FAILED' : 'WORKER_NOT_CONFIGURED',
    message: String(e?.message || e),
  }))
}

/** GET /api/protocols/watchlist — Sui-only market watch metadata. */
export function getProtocolWatchlist() {
  return workerGet('/api/protocols/watchlist').catch((e) => ({
    status: 'error',
    code: WORKER_CONFIGURED ? 'WORKER_READ_FAILED' : 'WORKER_NOT_CONFIGURED',
    message: String(e?.message || e),
  }))
}

/** GET /api/adapters/candidates — Sui-only post-MVP adapter constraints. */
export function getAdapterCandidates() {
  return workerGet('/api/adapters/candidates').catch((e) => ({
    status: 'error',
    code: WORKER_CONFIGURED ? 'WORKER_READ_FAILED' : 'WORKER_NOT_CONFIGURED',
    message: String(e?.message || e),
  }))
}

/** GET /api/adapters/dex-reads — Sui-only DEX quote/depth/spread read model. */
export function getDexReadAdapters() {
  return workerGet('/api/adapters/dex-reads').catch((e) => ({
    status: 'error',
    code: WORKER_CONFIGURED ? 'WORKER_READ_FAILED' : 'WORKER_NOT_CONFIGURED',
    message: String(e?.message || e),
  }))
}

/** GET /api/adapters/lending-reads — Sui-only lending reserve/health read model. */
export function getLendingReadAdapters() {
  return workerGet('/api/adapters/lending-reads').catch((e) => ({
    status: 'error',
    code: WORKER_CONFIGURED ? 'WORKER_READ_FAILED' : 'WORKER_NOT_CONFIGURED',
    message: String(e?.message || e),
  }))
}

/** GET /api/protocols/watch-boundaries — watch-only protocol risk boundaries. */
export function getProtocolWatchBoundaries() {
  return workerGet('/api/protocols/watch-boundaries').catch((e) => ({
    status: 'error',
    code: WORKER_CONFIGURED ? 'WORKER_READ_FAILED' : 'WORKER_NOT_CONFIGURED',
    message: String(e?.message || e),
  }))
}

/** GET /api/balances?owner= — real wallet token holdings valued via market. */
export function getBalances(owner) {
  return read(`/api/balances?owner=${owner}`, () => chainRead.getBalances(owner))
}

/** GET /api/execution/readiness — cloud/local agent execution preflight, no secrets. */
export function getExecutionReadiness() {
  return workerGet('/api/execution/readiness').catch((e) => ({
    status: 'error',
    code: WORKER_CONFIGURED ? 'WORKER_READ_FAILED' : 'WORKER_NOT_CONFIGURED',
    message: String(e?.message || e),
    funding: null,
  }))
}

/** GET /api/runtime/status — Worker agent/signer/provider status, no secrets. */
export function getRuntimeStatus() {
  return workerGet('/api/runtime/status').catch((e) => ({
    status: 'error',
    code: WORKER_CONFIGURED ? 'WORKER_READ_FAILED' : 'WORKER_NOT_CONFIGURED',
    message: String(e?.message || e),
    signer: null,
    agent: null,
    chain_data_provider: null,
  }))
}

/** GET /api/chain-data/status — Worker ChainDataProvider status, optional probe. */
export function getChainDataStatus({ probe = false } = {}) {
  const query = probe ? '?probe=true' : ''
  return workerGet(`/api/chain-data/status${query}`).catch((e) => ({
    status: 'error',
    code: WORKER_CONFIGURED ? 'WORKER_READ_FAILED' : 'WORKER_NOT_CONFIGURED',
    message: String(e?.message || e),
    provider_kind: null,
    provider_status: 'unavailable',
    available: false,
    probe: { status: 'error' },
  }))
}

function ownerControlNonce() {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint32Array(4)
    cryptoApi.getRandomValues(bytes)
    return [...bytes].map((n) => n.toString(16).padStart(8, '0')).join('-')
  }
  throw new Error('Secure random source unavailable for owner control nonce.')
}

function venueKey(venue) {
  return String(venue || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function baseRiskControlMessage({ owner, action, stopped, nonce, issuedAtMs }) {
  return {
    app: 'RescueGrid',
    version: 1,
    chain: 'sui:testnet',
    action,
    owner,
    stopped: Boolean(stopped),
    nonce,
    issued_at_ms: issuedAtMs,
  }
}

export function buildGlobalStopMessage({ owner, stopped, nonce = ownerControlNonce(), issuedAtMs = Date.now() }) {
  return JSON.stringify(baseRiskControlMessage({ owner, action: 'set_global_stop', stopped, nonce, issuedAtMs }))
}

export function buildStrategyStopMessage({ owner, wrapperId, stopped, nonce = ownerControlNonce(), issuedAtMs = Date.now() }) {
  return JSON.stringify({
    ...baseRiskControlMessage({ owner, action: 'set_strategy_stop', stopped, nonce, issuedAtMs }),
    wrapper_id: wrapperId,
  })
}

export function buildVenueStopMessage({ owner, venue, stopped, nonce = ownerControlNonce(), issuedAtMs = Date.now() }) {
  const cleanVenue = String(venue || '').trim().replace(/\s+/g, ' ')
  return JSON.stringify({
    ...baseRiskControlMessage({ owner, action: 'set_venue_stop', stopped, nonce, issuedAtMs }),
    venue: cleanVenue,
    venue_key: venueKey(cleanVenue),
  })
}

/** GET /api/risk/controls — owner-scoped Worker runtime risk controls. */
export function getRiskControls(owner) {
  const query = owner ? `?owner=${encodeURIComponent(owner)}` : ''
  return workerGet(`/api/risk/controls${query}`).catch((e) => ({
    status: 'error',
    code: WORKER_CONFIGURED ? 'WORKER_READ_FAILED' : 'WORKER_NOT_CONFIGURED',
    message: String(e?.message || e),
    global_stopped: false,
    global_stop: null,
    strategy_stops: [],
    strategy_stop_records: [],
    venue_stops: [],
    venue_stop_records: [],
  }))
}

/** GET /api/risk/venue-stops — Worker runtime venue emergency stops. */
export function getVenueStops(owner) {
  const query = owner ? `?owner=${encodeURIComponent(owner)}` : ''
  return workerGet(`/api/risk/venue-stops${query}`).catch((e) => ({
    status: 'error',
    code: WORKER_CONFIGURED ? 'WORKER_READ_FAILED' : 'WORKER_NOT_CONFIGURED',
    message: String(e?.message || e),
    venue_stops: [],
    venue_stop_records: [],
  }))
}

/** POST /api/risk/controls — owner-signed runtime risk control. */
export function setRiskControl(owner, message, signature) {
  return post('/api/risk/controls', { owner, message, signature })
}

/** POST /api/risk/venue-stops — owner-signed runtime venue stop/resume. */
export function setVenueStop(owner, message, signature) {
  return post('/api/risk/venue-stops', { owner, message, signature })
}

/** POST /api/policies/:id/revoke — returns { tx_json } unsigned revoke tx. */
export function buildRevokeTx(owner, wrapperId) {
  return post(`/api/policies/${wrapperId}/revoke`, { owner, confirmed: true })
}

/** Single tx detail — chain-authoritative, read directly from the fullnode
 *  (no Worker aggregation needed for a single object). */
export function getTransaction(digest) {
  return chainRead.getTransaction(digest)
}

/** Real SUI/USD price history for backtests (public market data, direct). */
export function getSuiPriceHistory(days = 30) {
  return chainRead.getSuiPriceHistory(days)
}
