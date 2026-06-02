import {
  SUI_PROTOCOL_REGISTRY_SOURCE,
  getSuiProtocolBySlug,
} from './sui-protocol-registry.js'

export const SUI_WATCH_ONLY_BOUNDARY_SOURCE = Object.freeze({
  assessed_at: '2026-06-03',
  protocol_registry_refreshed_at: SUI_PROTOCOL_REGISTRY_SOURCE.refreshed_at,
  scope: 'Sui-only H6 watch-only protocol boundaries. These rows define read surfaces and explicit no-execution constraints.',
})

const COMMON_BLOCKERS = Object.freeze([
  'no_executor_adapter_registered',
  'no_wrapper_fields_for_target_semantics',
  'no_guardian_conformance_tests',
])

const LST_READ_FIELDS = Object.freeze([
  'exchange_rate',
  'staking_apy',
  'redemption_liquidity',
  'withdrawal_delay',
  'peg_deviation_bps',
  'protocol_tvl_usd',
])

const LST_RISKS = Object.freeze([
  'redemption',
  'liquidity',
  'oracle',
  'smart_contract',
])

const RWA_READ_FIELDS = Object.freeze([
  'issuer_nav',
  'token_price',
  'secondary_liquidity',
  'redemption_terms',
  'settlement_calendar',
  'issuer_disclosures',
])

const RWA_RISKS = Object.freeze([
  'issuer',
  'liquidity',
  'settlement',
  'compliance',
  'smart_contract',
])

const PERPS_READ_FIELDS = Object.freeze([
  'funding_rate',
  'mark_price',
  'index_price',
  'open_interest',
  'margin_requirement',
  'liquidation_buffer',
  'venue_status',
])

const PERPS_RISKS = Object.freeze([
  'funding_flip',
  'liquidation',
  'market',
  'venue',
  'oracle',
])

function boundary({
  id,
  label,
  protocolSlugs = [],
  registryStatus = 'registry_backed',
  boundaryClass,
  firstSurface,
  readableState,
  riskDomains,
  noExecutionReasons,
  requiredTargetFields,
  dataSources = ['defillama', 'sui-rpc'],
  notes,
}) {
  return {
    id,
    label,
    protocol_slugs: protocolSlugs,
    registry_status: registryStatus,
    boundary_class: boundaryClass,
    first_surface: firstSurface,
    readable_state: readableState,
    risk_domains: riskDomains,
    no_execution_reasons: [...COMMON_BLOCKERS, ...noExecutionReasons],
    required_target_fields: requiredTargetFields,
    data_sources: dataSources,
    notes,
  }
}

