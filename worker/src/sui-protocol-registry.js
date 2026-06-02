export const SUI_PROTOCOL_REGISTRY_SOURCE = Object.freeze({
  refreshed_at: '2026-06-02T16:45:48.815Z',
  tvl_source: 'https://api.llama.fi/protocols',
  dex_volume_source: 'https://api.llama.fi/overview/dexs/sui?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true',
  tvl_basis: 'DefiLlama protocols filtered to chains including Sui, sorted by chainTvls.Sui when available.',
  volume_basis: 'DefiLlama Sui DEX overview sorted by total24h, used only for explicit volume exceptions.',
})

const RISK_BY_CLASS = {
  lending: ['liquidation', 'smart_contract', 'liquidity'],
  dex: ['market', 'liquidity', 'smart_contract'],
  lst: ['oracle', 'liquidity', 'smart_contract'],
  vault: ['smart_contract', 'liquidity'],
  cdp: ['liquidation', 'oracle', 'smart_contract'],
  rwa: ['issuer', 'liquidity', 'smart_contract'],
  perps: ['liquidation', 'market', 'venue'],
  allocator: ['strategy', 'smart_contract', 'liquidity'],
  farm: ['smart_contract', 'liquidity'],
}

const TOP_SUI_TVL_PROTOCOLS = [
  ['navi-lending', 'NAVI Lending', 'Lending', 'lending', 1, 136739821, 'execution_candidate'],
  ['suilend', 'Suilend', 'Lending', 'lending', 2, 122994803, 'execution_candidate'],
  ['alphalend', 'AlphaLend', 'Lending', 'lending', 3, 61691940, 'execution_candidate'],
  ['springsui', 'SpringSui', 'Liquid Staking', 'lst', 4, 50036279, 'watch_only'],
  ['bucket-farm', 'Bucket Farm', 'Farm', 'farm', 5, 37981838, 'watch_only'],
  ['ember-protocol', 'Ember Protocol', 'Onchain Capital Allocator', 'allocator', 6, 32189426, 'display_only'],
  ['haedal-protocol', 'Haedal Protocol', 'Liquid Staking', 'lst', 7, 31976400, 'watch_only'],
  ['cetus-clmm', 'Cetus CLMM', 'Dexs', 'dex', 8, 30873122, 'execution_candidate'],
  ['ondo-yield-assets', 'Ondo Yield Assets', 'RWA', 'rwa', 9, 23124874, 'display_only'],
  ['kaio', 'KAIO', 'RWA', 'rwa', 10, 20398044, 'display_only'],
  ['scallop-lend', 'Scallop Lend', 'Lending', 'lending', 11, 18270621, 'execution_candidate'],
  ['bluefin-spot', 'Bluefin Spot', 'Dexs', 'dex', 12, 17073245, 'execution_candidate'],
  ['volo-lst', 'Volo LST', 'Liquid Staking', 'lst', 13, 16934738, 'watch_only'],
  ['volo-vault', 'Volo Vault', 'Risk Curators', 'vault', 14, 14532956, 'watch_only'],
  ['deepbook-v3', 'DeepBook V3', 'Dexs', 'dex', 15, 13946378, 'live_executor'],
  ['bucket-cdp', 'Bucket CDP', 'CDP', 'cdp', 16, 13191258, 'watch_only'],
  ['alphafi-agg', 'AlphaFi Agg', 'Yield Aggregator', 'vault', 17, 12241226, 'watch_only'],
  ['matrixdock-xaum', 'MatrixDock XAUM', 'RWA', 'rwa', 18, 12151101, 'display_only'],
  ['current', 'Current', 'Lending', 'lending', 19, 11752415, 'watch_only'],
  ['bucket-protocol-v2', 'Bucket Protocol V2', 'CDP', 'cdp', 20, 8893054, 'watch_only'],
  ['mole', 'Mole', 'Yield', 'vault', 21, 8308082, 'watch_only'],
  ['kai-finance', 'Kai Finance', 'Leveraged Farming', 'vault', 22, 6563524, 'watch_only'],
  ['sudo-perps', 'Sudo Perps', 'Derivatives', 'perps', 23, 6317302, 'watch_only'],
  ['momentum', 'Momentum', 'Dexs', 'dex', 24, 6194363, 'execution_candidate'],
  ['bluefin-pro', 'Bluefin Pro', 'Derivatives', 'perps', 25, 5947550, 'watch_only'],
  ['alphafi-stsui', 'AlphaFi stSUI', 'Liquid Staking', 'lst', 26, 5792243, 'watch_only'],
]

