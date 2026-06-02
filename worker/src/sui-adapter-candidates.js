import {
  SUI_PROTOCOL_REGISTRY_SOURCE,
  getSuiProtocolBySlug,
} from './sui-protocol-registry.js'

export const SUI_ADAPTER_CANDIDATE_SOURCE = Object.freeze({
  assessed_at: '2026-06-03',
  protocol_registry_refreshed_at: SUI_PROTOCOL_REGISTRY_SOURCE.refreshed_at,
  scope: 'Sui-only H4/H5 adapter constraint metadata. These rows do not register execution adapters.',
  evidence: Object.freeze({
    cetus_docs: 'https://github.com/CetusProtocol/cetus-clmm-sui-sdk',
    cetus_npm: '@cetusprotocol/cetus-sui-clmm-sdk@5.4.0',
    turbos_npm: 'turbos-clmm-sdk@3.6.4',
    momentum_docs: 'https://docs.mmt.finance/',
    momentum_npm: '@mmt-finance/clmm-sdk@1.3.25',
    bluefin_npm: '@bluefin-exchange/bluefin7k-aggregator-sdk@7.3.0',
    navi_docs: 'https://docs.naviprotocol.io/technical/technical-docs',
    suilend_docs: 'https://docs.suilend.fi/ecosystem/suilend-sdk-guide',
    suilend_npm: '@suilend/sdk@2.0.6',
    scallop_docs: 'https://docs.scallop.io/',
    scallop_npm: '@scallop-io/sui-scallop-sdk@2.4.5',
  }),
})

const CLMM_TARGET_SCHEMA = Object.freeze([
  'clmm_pool_id',
  'coin_type_a',
  'coin_type_b',
  'tick_spacing',
  'fee_rate',
  'tick_lower_index?',
  'tick_upper_index?',
  'position_id?',
])

const CLMM_READ_FIELDS = Object.freeze([
  'pool_liquidity',
  'current_sqrt_price',
  'current_tick_index',
  'fee_growth',
  'reward_growth',
  'quote_amount_out',
  'price_impact_bps',
  'volume_24h_usd',
])

const CLMM_PREFLIGHT_GATES = Object.freeze([
  'pool_id_allowlisted',
  'coin_types_match_policy',
  'sdk_quote_success',
  'price_impact_below_policy',
  'min_liquidity_usd',
  'tick_range_inside_policy',
  'position_owner_matches_policy_when_position_id_present',
])

const CLMM_WRAPPER_FIELDS = Object.freeze([
  'target_kind=clmm_pool_or_position',
  'clmm_pool_id',
  'allowed_coin_types',
  'tick_lower_index',
  'tick_upper_index',
  'max_price_impact_bps',
  'max_rebalance_notional',
])

const LENDING_TARGET_SCHEMA = Object.freeze([
  'lending_market_id',
  'lending_market_type?',
  'reserve_id',
  'reserve_coin_type',
  'obligation_id?',
  'obligation_owner_cap_id?',
  'obligation_key_id?',
])

const LENDING_READ_FIELDS = Object.freeze([
  'reserve_available_amount',
  'reserve_supply_amount',
  'reserve_borrowed_amount',
  'collateral_value_usd',
  'debt_value_usd',
  'health_factor',
  'open_ltv_bps',
  'close_ltv_bps',
  'borrow_limit_usd',
  'withdrawal_liquidity',
])

const LENDING_PREFLIGHT_GATES = Object.freeze([
  'market_id_allowlisted',
  'reserve_coin_type_matches_policy',
  'fresh_reserve_and_obligation_state',
  'obligation_owner_cap_or_key_matches_policy',
  'health_factor_after_action_above_policy',
  'withdrawal_liquidity_sufficient',
  'oracle_not_stale',
])

const LENDING_WRAPPER_FIELDS = Object.freeze([
  'target_kind=lending_obligation_or_reserve',
  'lending_market_id',
  'reserve_id',
  'reserve_coin_type',
  'obligation_id',
  'max_ltv_bps',
  'min_health_factor_bps',
  'max_repay_or_withdraw_amount',
])

