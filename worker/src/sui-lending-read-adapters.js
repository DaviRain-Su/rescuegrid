import {
  SUI_PROTOCOL_REGISTRY_SOURCE,
  getSuiProtocolBySlug,
} from './sui-protocol-registry.js'
import { getSuiAdapterCandidateById } from './sui-adapter-candidates.js'
import { listSuiWatchMarkets } from './sui-watch-registry.js'

export const SUI_LENDING_READ_ADAPTER_SOURCE = Object.freeze({
  assessed_at: '2026-06-03',
  protocol_registry_refreshed_at: SUI_PROTOCOL_REGISTRY_SOURCE.refreshed_at,
  scope: 'Sui-only lending reserve and obligation health read adapter registry. This is not an executor registry.',
  coverage_basis: 'NAVI, Suilend, Scallop and AlphaLend from the current Sui lending execution-candidate set.',
})

const RESERVE_READ_FIELDS = Object.freeze([
  'lending_market_id',
  'reserve_id',
  'reserve_coin_type',
  'reserve_available_amount',
  'reserve_supply_amount',
  'reserve_borrowed_amount',
  'supply_apy_bps',
  'borrow_apy_bps',
  'utilization_bps',
  'withdrawal_liquidity',
  'oracle_price',
  'oracle_staleness_ms',
])

const OBLIGATION_READ_FIELDS = Object.freeze([
  'obligation_id',
  'obligation_owner_cap_id_or_key_id',
  'collateral_value_usd',
  'debt_value_usd',
  'health_factor_bps',
  'open_ltv_bps',
  'close_ltv_bps',
  'borrow_limit_usd',
  'liquidation_buffer_bps',
])

const HEALTH_GUARD_FIELDS = Object.freeze([
  'min_health_factor_bps',
  'max_ltv_bps',
  'repay_asset',
  'repay_amount',
  'post_repay_health_factor_bps',
  'post_repay_ltv_bps',
  'withdrawal_liquidity_after_action',
])

const READ_PREFLIGHT_GATES = Object.freeze([
  'protocol_registered_in_sui_coverage',
  'watch_market_row_exists',
  'reserve_state_fresh',
  'obligation_state_fresh_when_present',
  'oracle_not_stale',
  'withdrawal_liquidity_read',
  'owner_cap_or_obligation_key_verified_before_action',
  'no_execution_authority_requested',
])

const HEALTH_MATRIX_FIELDS = Object.freeze([
  'protocol_slug',
  'market_key',
  'reserve_asset',
  'position_owner',
  'collateral_value_usd',
  'debt_value_usd',
  'health_factor_bps',
  'ltv_bps',
  'liquidation_buffer_bps',
  'repay_candidate_amount',
  'post_repay_health_factor_bps',
  'oracle_staleness_ms',
  'withdrawal_liquidity',
])

const LENDING_ROWS = [
  {
    protocol_slug: 'navi-lending',
    candidate_id: 'sui-lending:navi-lending',
    adapter_kind: 'sui-lending-read',
    health_model: 'pool_receipt_position',
    implementation_stage: 'research_pending',
    sdk_status: 'docs_only_sdk_or_package_addresses_needed',
    target_binding: ['pool_id', 'receipt_token_type', 'collateral_asset_type', 'borrow_asset_type', 'user_position_or_account_id?'],
    execution_blocker_code: 'RESEARCH_PENDING_READ_ONLY',
    notes: 'NAVI remains read-only until package addresses, SDK read APIs and position semantics are verified.',
  },
  {
    protocol_slug: 'suilend',
    candidate_id: 'sui-lending:suilend',
    adapter_kind: 'sui-lending-read',
    health_model: 'lending_market_obligation_owner_cap',
    implementation_stage: 'sdk_pending',
    sdk_status: 'official_sdk_confirmed_read_not_wired',
    target_binding: ['lending_market_id', 'lending_market_type', 'reserve_id', 'reserve_coin_type', 'obligation_id?', 'obligation_owner_cap_id?'],
    execution_blocker_code: 'READ_ONLY_LENDING_ADAPTER',
    notes: 'Suilend can be wired through its SDK later; owner cap and obligation state must be bound before any guarded repay/withdraw action.',
  },
  {
    protocol_slug: 'scallop-lend',
    candidate_id: 'sui-lending:scallop-lend',
    adapter_kind: 'sui-lending-read',
    health_model: 'market_reserve_obligation_key',
    implementation_stage: 'sdk_pending',
    sdk_status: 'official_sdk_confirmed_read_not_wired',
    target_binding: ['lending_market_id', 'reserve_id', 'reserve_coin_type', 'obligation_id?', 'obligation_key_id?'],
    execution_blocker_code: 'READ_ONLY_LENDING_ADAPTER',
    notes: 'Scallop borrow/repay reads must bind the wallet-owned ObligationKey before any action can be considered.',
  },
  {
    protocol_slug: 'alphalend',
    candidate_id: 'sui-lending:alphalend',
    adapter_kind: 'sui-lending-read',
    health_model: 'research_pending_lending_position',
    implementation_stage: 'research_pending',
    sdk_status: 'research_pending',
    target_binding: ['lending_market_id?', 'reserve_id?', 'reserve_coin_type?', 'position_or_obligation_id?'],
    execution_blocker_code: 'RESEARCH_PENDING_READ_ONLY',
    notes: 'AlphaLend stays read-only until official package addresses, SDK APIs, position model and liquidation semantics are verified.',
  },
]

function watchMarketsFor(slug) {
  return listSuiWatchMarkets()
    .filter((market) => market.protocol_slug === slug && market.market_type === 'lending')
    .map((market) => ({
      id: market.id,
      market_id: market.market_id,
      base_asset: market.base_asset,
      quote_asset: market.quote_asset,
      execution_mode: market.execution_mode,
      data_sources: [...market.data_sources],
    }))
}

