import {
  countActivePoliciesByDeployment,
  getActivity,
  getBalances,
  getMarket,
  getOwnerSummary,
  isActivePolicySnapshot,
  listActivityByOwner,
  listPoliciesByOwner,
  policyEventsToFeedItems,
  queryPolicyEvents,
  readBalanceManagerBalance,
  readClockTimestampMs,
  readMandate,
  readWrapper,
} from './chain.js'
import { getClient, DEPLOYMENT } from './sui-tx.js'
import { bytesToHex, enrichPolicyFromChain, policyRuntimeState } from './read-surfaces.js'

export const CHAIN_DATA_PROVIDER_JSON_RPC = 'json-rpc'
export const CHAIN_DATA_PROVIDER_GRAPHQL = 'graphql'
export const KNOWN_CHAIN_DATA_PROVIDER_KINDS = Object.freeze([
  CHAIN_DATA_PROVIDER_JSON_RPC,
  CHAIN_DATA_PROVIDER_GRAPHQL,
])
export const CHAIN_DATA_PROVIDER_STATUS_PATH = '/api/chain-data/status'

export function unsupportedChainDataProvider(kind) {
  return {
    status: 'error',
    code: 'UNSUPPORTED_CHAIN_DATA_PROVIDER',
    provider_kind: kind || 'unknown',
    message: `Unsupported ChainDataProvider: ${kind || 'unknown'}. Current implementation supports json-rpc and a read-only graphql provider spike.`,
  }
}

export function graphqlEndpointRequired(kind = CHAIN_DATA_PROVIDER_GRAPHQL) {
  return {
    status: 'error',
    code: 'GRAPHQL_ENDPOINT_REQUIRED',
    provider_kind: kind,
    message: 'GraphQL ChainDataProvider requires SUI_GRAPHQL_URL, SUI_GRAPHQL_ENDPOINT, or an injected fetchGraphql transport.',
  }
}

function normalizeProviderKind(kind) {
  const value = String(kind || CHAIN_DATA_PROVIDER_JSON_RPC).trim().toLowerCase()
  if (value === 'jsonrpc' || value === 'json_rpc') return CHAIN_DATA_PROVIDER_JSON_RPC
  return value
}

export function configuredChainDataProviderKind(env = {}) {
  return normalizeProviderKind(env.CHAIN_DATA_PROVIDER || env.RESCUEGRID_CHAIN_DATA_PROVIDER || CHAIN_DATA_PROVIDER_JSON_RPC)
}

export function configuredGraphqlEndpoint(env = {}) {
  return String(env.SUI_GRAPHQL_URL || env.SUI_GRAPHQL_ENDPOINT || env.GRAPHQL_URL || '').trim()
}

const GRAPHQL_READ_OBJECT = `
query RescueGridReadObject($id: String!) {
  object(address: $id) {
    address
    asMoveObject {
      contents { json }
    }
  }
}`

const GRAPHQL_POLICY_EVENTS = `
query RescueGridPolicyEvents($package: String!, $module: String!, $cursor: String, $limit: Int!) {
  events(input: {package: $package, module: $module}, after: $cursor, first: $limit) {
    pageInfo { hasNextPage endCursor }
    nodes {
      type
      timestamp
      timestampMs
      parsedJson
      transactionBlock { digest }
    }
  }
}`

const GRAPHQL_SCHEMA_PROBE = `
query RescueGridGraphqlSchemaProbe {
  __typename
}`

const CHAIN_DATA_READ_MODELS = Object.freeze({
  [CHAIN_DATA_PROVIDER_JSON_RPC]: {
    policy_objects: 'json-rpc',
    policy_events: 'json-rpc',
    owner_policy_list: 'json-rpc',
    balances: 'json-rpc',
    market: 'json-rpc',
  },
  [CHAIN_DATA_PROVIDER_GRAPHQL]: {
    policy_objects: 'graphql',
    policy_events: 'graphql',
    owner_policy_list: 'graphql',
    balances: 'json-rpc-fallback',
    market: 'json-rpc-fallback',
  },
})

function graphqlError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