const BOUNDARY_ROWS = [
  boundary({
    id: 'bucket',
    label: 'Bucket',
    protocolSlugs: ['bucket-farm', 'bucket-cdp', 'bucket-protocol-v2'],
    boundaryClass: 'cdp_farm',
    firstSurface: 'CDP, BUCK peg and farm risk monitor',
    readableState: ['collateral_value', 'debt_amount', 'buck_peg', 'liquidation_buffer', 'farm_tvl', 'reward_apr'],
    riskDomains: ['liquidation', 'peg', 'redemption', 'liquidity', 'smart_contract'],
    noExecutionReasons: ['cdp_repay_sizing_unspecified', 'buck_peg_oracle_constraints_unspecified'],
    requiredTargetFields: ['cdp_position_id', 'collateral_coin_type', 'debt_coin_type', 'max_deleverage_amount', 'min_buck_peg_bps'],
    notes: 'Treat Bucket as a CDP/farm watch surface until repay sizing, BUCK peg and position target fields are specified.',
  }),
  boundary({
    id: 'current',
    label: 'Current',
    protocolSlugs: ['current'],
    boundaryClass: 'lending_watch',
    firstSurface: 'haSUI lending and borrow-health monitor',
    readableState: ['market_utilization', 'supply_apy', 'borrow_apy', 'collateral_value', 'debt_value', 'health_factor'],
    riskDomains: ['liquidation', 'oracle', 'liquidity', 'smart_contract'],
    noExecutionReasons: ['lending_market_schema_unverified', 'health_factor_guard_not_implemented'],
    requiredTargetFields: ['lending_market_id', 'reserve_id', 'obligation_id', 'min_health_factor_bps'],
    notes: 'Current remains watch-only until its market and obligation target semantics are verified like Suilend/Scallop.',
  }),
  boundary({
    id: 'springsui',
    label: 'SpringSui',
    protocolSlugs: ['springsui'],
    boundaryClass: 'lst',
    firstSurface: 'LST redemption and peg monitor',
    readableState: [...LST_READ_FIELDS],
    riskDomains: [...LST_RISKS],
    noExecutionReasons: ['lst_redemption_flow_unspecified', 'exchange_rate_guard_not_implemented'],
    requiredTargetFields: ['lst_coin_type', 'underlying_coin_type', 'max_peg_deviation_bps', 'min_redemption_liquidity'],
    notes: 'Show yield, exchange-rate and redemption risk before any supply/redeem authority.',
  }),
  boundary({
    id: 'haedal',
    label: 'Haedal',
    protocolSlugs: ['haedal-protocol'],
    boundaryClass: 'lst',
    firstSurface: 'haSUI peg and redemption monitor',
    readableState: [...LST_READ_FIELDS],
    riskDomains: [...LST_RISKS],
    noExecutionReasons: ['lst_redemption_flow_unspecified', 'exchange_rate_guard_not_implemented'],
    requiredTargetFields: ['lst_coin_type', 'underlying_coin_type', 'max_peg_deviation_bps', 'min_redemption_liquidity'],
    notes: 'Track haSUI liquidity, exchange rate and redemption conditions only.',
  }),
  boundary({
    id: 'volo',
    label: 'Volo',
    protocolSlugs: ['volo-lst', 'volo-vault'],
    boundaryClass: 'lst_vault',
    firstSurface: 'vSUI LST and vault liquidity monitor',
    readableState: [...LST_READ_FIELDS, 'vault_nav', 'strategy_weights', 'withdrawal_buffer'],
    riskDomains: [...LST_RISKS, 'strategy'],
    noExecutionReasons: ['vault_position_schema_unverified', 'redemption_and_withdrawal_paths_unspecified'],
    requiredTargetFields: ['lst_coin_type', 'vault_id', 'position_id', 'max_peg_deviation_bps', 'min_withdrawal_buffer'],
    notes: 'Volo has both LST and vault exposure; execution needs separate target semantics for each.',
  }),
  boundary({
    id: 'alphafi',
    label: 'AlphaFi',
    protocolSlugs: ['alphafi-agg', 'alphafi-stsui'],
    boundaryClass: 'lst_vault',
    firstSurface: 'stSUI and yield-aggregator risk monitor',
    readableState: ['vault_nav', 'strategy_weights', 'idle_ratio', 'staked_sui_exchange_rate', 'withdrawal_buffer', 'reward_apr'],
    riskDomains: ['strategy', 'redemption', 'liquidity', 'oracle', 'smart_contract'],
    noExecutionReasons: ['strategy_allocation_guard_not_implemented', 'vault_position_schema_unverified'],
    requiredTargetFields: ['vault_id', 'position_id', 'strategy_allowlist', 'max_strategy_weight_bps', 'min_withdrawal_buffer'],
    notes: 'Keep AlphaFi read-only until vault allocation and stSUI redemption constraints are explicit.',
  }),
  boundary({
    id: 'kai',
    label: 'Kai',
    protocolSlugs: ['kai-finance'],
    boundaryClass: 'leveraged_vault',
    firstSurface: 'leveraged farming and liquidation-risk monitor',
    readableState: ['vault_nav', 'leverage_ratio', 'collateral_value', 'debt_value', 'liquidation_buffer', 'withdrawal_liquidity'],
    riskDomains: ['leverage', 'liquidation', 'oracle', 'liquidity', 'smart_contract'],
    noExecutionReasons: ['leverage_loop_unwind_not_specified', 'liquidation_buffer_guard_not_implemented'],
    requiredTargetFields: ['vault_id', 'position_id', 'max_leverage_bps', 'min_liquidation_buffer_bps', 'max_unwind_amount'],
    notes: 'Leveraged vaults need unwind sequencing and stale-state checks before any autonomous action.',
  }),
  boundary({
    id: 'mole',
    label: 'Mole',
    protocolSlugs: ['mole'],
    boundaryClass: 'yield_vault',
    firstSurface: 'yield strategy and withdrawal-liquidity monitor',
    readableState: ['vault_nav', 'strategy_pnl', 'strategy_weights', 'withdrawal_liquidity', 'drawdown_bps', 'reward_apr'],
    riskDomains: ['strategy', 'liquidity', 'smart_contract'],
    noExecutionReasons: ['vault_position_schema_unverified', 'strategy_risk_guard_not_implemented'],
    requiredTargetFields: ['vault_id', 'position_id', 'strategy_allowlist', 'max_drawdown_bps', 'min_withdrawal_liquidity'],
    notes: 'Mole remains a watch-only yield strategy until position and withdrawal semantics are verified.',
  }),
  boundary({
    id: 'ondo',
    label: 'Ondo',
    protocolSlugs: ['ondo-yield-assets'],
    boundaryClass: 'rwa',
    firstSurface: 'RWA yield, liquidity and settlement monitor',
    readableState: [...RWA_READ_FIELDS],
    riskDomains: [...RWA_RISKS],
    noExecutionReasons: ['issuer_redemption_terms_not_machine_enforced', 'rwa_settlement_not_atomic_on_sui'],
    requiredTargetFields: ['rwa_token_type', 'issuer_id', 'max_issuer_exposure', 'min_secondary_liquidity'],
    dataSources: ['defillama', 'sui-rpc', 'issuer-disclosures'],
    notes: 'RWA products stay display/watch-only until issuer, redemption and settlement rules are enforceable.',
  }),
  boundary({
    id: 'kaio',
    label: 'KAIO',
    protocolSlugs: ['kaio'],
    boundaryClass: 'rwa',
    firstSurface: 'RWA vault liquidity and issuer-risk monitor',
    readableState: [...RWA_READ_FIELDS],
    riskDomains: [...RWA_RISKS],
    noExecutionReasons: ['issuer_redemption_terms_not_machine_enforced', 'rwa_settlement_not_atomic_on_sui'],
    requiredTargetFields: ['rwa_vault_id', 'issuer_id', 'max_issuer_exposure', 'min_secondary_liquidity'],
    dataSources: ['defillama', 'sui-rpc', 'issuer-disclosures'],
    notes: 'KAIO is useful for display and issuer-risk labels, not autonomous execution.',
  }),
  boundary({
    id: 'matrixdock',
    label: 'MatrixDock XAUM',
    protocolSlugs: ['matrixdock-xaum'],
    boundaryClass: 'rwa',
    firstSurface: 'tokenized gold liquidity and settlement monitor',
    readableState: [...RWA_READ_FIELDS],
    riskDomains: [...RWA_RISKS],
    noExecutionReasons: ['issuer_redemption_terms_not_machine_enforced', 'commodity_settlement_not_atomic_on_sui'],
    requiredTargetFields: ['rwa_token_type', 'issuer_id', 'commodity_reference_asset', 'max_issuer_exposure'],
    dataSources: ['defillama', 'sui-rpc', 'issuer-disclosures'],
    notes: 'MatrixDock XAUM needs issuer and commodity settlement constraints before anything beyond display.',
  }),
  boundary({
    id: 'ember',
    label: 'Ember',
    protocolSlugs: ['ember-protocol'],
    boundaryClass: 'capital_allocator',
    firstSurface: 'capital allocator strategy and drawdown monitor',
    readableState: ['allocator_nav', 'strategy_weights', 'idle_buffer', 'drawdown_bps', 'redemption_liquidity', 'reward_apr'],
    riskDomains: ['strategy', 'liquidity', 'smart_contract'],
    noExecutionReasons: ['allocator_strategy_guard_not_implemented', 'redemption_path_unspecified'],
    requiredTargetFields: ['allocator_id', 'strategy_allowlist', 'max_strategy_weight_bps', 'max_drawdown_bps', 'min_idle_buffer'],
    notes: 'Capital allocator actions need strategy-level guardrails before execution authority.',
  }),
  boundary({
    id: 'bluefin-pro',
    label: 'Bluefin Pro',
    protocolSlugs: ['bluefin-pro'],
    boundaryClass: 'perps',
    firstSurface: 'funding, mark/index and liquidation monitor',
    readableState: [...PERPS_READ_FIELDS],
    riskDomains: [...PERPS_RISKS],
    noExecutionReasons: ['margin_model_not_wrapped', 'funding_flip_guard_not_implemented', 'liquidation_handling_not_specified'],
    requiredTargetFields: ['perp_market_id', 'subaccount_id', 'max_leverage_bps', 'min_liquidation_buffer_bps', 'funding_flip_threshold_bps'],
    dataSources: ['defillama', 'sui-rpc', 'bluefin-public-api'],
    notes: 'Perps remain watch-only until margin, liquidation and funding-flip safeguards are specified.',
  }),
  boundary({
    id: 'sudo-perps',
    label: 'Sudo Perps',
    protocolSlugs: ['sudo-perps'],
    boundaryClass: 'perps',
    firstSurface: 'funding and liquidation-risk monitor',
    readableState: [...PERPS_READ_FIELDS],
    riskDomains: [...PERPS_RISKS],
    noExecutionReasons: ['margin_model_not_wrapped', 'funding_flip_guard_not_implemented', 'liquidation_handling_not_specified'],
    requiredTargetFields: ['perp_market_id', 'subaccount_id', 'max_leverage_bps', 'min_liquidation_buffer_bps', 'funding_flip_threshold_bps'],
    notes: 'Sudo Perps needs venue-specific margin and liquidation semantics before any tiny/paper execution.',
  }),
  boundary({
    id: 'dipcoin-perps',
    label: 'DipCoin Perps',
    protocolSlugs: [],
    registryStatus: 'roadmap_only',
    boundaryClass: 'perps',
    firstSurface: 'funding spread and venue-risk placeholder',
    readableState: [...PERPS_READ_FIELDS],
    riskDomains: [...PERPS_RISKS],
    noExecutionReasons: ['protocol_not_in_current_sui_top26_registry', 'official_read_api_not_verified', 'margin_model_not_wrapped'],
    requiredTargetFields: ['perp_market_id', 'subaccount_id', 'max_leverage_bps', 'min_liquidation_buffer_bps', 'funding_flip_threshold_bps'],
    dataSources: ['roadmap-research-needed'],
    notes: 'DipCoin is tracked because the product roadmap names it, but it is not part of the current DefiLlama top-26 registry baseline.',
  }),
]

