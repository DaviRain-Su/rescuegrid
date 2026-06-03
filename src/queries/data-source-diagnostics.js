export function statusTone({ ready = false, warn = false } = {}) {
  if (ready) return 'safe'
  if (warn) return 'warn'
  return 'neutral'
}

export function chainDataProviderDiagnostic(data = null, query = {}, { workerConfigured = true } = {}) {
  const unavailable = !workerConfigured
    ? 'worker not configured'
    : query?.isError
      ? 'worker read failed'
      : data?.provider_status || 'loading'
  const ready = data?.provider_status === 'ready' || (data?.provider_status === 'configured' && data?.available)
  const warn = data?.provider_status === 'probe_failed' || data?.provider_status === 'unavailable' || data?.status === 'error'
  const readModel = data?.read_model || {}
  const probeStatus = data?.probe?.status || (query?.isPending ? 'loading' : 'not run')
  return {
    available: data?.status === 'ok',
    statusLabel: data?.provider_status || unavailable,
    tone: statusTone({ ready, warn }),
    ready,
    warn,
    metrics: [
      ['Provider', data?.provider_kind || '-'],
      ['Transport', data?.transport || '-'],
      ['Probe', probeStatus],
    ],
    readModelRows: Object.entries(readModel).map(([key, value]) => ({
      id: key,
      label: key.replace(/_/g, ' '),
      value,
      warn: String(value).includes('fallback'),
    })),
    probeError: data?.probe?.status === 'error'
      ? `${data.probe.code || 'PROBE_FAILED'} · ${data.probe.message || 'schema/read probe failed'}`
      : null,
  }
}

export function archivalReplayDiagnostic(data = null, query = {}, { workerConfigured = true } = {}) {
  const provider = data?.provider || {}
  const contracts = data?.query_contracts || []
  const unavailable = !workerConfigured
    ? 'worker not configured'
    : query?.isError
      ? 'worker read failed'
      : provider.provider_status || 'loading'
  const ready = provider.provider_status === 'ready'
  const warn = Boolean(provider.provider_status && provider.provider_status !== 'ready')
  return {
    available: data?.status === 'ok',
    statusLabel: provider.provider_status || unavailable,
    tone: statusTone({ ready, warn }),
    ready,
    warn,
    metrics: [
      ['Provider', provider.kind || 'none'],
      ['Contracts', contracts.length],
      ['Replay only', provider.replay_only ? 'yes' : '-'],
    ],
    contractRows: contracts.map((row) => ({
      id: row.id,
      label: row.label,
      value: 'contract',
      mustNotClaimExecution: row.must_not_claim_execution === true,
    })),
    blocker: provider.blocker_code || 'REPLAY_CONTRACT_ONLY',
    hotPath: 'existing activity hot path unchanged',
  }
}

export function privatePolicyRecordDiagnostic(data = null, query = {}, { workerConfigured = true } = {}) {
  const provider = data?.provider || {}
  const contracts = data?.record_contracts || []
  const objectContract = data?.object_contract || {}
  const operations = data?.operation_contracts || []
  const events = data?.event_contracts || []
  const unavailable = !workerConfigured
    ? 'worker not configured'
    : query?.isError
      ? 'worker read failed'
      : provider.provider_status || 'loading'
  const ready = provider.provider_status === 'ready'
  const warn = Boolean(provider.provider_status && provider.provider_status !== 'ready')
  return {
    available: data?.status === 'ok',
    statusLabel: provider.provider_status || unavailable,
    tone: statusTone({ ready, warn }),
    ready,
    warn,
    metrics: [
      ['Provider', provider.kind || 'none'],
      ['Records', contracts.length],
      ['Object', objectContract.implementation_status || 'contract'],
    ],
    recordRows: contracts.map((row) => ({
      id: row.id,
      label: row.label,
      value: 'contract',
      encryptionRequired: row.client_side_encryption_required === true,
    })),
    operationsCount: operations.length,
    eventsCount: events.length,
    blocker: objectContract.blocker_code || provider.blocker_code || 'PRIVATE_RECORD_CONTRACT_ONLY',
    hotPath: 'encrypted storage hot path unchanged',
  }
}