const VOLUME_EXCEPTIONS = [
  {
    slug: 'turbos',
    name: 'Turbos',
    category: 'Dexs',
    category_class: 'dex',
    sui_tvl_rank: 28,
    sui_tvl_usd: 4449667,
    coverage_reason: 'volume_exception',
    adapter_status: 'execution_candidate',
    dex_volume_rank: 4,
    dex_volume_24h_usd: 6955563,
    dex_volume_7d_usd: 45090940,
  },
]

export const SUI_DEX_VOLUME_BASELINE = Object.freeze([
  ['deepbook-v3', 'DeepBook V3', 1, 26354196, 107622411],
  ['cetus-clmm', 'Cetus CLMM', 2, 20477399, 94561178],
  ['bluefin-spot', 'Bluefin Spot', 3, 16847116, 73487529],
  ['turbos', 'Turbos', 4, 6955563, 45090940],
  ['lotus-finance', 'Lotus Finance', 5, 5321737, 30799701],
  ['momentum', 'Momentum', 6, 2939768, 11902495],
].map(([slug, name, rank, volume24h, volume7d]) => Object.freeze({
  slug,
  name,
  rank,
  volume_24h_usd: volume24h,
  volume_7d_usd: volume7d,
})))

function protocolRecord([slug, name, category, categoryClass, rank, tvl, adapterStatus]) {
  const volume = SUI_DEX_VOLUME_BASELINE.find((row) => row.slug === slug)
  return Object.freeze({
    slug,
    name,
    chain: 'sui',
    source: 'defillama',
    coverage_reason: 'top_sui_tvl',
    category,
    category_class: categoryClass,
    sui_tvl_rank: rank,
    sui_tvl_usd: tvl,
    adapter_status: adapterStatus,
    execution_enabled: adapterStatus === 'live_executor',
    autonomous_execution_allowed: adapterStatus === 'live_executor',
    monitor_allowed: true,
    dex_volume_rank: volume?.rank ?? null,
    dex_volume_24h_usd: volume?.volume_24h_usd ?? null,
    dex_volume_7d_usd: volume?.volume_7d_usd ?? null,
    risk_tags: RISK_BY_CLASS[categoryClass] ?? ['smart_contract'],
  })
}

function volumeExceptionRecord(row) {
  return Object.freeze({
    ...row,
    chain: 'sui',
    source: 'defillama',
    execution_enabled: false,
    autonomous_execution_allowed: false,
    monitor_allowed: true,
    risk_tags: RISK_BY_CLASS[row.category_class] ?? ['smart_contract'],
  })
}

export const SUI_PROTOCOL_REGISTRY = Object.freeze([
  ...TOP_SUI_TVL_PROTOCOLS.map(protocolRecord),
  ...VOLUME_EXCEPTIONS.map(volumeExceptionRecord),
])

export function listSuiProtocolRegistry({ includeDisplayOnly = true } = {}) {
  const protocols = includeDisplayOnly
    ? SUI_PROTOCOL_REGISTRY
    : SUI_PROTOCOL_REGISTRY.filter((p) => p.adapter_status !== 'display_only')
  return protocols.map((p) => ({ ...p, risk_tags: [...p.risk_tags] }))
}

export function getSuiProtocolCoverage({ includeDisplayOnly = true } = {}) {
  const protocols = listSuiProtocolRegistry({ includeDisplayOnly })
  const counts = protocols.reduce((acc, p) => {
    acc.total += 1
    acc[p.adapter_status] = (acc[p.adapter_status] || 0) + 1
    return acc
  }, { total: 0 })
  return {
    status: 'ok',
    chain: 'sui',
    coverage_pool: 'defillama_sui_top_26_plus_volume_exceptions',
    sources: SUI_PROTOCOL_REGISTRY_SOURCE,
    counts,
    dex_volume_baseline: SUI_DEX_VOLUME_BASELINE.map((row) => ({ ...row })),
    protocols,
  }
}

export function getSuiProtocolBySlug(slug) {
  return listSuiProtocolRegistry().find((p) => p.slug === slug) || null
}