async function postGraphql(endpoint, query, variables, fetchImpl = fetch) {
  if (!endpoint) throw graphqlError('GRAPHQL_ENDPOINT_REQUIRED', graphqlEndpointRequired().message)
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw graphqlError('GRAPHQL_HTTP_ERROR', `Sui GraphQL returned HTTP ${res.status}.`)
  if (!json) throw graphqlError('GRAPHQL_BAD_RESPONSE', 'Sui GraphQL returned a non-JSON response.')
  if (Array.isArray(json.errors) && json.errors.length) {
    throw graphqlError('GRAPHQL_QUERY_ERROR', json.errors.map((e) => e.message || String(e)).join('; '))
  }
  return json.data ?? json
}

function unwrapData(value) {
  return value?.data ?? value
}

function objectFieldsFromGraphql(value) {
  const data = unwrapData(value)
  const object = data?.object ?? data?.objectByAddress ?? data?.objectById ?? data
  return object?.fields
    ?? object?.contents?.json
    ?? object?.asMoveObject?.contents?.json
    ?? object?.asMoveObject?.contents?.data
    ?? object?.asMoveObject?.fields
    ?? object?.parsedJson
    ?? null
}

function normalizeStrategyHash(value) {
  if (typeof value === 'string') return value
  return bytesToHex(value)
}

function wrapperFromFields(wrapperId, f) {
  if (!f) return null
  return {
    wrapper_id: wrapperId,
    owner: f.owner,
    mandate_id: f.mandate_id,
    agent: f.agent,
    pool_id: f.pool_id,
    budget_coin_type: f.budget_coin_type,
    budget_ceiling: String(f.budget_ceiling),
    spent_amount: String(f.spent_amount),
    max_slippage_bps: Number(f.max_slippage_bps),
    strategy_hash: normalizeStrategyHash(f.strategy_hash),
  }
}

function mandateFromFields(mandateId, f) {
  if (!f) return null
  return {
    id: mandateId,
    owner: f.owner,
    agent: f.agent,
    revoked: Boolean(f.revoked),
    expires_at_ms: String(f.expires_at_ms),
  }
}

function graphqlEventNodes(value) {
  const data = unwrapData(value)
  const events = data?.events ?? data?.queryEvents ?? data?.moveEvents ?? data?.policyEvents ?? data
  if (Array.isArray(events)) return { nodes: events, hasNextPage: false, cursor: null }
  const nodes = events?.nodes ?? events?.edges?.map((e) => e.node).filter(Boolean) ?? events?.data ?? []
  return {
    nodes: Array.isArray(nodes) ? nodes : [],
    hasNextPage: Boolean(events?.pageInfo?.hasNextPage ?? events?.hasNextPage),
    cursor: events?.pageInfo?.endCursor ?? events?.nextCursor ?? null,
  }
}

function normalizeGraphqlPolicyEvent(e) {
  const pj = e?.parsedJson ?? e?.parsed_json ?? e?.json ?? e?.data ?? {}
  return {
    type: String(e?.type || '').split('::').pop(),
    tx: e?.id?.txDigest ?? e?.transactionBlock?.digest ?? e?.transaction_block?.digest ?? e?.txDigest ?? e?.tx ?? null,
    timestamp_ms: e?.timestampMs ? Number(e.timestampMs) : e?.timestamp_ms ? Number(e.timestamp_ms) : e?.timestamp ? Number(e.timestamp) : null,
    data: pj,
  }
}

function policyEventSortDesc(a, b) {
  return Number(b.timestamp_ms || 0) - Number(a.timestamp_ms || 0)
}

function providerTransport(kind, provider, options = {}) {
  if (kind === CHAIN_DATA_PROVIDER_GRAPHQL) {
    if (options.fetchGraphql || provider?.fetchGraphql) return 'injected-graphql'
    if (options.endpoint || provider?.endpoint) return 'http-graphql'
    return 'unconfigured-graphql'
  }
  return 'sui-json-rpc'
}

function providerReadModel(kind) {
  return CHAIN_DATA_READ_MODELS[kind] || {}
}

function sanitizeProviderError(error) {
  if (!error) return null
  return {
    code: error.code || 'CHAIN_DATA_PROVIDER_ERROR',
    message: String(error.message || error),
    provider_kind: error.provider_kind || undefined,
    query_name: error.query_name || undefined,
  }
}

export class JsonRpcChainDataProvider {
  constructor({ client = getClient() } = {}) {
    this.kind = CHAIN_DATA_PROVIDER_JSON_RPC
    this.available = true
    this.client = client
  }

  readWrapper(wrapperId) {
    return readWrapper(this.client, wrapperId)
  }

