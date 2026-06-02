export const PRIVATE_RECORD_PROVIDER_NONE = 'none'
export const PRIVATE_RECORD_PROVIDER_SEAL_WALRUS = 'seal-walrus'
export const KNOWN_PRIVATE_RECORD_PROVIDERS = Object.freeze([
  PRIVATE_RECORD_PROVIDER_NONE,
  PRIVATE_RECORD_PROVIDER_SEAL_WALRUS,
])

function normalizePrivateRecordProviderKind(kind) {
  const value = String(kind || PRIVATE_RECORD_PROVIDER_NONE).trim().toLowerCase()
  if (value === 'disabled' || value === 'off') return PRIVATE_RECORD_PROVIDER_NONE
  if (value === 'seal_walrus' || value === 'seal+walrus' || value === 'walrus-seal') return PRIVATE_RECORD_PROVIDER_SEAL_WALRUS
  return value
}

export function configuredPrivateRecordProviderKind(env = {}) {
  return normalizePrivateRecordProviderKind(
    env.PRIVATE_RECORD_PROVIDER
    || env.RESCUEGRID_PRIVATE_RECORD_PROVIDER
    || PRIVATE_RECORD_PROVIDER_NONE,
  )
}

function boolEnv(env, ...keys) {
  for (const key of keys) {
    const value = env?.[key]
    if (value == null || String(value).trim() === '') continue
    const normalized = String(value).toLowerCase()
    return normalized !== 'false' && normalized !== '0' && normalized !== 'no'
  }
  return false
}

function envConfigured(env, ...keys) {
  return keys.some((key) => {
    const value = env?.[key]
    return value != null && String(value).trim() !== ''
  })
}

export function privateRecordProviderConfig(env = {}) {
  const sealConfigured = boolEnv(env, 'SEAL_CONFIGURED', 'RESCUEGRID_SEAL_CONFIGURED')
    || envConfigured(env, 'SEAL_API_URL', 'RESCUEGRID_SEAL_API_URL')
  const walrusConfigured = boolEnv(env, 'WALRUS_CONFIGURED', 'RESCUEGRID_WALRUS_CONFIGURED')
    || envConfigured(env, 'WALRUS_API_URL', 'RESCUEGRID_WALRUS_API_URL')
  return {
    seal_configured: sealConfigured,
    walrus_configured: walrusConfigured,
  }
}

export function unsupportedPrivateRecordProvider(kind) {
  return {
    status: 'error',
    code: 'UNSUPPORTED_PRIVATE_RECORD_PROVIDER',
    provider_kind: kind || 'unknown',
    message: `Unsupported private record provider: ${kind || 'unknown'}. Current implementation supports none and a Seal + Walrus contract boundary.`,
  }
}

const COMMON_CHAIN_ANCHOR_FIELDS = Object.freeze([
  'wrapper_id',
  'mandate_id',
  'owner',
  'strategy_hash?',
  'walrus_blob_id',
  'seal_policy_id',
  'seal_access_object_id',
  'content_hash',
  'version',
  'created_at_ms',
  'updated_at_ms?',
])

const COMMON_DISALLOWED_FIELDS = Object.freeze([
  'AGENT_KEY',
  'OWNER_KEY',
  'owner_wallet_private_key',
  'agent_private_key',
  'WaaP session file',
  'WaaP permission token',
  'Turnkey API secret',
  'raw model hidden reasoning',
  'internal tick token',
])

const COMMON_REDACTIONS = Object.freeze([
  'private keys',
  'signing material',
  'session files',
  'permission tokens',
  'endpoint URLs with credentials',
  'raw model hidden reasoning',
])

