import { DEPLOYMENT } from './sui-tx.js'
import { keypairFromWorkerEnv } from './secret-safe-signer.js'

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

function unsupportedSignerAdapter(kind) {
  return {
    kind,
    address: DEPLOYMENT.agent.address,
    available: false,
    unavailable_code: 'UNSUPPORTED_SIGNER',
    unavailable_detail: `Signer adapter ${kind} is not implemented in this runtime.`,
    async signAndSubmit() {
      throw new Error(`Signer adapter ${kind} is not implemented`)
    },
  }
}

function workerSecretSignerAdapter(env, client) {
  return {
    kind: SIGNER_KIND_WORKER_SECRET,
    address: DEPLOYMENT.agent.address,
    available: typeof env?.AGENT_KEY === 'string' && env.AGENT_KEY.trim() !== '',
    unavailable_code: 'EXECUTION_DISABLED',
    unavailable_detail: 'worker AGENT_KEY is unavailable',
    async signAndSubmit(transaction, options = { showEffects: true, showEvents: true }) {
      const signer = keypairFromWorkerEnv(env)
      return client.signAndExecuteTransaction({ signer, transaction, options })
    },
  }
}

export function resolveSignerAdapter(env, { client } = {}) {
  const kind = signerKindFromEnv(env)
  if (kind === SIGNER_KIND_WORKER_SECRET) return workerSecretSignerAdapter(env, client)
  return unsupportedSignerAdapter(kind)
}

export function signerExecutionEnabled(env, signerAdapter) {
  return env?.EXECUTION_ENABLED === 'true' && Boolean(signerAdapter?.available)
}
