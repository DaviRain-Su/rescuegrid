import assert from 'node:assert/strict'
import { DEPLOYMENT } from '../src/sui-tx.js'
import { getSuiProtocolBySlug } from '../src/sui-protocol-registry.js'
import {
  SUI_WATCH_MARKETS,
  getSuiWatchData,
  getSuiWatchMarketById,
} from '../src/sui-watch-registry.js'

{
  assert.equal(SUI_WATCH_MARKETS.length, 31)
  assert.equal(SUI_WATCH_MARKETS.every((market) => market.chain === 'sui'), true)
  assert.equal(SUI_WATCH_MARKETS.every((market) => getSuiProtocolBySlug(market.protocol_slug)), true)
  assert.equal(SUI_WATCH_MARKETS.some((market) => /cex|cefi|bridge/i.test(market.protocol_category)), false)
  assert.equal(SUI_WATCH_MARKETS.some((market) => ['ethereum', 'solana', 'aptos', 'base'].includes(String(market.chain).toLowerCase())), false)
}

{
  const watchData = getSuiWatchData()
  assert.equal(watchData.status, 'ok')
  assert.equal(watchData.chain, 'sui')
  assert.equal(watchData.counts.total_markets, 31)
  assert.equal(watchData.counts.by_market_type.spot, 8)
  assert.equal(watchData.counts.by_market_type.lending, 6)
  assert.equal(watchData.counts.by_market_type.rwa, 3)
  assert.equal(watchData.counts.by_execution_mode.live_executor_funding_gated, 3)
  assert.equal(watchData.counts.by_execution_mode.adapter_candidate, 10)
}

{
  const deepbookSui = getSuiWatchMarketById('deepbook-v3:SUI_DBUSDC')
  assert.equal(deepbookSui.target_id, DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id)
  assert.equal(deepbookSui.adapter_kind, 'deepbook')
  assert.equal(deepbookSui.execution_mode, 'live_executor_funding_gated')
  assert.equal(deepbookSui.executor_configured, true)
  assert.equal(deepbookSui.execution_enabled, false)
  assert.equal(deepbookSui.autonomous_execution_allowed, false)
  assert.equal(deepbookSui.execution_blocker_code, 'FUNDING_GATED')
  assert.equal(deepbookSui.data_sources.includes('deepbook-indexer'), true)
}

{
  const turbos = getSuiWatchMarketById('turbos:SUI_USDC')
  assert.equal(turbos.coverage_reason, 'volume_exception')
  assert.equal(turbos.dex_volume_rank, 4)
  assert.equal(turbos.execution_mode, 'adapter_candidate')
  assert.equal(turbos.executor_configured, false)
  assert.equal(turbos.execution_enabled, false)
  assert.equal(turbos.execution_blocker_code, null)
}

{
  const ondo = getSuiWatchMarketById('ondo-yield-assets:USDY')
  assert.equal(ondo.execution_mode, 'display_only')
  assert.equal(ondo.protocol_adapter_status, 'display_only')
  assert.equal(ondo.execution_enabled, false)

  const filtered = getSuiWatchData({ includeDisplayOnly: false })
  assert.equal(filtered.markets.some((market) => market.execution_mode === 'display_only'), false)
  assert.equal(filtered.counts.total_markets, SUI_WATCH_MARKETS.filter((market) => market.execution_mode !== 'display_only').length)
}

console.log('\nALL SUI WATCH REGISTRY TESTS PASS')