function clmmCandidate({
  protocolSlug,
  adapterKind = 'sui-clmm',
  sdkPackage,
  sdkVersion,
  sdkStatus,
  evidence,
  integrationStage = 'design_candidate',
  notes,
}) {
  return {
    protocol_slug: protocolSlug,
    adapter_kind: adapterKind,
    integration_stage: integrationStage,
    sdk_package: sdkPackage,
    sdk_version: sdkVersion,
    sdk_status: sdkStatus,
    target_schema: [...CLMM_TARGET_SCHEMA],
    read_fields: [...CLMM_READ_FIELDS],
    preflight_gates: [...CLMM_PREFLIGHT_GATES],
    action_scopes: ['quote_swap', 'swap', 'lp_rebalance_dry_run', 'add_liquidity_future', 'remove_liquidity_future'],
    wrapper_change_required: true,
    wrapper_fields_required: [...CLMM_WRAPPER_FIELDS],
    execution_blocker_code: 'ADAPTER_DESIGN_ONLY',
    evidence,
    notes,
  }
}

function lendingCandidate({
  protocolSlug,
  sdkPackage,
  sdkVersion,
  sdkStatus,
  evidence,
  integrationStage = 'design_candidate',
  targetSchema = LENDING_TARGET_SCHEMA,
  preflightGates = LENDING_PREFLIGHT_GATES,
  actionScopes = ['supply_watch', 'repay_risk_reduction', 'withdraw_guarded', 'borrow_future'],
  notes,
}) {
  return {
    protocol_slug: protocolSlug,
    adapter_kind: 'sui-lending',
    integration_stage: integrationStage,
    sdk_package: sdkPackage,
    sdk_version: sdkVersion,
    sdk_status: sdkStatus,
    target_schema: [...targetSchema],
    read_fields: [...LENDING_READ_FIELDS],
    preflight_gates: [...preflightGates],
    action_scopes: actionScopes,
    wrapper_change_required: true,
    wrapper_fields_required: [...LENDING_WRAPPER_FIELDS],
    execution_blocker_code: 'ADAPTER_DESIGN_ONLY',
    evidence,
    notes,
  }
}

const CANDIDATE_ROWS = [
  clmmCandidate({
    protocolSlug: 'cetus-clmm',
    sdkPackage: '@cetusprotocol/cetus-sui-clmm-sdk',
    sdkVersion: '5.4.0',
    sdkStatus: 'official_sdk_confirmed',
    evidence: ['github:CetusProtocol/cetus-clmm-sui-sdk', 'npm:@cetusprotocol/cetus-sui-clmm-sdk@5.4.0'],
    notes: 'CLMM pool and optional LP position semantics; do not reuse the DeepBook order-book pool constraint.',
  }),
  clmmCandidate({
    protocolSlug: 'turbos',
    sdkPackage: 'turbos-clmm-sdk',
    sdkVersion: '3.6.4',
    sdkStatus: 'npm_sdk_confirmed_docs_pending',
    evidence: ['npm:turbos-clmm-sdk@3.6.4'],
    notes: 'SDK package exists, but docs endpoint was not reachable in this pass; keep execution blocked until package addresses and pool schemas are verified.',
  }),
  clmmCandidate({
    protocolSlug: 'momentum',
    sdkPackage: '@mmt-finance/clmm-sdk',
    sdkVersion: '1.3.25',
    sdkStatus: 'npm_sdk_confirmed',
    evidence: ['docs:https://docs.mmt.finance/', 'npm:@mmt-finance/clmm-sdk@1.3.25'],
    notes: 'Momentum DEX is CLMM/PTB-oriented; adapter must bind pool, tick range and position ids explicitly.',
  }),
  clmmCandidate({
    protocolSlug: 'bluefin-spot',
    adapterKind: 'sui-spot-aggregator',
    sdkPackage: '@bluefin-exchange/bluefin7k-aggregator-sdk',
    sdkVersion: '7.3.0',
    sdkStatus: 'aggregator_sdk_confirmed_route_constraints_required',
    evidence: ['npm:@bluefin-exchange/bluefin7k-aggregator-sdk@7.3.0', 'npm:@firefly-exchange/library-sui@4.2.0'],
    notes: 'Aggregator routes must be decomposed into allowed Sui venues and targets before any autonomous execution; broad route signing is not acceptable.',
  }),
  lendingCandidate({
    protocolSlug: 'navi-lending',
    sdkPackage: null,
    sdkVersion: null,
    sdkStatus: 'docs_only_sdk_or_package_addresses_needed',
    evidence: ['docs:https://docs.naviprotocol.io/technical/technical-docs'],
    integrationStage: 'research_pending',
    targetSchema: ['pool_id', 'receipt_token_type', 'collateral_asset_type', 'borrow_asset_type', 'user_position_or_account_id?'],
    notes: 'NAVI docs describe shared liquidity pools, receipt tokens and collateralization; SDK/package-address proof is still required before adapter design can freeze.',
  }),
  lendingCandidate({
    protocolSlug: 'suilend',
    sdkPackage: '@suilend/sdk',
    sdkVersion: '2.0.6',
    sdkStatus: 'official_sdk_confirmed',
    evidence: ['docs:https://docs.suilend.fi/ecosystem/suilend-sdk-guide', 'npm:@suilend/sdk@2.0.6'],
    preflightGates: [...LENDING_PREFLIGHT_GATES, 'refresh_all_before_action'],
    notes: 'Suilend target must bind lending market id/type, reserve coin type, obligation id and obligation owner cap id.',
  }),
  lendingCandidate({
    protocolSlug: 'scallop-lend',
    sdkPackage: '@scallop-io/sui-scallop-sdk',
    sdkVersion: '2.4.5',
    sdkStatus: 'official_sdk_confirmed',
    evidence: ['docs:https://docs.scallop.io/', 'npm:@scallop-io/sui-scallop-sdk@2.4.5'],
    preflightGates: [...LENDING_PREFLIGHT_GATES, 'obligation_key_required_for_borrowing_actions'],
    notes: 'Scallop borrowing requires a shared Obligation plus wallet-owned ObligationKey; both must be bound before any guarded action.',
  }),
  lendingCandidate({
    protocolSlug: 'alphalend',
    sdkPackage: null,
    sdkVersion: null,
    sdkStatus: 'research_pending',
    evidence: ['defillama:top_sui_tvl'],
    integrationStage: 'research_pending',
    notes: 'Keep watch-only until official package addresses, position model and liquidation/health semantics are verified.',
  }),
]

