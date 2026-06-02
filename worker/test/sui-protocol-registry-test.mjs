import assert from 'node:assert/strict'
import {
  SUI_PROTOCOL_REGISTRY,
  SUI_PROTOCOL_REGISTRY_SOURCE,
  getSuiProtocolBySlug,
  getSuiProtocolCoverage,
} from '../src/sui-protocol-registry.js'

{
  assert.equal(SUI_PROTOCOL_REGISTRY_SOURCE.tvl_source, 'https://api.llama.fi/protocols')
  assert.equal(SUI_PROTOCOL_REGISTRY_SOURCE.dex_volume_source.startsWith('https://api.llama.fi/overview/dexs/sui'), true)
  assert.equal(SUI_PROTOCOL_REGISTRY.length, 27)
  assert.equal(SUI_PROTOCOL_REGISTRY.every((p) => p.chain === 'sui'), true)
  assert.equal(SUI_PROTOCOL_REGISTRY.some((p) => /cex|cefi|bridge/i.test(p.category)), false)
}

{
  const coverage = getSuiProtocolCoverage()
  assert.equal(coverage.status, 'ok')
  assert.equal(coverage.chain, 'sui')
  assert.equal(coverage.coverage_pool, 'defillama_sui_top_26_plus_volume_exceptions')
  assert.equal(coverage.counts.total, 27)
  assert.equal(coverage.counts.live_executor, 1)
  assert.equal(coverage.counts.execution_candidate, 8)
  assert.equal(coverage.dex_volume_baseline[0].slug, 'deepbook-v3')
}

{
  const topTvl = SUI_PROTOCOL_REGISTRY.filter((p) => p.coverage_reason === 'top_sui_tvl')
  assert.equal(topTvl.length, 26)
  assert.equal(topTvl[0].slug, 'navi-lending')
  assert.equal(topTvl.at(-1).slug, 'alphafi-stsui')
  assert.deepEqual(topTvl.map((p) => p.sui_tvl_rank), Array.from({ length: 26 }, (_, i) => i + 1))
}

{
  const deepbook = getSuiProtocolBySlug('deepbook-v3')
  assert.equal(deepbook.adapter_status, 'live_executor')
  assert.equal(deepbook.execution_enabled, true)
  assert.equal(deepbook.autonomous_execution_allowed, true)
  assert.equal(deepbook.dex_volume_rank, 1)

  const turbos = getSuiProtocolBySlug('turbos')
  assert.equal(turbos.coverage_reason, 'volume_exception')
  assert.equal(turbos.sui_tvl_rank, 28)
  assert.equal(turbos.dex_volume_rank, 4)
  assert.equal(turbos.execution_enabled, false)

  const ondo = getSuiProtocolBySlug('ondo-yield-assets')
  assert.equal(ondo.adapter_status, 'display_only')
  assert.equal(ondo.monitor_allowed, true)
  assert.equal(ondo.execution_enabled, false)
}

{
  const hiddenDisplayOnly = getSuiProtocolCoverage({ includeDisplayOnly: false })
  assert.equal(hiddenDisplayOnly.protocols.some((p) => p.adapter_status === 'display_only'), false)
  assert.equal(hiddenDisplayOnly.counts.total, SUI_PROTOCOL_REGISTRY.filter((p) => p.adapter_status !== 'display_only').length)
}

console.log('\nALL SUI PROTOCOL REGISTRY TESTS PASS')
