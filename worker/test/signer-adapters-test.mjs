import assert from 'node:assert/strict'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import {
  SIGNER_KIND_LOCAL_DAEMON,
  SIGNER_KIND_WAAP,
  SIGNER_KIND_WORKER_SECRET,
  resolveSignerAdapter,
  signerExecutionEnabled,
  signerKindFromEnv,
} from '../src/signer-adapters.js'

const keypair = Ed25519Keypair.generate()
const secret = keypair.getSecretKey()
const transaction = { mock: 'tx' }
const calls = []
const client = {
  async signAndExecuteTransaction(args) {
    calls.push(args)
    return { digest: '0xsubmitted' }
  },
}

assert.equal(signerKindFromEnv({}), SIGNER_KIND_WORKER_SECRET)
assert.equal(signerKindFromEnv({ SIGNER_KIND: SIGNER_KIND_WAAP }), SIGNER_KIND_WAAP)
assert.equal(signerKindFromEnv({ RESCUEGRID_SIGNER_KIND: SIGNER_KIND_WAAP }), SIGNER_KIND_WAAP)
assert.equal(signerKindFromEnv({ SIGNER_KIND: SIGNER_KIND_LOCAL_DAEMON }), SIGNER_KIND_LOCAL_DAEMON)

const missingSecret = resolveSignerAdapter({ EXECUTION_ENABLED: 'true' }, { client })
assert.equal(missingSecret.kind, SIGNER_KIND_WORKER_SECRET)
assert.equal(missingSecret.available, false)
assert.equal(signerExecutionEnabled({ EXECUTION_ENABLED: 'true' }, missingSecret), false)

const workerSecret = resolveSignerAdapter({ EXECUTION_ENABLED: 'true', AGENT_KEY: secret }, { client })
assert.equal(workerSecret.kind, SIGNER_KIND_WORKER_SECRET)
assert.equal(workerSecret.available, true)
assert.equal(signerExecutionEnabled({ EXECUTION_ENABLED: 'true' }, workerSecret), true)
assert.equal(signerExecutionEnabled({ EXECUTION_ENABLED: 'false' }, workerSecret), false)

const submitted = await workerSecret.signAndSubmit(transaction, { showEffects: true })
assert.deepEqual(submitted, { digest: '0xsubmitted' })
assert.equal(calls.length, 1)
assert.equal(calls[0].transaction, transaction)
assert.deepEqual(calls[0].options, { showEffects: true })
assert.equal(
  calls[0].signer.getPublicKey().toSuiAddress(),
  keypair.getPublicKey().toSuiAddress(),
)

const localDaemonOutsideDaemonMode = resolveSignerAdapter({
  SIGNER_KIND: SIGNER_KIND_LOCAL_DAEMON,
  EXECUTION_ENABLED: 'true',
  AGENT_KEY: secret,
}, { client })
assert.equal(localDaemonOutsideDaemonMode.kind, SIGNER_KIND_LOCAL_DAEMON)
assert.equal(localDaemonOutsideDaemonMode.available, false)
assert.equal(localDaemonOutsideDaemonMode.unavailable_code, 'UNSUPPORTED_SIGNER')
assert.equal(signerExecutionEnabled({ EXECUTION_ENABLED: 'true' }, localDaemonOutsideDaemonMode), false)
await assert.rejects(() => localDaemonOutsideDaemonMode.signAndSubmit(transaction), /not available outside/)

const localDaemonMissingKey = resolveSignerAdapter({
  SIGNER_KIND: SIGNER_KIND_LOCAL_DAEMON,
  RESCUEGRID_DAEMON_MODE: 'true',
  EXECUTION_ENABLED: 'true',
}, { client })
assert.equal(localDaemonMissingKey.available, false)
assert.equal(localDaemonMissingKey.unavailable_code, 'EXECUTION_DISABLED')
assert.equal(signerExecutionEnabled({ EXECUTION_ENABLED: 'true' }, localDaemonMissingKey), false)

const localDaemon = resolveSignerAdapter({
  SIGNER_KIND: SIGNER_KIND_LOCAL_DAEMON,
  RESCUEGRID_DAEMON_MODE: 'true',
  EXECUTION_ENABLED: 'true',
  AGENT_KEY: secret,
}, { client })
assert.equal(localDaemon.kind, SIGNER_KIND_LOCAL_DAEMON)
assert.equal(localDaemon.available, true)
assert.equal(signerExecutionEnabled({ EXECUTION_ENABLED: 'true' }, localDaemon), true)
const daemonSubmitted = await localDaemon.signAndSubmit(transaction, { showEffects: true, showEvents: true })
assert.deepEqual(daemonSubmitted, { digest: '0xsubmitted' })
assert.equal(calls.length, 2)
assert.equal(calls[1].transaction, transaction)
assert.deepEqual(calls[1].options, { showEffects: true, showEvents: true })
assert.equal(
  calls[1].signer.getPublicKey().toSuiAddress(),
  keypair.getPublicKey().toSuiAddress(),
)

const waap = resolveSignerAdapter({ SIGNER_KIND: SIGNER_KIND_WAAP, EXECUTION_ENABLED: 'true' }, { client })
assert.equal(waap.kind, SIGNER_KIND_WAAP)
assert.equal(waap.available, false)
assert.equal(waap.unavailable_code, 'UNSUPPORTED_SIGNER')
assert.equal(signerExecutionEnabled({ EXECUTION_ENABLED: 'true' }, waap), false)
await assert.rejects(() => waap.signAndSubmit(transaction), /not implemented/)

console.log('\nALL SIGNER ADAPTER TESTS PASS')
