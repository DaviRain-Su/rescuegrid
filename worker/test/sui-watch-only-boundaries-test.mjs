import assert from 'node:assert/strict'
import { getSuiProtocolBySlug } from '../src/sui-protocol-registry.js'
import {
  SUI_WATCH_ONLY_BOUNDARIES,
  getSuiWatchOnlyBoundaryById,
  getSuiWatchOnlyBoundaryData,
} from '../src/sui-watch-only-boundaries.js'

const REQUIRED_IDS = [
  'bucket',
  'current',
  'springsui',
  'haedal',
  'volo',
  'alphafi',
  'kai',
  'mole',
  'ondo',
  'kaio',
  'matrixdock',
  'ember',
  'bluefin-pro',
  'sudo-perps',
  'dipcoin-perps',
]

{
  assert.equal(SUI_WATCH_ONLY_BOUNDARIES.length, REQUIRED_IDS.length)
  assert.deepEqual(SUI_WATCH_ONLY_BOUNDARIES.map((row) => row.id), REQUIRED_IDS)
  assert.equal(SUI_WATCH_ONLY_BOUNDARIES.every((row) => row.chain === 'sui'), true)
  assert.equal(SUI_WATCH_ONLY_BOUNDARIES.every((row) => row.monitor_allowed === true), true)
  assert.equal(SUI_WATCH_ONLY_BOUNDARIES.every((row) => row.registered_executor === false), true)
  assert.equal(SUI_WATCH_ONLY_BOUNDARIES.every((row) => row.execution_enabled === false), true)
  assert.equal(SUI_WATCH_ONLY_BOUNDARIES.every((row) => row.autonomous_execution_allowed === false), true)
  assert.equal(SUI_WATCH_ONLY_BOUNDARIES.every((row) => row.execution_blocker_code === 'WATCH_ONLY_BOUNDARY'), true)
  assert.equal(SUI_WATCH_ONLY_BOUNDARIES.every((row) => row.no_execution_reasons.includes('no_executor_adapter_registered')), true)
}

{
  const nonRoadmapSlugs = SUI_WATCH_ONLY_BOUNDARIES
    .filter((row) => row.registry_status !== 'roadmap_only')
    .flatMap((row) => row.protocol_slugs)
  assert.equal(nonRoadmapSlugs.every((slug) => getSuiProtocolBySlug(slug)), true)
  const dipcoin = getSuiWatchOnlyBoundaryById('dipcoin-perps')
  assert.equal(dipcoin.registry_status, 'roadmap_only')
  assert.equal(dipcoin.protocol_slugs.length, 0)
  assert.equal(dipcoin.no_execution_reasons.includes('protocol_not_in_current_sui_top26_registry'), true)
}

{
  const data = getSuiWatchOnlyBoundaryData()
  assert.equal(data.status, 'ok')
  assert.equal(data.chain, 'sui')
  assert.equal(data.counts.total_boundaries, 15)
  assert.equal(data.counts.by_boundary_class.rwa, 3)
  assert.equal(data.counts.by_boundary_class.perps, 3)
  assert.equal(data.counts.by_registry_status.registry_backed, 14)
  assert.equal(data.counts.by_registry_status.roadmap_only, 1)
}

{
  const bucket = getSuiWatchOnlyBoundaryById('bucket')
  assert.deepEqual(bucket.protocol_slugs, ['bucket-farm', 'bucket-cdp', 'bucket-protocol-v2'])
  assert.equal(bucket.risk_domains.includes('peg'), true)
  assert.equal(bucket.readable_state.includes('liquidation_buffer'), true)
  assert.equal(bucket.required_target_fields.includes('cdp_position_id'), true)
}

{
  const springsui = getSuiWatchOnlyBoundaryById('springsui')
  assert.equal(springsui.boundary_class, 'lst')
  assert.equal(springsui.readable_state.includes('redemption_liquidity'), true)
  assert.equal(springsui.risk_domains.includes('redemption'), true)
  assert.equal(springsui.no_execution_reasons.includes('lst_redemption_flow_unspecified'), true)
}

{
  const ondo = getSuiWatchOnlyBoundaryById('ondo')
  assert.equal(ondo.boundary_class, 'rwa')
  assert.equal(ondo.risk_domains.includes('issuer'), true)
  assert.equal(ondo.readable_state.includes('settlement_calendar'), true)
  assert.equal(ondo.no_execution_reasons.includes('issuer_redemption_terms_not_machine_enforced'), true)
}

{
  const bluefinPro = getSuiWatchOnlyBoundaryById('bluefin-pro')
  assert.equal(bluefinPro.boundary_class, 'perps')
  assert.equal(bluefinPro.risk_domains.includes('funding_flip'), true)
  assert.equal(bluefinPro.readable_state.includes('liquidation_buffer'), true)
  assert.equal(bluefinPro.required_target_fields.includes('funding_flip_threshold_bps'), true)
}

{
  const filtered = getSuiWatchOnlyBoundaryData({ includeRoadmapOnly: false })
  assert.equal(filtered.counts.total_boundaries, 14)
  assert.equal(filtered.boundaries.some((row) => row.registry_status === 'roadmap_only'), false)
}

console.log('\nALL SUI WATCH-ONLY BOUNDARY TESTS PASS')
