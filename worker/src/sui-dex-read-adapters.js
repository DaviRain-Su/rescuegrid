import {
  SUI_DEX_VOLUME_BASELINE,
  SUI_PROTOCOL_REGISTRY_SOURCE,
  getSuiProtocolBySlug,
} from './sui-protocol-registry.js'
import { getSuiAdapterCandidateById } from './sui-adapter-candidates.js'
import { listSuiWatchMarkets } from './sui-watch-registry.js'

export const SUI_DEX_READ_ADAPTER_SOURCE = Object.freeze({
  assessed_at: '2026-06-03',
  protocol_registry_refreshed_at: SUI_PROTOCOL_REGISTRY_SOURCE.refreshed_at,
  scope: 'Sui-only liquid DEX read adapter registry. This is a quote/depth/spread read surface, not an executor registry.',
  coverage_basis: 'DeepBook plus Sui DEX protocols that clear the current TVL or DEX-volume baseline.',
})

const COMMON_QUOTE_FIELDS = Object.freeze([
  'base_asset',
  'quote_asset',
  'best_bid_or_quote_out',
  'best_ask_or_quote_in',
  'mid_price',
  'spread_bps',
  'price_impact_bps',
  'fee_bps',
  'volume_24h_usd',
  'depth_usd_1pct',
  'data_freshness_ms',
])

const ORDERBOOK_READ_FIELDS = Object.freeze([
  ...COMMON_QUOTE_FIELDS,
  'pool_id',
  'orderbook_best_bid',
  'orderbook_best_ask',
  'base_depth',
  'quote_depth',
])

const CLMM_READ_FIELDS = Object.freeze([
  ...COMMON_QUOTE_FIELDS,
  'clmm_pool_id',
  'current_sqrt_price',
  'current_tick_index',
  'tick_spacing',
  'pool_liquidity',
  'fee_growth',
  'reward_growth',
])

const ROUTE_AGGREGATOR_READ_FIELDS = Object.freeze([
  ...COMMON_QUOTE_FIELDS,
  'route_id',
  'route_legs',
  'allowed_venues',
  'quote_amount_in',
  'quote_amount_out',
])

const READ_PREFLIGHT_GATES = Object.freeze([
  'protocol_registered_in_sui_coverage',
  'watch_market_row_exists',
  'data_source_allowed_for_sui_branch',
  'quote_staleness_below_threshold',
  'no_execution_authority_requested',
])

const SPREAD_MATRIX_FIELDS = Object.freeze([
  'market_key',
  'base_asset',
  'quote_family',
  'left_protocol_slug',
  'right_protocol_slug',
  'left_quote',
  'right_quote',
  'gross_spread_bps',
  'fee_adjusted_spread_bps',
  'min_depth_usd',
  'staleness_ms',
])

const DEX_ROWS = [
  {
    protocol_slug: 'deepbook-v3',
    adapter_kind: 'deepbook-read',
    quote_model: 'orderbook',
    implementation_stage: 'metadata_ready',
    sdk_status: 'worker_deepbook_pool_metadata_configured',
    target_schema: ['pool_id', 'base_coin_type', 'quote_coin_type'],
    read_fields: ORDERBOOK_READ_FIELDS,
    execution_adapter_registered: true,
    execution_blocker_code: 'FUNDING_GATED',
    notes: 'DeepBook pool metadata is configured and the execution adapter exists, but live order execution remains blocked until DBUSDC/DEEP funding is real.',
  },
  {
    protocol_slug: 'cetus-clmm',
    adapter_kind: 'sui-clmm-read',
    quote_model: 'clmm',
    candidate_id: 'sui-clmm:cetus-clmm',
    implementation_stage: 'sdk_pending',
    sdk_status: 'official_sdk_confirmed_read_not_wired',
    read_fields: CLMM_READ_FIELDS,
    execution_adapter_registered: false,
    execution_blocker_code: 'READ_ONLY_ADAPTER',
    notes: 'Cetus is the first CLMM read-adapter target; quote/depth reads must be wired through the official SDK before any execution adapter can be considered.',
  },
  {
    protocol_slug: 'turbos',
    adapter_kind: 'sui-clmm-read',
    quote_model: 'clmm',
    candidate_id: 'sui-clmm:turbos',
    implementation_stage: 'sdk_pending',
    sdk_status: 'npm_sdk_confirmed_read_not_wired',
    read_fields: CLMM_READ_FIELDS,
    execution_adapter_registered: false,
    execution_blocker_code: 'READ_ONLY_ADAPTER',
    notes: 'Turbos is included because it clears the Sui DEX volume exception baseline; execution remains blocked until docs, pool schemas and target constraints are verified.',
  },
  {
    protocol_slug: 'momentum',
    adapter_kind: 'sui-clmm-read',
    quote_model: 'clmm',
    candidate_id: 'sui-clmm:momentum',
    implementation_stage: 'sdk_pending',
    sdk_status: 'npm_sdk_confirmed_read_not_wired',
    read_fields: CLMM_READ_FIELDS,
    execution_adapter_registered: false,
    execution_blocker_code: 'READ_ONLY_ADAPTER',
    notes: 'Momentum read support is limited to quote/depth metadata until CLMM pool ids, tick constraints and API freshness rules are wired.',
  },
  {
    protocol_slug: 'bluefin-spot',
    adapter_kind: 'sui-spot-aggregator-read',
    quote_model: 'route_aggregator',
    candidate_id: 'sui-spot-aggregator:bluefin-spot',
    implementation_stage: 'sdk_pending',
    sdk_status: 'aggregator_sdk_confirmed_read_not_wired',
    read_fields: ROUTE_AGGREGATOR_READ_FIELDS,
    execution_adapter_registered: false,
    execution_blocker_code: 'READ_ONLY_ADAPTER',
    notes: 'Bluefin Spot is a route-aggregator read target only; broad route signing is not acceptable without decomposed allowed venues and targets.',
  },
]

