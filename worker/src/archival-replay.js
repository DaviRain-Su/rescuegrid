export const ARCHIVAL_REPLAY_PROVIDER_NONE = 'none'
export const ARCHIVAL_REPLAY_PROVIDER_ARCHIVAL_STORE = 'archival-store'
export const KNOWN_ARCHIVAL_REPLAY_PROVIDERS = Object.freeze([
  ARCHIVAL_REPLAY_PROVIDER_NONE,
  ARCHIVAL_REPLAY_PROVIDER_ARCHIVAL_STORE,
])

function normalizeArchivalReplayProviderKind(kind) {
  const value = String(kind || ARCHIVAL_REPLAY_PROVIDER_NONE).trim().toLowerCase()
  if (value === 'disabled' || value === 'off') return ARCHIVAL_REPLAY_PROVIDER_NONE
  if (value === 'archival_store' || value === 'sui-archival-store') return ARCHIVAL_REPLAY_PROVIDER_ARCHIVAL_STORE
  return value
}

export function configuredArchivalReplayProviderKind(env = {}) {
  return normalizeArchivalReplayProviderKind(
    env.ARCHIVAL_REPLAY_PROVIDER
    || env.RESCUEGRID_ARCHIVAL_REPLAY_PROVIDER
    || ARCHIVAL_REPLAY_PROVIDER_NONE,
  )
}

export function configuredArchivalReplayEndpoint(env = {}) {
  return String(env.SUI_ARCHIVAL_STORE_URL || env.SUI_ARCHIVAL_URL || env.ARCHIVAL_STORE_URL || '').trim()
}

export function unsupportedArchivalReplayProvider(kind) {
  return {
    status: 'error',
    code: 'UNSUPPORTED_ARCHIVAL_REPLAY_PROVIDER',
    provider_kind: kind || 'unknown',
    message: `Unsupported archival replay provider: ${kind || 'unknown'}. Current implementation supports none and an archival-store contract boundary.`,
  }
}

export const ARCHIVAL_REPLAY_QUERY_CONTRACTS = Object.freeze([
  {
    id: 'historical_activity',
    label: 'Historical activity',
    purpose: 'Reconstruct chain-authoritative policy lifecycle and runtime-visible decisions beyond recent event pages.',
    required_inputs: ['owner?', 'wrapper_id?', 'from_checkpoint?', 'to_checkpoint?', 'from_timestamp_ms?', 'to_timestamp_ms?', 'limit?', 'cursor?'],
    required_outputs: [
      'events[] sorted by checkpoint/timestamp',
      'policy snapshots keyed by wrapper_id',
      'terminal chain state for revoked/expired policies',
      'source evidence with tx_digest, checkpoint and event type',
    ],
    primary_sources: [
      'RescueGrid policy Move events',
      'MoveGate Mandate / ActionReceipt events',
      'RescuePolicyWrapper object snapshots',
      'Durable Object runtime activity as non-authoritative annotation',
    ],
    current_fallback: 'Recent JSON-RPC or GraphQL event pages plus Durable Object runtime activity.',
    consumers: ['Agent Activity', 'Policy Inspect', 'local daemon logs'],
    must_not_claim_execution: true,
  },
  {
    id: 'performance_replay',
    label: 'Performance replay',
    purpose: 'Replay policy budget, spend, fill and blocked-decision history for strategy performance charts.',
    required_inputs: ['wrapper_id', 'strategy_hash?', 'from_checkpoint?', 'to_checkpoint?', 'market_id?', 'price_series_id?'],
    required_outputs: [
      'budget timeline',
      'spent_amount deltas',
      'execution and blocked tick markers',
      'price context used for advisory replay',
      'PnL/carry fields marked advisory unless backed by execution evidence',
    ],
    primary_sources: [
      'AgentTradeExecuted events',
      'PolicyCreated / PolicyRevoked events',
      'runtime blocked/no-op activity annotations',
      'Worker market read snapshots when available',
    ],
    current_fallback: 'Current UI uses recent activity plus live/advisory market reads; long-range replay is not implemented.',
    consumers: ['Active Strategy Detail', 'Strategy performance export', 'operator review'],
    must_not_claim_execution: true,
  },
  {
    id: 'judge_demo_replay',
    label: 'Judge/demo replay',
    purpose: 'Produce a deterministic evidence packet for hackathon judges and handoff reviews.',
    required_inputs: ['run_marker?', 'owner?', 'wrapper_id?', 'created_after_ms?', 'include_runtime_annotations?'],
    required_outputs: [
      'deployment ids',
      'create / activate / tick / revoke sequence',
      'tx digests and checkpoints',
      'execution_claimed flags',
      'funding and signer blockers',
      'secret-leak-safe redaction proof',
    ],
    primary_sources: [
      'RescueGrid chain events',
      'runtime activity rows',
      'execution readiness snapshots',
      'funding handoff report fields',
    ],
    current_fallback: '`npm run demo:loop`, `npm run demo:execute`, `npm run funding:request` and `docs/STATUS.md` evidence.',
    consumers: ['hackathon submission', 'baseline smoke report', 'funding provider handoff'],
    must_not_claim_execution: true,
  },
])