  readMandate(mandateId) {
    return readMandate(this.client, mandateId)
  }

  readClockTimestampMs() {
    return readClockTimestampMs(this.client)
  }

  queryPolicyEvents(wrapperId, max) {
    return queryPolicyEvents(this.client, wrapperId, max)
  }

  listPoliciesByOwner(owner) {
    return listPoliciesByOwner(owner)
  }

  countActivePoliciesByDeployment(options = {}) {
    return countActivePoliciesByDeployment({ ...options, client: this.client })
  }

  getOwnerSummary(owner, nowMs) {
    return getOwnerSummary(owner, nowMs)
  }

  getBalances(owner) {
    return getBalances(owner)
  }

  readBalanceManagerBalance(coinType, sender = DEPLOYMENT.agent.address) {
    return readBalanceManagerBalance(this.client, coinType, sender)
  }

  getAgentSuiGasBalance(owner = DEPLOYMENT.agent.address) {
    return this.client.getBalance({ owner, coinType: '0x2::sui::SUI' })
  }

  getMarket() {
    return getMarket()
  }

  listActivityByOwner(owner) {
    return listActivityByOwner(owner)
  }

  getActivity(wrapperId, nowMs) {
    return getActivity(wrapperId, nowMs)
  }

  policyEventsToFeedItems(events, policyLabel) {
    return policyEventsToFeedItems(events, policyLabel)
  }

  async probeStatus() {
    const clockTimestampMs = await this.readClockTimestampMs()
    return {
      status: 'ok',
      checks: [
        { name: 'clock_object_read', ok: clockTimestampMs != null },
      ],
      clock_timestamp_ms: clockTimestampMs ?? null,
    }
  }
}

export class GraphqlChainDataProvider {
  constructor({ endpoint = '', fetchGraphql = null, fetchImpl = fetch, fallback = null, client = getClient() } = {}) {
    this.kind = CHAIN_DATA_PROVIDER_GRAPHQL
    this.endpoint = endpoint
    this.fetchGraphql = fetchGraphql
    this.fetchImpl = fetchImpl
    this.fallback = fallback || new JsonRpcChainDataProvider({ client })
    this.available = Boolean(endpoint || fetchGraphql)
  }

  async query(name, query, variables = {}) {
    try {
      if (this.fetchGraphql) return await this.fetchGraphql({ name, query, variables })
      return await postGraphql(this.endpoint, query, variables, this.fetchImpl)
    } catch (e) {
      throw Object.assign(
        new Error(`GraphQL ChainDataProvider ${name} failed: ${String(e?.message || e)}`),
        { code: e?.code || 'GRAPHQL_READ_FAILED', provider_kind: this.kind, query_name: name },
      )
    }
  }

  async readObjectFields(id) {
    const data = await this.query('readObject', GRAPHQL_READ_OBJECT, { id })
    return objectFieldsFromGraphql(data)
  }

  async readWrapper(wrapperId) {
    return wrapperFromFields(wrapperId, await this.readObjectFields(wrapperId))
  }

  async readMandate(mandateId) {
    return mandateFromFields(mandateId, await this.readObjectFields(mandateId))
  }

  async readClockTimestampMs() {
    const f = await this.readObjectFields('0x6')
    if (!f?.timestamp_ms) return null
    return Number(f.timestamp_ms)
  }

  async queryPolicyModuleEvents({ max = 100, maxPages = 6, pageSize = 50 } = {}) {
    const out = []
    let cursor = null
    for (let page = 0; page < maxPages; page++) {
      const data = await this.query('policyEvents', GRAPHQL_POLICY_EVENTS, {
        package: DEPLOYMENT.rescuegrid.package_id,
        module: 'policy',
        cursor,
        limit: Math.min(pageSize, max - out.length),
      })
      const pageData = graphqlEventNodes(data)
      out.push(...pageData.nodes.map(normalizeGraphqlPolicyEvent))
      if (out.length >= max || !pageData.hasNextPage) break
      cursor = pageData.cursor
    }
    return out.slice(0, max).sort(policyEventSortDesc)
  }

  async queryPolicyEvents(wrapperId, max = 100) {
    const events = await this.queryPolicyModuleEvents({ max: Math.max(max, 100) })
    return events.filter((event) => event?.data?.wrapper_id === wrapperId).slice(0, max)
  }

