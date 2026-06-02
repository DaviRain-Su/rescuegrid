import { DEPLOYMENT } from './sui-tx.js'
import { keypairFromLocalDaemonEnv, keypairFromWorkerEnv } from './secret-safe-signer.js'

export const SIGNER_CODE_EXECUTION_DISABLED = 'EXECUTION_DISABLED'
export const SIGNER_CODE_INVALID_SECRET = 'INVALID_SIGNER_SECRET'
export const SIGNER_CODE_ADDRESS_MISMATCH = 'SIGNER_ADDRESS_MISMATCH'
export const SIGNER_CODE_UNSUPPORTED = 'UNSUPPORTED_SIGNER'

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

export function resolveSignerAdapter(env, { client, expectedAgentAddress = DEPLOYMENT.agent.address } = {}) {
  const kind = signerKindFromEnv(env)
  const expectedAddress = expectedAgentAddress
  if (kind === SIGNER_KIND_WORKER_SECRET) return workerSecretSignerAdapter(env, client, expectedAddress)
  if (kind === SIGNER_KIND_LOCAL_DAEMON) return localDaemonSignerAdapter(env, client, expectedAddress)
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