export const PRIVATE_POLICY_RECORD_CONTRACTS = Object.freeze([
  {
    id: 'strategy_snapshot',
    label: 'Strategy snapshot',
    purpose: 'Encrypt the owner-approved strategy source text, parsed strategy JSON and PTB preview for later owner review.',
    encrypted_payload_fields: [
      'natural_language_strategy',
      'parsed_strategy_json',
      'strategy_hash',
      'owner',
      'wrapper_id',
      'mandate_id',
      'ptb_preview',
      'version',
      'created_at_ms',
    ],
    chain_anchor_fields: COMMON_CHAIN_ANCHOR_FIELDS,
    authorized_readers: ['owner', 'owner-delegated team address?', 'operator account?'],
    disallowed_fields: COMMON_DISALLOWED_FIELDS,
    required_redactions: COMMON_REDACTIONS,
    writer: 'browser_or_local_daemon_after_owner_approval',
    current_fallback: 'Only strategy_hash and public wrapper fields are stored/read today.',
    consumers: ['Strategy Builder', 'Policy Inspect', 'local daemon review'],
    client_side_encryption_required: true,
    signing_secret_allowed: false,
  },
  {
    id: 'backtest_report',
    label: 'Backtest report',
    purpose: 'Store encrypted backtest inputs, market windows, assumptions and advisory results linked to a policy version.',
    encrypted_payload_fields: [
      'strategy_hash',
      'market_window',
      'input_assumptions',
      'result_metrics',
      'chart_data',
      'advisory_only',
      'version',
      'created_at_ms',
    ],
    chain_anchor_fields: COMMON_CHAIN_ANCHOR_FIELDS,
    authorized_readers: ['owner', 'owner-delegated team address?', 'operator account?'],
    disallowed_fields: COMMON_DISALLOWED_FIELDS,
    required_redactions: COMMON_REDACTIONS,
    writer: 'browser_or_local_daemon_after_owner_approval',
    current_fallback: 'Strategy performance remains live/advisory UI state unless backed by chain execution evidence.',
    consumers: ['Strategy performance export', 'judge/demo replay', 'operator review'],
    client_side_encryption_required: true,
    signing_secret_allowed: false,
  },
  {
    id: 'agent_reasoning_trace',
    label: 'Agent reasoning trace',
    purpose: 'Store an owner-facing reasoning summary and tick evidence, never raw hidden model reasoning.',
    encrypted_payload_fields: [
      'wrapper_id',
      'tick_id',
      'operator_reasoning_summary',
      'input_snapshot',
      'guardian_decision',
      'blocker_codes',
      'redacted_execution_plan',
      'approval_state',
      'created_at_ms',
    ],
    chain_anchor_fields: COMMON_CHAIN_ANCHOR_FIELDS,
    authorized_readers: ['owner', 'owner-delegated team address?', 'operator account?'],
    disallowed_fields: COMMON_DISALLOWED_FIELDS,
    required_redactions: COMMON_REDACTIONS,
    writer: 'local_daemon_or_worker_public_summary_only',
    current_fallback: 'Runtime activity stores public blocked/no-op annotations only.',
    consumers: ['Agent Activity', 'Risk Center', 'operator review'],
    client_side_encryption_required: true,
    signing_secret_allowed: false,
  },
  {
    id: 'incident_report',
    label: 'Incident report',
    purpose: 'Store encrypted failed/blocked tick evidence, recovery action and user approval notes for post-incident review.',
    encrypted_payload_fields: [
      'wrapper_id',
      'tx_digest?',
      'tick_id',
      'error_code',
      'funding_blockers',
      'signer_blockers',
      'recovery_action',
      'human_approval_notes?',
      'created_at_ms',
    ],
    chain_anchor_fields: COMMON_CHAIN_ANCHOR_FIELDS,
    authorized_readers: ['owner', 'owner-delegated team address?', 'operator account?'],
    disallowed_fields: COMMON_DISALLOWED_FIELDS,
    required_redactions: COMMON_REDACTIONS,
    writer: 'browser_or_local_daemon_after_owner_approval',
    current_fallback: 'Funding/signing blockers are public status fields and JSONL daemon logs today.',
    consumers: ['Agent Activity', 'funding handoff', 'operator review'],
    client_side_encryption_required: true,
    signing_secret_allowed: false,
  },
])