function cloneArray(value) {
  return Object.freeze([...(value || [])])
}

function lendingReadAdapterRecord(row) {
  const protocol = getSuiProtocolBySlug(row.protocol_slug)
  if (!protocol) throw new Error(`Sui lending read adapter references unregistered protocol: ${row.protocol_slug}`)
  const candidate = getSuiAdapterCandidateById(row.candidate_id)
  if (!candidate) throw new Error(`Sui lending read adapter references missing candidate: ${row.candidate_id}`)
  const markets = watchMarketsFor(row.protocol_slug)
  if (markets.length === 0) throw new Error(`Sui lending read adapter has no watch markets: ${row.protocol_slug}`)

  return Object.freeze({
    id: `${row.adapter_kind}:${row.protocol_slug}`,
    chain: 'sui',
    protocol_slug: row.protocol_slug,
    protocol_name: protocol.name,
    protocol_category: protocol.category,
    protocol_category_class: protocol.category_class,
    protocol_adapter_status: protocol.adapter_status,
    sui_tvl_rank: protocol.sui_tvl_rank,
    sui_tvl_usd: protocol.sui_tvl_usd,
    candidate_id: row.candidate_id,
    adapter_kind: row.adapter_kind,
    health_model: row.health_model,
    implementation_stage: row.implementation_stage,
    sdk_status: row.sdk_status,
    read_adapter_registered: true,
    execution_adapter_registered: false,
    registered_executor: false,
    execution_enabled: false,
    autonomous_execution_allowed: false,
    execution_blocker_code: row.execution_blocker_code,
    reserve_read_fields: cloneArray(RESERVE_READ_FIELDS),
    obligation_read_fields: cloneArray(OBLIGATION_READ_FIELDS),
    health_guard_fields: cloneArray(HEALTH_GUARD_FIELDS),
    read_preflight_gates: cloneArray(READ_PREFLIGHT_GATES),
    target_binding: cloneArray(row.target_binding),
    supported_markets: Object.freeze(markets.map(Object.freeze)),
    notes: row.notes,
  })
}

export const SUI_LENDING_READ_ADAPTERS = Object.freeze(LENDING_ROWS.map(lendingReadAdapterRecord))

function healthMatrixRow(adapter) {
  return Object.freeze({
    id: `borrow-health:${adapter.protocol_slug}`,
    chain: 'sui',
    protocol_slug: adapter.protocol_slug,
    protocol_name: adapter.protocol_name,
    adapter_id: adapter.id,
    health_model: adapter.health_model,
    supported_markets: Object.freeze(adapter.supported_markets.map((market) => market.id)),
    required_health_fields: cloneArray(HEALTH_MATRIX_FIELDS),
    execution_enabled: false,
    autonomous_execution_allowed: false,
    execution_blocker_code: 'READ_ONLY_HEALTH_MATRIX',
    notes: 'Health rows define reserve/obligation fields required for borrow health, repay dry-run and liquidation-buffer monitoring; they do not execute repay or withdraw actions.',
  })
}

export const SUI_LENDING_HEALTH_MATRIX = Object.freeze(SUI_LENDING_READ_ADAPTERS.map(healthMatrixRow))

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] || 0) + 1
    return acc
  }, {})
}

function cloneAdapter(row) {
  return {
    ...row,
    reserve_read_fields: [...row.reserve_read_fields],
    obligation_read_fields: [...row.obligation_read_fields],
    health_guard_fields: [...row.health_guard_fields],
    read_preflight_gates: [...row.read_preflight_gates],
    target_binding: [...row.target_binding],
    supported_markets: row.supported_markets.map((market) => ({
      ...market,
      data_sources: [...market.data_sources],
    })),
  }
}

function cloneHealthRow(row) {
  return {
    ...row,
    supported_markets: [...row.supported_markets],
    required_health_fields: [...row.required_health_fields],
  }
}

export function listSuiLendingReadAdapters({ includeResearchPending = true } = {}) {
  const rows = includeResearchPending
    ? SUI_LENDING_READ_ADAPTERS
    : SUI_LENDING_READ_ADAPTERS.filter((row) => row.implementation_stage !== 'research_pending')
  return rows.map(cloneAdapter)
}

export function listSuiLendingHealthMatrix({ includeResearchPending = true } = {}) {
  const allowedAdapterIds = new Set(listSuiLendingReadAdapters({ includeResearchPending }).map((row) => row.id))
  return SUI_LENDING_HEALTH_MATRIX
    .filter((row) => allowedAdapterIds.has(row.adapter_id))
    .map(cloneHealthRow)
}

export function getSuiLendingReadAdapterData({ includeResearchPending = true } = {}) {
  const adapters = listSuiLendingReadAdapters({ includeResearchPending })
  const healthMatrix = listSuiLendingHealthMatrix({ includeResearchPending })
  return {
    status: 'ok',
    chain: 'sui',
    sources: SUI_LENDING_READ_ADAPTER_SOURCE,
    counts: {
      total_adapters: adapters.length,
      total_supported_markets: adapters.reduce((sum, row) => sum + row.supported_markets.length, 0),
      total_health_rows: healthMatrix.length,
      by_implementation_stage: countBy(adapters, 'implementation_stage'),
      by_sdk_status: countBy(adapters, 'sdk_status'),
      by_execution_blocker_code: countBy(adapters, 'execution_blocker_code'),
    },
    adapters,
    health_matrix: healthMatrix,
  }
}

export function getSuiLendingReadAdapterById(id) {
  return listSuiLendingReadAdapters().find((adapter) => adapter.id === id) || null
}
