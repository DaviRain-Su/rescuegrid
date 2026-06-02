import { DEPLOYMENT } from './sui-tx.js'
import {
  SUI_PROTOCOL_REGISTRY_SOURCE,
  getSuiProtocolBySlug,
} from './sui-protocol-registry.js'

export const SUI_WATCH_REGISTRY_SOURCE = Object.freeze({
  refreshed_at: SUI_PROTOCOL_REGISTRY_SOURCE.refreshed_at,
  protocol_registry: 'worker/src/sui-protocol-registry.js',
  scope: 'Sui-only market watch metadata. No CEX, bridge, EVM, Solana or Aptos venue is included.',
})

const DEEPBOOK_POOLS = DEPLOYMENT.deepbook.pools

const MARKET_ROWS = [
  {
    id: 'deepbook-v3:SUI_DBUSDC',
    protocol_slug: 'deepbook-v3',
    venue: 'DeepBook V3',
    market_type: 'spot',
    market_id: 'SUI_DBUSDC',
    base_asset: 'SUI',
    quote_asset: 'DBUSDC',
    execution_mode: 'live_executor_funding_gated',
    adapter_kind: 'deepbook',
    target_kind: 'pool_id',
    target_id: DEEPBOOK_POOLS.SUI_DBUSDC.pool_id,
    data_sources: ['deepbook-indexer', 'sui-rpc', 'defillama'],
  },
  {
    id: 'deepbook-v3:DEEP_DBUSDC',
    protocol_slug: 'deepbook-v3',
    venue: 'DeepBook V3',
    market_type: 'spot',
    market_id: 'DEEP_DBUSDC',
    base_asset: 'DEEP',
    quote_asset: 'DBUSDC',
    execution_mode: 'live_executor_funding_gated',
    adapter_kind: 'deepbook',
    target_kind: 'pool_id',
    target_id: DEEPBOOK_POOLS.DEEP_DBUSDC.pool_id,
    data_sources: ['deepbook-indexer', 'sui-rpc', 'defillama'],
  },
  {
    id: 'deepbook-v3:WAL_DBUSDC',
    protocol_slug: 'deepbook-v3',
    venue: 'DeepBook V3',
    market_type: 'spot',
    market_id: 'WAL_DBUSDC',
    base_asset: 'WAL',
    quote_asset: 'DBUSDC',
    execution_mode: 'live_executor_funding_gated',
    adapter_kind: 'deepbook',
    target_kind: 'pool_id',
    target_id: DEEPBOOK_POOLS.WAL_DBUSDC.pool_id,
    data_sources: ['deepbook-indexer', 'sui-rpc', 'defillama'],
  },
  ['cetus-clmm', 'Cetus CLMM', 'spot', 'SUI/USDC', 'SUI', 'USDC', 'adapter_candidate', ['defillama', 'sui-rpc', 'cetus-public-api']],
  ['cetus-clmm', 'Cetus CLMM', 'spot', 'DEEP/SUI', 'DEEP', 'SUI', 'adapter_candidate', ['defillama', 'sui-rpc', 'cetus-public-api']],
  ['bluefin-spot', 'Bluefin Spot', 'spot', 'SUI/USDC', 'SUI', 'USDC', 'adapter_candidate', ['defillama', 'sui-rpc', 'bluefin-public-api']],
  ['turbos', 'Turbos', 'spot', 'SUI/USDC', 'SUI', 'USDC', 'adapter_candidate', ['defillama', 'sui-rpc', 'turbos-public-api']],
  ['momentum', 'Momentum', 'spot', 'SUI/USDC', 'SUI', 'USDC', 'adapter_candidate', ['defillama', 'sui-rpc', 'momentum-public-api']],

  ['navi-lending', 'NAVI Lending', 'lending', 'SUI borrow health', 'SUI', null, 'adapter_candidate', ['defillama', 'sui-rpc', 'navi-public-api']],
  ['navi-lending', 'NAVI Lending', 'lending', 'USDC supply', 'USDC', null, 'adapter_candidate', ['defillama', 'sui-rpc', 'navi-public-api']],
  ['suilend', 'Suilend', 'lending', 'USDC supply', 'USDC', null, 'adapter_candidate', ['defillama', 'sui-rpc', 'suilend-public-api']],
  ['scallop-lend', 'Scallop Lend', 'lending', 'USDC supply', 'USDC', null, 'adapter_candidate', ['defillama', 'sui-rpc', 'scallop-public-api']],
  ['alphalend', 'AlphaLend', 'lending', 'USDC supply', 'USDC', null, 'adapter_candidate', ['defillama', 'sui-rpc', 'alphalend-public-api']],
  ['current', 'Current', 'lending', 'haSUI lending', 'haSUI', null, 'watch_only', ['defillama', 'sui-rpc']],

  ['springsui', 'SpringSui', 'lst', 'sSUI/SUI', 'sSUI', 'SUI', 'watch_only', ['defillama', 'sui-rpc']],
  ['haedal-protocol', 'Haedal Protocol', 'lst', 'haSUI/SUI', 'haSUI', 'SUI', 'watch_only', ['defillama', 'sui-rpc']],
  ['volo-lst', 'Volo LST', 'lst', 'vSUI/SUI', 'vSUI', 'SUI', 'watch_only', ['defillama', 'sui-rpc']],
  ['alphafi-stsui', 'AlphaFi stSUI', 'lst', 'stSUI/SUI', 'stSUI', 'SUI', 'watch_only', ['defillama', 'sui-rpc']],

  ['bucket-farm', 'Bucket Farm', 'farm', 'BUCK farm', 'BUCK', null, 'watch_only', ['defillama', 'sui-rpc']],
  ['bucket-cdp', 'Bucket CDP', 'cdp', 'BUCK CDP', 'BUCK', null, 'watch_only', ['defillama', 'sui-rpc']],
  ['bucket-protocol-v2', 'Bucket Protocol V2', 'cdp', 'BUCK V2 CDP', 'BUCK', null, 'watch_only', ['defillama', 'sui-rpc']],
  ['alphafi-agg', 'AlphaFi Agg', 'vault', 'SUI yield aggregator', 'SUI', null, 'watch_only', ['defillama', 'sui-rpc']],
  ['volo-vault', 'Volo Vault', 'vault', 'vSUI vault', 'vSUI', null, 'watch_only', ['defillama', 'sui-rpc']],
  ['kai-finance', 'Kai Finance', 'vault', 'USDC leveraged farming', 'USDC', null, 'watch_only', ['defillama', 'sui-rpc']],
  ['mole', 'Mole', 'vault', 'USDC strategy', 'USDC', null, 'watch_only', ['defillama', 'sui-rpc']],
  ['ember-protocol', 'Ember Protocol', 'vault', 'USDC allocator', 'USDC', null, 'display_only', ['defillama', 'sui-rpc']],

  ['ondo-yield-assets', 'Ondo Yield Assets', 'rwa', 'USDY', 'USDY', null, 'display_only', ['defillama', 'sui-rpc']],
  ['kaio', 'KAIO', 'rwa', 'RWA vault', 'RWA', null, 'display_only', ['defillama', 'sui-rpc']],
  ['matrixdock-xaum', 'MatrixDock XAUM', 'rwa', 'XAUM', 'XAUM', null, 'display_only', ['defillama', 'sui-rpc']],

  ['bluefin-pro', 'Bluefin Pro', 'perps', 'SUI-PERP', 'SUI', 'USDC', 'watch_only', ['defillama', 'sui-rpc', 'bluefin-public-api']],
  ['sudo-perps', 'Sudo Perps', 'perps', 'SUI-PERP', 'SUI', 'USDC', 'watch_only', ['defillama', 'sui-rpc']],
]

