import { DEPLOYMENT } from './sui-tx.js'
import { keypairFromLocalDaemonEnv, keypairFromWorkerEnv } from './secret-safe-signer.js'

export const SIGNER_CODE_EXECUTION_DISABLED = 'EXECUTION_DISABLED'
export const SIGNER_CODE_INVALID_SECRET = 'INVALID_SIGNER_SECRET'
export const SIGNER_CODE_ADDRESS_MISMATCH = 'SIGNER_ADDRESS_MISMATCH'
export const SIGNER_CODE_UNSUPPORTED = 'UNSUPPORTED_SIGNER'
export const SIGNER_CODE_WAAP_ADDRESS_MISSING = 'WAAP_ADDRESS_MISSING'
export const SIGNER_CODE_WAAP_RUNNER_MISSING = 'WAAP_RUNNER_MISSING'
export const SIGNER_CODE_WAAP_NO_DIGEST = 'WAAP_NO_DIGEST'

export const SIGNER_KIND_WORKER_SECRET = 'worker-secret'
export const SIGNER_KIND_LOCAL_DAEMON = 'local-daemon'
export const SIGNER_KIND_WAAP = 'waap'
export const SIGNER_KIND_HARDWARE = 'hardware'
export const SIGNER_KIND_REMOTE = 'remote-signer'

export const KNOWN_SIGNER_KINDS = [
  SIGNER_KIND_WORKER_SECRET,
  SIGNER_KIND_LOCAL_DAEMON,
  SIGNER_KIND_WAAP,
  SIGNER_KIND_HARDWARE,
  SIGNER_KIND_REMOTE,
]

export function signerKindFromEnv(env) {
  return env?.SIGNER_KIND || env?.RESCUEGRID_SIGNER_KIND || SIGNER_KIND_WORKER_SECRET
}

function signerSecretStatus(env, { expectedAddress, sourceLabel, keypairFromEnv }) {
  if (typeof env?.AGENT_KEY !== 'string' || env.AGENT_KEY.trim() === '') {
    return {
      address: null,
      expected_address: expectedAddress,
      signer_matches_expected: false,
      available: false,
      unavailable_code: SIGNER_CODE_EXECUTION_DISABLED,
      unavailable_detail: `${sourceLabel} is unavailable`,
    }
  }
  try {
    const signer = keypairFromEnv(env)
    const address = signer.getPublicKey().toSuiAddress()
    const matches = address === expectedAddress
    return {
      address,
      expected_address: expectedAddress,
      signer_matches_expected: matches,
      available: matches,
      unavailable_code: matches ? null : SIGNER_CODE_ADDRESS_MISMATCH,
      unavailable_detail: matches ? null : `${sourceLabel} address does not match deployed RescueGrid agent address.`,
    }
  } catch {
    return {
      address: null,
      expected_address: expectedAddress,
      signer_matches_expected: false,
      available: false,
      unavailable_code: SIGNER_CODE_INVALID_SECRET,
      unavailable_detail: `${sourceLabel} is not a valid Sui private key`,
    }
  }
}

