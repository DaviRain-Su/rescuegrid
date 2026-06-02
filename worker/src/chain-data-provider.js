import {
  countActivePoliciesByDeployment,
  getActivity,
  getBalances,
  getMarket,
  getOwnerSummary,
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

export const CHAIN_DATA_PROVIDER_JSON_RPC = 'json-rpc'
export const CHAIN_DATA_PROVIDER_GRAPHQL = 'graphql'
export const KNOWN_CHAIN_DATA_PROVIDER_KINDS = Object.freeze([
  CHAIN_DATA_PROVIDER_JSON_RPC,
  CHAIN_DATA_PROVIDER_GRAPHQL,
])

export function unsupportedChainDataProvider(kind) {
  return {
    status: 'error',
    code: 'UNSUPPORTED_CHAIN_DATA_PROVIDER',
    provider_kind: kind || 'unknown',
    message: `Unsupported ChainDataProvider: ${kind || 'unknown'}. Current implementation supports json-rpc; GraphQL is a planned read-only provider.`,
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
}

export function resolveChainDataProvider(env = {}, options = {}) {
  const kind = normalizeProviderKind(options.kind || configuredChainDataProviderKind(env))
  if (kind === CHAIN_DATA_PROVIDER_JSON_RPC) return new JsonRpcChainDataProvider({ client: options.client })
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