function normalizeMarket(row) {
  if (!Array.isArray(row)) return row
  const [protocolSlug, venue, marketType, marketId, baseAsset, quoteAsset, executionMode, dataSources] = row
  return {
    id: `${protocolSlug}:${String(marketId).replaceAll('/', '_').replaceAll(' ', '_')}`,
    protocol_slug: protocolSlug,
    venue,
    market_type: marketType,
    market_id: marketId,
    base_asset: baseAsset,
    quote_asset: quoteAsset,
    execution_mode: executionMode,
    adapter_kind: null,
    target_kind: null,
    target_id: null,
    data_sources: dataSources,
  }
}

function marketRecord(row) {
  const normalized = normalizeMarket(row)
  const protocol = getSuiProtocolBySlug(normalized.protocol_slug)
  if (!protocol) throw new Error(`Sui watch market references unregistered protocol: ${normalized.protocol_slug}`)
  const executorConfigured = normalized.execution_mode === 'live_executor_funding_gated'
  const executionEnabled = normalized.execution_mode === 'live_executor_ready'
  return Object.freeze({
    ...normalized,
    chain: 'sui',
    protocol_name: protocol.name,
    protocol_category: protocol.category,
    protocol_category_class: protocol.category_class,
    protocol_adapter_status: protocol.adapter_status,
    coverage_reason: protocol.coverage_reason,
    sui_tvl_rank: protocol.sui_tvl_rank,
    sui_tvl_usd: protocol.sui_tvl_usd,
    dex_volume_rank: protocol.dex_volume_rank,
    dex_volume_24h_usd: protocol.dex_volume_24h_usd,
    dex_volume_7d_usd: protocol.dex_volume_7d_usd,
    risk_tags: protocol.risk_tags,
    monitor_allowed: protocol.monitor_allowed,
    executor_configured: executorConfigured,
    execution_enabled: executionEnabled,
    autonomous_execution_allowed: executionEnabled,
    execution_blocker_code: executorConfigured && !executionEnabled ? 'FUNDING_GATED' : null,
  })
}

export const SUI_WATCH_MARKETS = Object.freeze(MARKET_ROWS.map(marketRecord))

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] || 0) + 1
    return acc
  }, {})
}

export function listSuiWatchMarkets({ includeDisplayOnly = true } = {}) {
  const rows = includeDisplayOnly
    ? SUI_WATCH_MARKETS
    : SUI_WATCH_MARKETS.filter((market) => market.execution_mode !== 'display_only')
  return rows.map((market) => ({
    ...market,
    risk_tags: [...market.risk_tags],
    data_sources: [...market.data_sources],
  }))
}

export function getSuiWatchData({ includeDisplayOnly = true } = {}) {
  const markets = listSuiWatchMarkets({ includeDisplayOnly })
  return {
    status: 'ok',
    chain: 'sui',
    coverage_pool: 'defillama_sui_top_26_plus_volume_exceptions',
    sources: SUI_WATCH_REGISTRY_SOURCE,
    counts: {
      total_markets: markets.length,
      by_market_type: countBy(markets, 'market_type'),
      by_execution_mode: countBy(markets, 'execution_mode'),
      by_protocol_adapter_status: countBy(markets, 'protocol_adapter_status'),
    },
    markets,
  }
}

export function getSuiWatchMarketById(id) {
  return listSuiWatchMarkets().find((market) => market.id === id) || null
}
