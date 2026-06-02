import assert from 'node:assert/strict'
import { getSuiAdapterCandidateById } from '../src/sui-adapter-candidates.js'
import { getSuiProtocolBySlug } from '../src/sui-protocol-registry.js'
import { getSuiWatchMarketById } from '../src/sui-watch-registry.js'
import {
  SUI_DEX_READ_ADAPTERS,
  SUI_DEX_SPREAD_MATRIX,
  getSuiDexReadAdapterById,
  getSuiDexReadAdapterData,
} from '../src/sui-dex-read-adapters.js'

const EXPECTED_IDS = [
  'deepbook-read:deepbook-v3',
  'sui-clmm-read:cetus-clmm',
  'sui-clmm-read:turbos',
  'sui-clmm-read:momentum',
  'sui-spot-aggregator-read:bluefin-spot',
]

{
  assert.deepEqual(SUI_DEX_READ_ADAPTERS.map((adapter) => adapter.id), EXPECTED_IDS)
  assert.equal(SUI_DEX_READ_ADAPTERS.every((adapter) => adapter.chain === 'sui'), true)
  assert.equal(SUI_DEX_READ_ADAPTERS.every((adapter) => getSuiProtocolBySlug(adapter.protocol_slug)), true)
  assert.equal(SUI_DEX_READ_ADAPTERS.every((adapter) => adapter.read_adapter_registered === true), true)
  assert.equal(SUI_DEX_READ_ADAPTERS.every((adapter) => adapter.execution_enabled === false), true)
  assert.equal(SUI_DEX_READ_ADAPTERS.every((adapter) => adapter.autonomous_execution_allowed === false), true)
  assert.equal(SUI_DEX_READ_ADAPTERS.every((adapter) => adapter.read_preflight_gates.includes('no_execution_authority_requested')), true)
  assert.equal(
    SUI_DEX_READ_ADAPTERS.filter((adapter) => adapter.protocol_slug !== 'deepbook-v3').every((adapter) => adapter.registered_executor === false),
    true,
  )
}

{
  const data = getSuiDexReadAdapterData()
  assert.equal(data.status, 'ok')
  assert.equal(data.chain, 'sui')
  assert.equal(data.counts.total_adapters, 5)
  assert.equal(data.counts.total_supported_markets, 8)
  assert.equal(data.counts.total_spread_pairs, 10)
  assert.equal(data.counts.by_quote_model.orderbook, 1)
  assert.equal(data.counts.by_quote_model.clmm, 3)
  assert.equal(data.counts.by_quote_model.route_aggregator, 1)
  assert.equal(data.counts.by_implementation_stage.metadata_ready, 1)
  assert.equal(data.counts.by_implementation_stage.sdk_pending, 4)
  assert.equal(data.counts.by_execution_blocker_code.FUNDING_GATED, 1)
  assert.equal(data.counts.by_execution_blocker_code.READ_ONLY_ADAPTER, 4)
}

{
  const deepbook = getSuiDexReadAdapterById('deepbook-read:deepbook-v3')
  assert.equal(deepbook.quote_model, 'orderbook')
  assert.equal(deepbook.execution_adapter_registered, true)
  assert.equal(deepbook.registered_executor, true)
  assert.equal(deepbook.execution_blocker_code, 'FUNDING_GATED')
  assert.equal(deepbook.supported_markets.length, 3)
  assert.equal(deepbook.target_schema.includes('pool_id'), true)
  assert.equal(deepbook.read_fields.includes('orderbook_best_bid'), true)
  assert.ok(getSuiWatchMarketById('deepbook-v3:SUI_DBUSDC'))
}

{
  const cetus = getSuiDexReadAdapterById('sui-clmm-read:cetus-clmm')
  assert.equal(cetus.quote_model, 'clmm')
  assert.equal(cetus.candidate_id, 'sui-clmm:cetus-clmm')
  assert.ok(getSuiAdapterCandidateById(cetus.candidate_id))
  assert.equal(cetus.execution_adapter_registered, false)
  assert.equal(cetus.execution_blocker_code, 'READ_ONLY_ADAPTER')
  assert.equal(cetus.supported_markets.length, 2)
  assert.equal(cetus.target_schema.includes('clmm_pool_id'), true)
  assert.equal(cetus.read_fields.includes('current_tick_index'), true)
}

{
  const bluefin = getSuiDexReadAdapterById('sui-spot-aggregator-read:bluefin-spot')
  assert.equal(bluefin.quote_model, 'route_aggregator')
  assert.equal(bluefin.read_fields.includes('route_legs'), true)
  assert.equal(bluefin.notes.toLowerCase().includes('broad route signing'), true)
}

{
  assert.equal(SUI_DEX_SPREAD_MATRIX.length, 10)
  assert.equal(SUI_DEX_SPREAD_MATRIX.every((row) => row.chain === 'sui'), true)
  assert.equal(SUI_DEX_SPREAD_MATRIX.every((row) => row.market_key === 'SUI/USD_STABLE'), true)
  assert.equal(SUI_DEX_SPREAD_MATRIX.every((row) => row.execution_enabled === false), true)
  assert.equal(SUI_DEX_SPREAD_MATRIX.every((row) => row.autonomous_execution_allowed === false), true)
  assert.equal(SUI_DEX_SPREAD_MATRIX.every((row) => row.execution_blocker_code === 'READ_ONLY_SPREAD_MATRIX'), true)
  assert.equal(SUI_DEX_SPREAD_MATRIX.some((row) => row.id === 'sui-usd-stable:deepbook-v3:cetus-clmm'), true)
  assert.equal(SUI_DEX_SPREAD_MATRIX.every((row) => row.comparable_quotes_required.includes('gross_spread_bps')), true)
  assert.equal(SUI_DEX_SPREAD_MATRIX.every((row) => getSuiDexReadAdapterById(row.left_adapter_id)), true)
  assert.equal(SUI_DEX_SPREAD_MATRIX.every((row) => getSuiDexReadAdapterById(row.right_adapter_id)), true)
}

{
  const adapterIds = new Set(SUI_DEX_READ_ADAPTERS.map((adapter) => adapter.id))
  assert.equal(SUI_DEX_SPREAD_MATRIX.every((row) => adapterIds.has(row.left_adapter_id) && adapterIds.has(row.right_adapter_id)), true)

  const filtered = getSuiDexReadAdapterData({ includeSdkPending: false })
  assert.equal(filtered.counts.total_adapters, 1)
  assert.equal(filtered.adapters[0].id, 'deepbook-read:deepbook-v3')
  assert.equal(filtered.counts.total_spread_pairs, 0)
}

console.log('\nALL SUI DEX READ ADAPTER TESTS PASS')