function assertExpectedSignerAddress(signer, expectedAddress, sourceLabel) {
  const actual = signer.getPublicKey().toSuiAddress()
  if (actual !== expectedAddress) {
    throw new Error(`${sourceLabel} address does not match deployed RescueGrid agent address`)
  }
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

function envString(env, ...keys) {
  for (const key of keys) {
    const value = env?.[key]
    if (value != null && String(value).trim() !== '') return String(value)
  }
  return undefined
}

function unsupportedSignerAdapter(kind, expectedAddress) {
  return {
    kind,
    address: null,
    expected_address: expectedAddress,
    signer_matches_expected: false,
    available: false,
    unavailable_code: SIGNER_CODE_UNSUPPORTED,
    unavailable_detail: `Signer adapter ${kind} is not implemented in this runtime.`,
    async signAndSubmit() {
      throw new Error(`Signer adapter ${kind} is not implemented`)
    },
  }
}

function extractWaapDigest(result = {}) {
  if (typeof result === 'string' && result.trim()) {
    try {
      return extractWaapDigest(JSON.parse(result))
    } catch {
      return result.trim()
    }
  }
  if (typeof result !== 'object' || !result) return null
  return result.digest || result.txDigest || result.transactionDigest || result.txHash || result.hash || null
}

function waapPublicResult(result = {}) {
  if (typeof result !== 'object' || !result) return {}
  const out = {}
  for (const key of ['digest', 'txDigest', 'transactionDigest', 'txHash', 'hash', 'chain', 'status', 'approvalStatus', 'policyStatus']) {
    if (result[key] != null) out[key] = result[key]
  }
  return out
}

function serializeTxJsonForWaap(transaction, expectedAddress) {
  if (transaction && typeof transaction.setSender === 'function') transaction.setSender(expectedAddress)
  if (typeof transaction === 'string') return transaction
  if (transaction && typeof transaction.serialize === 'function') return transaction.serialize()
  if (transaction && typeof transaction.toJSON === 'function') return JSON.stringify(transaction.toJSON())
  return JSON.stringify(transaction)
}

function workerSecretSignerAdapter(env, client, expectedAddress) {
  const status = signerSecretStatus(env, {
    expectedAddress,
    sourceLabel: 'worker AGENT_KEY',
    keypairFromEnv: keypairFromWorkerEnv,
  })
  return {
    kind: SIGNER_KIND_WORKER_SECRET,
    ...status,
    async signAndSubmit(transaction, options = { showEffects: true, showEvents: true }) {
      const signer = keypairFromWorkerEnv(env)
      assertExpectedSignerAddress(signer, expectedAddress, 'worker AGENT_KEY')
      return client.signAndExecuteTransaction({ signer, transaction, options })
    },
  }
}

function localDaemonSignerAdapter(env, client, expectedAddress) {
  const daemonMode = env?.RESCUEGRID_DAEMON_MODE === 'true'
  const status = daemonMode
    ? signerSecretStatus(env, {
        expectedAddress,
        sourceLabel: 'local daemon AGENT_KEY',
        keypairFromEnv: keypairFromLocalDaemonEnv,
      })
    : {
        address: null,
        expected_address: expectedAddress,
        signer_matches_expected: false,
        available: false,
        unavailable_code: SIGNER_CODE_UNSUPPORTED,
        unavailable_detail: 'local-daemon signer requires RESCUEGRID_DAEMON_MODE=true and is not available in the cloud Worker runtime',
      }
  return {
    kind: SIGNER_KIND_LOCAL_DAEMON,
    ...status,
    async signAndSubmit(transaction, options = { showEffects: true, showEvents: true }) {
      if (!daemonMode) throw new Error('local-daemon signer is not available outside RESCUEGRID_DAEMON_MODE=true')
      const signer = keypairFromLocalDaemonEnv(env)
      assertExpectedSignerAddress(signer, expectedAddress, 'local daemon AGENT_KEY')
      return client.signAndExecuteTransaction({ signer, transaction, options })
    },
  }
}

function waapSignerStatus(env, expectedAddress) {
  const daemonMode = env?.RESCUEGRID_DAEMON_MODE === 'true'
  const enabled = boolEnv(env, 'RESCUEGRID_WAAP_CLI_ENABLED', 'WAAP_CLI_ENABLED')
  const address = envString(env, 'RESCUEGRID_WAAP_SUI_ADDRESS', 'WAAP_SUI_ADDRESS')
  if (!daemonMode) {
    return {
      address: null,
      expected_address: expectedAddress,
      signer_matches_expected: false,
      available: false,
      unavailable_code: SIGNER_CODE_UNSUPPORTED,
      unavailable_detail: 'waap signer requires a local daemon or external signer service; Cloud Worker runtime cannot shell out to waap-cli.',
    }
  }
  if (!enabled) {
    return {
      address: address || null,
      expected_address: expectedAddress,
      signer_matches_expected: address === expectedAddress,
      available: false,
      unavailable_code: SIGNER_CODE_UNSUPPORTED,
      unavailable_detail: 'waap signer spike is disabled; set RESCUEGRID_WAAP_CLI_ENABLED=true only in a reviewed local daemon runtime.',
    }
  }
  if (!address) {
    return {
      address: null,
      expected_address: expectedAddress,
      signer_matches_expected: false,
      available: false,
      unavailable_code: SIGNER_CODE_WAAP_ADDRESS_MISSING,
      unavailable_detail: 'waap signer requires RESCUEGRID_WAAP_SUI_ADDRESS so RescueGrid can verify it matches the deployed agent.',
    }
  }
  const matches = address === expectedAddress
  return {
    address,
    expected_address: expectedAddress,
    signer_matches_expected: matches,
    available: matches,
    unavailable_code: matches ? null : SIGNER_CODE_ADDRESS_MISMATCH,
    unavailable_detail: matches ? null : 'waap signer address does not match deployed RescueGrid agent address.',
  }
}

function waapSignerAdapter(env, expectedAddress, waapCliRunner) {
  const status = waapSignerStatus(env, expectedAddress)
  return {
    kind: SIGNER_KIND_WAAP,
    ...status,
    async signAndSubmit(transaction) {
      if (!status.available) throw new Error(status.unavailable_detail || 'waap signer is unavailable')
      if (typeof waapCliRunner !== 'function') {
        const error = new Error('waap signer runner is not configured for this runtime')
        error.code = SIGNER_CODE_WAAP_RUNNER_MISSING
        throw error
      }
      const txJson = serializeTxJsonForWaap(transaction, expectedAddress)
      const chain = envString(env, 'RESCUEGRID_WAAP_CHAIN', 'WAAP_CHAIN', 'RESCUEGRID_CHAIN') || 'sui:testnet'
      const result = await waapCliRunner({
        txJson,
        chain,
        rpc: envString(env, 'RESCUEGRID_WAAP_RPC', 'WAAP_RPC'),
        permissionToken: envString(env, 'RESCUEGRID_WAAP_PERMISSION_TOKEN', 'WAAP_PERMISSION_TOKEN'),
        cliPath: envString(env, 'RESCUEGRID_WAAP_CLI_PATH', 'WAAP_CLI_PATH') || 'waap-cli',
      })
      const parsed = typeof result?.stdout === 'string'
        ? JSON.parse(result.stdout || '{}')
        : result
      const digest = extractWaapDigest(parsed)
      if (!digest) {
        const error = new Error('waap signer did not return a Sui transaction digest')
        error.code = SIGNER_CODE_WAAP_NO_DIGEST
        throw error
      }
      return {
        digest,
        signer_kind: SIGNER_KIND_WAAP,
        submitted: true,
        waap_chain: chain,
        waap_result: waapPublicResult(parsed),
      }
    },
  }
}

export function resolveSignerAdapter(env, { client, expectedAgentAddress = DEPLOYMENT.agent.address, waapCliRunner = null } = {}) {
  const kind = signerKindFromEnv(env)
  const expectedAddress = expectedAgentAddress
  if (kind === SIGNER_KIND_WORKER_SECRET) return workerSecretSignerAdapter(env, client, expectedAddress)
  if (kind === SIGNER_KIND_LOCAL_DAEMON) return localDaemonSignerAdapter(env, client, expectedAddress)
  if (kind === SIGNER_KIND_WAAP) return waapSignerAdapter(env, expectedAddress, waapCliRunner)
  return unsupportedSignerAdapter(kind, expectedAddress)
}

export function signerExecutionEnabled(env, signerAdapter) {
  return env?.EXECUTION_ENABLED === 'true' && Boolean(signerAdapter?.available)
}

export function signerAdapterStatus(env, options = {}) {
  const adapter = resolveSignerAdapter(env, options)
  const executionConfigured = env?.EXECUTION_ENABLED === 'true'
  const executionEnabled = signerExecutionEnabled(env, adapter)
  return {
    kind: adapter.kind,
    address: adapter.address,
    expected_address: adapter.expected_address,
    signer_matches_expected: Boolean(adapter.signer_matches_expected),
    available: Boolean(adapter.available),
    execution_configured: executionConfigured,
    execution_enabled: executionEnabled,
    unavailable_code: adapter.available ? null : adapter.unavailable_code,
    unavailable_detail: adapter.available ? null : adapter.unavailable_detail,
    known_signer_kinds: KNOWN_SIGNER_KINDS,
  }
}
