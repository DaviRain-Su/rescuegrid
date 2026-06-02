const EXTERNAL_SIGNER_KINDS = new Set(['waap', 'hardware', 'remote-signer'])

export function shortPublicAddress(address) {
  return address && address.length > 16 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address
}

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function joinDetail(parts) {
  return parts.map(clean).filter(Boolean).join(' · ')
}

function signerStatus(signer = {}, execution = {}) {
  if (signer.available && (execution.enabled || signer.execution_enabled)) return 'ok'
  if (signer.available) return 'warn'
  return 'offline'
}

function runtimeSignerName(kind) {
  if (kind === 'worker-secret') return 'Cloud agent executor'
  if (kind === 'local-daemon') return 'Local daemon signer'
  if (kind === 'waap') return 'WaaP CLI signer'
  if (kind === 'hardware') return 'Hardware signer'
  if (kind === 'remote-signer') return 'Remote signer'
  return 'Runtime signer'
}

function runtimeSignerUiKind(kind) {
  if (kind === 'worker-secret') return 'cloud'
  if (kind === 'local-daemon') return 'local'
  if (EXTERNAL_SIGNER_KINDS.has(kind)) return 'external'
  return 'runtime'
}

function executionBlocker(signer = {}, execution = {}) {
  if (execution.enabled || signer.execution_enabled) return 'execution enabled'
  return execution.blocker_code || signer.unavailable_code || 'execution gated'
}

function fallbackSignerRows(fallbackRows = []) {
  return fallbackRows.map((row) => ({
    id: `static-${row.kind || 'signer'}-${row.name || row.detail}`,
    name: row.name || 'Signer',
    kind: row.kind || 'runtime',
    status: row.status || 'offline',
    detail: row.detail || '',
    source: 'static',
    warning: row.status !== 'ok',
  }))
}

function tokenPostureLabel(value) {
  if (value === true) return 'permission token configured'
  if (value === false) return 'permission token not configured'
  return null
}

function runnerPostureLabel(value) {
  if (value === true) return 'submission runner configured'
  if (value === false) return 'submission runner missing'
  return null
}

function externalSignerRow(runtimeStatus, signer, execution) {
  const runtime = runtimeStatus?.runtime || {}
  const external = runtimeStatus?.external_signer || runtime.external_signer || null
  const knownKinds = signer?.known_signer_kinds || []
  const kind = signer?.kind
  const isExternalSelected = EXTERNAL_SIGNER_KINDS.has(kind)
  const showExternalBoundary = Boolean(
    external
    || isExternalSelected
    || runtime.local_daemon_supported
    || runtime.mainnet_requires_external_signer
    || knownKinds.some((knownKind) => EXTERNAL_SIGNER_KINDS.has(knownKind))
  )

  if (!showExternalBoundary) return null

  const selectedStatus = signerStatus(signer, execution)
  const status = isExternalSelected ? selectedStatus : 'offline'
  const isWaap = kind === 'waap' || external?.kind === 'waap' || knownKinds.includes('waap')
  const tokenConfigured = external?.permission_token_configured
  const detail = joinDetail([
    isExternalSelected ? executionBlocker(signer, execution) : 'not selected for this runtime',
    signer?.address && isExternalSelected ? `address ${shortPublicAddress(signer.address)}` : null,
    signer?.signer_matches_expected === false && signer?.expected_address ? `expected ${shortPublicAddress(signer.expected_address)}` : null,
    isWaap && runtime.cloud_worker ? 'Cloud Worker cannot shell out to waap-cli' : null,
    isWaap && runtime.cloud_worker === false ? 'local daemon CLI boundary' : null,
    !isWaap && runtime.local_daemon_supported ? 'local daemon can attach an external signer later' : null,
    runtime.mainnet_requires_external_signer ? 'mainnet requires external signer' : null,
    tokenPostureLabel(tokenConfigured),
    runnerPostureLabel(external?.submission_runner_configured),
    isExternalSelected ? signer?.unavailable_detail : null,
  ])

  return {
    id: isWaap ? 'external-waap-signer' : 'external-signer',
    name: isWaap ? 'WaaP external signer' : 'External signer boundary',
    kind: 'external',
    status,
    detail,
    source: 'runtime',
    warning: isExternalSelected && status !== 'ok',
  }
}

export function signerHealthRows(runtimeStatus, fallbackRows = []) {
  const signer = runtimeStatus?.signer
  if (!signer) return fallbackSignerRows(fallbackRows)

  const execution = runtimeStatus.execution || {}
  const runtimeStatusValue = signerStatus(signer, execution)
  const detail = joinDetail([
    signer.address ? `address ${shortPublicAddress(signer.address)}` : signer.unavailable_code || 'not configured',
    signer.signer_matches_expected === false && signer.expected_address ? `expected ${shortPublicAddress(signer.expected_address)}` : null,
    executionBlocker(signer, execution),
    signer.unavailable_detail,
  ])

  const rows = [
    {
      id: 'owner-wallet-signer',
      name: 'Owner wallet signer',
      kind: 'wallet',
      status: 'ok',
      detail: 'create / revoke only; no owner key custody',
      source: 'runtime',
      warning: false,
    },
    {
      id: 'runtime-signer',
      name: runtimeSignerName(signer.kind),
      kind: runtimeSignerUiKind(signer.kind),
      status: runtimeStatusValue,
      detail,
      source: 'runtime',
      warning: runtimeStatusValue !== 'ok',
    },
  ]

  const external = externalSignerRow(runtimeStatus, signer, execution)
  if (external) rows.push(external)
  return rows
}

export function signerWarningRows(runtimeStatus, fallbackRows = []) {
  return signerHealthRows(runtimeStatus, fallbackRows)
    .filter((row) => row.warning)
    .map((row) => ({
      id: `signer-${row.id}`,
      kind: row.kind === 'cloud' ? 'Cloud signer' : row.kind === 'local' ? 'Local daemon' : row.kind === 'external' ? 'External signer' : 'Signer',
      label: row.name,
      detail: row.detail,
      severity: row.status === 'danger' ? 'danger' : 'warn',
    }))
}

export function signerKindBadges(runtimeStatus) {
  return runtimeStatus?.signer?.known_signer_kinds || []
}