function protocolRefs(protocolSlugs) {
  return protocolSlugs.map((slug) => {
    const protocol = getSuiProtocolBySlug(slug)
    if (!protocol) throw new Error(`Sui watch-only boundary references unregistered protocol: ${slug}`)
    return {
      slug: protocol.slug,
      name: protocol.name,
      category: protocol.category,
      category_class: protocol.category_class,
      adapter_status: protocol.adapter_status,
      sui_tvl_rank: protocol.sui_tvl_rank,
      sui_tvl_usd: protocol.sui_tvl_usd,
    }
  })
}

function boundaryRecord(row) {
  const refs = protocolRefs(row.protocol_slugs)
  return Object.freeze({
    ...row,
    chain: 'sui',
    protocol_refs: Object.freeze(refs),
    monitor_allowed: true,
    registered_executor: false,
    execution_enabled: false,
    autonomous_execution_allowed: false,
    execution_mode: 'watch_only',
    execution_blocker_code: 'WATCH_ONLY_BOUNDARY',
    protocol_slugs: Object.freeze([...row.protocol_slugs]),
    readable_state: Object.freeze([...row.readable_state]),
    risk_domains: Object.freeze([...row.risk_domains]),
    no_execution_reasons: Object.freeze([...row.no_execution_reasons]),
    required_target_fields: Object.freeze([...row.required_target_fields]),
    data_sources: Object.freeze([...row.data_sources]),
  })
}

