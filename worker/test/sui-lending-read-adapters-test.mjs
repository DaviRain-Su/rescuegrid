import assert from 'node:assert/strict'
import { getSuiAdapterCandidateById } from '../src/sui-adapter-candidates.js'
import { getSuiProtocolBySlug } from '../src/sui-protocol-registry.js'
import {
  SUI_LENDING_HEALTH_MATRIX,
  SUI_LENDING_READ_ADAPTERS,
  getSuiLendingReadAdapterById,
  getSuiLendingReadAdapterData,
} from '../src/sui-lending-read-adapters.js'

const EXPECTED_IDS = [
  'sui-lending-read:navi-lending',
  'sui-lending-read:suilend',
  'sui-lending-read:scallop-lend',
  'sui-lending-read:alphalend',
]

{
  assert.deepEqual(SUI_LENDING_READ_ADAPTERS.map((adapter) => adapter.id), EXPECTED_IDS)
  assert.equal(SUI_LENDING_READ_ADAPTERS.every((adapter) => adapter.chain === 'sui'), true)
  assert.equal(SUI_LENDING_READ_ADAPTERS.every((adapter) => getSuiProtocolBySlug(adapter.protocol_slug)), true)
  assert.equal(SUI_LENDING_READ_ADAPTERS.every((adapter) => getSuiAdapterCandidateById(adapter.candidate_id)), true)
  assert.equal(SUI_LENDING_READ_ADAPTERS.every((adapter) => adapter.read_adapter_registered === true), true)
  assert.equal(SUI_LENDING_READ_ADAPTERS.every((adapter) => adapter.execution_adapter_registered === false), true)
  assert.equal(SUI_LENDING_READ_ADAPTERS.every((adapter) => adapter.registered_executor === false), true)
  assert.equal(SUI_LENDING_READ_ADAPTERS.every((adapter) => adapter.execution_enabled === false), true)
  assert.equal(SUI_LENDING_READ_ADAPTERS.every((adapter) => adapter.autonomous_execution_allowed === false), true)
  assert.equal(SUI_LENDING_READ_ADAPTERS.every((adapter) => adapter.read_preflight_gates.includes('no_execution_authority_requested')), true)
}

{
  const data = getSuiLendingReadAdapterData()
  assert.equal(data.status, 'ok')
  assert.equal(data.chain, 'sui')
  assert.equal(data.counts.total_adapters, 4)
  assert.equal(data.counts.total_supported_markets, 5)
  assert.equal(data.counts.total_health_rows, 4)
  assert.equal(data.counts.by_implementation_stage.sdk_pending, 2)
  assert.equal(data.counts.by_implementation_stage.research_pending, 2)
  assert.equal(data.counts.by_execution_blocker_code.READ_ONLY_LENDING_ADAPTER, 2)
  assert.equal(data.counts.by_execution_blocker_code.RESEARCH_PENDING_READ_ONLY, 2)
  assert.equal(data.counts.by_sdk_status.official_sdk_confirmed_read_not_wired, 2)
  assert.equal(data.health_matrix.every((row) => row.execution_blocker_code === 'READ_ONLY_HEALTH_MATRIX'), true)
}

{
  const navi = getSuiLendingReadAdapterById('sui-lending-read:navi-lending')
  assert.equal(navi.implementation_stage, 'research_pending')
  assert.equal(navi.execution_blocker_code, 'RESEARCH_PENDING_READ_ONLY')
  assert.equal(navi.supported_markets.length, 2)
  assert.equal(navi.supported_markets.some((market) => market.market_id === 'SUI borrow health'), true)
  assert.equal(navi.target_binding.includes('receipt_token_type'), true)
}

{
  const suilend = getSuiLendingReadAdapterById('sui-lending-read:suilend')
  assert.equal(suilend.sdk_status, 'official_sdk_confirmed_read_not_wired')
  assert.equal(suilend.health_model, 'lending_market_obligation_owner_cap')
  assert.equal(suilend.target_binding.includes('obligation_owner_cap_id?'), true)
  assert.equal(suilend.reserve_read_fields.includes('withdrawal_liquidity'), true)
  assert.equal(suilend.obligation_read_fields.includes('health_factor_bps'), true)
  assert.equal(suilend.health_guard_fields.includes('post_repay_health_factor_bps'), true)
}

{
  const scallop = getSuiLendingReadAdapterById('sui-lending-read:scallop-lend')
  assert.equal(scallop.health_model, 'market_reserve_obligation_key')
  assert.equal(scallop.target_binding.includes('obligation_key_id?'), true)
  assert.equal(scallop.notes.includes('ObligationKey'), true)
}

{
  const alphalend = getSuiLendingReadAdapterById('sui-lending-read:alphalend')
  assert.equal(alphalend.implementation_stage, 'research_pending')
  assert.equal(alphalend.execution_blocker_code, 'RESEARCH_PENDING_READ_ONLY')
  assert.equal(alphalend.target_binding.includes('position_or_obligation_id?'), true)
}

{
  assert.equal(SUI_LENDING_HEALTH_MATRIX.length, 4)
  assert.equal(SUI_LENDING_HEALTH_MATRIX.every((row) => row.chain === 'sui'), true)
  assert.equal(SUI_LENDING_HEALTH_MATRIX.every((row) => row.execution_enabled === false), true)
  assert.equal(SUI_LENDING_HEALTH_MATRIX.every((row) => row.autonomous_execution_allowed === false), true)
  assert.equal(SUI_LENDING_HEALTH_MATRIX.every((row) => row.required_health_fields.includes('health_factor_bps')), true)
  assert.equal(SUI_LENDING_HEALTH_MATRIX.every((row) => row.required_health_fields.includes('liquidation_buffer_bps')), true)
  assert.equal(SUI_LENDING_HEALTH_MATRIX.every((row) => getSuiLendingReadAdapterById(row.adapter_id)), true)
}

{
  const filtered = getSuiLendingReadAdapterData({ includeResearchPending: false })
  assert.equal(filtered.counts.total_adapters, 2)
  assert.equal(filtered.counts.total_supported_markets, 2)
  assert.equal(filtered.counts.total_health_rows, 2)
  assert.equal(filtered.adapters.some((adapter) => adapter.implementation_stage === 'research_pending'), false)
  assert.deepEqual(filtered.adapters.map((adapter) => adapter.protocol_slug), ['suilend', 'scallop-lend'])
}

console.log('\nALL SUI LENDING READ ADAPTER TESTS PASS')