function cloneArray(value) {
  return Object.freeze([...(value || [])])
}

function volumeFor(slug) {
  return SUI_DEX_VOLUME_BASELINE.find((row) => row.slug === slug) || null
}

function watchMarketsFor(slug) {
  return listSuiWatchMarkets()
    .filter((market) => market.protocol_slug === slug && market.market_type === 'spot')
    .map((market) => ({
      id: market.id,
      market_id: market.market_id,
      base_asset: market.base_asset,
      quote_asset: market.quote_asset,
      target_kind: market.target_kind,
      target_id: market.target_id,
      data_sources: [...market.data_sources],
    }))
}

function dexReadAdapterRecord(row) {
  const protocol = getSuiProtocolBySlug(row.protocol_slug)
  if (!protocol) throw new Error(`Sui DEX read adapter references unregistered protocol: ${row.protocol_slug}`)

  const candidate = row.candidate_id ? getSuiAdapterCandidateById(row.candidate_id) : null
  if (row.candidate_id && !candidate) throw new Error(`Sui DEX read adapter references missing candidate: ${row.candidate_id}`)

  const markets = watchMarketsFor(row.protocol_slug)
  if (markets.length === 0) throw new Error(`Sui DEX read adapter has no watch markets: ${row.protocol_slug}`)

  const volume = volumeFor(row.protocol_slug)
  const targetSchema = row.target_schema || candidate?.target_schema || []

  return Object.freeze({
    id: `${row.adapter_kind}:${row.protocol_slug}`,
    chain: 'sui',
    protocol_slug: row.protocol_slug,
    protocol_name: protocol.name,
    protocol_category: protocol.category,
    protocol_category_class: protocol.category_class,
    protocol_adapter_status: protocol.adapter_status,
    coverage_reason: protocol.coverage_reason,
    dex_volume_rank: volume?.rank ?? protocol.dex_volume_rank ?? null,
    dex_volume_24h_usd: volume?.volume_24h_usd ?? protocol.dex_volume_24h_usd ?? null,
    dex_volume_7d_usd: volume?.volume_7d_usd ?? protocol.dex_volume_7d_usd ?? null,
    adapter_kind: row.adapter_kind,
    quote_model: row.quote_model,
    implementation_stage: row.implementation_stage,
    sdk_status: row.sdk_status,
    candidate_id: row.candidate_id ?? null,
    read_adapter_registered: true,
    execution_adapter_registered: row.execution_adapter_registered,
    registered_executor: row.execution_adapter_registered,
    execution_enabled: false,
    autonomous_execution_allowed: false,
    execution_blocker_code: row.execution_blocker_code,
    target_schema: cloneArray(targetSchema),
    read_fields: cloneArray(row.read_fields),
    read_preflight_gates: cloneArray(READ_PREFLIGHT_GATES),
    supported_markets: Object.freeze(markets.map(Object.freeze)),
    notes: row.notes,
  })
}