export function getArchivalReplayProviderStatus(env = {}) {
  const kind = configuredArchivalReplayProviderKind(env)
  const endpointConfigured = Boolean(configuredArchivalReplayEndpoint(env))
  if (kind === ARCHIVAL_REPLAY_PROVIDER_NONE) {
    return {
      kind,
      known_provider_kinds: KNOWN_ARCHIVAL_REPLAY_PROVIDERS,
      provider_status: 'disabled',
      endpoint_configured: endpointConfigured,
      worker_first: true,
      replay_only: true,
      execution_hot_path_unchanged: true,
      activity_hot_path_unchanged: true,
      migration_ready: false,
      blocker_code: 'ARCHIVAL_REPLAY_DISABLED',
    }
  }
  if (kind === ARCHIVAL_REPLAY_PROVIDER_ARCHIVAL_STORE) {
    return {
      kind,
      known_provider_kinds: KNOWN_ARCHIVAL_REPLAY_PROVIDERS,
      provider_status: endpointConfigured ? 'not_validated' : 'unavailable',
      endpoint_configured: endpointConfigured,
      worker_first: true,
      replay_only: true,
      execution_hot_path_unchanged: true,
      activity_hot_path_unchanged: true,
      migration_ready: false,
      blocker_code: endpointConfigured ? 'ARCHIVAL_REPLAY_NOT_VALIDATED' : 'ARCHIVAL_REPLAY_ENDPOINT_REQUIRED',
      unavailable_detail: endpointConfigured
        ? 'Archival Store endpoint is configured, but replay query shape and reconciliation have not been validated.'
        : 'Archival replay requires an Archival Store endpoint and contract validation before use.',
    }
  }
  return {
    kind,
    known_provider_kinds: KNOWN_ARCHIVAL_REPLAY_PROVIDERS,
    provider_status: 'unsupported',
    endpoint_configured: endpointConfigured,
    worker_first: true,
    replay_only: true,
    execution_hot_path_unchanged: true,
    activity_hot_path_unchanged: true,
    migration_ready: false,
    blocker_code: 'UNSUPPORTED_ARCHIVAL_REPLAY_PROVIDER',
    error: unsupportedArchivalReplayProvider(kind),
  }
}

export function getArchivalReplayContract(env = {}) {
  return {
    status: 'ok',
    chain: 'sui:testnet',
    provider: getArchivalReplayProviderStatus(env),
    query_contracts: ARCHIVAL_REPLAY_QUERY_CONTRACTS,
    invariants: [
      'Worker remains the replay contract for frontend, cloud agent and local daemon.',
      'Replay reads cannot submit transactions or claim execution success.',
      'Chain events and object snapshots win over runtime annotations.',
      'Runtime blocked/no-op rows are annotations, not on-chain proof.',
      'Endpoint URLs, access tokens and signer secrets must never be returned.',
    ],
  }
}