  async listPoliciesByOwner(owner) {
    const events = await this.queryPolicyModuleEvents({ max: 300 })
    const out = []
    for (const event of events) {
      if (String(event.type) !== 'PolicyCreated') continue
      const pj = event.data || {}
      if (pj.owner !== owner) continue
      const eventPolicy = {
        wrapper_id: pj.wrapper_id,
        mandate_id: pj.mandate_id,
        owner: pj.owner,
        agent: pj.agent,
        pool_id: pj.pool_id,
        budget_coin_type: pj.budget_coin_type,
        budget_ceiling: String(pj.budget_ceiling),
        max_slippage_bps: Number(pj.max_slippage_bps),
        expires_at_ms: String(pj.expires_at_ms),
        strategy_hash: normalizeStrategyHash(pj.strategy_hash),
      }
      const wrapper = pj.wrapper_id ? await this.readWrapper(pj.wrapper_id) : null
      const mandate = wrapper?.mandate_id ? await this.readMandate(wrapper.mandate_id) : null
      out.push(enrichPolicyFromChain({ eventPolicy, wrapper, mandate, createdTx: event.tx }))
    }
    return out
  }

  async countActivePoliciesByDeployment({ limit = 10, nowMs = Date.now(), maxPages = 20, pageSize = 50 } = {}) {
    const events = await this.queryPolicyModuleEvents({ max: maxPages * pageSize, maxPages, pageSize })
    const seenWrappers = new Set()
    let active = 0
    let scanned = 0
    for (const event of events) {
      if (String(event.type) !== 'PolicyCreated') continue
      const wrapperId = event.data?.wrapper_id
      if (!wrapperId || seenWrappers.has(wrapperId)) continue
      seenWrappers.add(wrapperId)
      scanned += 1
      const wrapper = await this.readWrapper(wrapperId)
      const mandate = wrapper ? await this.readMandate(wrapper.mandate_id) : null
      if (isActivePolicySnapshot({ mandate, nowMs })) active += 1
      if (active >= limit) {
        return { active, limit, limit_reached: true, scanned, pages_scanned: Math.ceil(scanned / pageSize) }
      }
    }
    return { active, limit, limit_reached: false, scanned, pages_scanned: Math.ceil(scanned / pageSize) }
  }

  async getOwnerSummary(owner, nowMs = Date.now()) {
    const policies = await this.listPoliciesByOwner(owner)
    const active = policies.filter((p) => p.status === 'active')
    const sum = (arr, k) => arr.reduce((s, p) => s + Number(p[k] || 0), 0)
    return {
      active_policies: active.length,
      total_policies: policies.length,
      total_authorized: sum(active, 'budget_ceiling'),
      total_deployed: sum(active, 'spent_amount'),
      positions: policies.map((p) => ({
        wrapper_id: p.wrapper_id,
        pool_id: p.pool_id,
        budget_ceiling: p.budget_ceiling,
        spent_amount: p.spent_amount,
        max_slippage_bps: p.max_slippage_bps,
        status: p.status,
      })),
    }
  }

  async listActivityByOwner(owner) {
    const events = await this.queryPolicyModuleEvents({ max: 300 })
    const ownedWrappers = new Set(
      events.filter((event) => String(event.type) === 'PolicyCreated' && event.data?.owner === owner)
        .map((event) => event.data.wrapper_id),
    )
    return policyEventsToFeedItems(events.filter((event) => ownedWrappers.has(event.data?.wrapper_id)))
  }

  async getActivity(wrapperId, nowMs = Date.now()) {
    const wrapper = await this.readWrapper(wrapperId)
    if (!wrapper) return { status: 'error', code: 'NOT_FOUND', message: 'Wrapper not found on-chain.' }
    const mandate = wrapper?.mandate_id ? await this.readMandate(wrapper.mandate_id) : null
    const status = mandate?.revoked ? 'revoked' : mandate && nowMs >= Number(mandate.expires_at_ms) ? 'expired' : 'active'
    const events = await this.queryPolicyEvents(wrapperId)
    return {
      status: 'ok',
      policy: {
        policy_id: wrapperId,
        wrapper_id: wrapperId,
        mandate_id: wrapper.mandate_id,
        owner: wrapper.owner,
        agent: wrapper.agent,
        runtime_state: policyRuntimeState(status),
        runtime_state_stale: false,
        status,
        budget_ceiling: wrapper.budget_ceiling,
        spent_amount: wrapper.spent_amount,
        budget_coin_type: wrapper.budget_coin_type,
        pool_id: wrapper.pool_id,
        max_slippage_bps: wrapper.max_slippage_bps,
        strategy_hash: wrapper.strategy_hash,
        revoked: Boolean(mandate?.revoked),
        expires_at_ms: mandate?.expires_at_ms ?? '0',
      },
      events,
    }
  }