export const SUI_DEX_READ_ADAPTERS = Object.freeze(DEX_ROWS.map(dexReadAdapterRecord))

const SPREAD_MARKET_PROTOCOLS = Object.freeze([
  'deepbook-v3',
  'cetus-clmm',
  'bluefin-spot',
  'turbos',
  'momentum',
])

function spreadMatrixRow(leftSlug, rightSlug) {
  const left = SUI_DEX_READ_ADAPTERS.find((adapter) => adapter.protocol_slug === leftSlug)
  const right = SUI_DEX_READ_ADAPTERS.find((adapter) => adapter.protocol_slug === rightSlug)
  if (!left || !right) throw new Error(`Missing DEX read adapter for spread pair: ${leftSlug}/${rightSlug}`)
  return Object.freeze({
    id: `sui-usd-stable:${leftSlug}:${rightSlug}`,
    chain: 'sui',
    market_key: 'SUI/USD_STABLE',
    base_asset: 'SUI',
    quote_family: 'usd-stable',
    left_protocol_slug: leftSlug,
    left_protocol_name: left.protocol_name,
    left_adapter_id: left.id,
    right_protocol_slug: rightSlug,
    right_protocol_name: right.protocol_name,
    right_adapter_id: right.id,
    comparable_quotes_required: cloneArray(SPREAD_MATRIX_FIELDS),
    execution_enabled: false,
    autonomous_execution_allowed: false,
    execution_blocker_code: 'READ_ONLY_SPREAD_MATRIX',
    notes: 'Spread rows define the comparable quote/depth shape only; they do not claim a live arbitrage spread or execution authority.',
  })
}

function buildSpreadMatrixRows(protocolSlugs) {
  const rows = []
  for (let i = 0; i < protocolSlugs.length; i += 1) {
    for (let j = i + 1; j < protocolSlugs.length; j += 1) {
      rows.push(spreadMatrixRow(protocolSlugs[i], protocolSlugs[j]))
    }
  }
  return rows
}

export const SUI_DEX_SPREAD_MATRIX = Object.freeze(buildSpreadMatrixRows(SPREAD_MARKET_PROTOCOLS))

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] || 0) + 1
    return acc
  }, {})
}

function cloneAdapter(row) {
  return {
    ...row,
    target_schema: [...row.target_schema],
    read_fields: [...row.read_fields],
    read_preflight_gates: [...row.read_preflight_gates],
    supported_markets: row.supported_markets.map((market) => ({
      ...market,
      data_sources: [...market.data_sources],
    })),
  }
}

function cloneSpreadRow(row) {
  return {
    ...row,
    comparable_quotes_required: [...row.comparable_quotes_required],
  }
}

export function listSuiDexReadAdapters({ includeSdkPending = true } = {}) {
  const rows = includeSdkPending
    ? SUI_DEX_READ_ADAPTERS
    : SUI_DEX_READ_ADAPTERS.filter((row) => row.implementation_stage !== 'sdk_pending')
  return rows.map(cloneAdapter)
}

export function listSuiDexSpreadMatrix({ includeSdkPending = true } = {}) {
  const allowedAdapterIds = new Set(listSuiDexReadAdapters({ includeSdkPending }).map((row) => row.id))
  return SUI_DEX_SPREAD_MATRIX
    .filter((row) => allowedAdapterIds.has(row.left_adapter_id) && allowedAdapterIds.has(row.right_adapter_id))
    .map(cloneSpreadRow)
}

export function getSuiDexReadAdapterData({ includeSdkPending = true } = {}) {
  const adapters = listSuiDexReadAdapters({ includeSdkPending })
  const spreadMatrix = listSuiDexSpreadMatrix({ includeSdkPending })
  return {
    status: 'ok',
    chain: 'sui',
    sources: SUI_DEX_READ_ADAPTER_SOURCE,
    counts: {
      total_adapters: adapters.length,
      total_supported_markets: adapters.reduce((sum, row) => sum + row.supported_markets.length, 0),
      total_spread_pairs: spreadMatrix.length,
      by_quote_model: countBy(adapters, 'quote_model'),
      by_implementation_stage: countBy(adapters, 'implementation_stage'),
      by_execution_blocker_code: countBy(adapters, 'execution_blocker_code'),
    },
    adapters,
    spread_matrix: spreadMatrix,
  }
}

export function getSuiDexReadAdapterById(id) {
  return listSuiDexReadAdapters().find((adapter) => adapter.id === id) || null
}