export const SUI_WATCH_ONLY_BOUNDARIES = Object.freeze(BOUNDARY_ROWS.map(boundaryRecord))

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] || 0) + 1
    return acc
  }, {})
}

function cloneBoundary(row) {
  return {
    ...row,
    protocol_slugs: [...row.protocol_slugs],
    protocol_refs: row.protocol_refs.map((ref) => ({ ...ref })),
    readable_state: [...row.readable_state],
    risk_domains: [...row.risk_domains],
    no_execution_reasons: [...row.no_execution_reasons],
    required_target_fields: [...row.required_target_fields],
    data_sources: [...row.data_sources],
  }
}

export function listSuiWatchOnlyBoundaries({ includeRoadmapOnly = true } = {}) {
  const rows = includeRoadmapOnly
    ? SUI_WATCH_ONLY_BOUNDARIES
    : SUI_WATCH_ONLY_BOUNDARIES.filter((row) => row.registry_status !== 'roadmap_only')
  return rows.map(cloneBoundary)
}

export function getSuiWatchOnlyBoundaryData({ includeRoadmapOnly = true } = {}) {
  const boundaries = listSuiWatchOnlyBoundaries({ includeRoadmapOnly })
  return {
    status: 'ok',
    chain: 'sui',
    sources: SUI_WATCH_ONLY_BOUNDARY_SOURCE,
    counts: {
      total_boundaries: boundaries.length,
      by_boundary_class: countBy(boundaries, 'boundary_class'),
      by_registry_status: countBy(boundaries, 'registry_status'),
    },
    boundaries,
  }
}

export function getSuiWatchOnlyBoundaryById(id) {
  return listSuiWatchOnlyBoundaries().find((boundary) => boundary.id === id) || null
}
