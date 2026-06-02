const ADAPTER_ALIASES = {
  AlphaLend: ['AlphaLend', 'alphalend'],
  'Bluefin Spot': ['Bluefin Spot', 'bluefin-spot'],
  'Bluefin Pro': ['Bluefin Pro', 'bluefin-pro'],
  Cetus: ['Cetus CLMM', 'Cetus', 'cetus-clmm'],
  DeepBook: ['DeepBook V3', 'DeepBook'],
  Momentum: ['Momentum', 'momentum'],
  NAVI: ['NAVI Lending', 'NAVI', 'navi-lending'],
  Scallop: ['Scallop Lend', 'Scallop', 'scallop-lend'],
  Suilend: ['Suilend', 'suilend'],
  Turbos: ['Turbos', 'turbos'],
}

export function adapterAliasesFor(name) {
  return new Set([name, ...(ADAPTER_ALIASES[name] || [])].map((x) => String(x).toLowerCase()))
}

export function surfaceRowsForAdapter(name, surfaces) {
  const aliases = adapterAliasesFor(name)
  return surfaces
    .flatMap((surface) => surface?.adapters || [])
    .filter((row) => (
      aliases.has(String(row.protocol_name || '').toLowerCase())
      || aliases.has(String(row.protocol_slug || '').toLowerCase())
    ))
}

export function summarizeReadiness(strategy, dexSurface, lendingSurface) {
  const surfaces = [dexSurface, lendingSurface].filter(Boolean)
  const surfacesKnown = surfaces.length > 0
  const adapters = strategy?.adapters || []
  const rows = []
  const missing = []

  for (const adapter of adapters) {
    const matched = surfaceRowsForAdapter(adapter, surfaces)
    if (matched.length === 0) missing.push(adapter)
    else matched.forEach((row) => rows.push({ ...row, catalog_adapter: adapter }))
  }

  const blockers = [...new Set(rows.map((row) => row.execution_blocker_code).filter(Boolean))]
  const onlyRegisteredExecutors = rows.length > 0 && rows.every((row) => row.execution_adapter_registered)
  const readOnly = rows.some((row) => !row.execution_adapter_registered || row.autonomous_execution_allowed === false)
  const hasDeepBookOnlyStatic = adapters.length > 0 && adapters.every((adapter) => adapter === 'DeepBook')

  return {
    surfacesKnown,
    rows,
    missing,
    blockers,
    readOnly,
    staticDeepBookOnly: !surfacesKnown && hasDeepBookOnlyStatic,
    canPreviewPolicy: strategy?.status !== 'soon' && Boolean(strategy?.scenario) && (
      !surfacesKnown ? hasDeepBookOnlyStatic : rows.length > 0 && missing.length === 0 && onlyRegisteredExecutors
    ),
  }
}

export function readinessBlockReason(readiness) {
  if (readiness.canPreviewPolicy) return null
  if (readiness.missing.length > 0) return `${readiness.missing.join(', ')} adapter not wired`
  if (readiness.blockers.length > 0) return readiness.blockers.join(', ')
  if (!readiness.surfacesKnown) return 'Worker adapter surface offline'
  return 'No registered execution adapter'
}