  getBalances(owner) {
    return this.fallback.getBalances(owner)
  }

  readBalanceManagerBalance(coinType, sender = DEPLOYMENT.agent.address) {
    return this.fallback.readBalanceManagerBalance(coinType, sender)
  }

  getAgentSuiGasBalance(owner = DEPLOYMENT.agent.address) {
    return this.fallback.getAgentSuiGasBalance(owner)
  }

  getMarket() {
    return this.fallback.getMarket()
  }

  policyEventsToFeedItems(events, policyLabel) {
    return policyEventsToFeedItems(events, policyLabel)
  }

  async probeStatus() {
    await this.query('schemaProbe', GRAPHQL_SCHEMA_PROBE, {})
    const clockTimestampMs = await this.readClockTimestampMs()
    const events = await this.queryPolicyModuleEvents({ max: 1, maxPages: 1, pageSize: 1 })
    return {
      status: 'ok',
      checks: [
        { name: 'schema_probe', ok: true },
        { name: 'clock_object_read', ok: clockTimestampMs != null },
        { name: 'policy_events_query', ok: Array.isArray(events), rows: events.length },
      ],
      clock_timestamp_ms: clockTimestampMs ?? null,
    }
  }
}

export function resolveChainDataProvider(env = {}, options = {}) {
  const kind = normalizeProviderKind(options.kind || configuredChainDataProviderKind(env))
  if (kind === CHAIN_DATA_PROVIDER_JSON_RPC) return new JsonRpcChainDataProvider({ client: options.client })
  if (kind === CHAIN_DATA_PROVIDER_GRAPHQL) {
    const endpoint = options.endpoint ?? configuredGraphqlEndpoint(env)
    if (!endpoint && !options.fetchGraphql) {
      return { kind, available: false, error: graphqlEndpointRequired(kind) }
    }
    return new GraphqlChainDataProvider({
      endpoint,
      fetchGraphql: options.fetchGraphql,
      fetchImpl: options.fetchImpl,
      fallback: options.fallback,
      client: options.client,
    })
  }
  return {
    kind,
    available: false,
    error: unsupportedChainDataProvider(kind),
  }
}

export function requireChainDataProvider(env = {}, options = {}) {
  const provider = resolveChainDataProvider(env, options)
  if (provider.available) return provider
  throw Object.assign(new Error(provider.error.message), provider.error)
}

export async function getChainDataProviderStatus(env = {}, options = {}) {
  const kind = normalizeProviderKind(options.kind || configuredChainDataProviderKind(env))
  const provider = resolveChainDataProvider(env, options)
  const endpointConfigured = Boolean(options.endpoint || configuredGraphqlEndpoint(env))
  const configured = kind === CHAIN_DATA_PROVIDER_JSON_RPC || endpointConfigured || Boolean(options.fetchGraphql)
  const out = {
    status: 'ok',
    chain: 'sui:testnet',
    provider_kind: kind,
    known_provider_kinds: KNOWN_CHAIN_DATA_PROVIDER_KINDS,
    provider_status: provider.available ? 'configured' : 'unavailable',
    available: Boolean(provider.available),
    configured,
    endpoint_configured: endpointConfigured,
    graphql_configured: kind === CHAIN_DATA_PROVIDER_GRAPHQL && configured,
    worker_first: true,
    transport: providerTransport(kind, provider, options),
    read_model: providerReadModel(kind),
    probe: { status: 'skipped', reason: options.probe ? 'provider unavailable' : 'probe=false' },
  }
  if (!provider.available) {
    return {
      ...out,
      error: sanitizeProviderError(provider.error),
    }
  }
  if (!options.probe) return out

  try {
    return {
      ...out,
      provider_status: 'ready',
      probe: await provider.probeStatus(),
    }
  } catch (e) {
    return {
      ...out,
      provider_status: 'probe_failed',
      probe: {
        status: 'error',
        ...sanitizeProviderError(e),
      },
    }
  }
}
