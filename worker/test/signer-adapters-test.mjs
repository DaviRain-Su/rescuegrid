import assert from 'node:assert/strict'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import {
  SIGNER_CODE_ADDRESS_MISMATCH,
  SIGNER_KIND_LOCAL_DAEMON,
  SIGNER_KIND_WAAP,
  SIGNER_KIND_WORKER_SECRET,
  resolveSignerAdapter,
  signerAdapterStatus,
  signerExecutionEnabled,
  signerKindFromEnv,
} from '../src/signer-adapters.js'
import { DEPLOYMENT } from '../src/sui-tx.js'

const keypair = Ed25519Keypair.generate()
const secret = keypair.getSecretKey()
const signerAddress = keypair.getPublicKey().toSuiAddress()
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
{
  const status = signerAdapterStatus({ EXECUTION_ENABLED: 'true' }, { client })
  assert.equal(status.kind, SIGNER_KIND_WORKER_SECRET)
  assert.equal(status.available, false)
  assert.equal(status.execution_configured, true)
  assert.equal(status.execution_enabled, false)
  assert.equal(status.unavailable_code, 'EXECUTION_DISABLED')
  assert.equal(status.address, null)
  assert.equal(status.expected_address, DEPLOYMENT.agent.address)
  assert.equal(status.signer_matches_expected, false)
  assert.equal(status.known_signer_kinds.includes(SIGNER_KIND_WAAP), true)
}

const invalidSecret = resolveSignerAdapter({ EXECUTION_ENABLED: 'true', AGENT_KEY: 'not-a-sui-private-key' }, { client })
assert.equal(invalidSecret.available, false)
assert.equal(invalidSecret.unavailable_code, 'INVALID_SIGNER_SECRET')

const mismatchedWorkerSecret = resolveSignerAdapter({ EXECUTION_ENABLED: 'true', AGENT_KEY: secret }, { client })
assert.equal(mismatchedWorkerSecret.kind, SIGNER_KIND_WORKER_SECRET)
assert.equal(mismatchedWorkerSecret.available, false)
assert.equal(mismatchedWorkerSecret.address, signerAddress)
assert.equal(mismatchedWorkerSecret.expected_address, DEPLOYMENT.agent.address)
assert.equal(mismatchedWorkerSecret.signer_matches_expected, false)
assert.equal(mismatchedWorkerSecret.unavailable_code, SIGNER_CODE_ADDRESS_MISMATCH)
assert.equal(signerExecutionEnabled({ EXECUTION_ENABLED: 'true' }, mismatchedWorkerSecret), false)
await assert.rejects(() => mismatchedWorkerSecret.signAndSubmit(transaction), /does not match/)

const workerSecret = resolveSignerAdapter(
  { EXECUTION_ENABLED: 'true', AGENT_KEY: secret },
  { client, expectedAgentAddress: signerAddress },
)
assert.equal(workerSecret.kind, SIGNER_KIND_WORKER_SECRET)
assert.equal(workerSecret.available, true)
assert.equal(workerSecret.address, signerAddress)
assert.equal(workerSecret.expected_address, signerAddress)
assert.equal(workerSecret.signer_matches_expected, true)
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
assert.equal(localDaemonOutsideDaemonMode.address, null)
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

const mismatchedLocalDaemon = resolveSignerAdapter({
  SIGNER_KIND: SIGNER_KIND_LOCAL_DAEMON,
  RESCUEGRID_DAEMON_MODE: 'true',
  EXECUTION_ENABLED: 'true',
  AGENT_KEY: secret,
}, { client })
assert.equal(mismatchedLocalDaemon.available, false)
assert.equal(mismatchedLocalDaemon.unavailable_code, SIGNER_CODE_ADDRESS_MISMATCH)
await assert.rejects(() => mismatchedLocalDaemon.signAndSubmit(transaction), /does not match/)

const localDaemon = resolveSignerAdapter({
  SIGNER_KIND: SIGNER_KIND_LOCAL_DAEMON,
  RESCUEGRID_DAEMON_MODE: 'true',
  EXECUTION_ENABLED: 'true',
  AGENT_KEY: secret,
}, { client, expectedAgentAddress: signerAddress })
assert.equal(localDaemon.kind, SIGNER_KIND_LOCAL_DAEMON)
assert.equal(localDaemon.available, true)
assert.equal(localDaemon.address, signerAddress)
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
assert.equal(waap.address, null)
assert.equal(waap.expected_address, DEPLOYMENT.agent.address)
assert.equal(signerExecutionEnabled({ EXECUTION_ENABLED: 'true' }, waap), false)
{
  const status = signerAdapterStatus({ SIGNER_KIND: SIGNER_KIND_WAAP, EXECUTION_ENABLED: 'true' }, { client })
  assert.equal(status.kind, SIGNER_KIND_WAAP)
  assert.equal(status.available, false)
  assert.equal(status.execution_enabled, false)
  assert.equal(status.unavailable_code, 'UNSUPPORTED_SIGNER')
}
await assert.rejects(() => waap.signAndSubmit(transaction), /not implemented/)

console.log('\nALL SIGNER ADAPTER TESTS PASS')
