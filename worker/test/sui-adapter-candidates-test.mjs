import assert from 'node:assert/strict'
import { getSuiProtocolBySlug } from '../src/sui-protocol-registry.js'
import {
  SUI_ADAPTER_CANDIDATES,
  getSuiAdapterCandidateById,
  getSuiAdapterCandidateData,
} from '../src/sui-adapter-candidates.js'

{
  assert.equal(SUI_ADAPTER_CANDIDATES.length, 8)
  assert.equal(SUI_ADAPTER_CANDIDATES.every((candidate) => candidate.chain === 'sui'), true)
  assert.equal(SUI_ADAPTER_CANDIDATES.every((candidate) => getSuiProtocolBySlug(candidate.protocol_slug)), true)
  assert.equal(SUI_ADAPTER_CANDIDATES.every((candidate) => candidate.registered_executor === false), true)
  assert.equal(SUI_ADAPTER_CANDIDATES.every((candidate) => candidate.execution_enabled === false), true)
  assert.equal(SUI_ADAPTER_CANDIDATES.every((candidate) => candidate.autonomous_execution_allowed === false), true)
  assert.equal(SUI_ADAPTER_CANDIDATES.some((candidate) => candidate.target_schema.includes('pool_id')), true)
  assert.equal(SUI_ADAPTER_CANDIDATES.some((candidate) => candidate.target_schema.includes('clmm_pool_id')), true)
  assert.equal(
    SUI_ADAPTER_CANDIDATES
      .filter((candidate) => candidate.adapter_kind !== 'sui-lending')
      .some((candidate) => candidate.target_schema.includes('lending_market_id')),
    false,
  )
}

{
  const data = getSuiAdapterCandidateData()
  assert.equal(data.status, 'ok')
  assert.equal(data.chain, 'sui')
  assert.equal(data.counts.total_candidates, 8)
  assert.equal(data.counts.by_adapter_kind['sui-clmm'], 3)
  assert.equal(data.counts.by_adapter_kind['sui-spot-aggregator'], 1)
  assert.equal(data.counts.by_adapter_kind['sui-lending'], 4)
  assert.equal(data.counts.by_integration_stage.research_pending, 2)
  assert.equal(data.counts.by_sdk_status.official_sdk_confirmed, 3)
}

{
  const cetus = getSuiAdapterCandidateById('sui-clmm:cetus-clmm')
  assert.equal(cetus.sdk_package, '@cetusprotocol/cetus-sui-clmm-sdk')
  assert.equal(cetus.target_schema.includes('clmm_pool_id'), true)
  assert.equal(cetus.target_schema.includes('pool_id'), false)
  assert.equal(cetus.preflight_gates.includes('tick_range_inside_policy'), true)
  assert.equal(cetus.wrapper_change_required, true)
}

{
  const bluefin = getSuiAdapterCandidateById('sui-spot-aggregator:bluefin-spot')
  assert.equal(bluefin.sdk_status, 'aggregator_sdk_confirmed_route_constraints_required')
  assert.equal(bluefin.notes.includes('Broad') || bluefin.notes.includes('broad'), true)
  assert.equal(bluefin.execution_blocker_code, 'ADAPTER_DESIGN_ONLY')
}

{
  const suilend = getSuiAdapterCandidateById('sui-lending:suilend')
  assert.equal(suilend.sdk_package, '@suilend/sdk')
  assert.equal(suilend.target_schema.includes('lending_market_id'), true)
  assert.equal(suilend.target_schema.includes('obligation_owner_cap_id?'), true)
  assert.equal(suilend.preflight_gates.includes('refresh_all_before_action'), true)
  assert.equal(suilend.action_scopes.includes('borrow_future'), true)
}

{
  const scallop = getSuiAdapterCandidateById('sui-lending:scallop-lend')
  assert.equal(scallop.sdk_package, '@scallop-io/sui-scallop-sdk')
  assert.equal(scallop.target_schema.includes('obligation_key_id?'), true)
  assert.equal(scallop.preflight_gates.includes('obligation_key_required_for_borrowing_actions'), true)
}

{
  const filtered = getSuiAdapterCandidateData({ includeResearchPending: false })
  assert.equal(filtered.counts.total_candidates, 6)
  assert.equal(filtered.candidates.some((candidate) => candidate.integration_stage === 'research_pending'), false)
}

console.log('\nALL SUI ADAPTER CANDIDATE TESTS PASS')