export function getPrivateRecordProviderStatus(env = {}) {
  const kind = configuredPrivateRecordProviderKind(env)
  const config = privateRecordProviderConfig(env)
  if (kind === PRIVATE_RECORD_PROVIDER_NONE) {
    return {
      kind,
      known_provider_kinds: KNOWN_PRIVATE_RECORD_PROVIDERS,
      provider_status: 'disabled',
      ...config,
      worker_first: true,
      read_only_contract: true,
      client_side_encryption_required: true,
      signing_secret_allowed: false,
      storage_hot_path_unchanged: true,
      execution_hot_path_unchanged: true,
      migration_ready: false,
      blocker_code: 'PRIVATE_RECORDS_DISABLED',
    }
  }
  if (kind === PRIVATE_RECORD_PROVIDER_SEAL_WALRUS) {
    const configured = config.seal_configured && config.walrus_configured
    return {
      kind,
      known_provider_kinds: KNOWN_PRIVATE_RECORD_PROVIDERS,
      provider_status: configured ? 'not_validated' : 'unavailable',
      ...config,
      worker_first: true,
      read_only_contract: true,
      client_side_encryption_required: true,
      signing_secret_allowed: false,
      storage_hot_path_unchanged: true,
      execution_hot_path_unchanged: true,
      migration_ready: false,
      blocker_code: configured ? 'PRIVATE_RECORDS_NOT_VALIDATED' : 'PRIVATE_RECORDS_CONFIG_REQUIRED',
      unavailable_detail: configured
        ? 'Seal + Walrus posture is configured, but encrypted write/read, ACL validation and chain anchoring are not implemented.'
        : 'Private policy records require both Seal and Walrus configuration before a validation spike can run.',
    }
  }
  return {
    kind,
    known_provider_kinds: KNOWN_PRIVATE_RECORD_PROVIDERS,
    provider_status: 'unsupported',
    ...config,
    worker_first: true,
    read_only_contract: true,
    client_side_encryption_required: true,
    signing_secret_allowed: false,
    storage_hot_path_unchanged: true,
    execution_hot_path_unchanged: true,
    migration_ready: false,
    blocker_code: 'UNSUPPORTED_PRIVATE_RECORD_PROVIDER',
    error: unsupportedPrivateRecordProvider(kind),
  }
}

export function getPrivatePolicyRecordContract(env = {}) {
  return {
    status: 'ok',
    chain: 'sui:testnet',
    provider: getPrivateRecordProviderStatus(env),
    access_model: {
      pattern: 'Sui access object + Seal policy + Walrus blob id',
      chain_anchor_fields: COMMON_CHAIN_ANCHOR_FIELDS,
      default_authorized_readers: ['owner'],
      optional_authorized_readers: ['owner-delegated team address', 'operator account'],
      agent_can_decrypt_by_default: false,
      worker_can_decrypt_by_default: false,
      encryption_location: 'client_or_local_daemon_before_upload',
      on_chain_payload_policy: 'hashes_and_blob_ids_only',
    },
    record_contracts: PRIVATE_POLICY_RECORD_CONTRACTS,
    invariants: [
      'Worker exposes only the private record contract surface until Seal + Walrus read/write validation is complete.',
      'Private policy records are encrypted client-side or by an approved local daemon before Walrus upload.',
      'Sui stores only access object ids, blob ids, versions and content hashes.',
      'AGENT_KEY, owner wallet keys, WaaP session files, permission tokens and signing material are never valid payload fields.',
      'Agent-facing records use owner-facing reasoning summaries, not raw hidden model reasoning.',
      'Private record storage cannot submit transactions or relax Guardian, MoveGate or RescuePolicyWrapper checks.',
    ],
  }
}