function candidateRecord(row) {
  const protocol = getSuiProtocolBySlug(row.protocol_slug)
  if (!protocol) throw new Error(`Sui adapter candidate references unregistered protocol: ${row.protocol_slug}`)
  return Object.freeze({
    ...row,
    id: `${row.adapter_kind}:${row.protocol_slug}`,
    chain: 'sui',
    protocol_name: protocol.name,
    protocol_category: protocol.category,
    protocol_category_class: protocol.category_class,
    protocol_adapter_status: protocol.adapter_status,
    registered_executor: false,
    execution_enabled: false,
    autonomous_execution_allowed: false,
    target_schema: Object.freeze([...row.target_schema]),
    read_fields: Object.freeze([...row.read_fields]),
    preflight_gates: Object.freeze([...row.preflight_gates]),
    action_scopes: Object.freeze([...row.action_scopes]),
    wrapper_fields_required: Object.freeze([...row.wrapper_fields_required]),
    evidence: Object.freeze([...row.evidence]),
  })
}

export const SUI_ADAPTER_CANDIDATES = Object.freeze(CANDIDATE_ROWS.map(candidateRecord))

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] || 0) + 1
    return acc
  }, {})
}

function cloneCandidate(row) {
  return {
    ...row,
    target_schema: [...row.target_schema],
    read_fields: [...row.read_fields],
    preflight_gates: [...row.preflight_gates],
    action_scopes: [...row.action_scopes],
    wrapper_fields_required: [...row.wrapper_fields_required],
    evidence: [...row.evidence],
  }
}

export function listSuiAdapterCandidates({ includeResearchPending = true } = {}) {
  const rows = includeResearchPending
    ? SUI_ADAPTER_CANDIDATES
    : SUI_ADAPTER_CANDIDATES.filter((row) => row.integration_stage !== 'research_pending')
  return rows.map(cloneCandidate)
}

export function getSuiAdapterCandidateData({ includeResearchPending = true } = {}) {
  const candidates = listSuiAdapterCandidates({ includeResearchPending })
  return {
    status: 'ok',
    chain: 'sui',
    sources: SUI_ADAPTER_CANDIDATE_SOURCE,
    counts: {
      total_candidates: candidates.length,
      by_adapter_kind: countBy(candidates, 'adapter_kind'),
      by_integration_stage: countBy(candidates, 'integration_stage'),
      by_sdk_status: countBy(candidates, 'sdk_status'),
    },
    candidates,
  }
}

export function getSuiAdapterCandidateById(id) {
  return listSuiAdapterCandidates().find((candidate) => candidate.id === id) || null
}
