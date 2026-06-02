import assert from 'node:assert/strict'
import { signerHealthRows, signerKindBadges, signerWarningRows } from './signer-health.js'

const fallback = [
  { name: 'Owner wallet signer', kind: 'wallet', status: 'ok', detail: 'owner only' },
  { name: 'Local daemon', kind: 'local', status: 'offline', detail: 'not running' },
]

const agent = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

assert.equal(signerHealthRows(null, fallback).length, 2)
assert.equal(signerWarningRows(null, fallback).length, 1)

const workerSecret = {
  signer: {
    kind: 'worker-secret',
    address: agent,
    expected_address: agent,
    signer_matches_expected: true,
    available: true,
    execution_enabled: false,
    execution_configured: false,
    known_signer_kinds: ['worker-secret', 'local-daemon', 'waap'],
  },
  execution: {
    enabled: false,
    blocker_code: 'EXECUTION_DISABLED',
  },
  runtime: {
    cloud_worker: true,
    local_daemon_supported: true,
    mainnet_requires_external_signer: true,
  },
}

const workerRows = signerHealthRows(workerSecret, fallback)
assert.deepEqual(signerKindBadges(workerSecret), ['worker-secret', 'local-daemon', 'waap'])
assert.equal(workerRows.find((row) => row.id === 'runtime-signer').status, 'warn')
assert.equal(workerRows.find((row) => row.id === 'external-waap-signer').warning, false)
assert.match(workerRows.find((row) => row.id === 'external-waap-signer').detail, /not selected/)
assert.match(workerRows.find((row) => row.id === 'external-waap-signer').detail, /mainnet requires external signer/)

const waapCloud = {
  signer: {
    kind: 'waap',
    address: null,
    expected_address: agent,
    signer_matches_expected: false,
    available: false,
    execution_enabled: false,
    unavailable_code: 'UNSUPPORTED_SIGNER',
    unavailable_detail: 'waap signer requires a local daemon or external signer service; Cloud Worker runtime cannot shell out to waap-cli.',
    known_signer_kinds: ['worker-secret', 'local-daemon', 'waap'],
  },
  execution: {
    enabled: false,
    blocker_code: 'UNSUPPORTED_SIGNER',
  },
  runtime: {
    cloud_worker: true,
    local_daemon_supported: true,
    mainnet_requires_external_signer: true,
  },
  external_signer: {
    kind: 'waap',
    submission_runner_configured: false,
  },
}

const waapCloudRows = signerHealthRows(waapCloud, fallback)
const waapExternalCloud = waapCloudRows.find((row) => row.id === 'external-waap-signer')
assert.equal(waapExternalCloud.status, 'offline')
assert.equal(waapExternalCloud.warning, true)
assert.match(waapExternalCloud.detail, /Cloud Worker cannot shell out to waap-cli/)
assert.match(waapExternalCloud.detail, /submission runner missing/)
assert.equal(signerWarningRows(waapCloud, fallback).length, 2)

const waapDaemon = {
  signer: {
    kind: 'waap',
    address: agent,
    expected_address: agent,
    signer_matches_expected: true,
    available: true,
    execution_enabled: true,
    known_signer_kinds: ['worker-secret', 'local-daemon', 'waap'],
  },
  execution: {
    enabled: true,
    blocker_code: null,
  },
  runtime: {
    cloud_worker: false,
    local_daemon_supported: true,
    mainnet_requires_external_signer: true,
  },
  external_signer: {
    kind: 'waap',
    permission_token_configured: true,
    submission_runner_configured: true,
  },
}

const waapDaemonRows = signerHealthRows(waapDaemon, fallback)
const waapExternalDaemon = waapDaemonRows.find((row) => row.id === 'external-waap-signer')
assert.equal(waapDaemonRows.find((row) => row.id === 'runtime-signer').status, 'ok')
assert.equal(waapExternalDaemon.status, 'ok')
assert.match(waapExternalDaemon.detail, /permission token configured/)
assert.match(waapExternalDaemon.detail, /submission runner configured/)
assert.doesNotMatch(waapExternalDaemon.detail, /AGENT_KEY|WAAP_PERMISSION_TOKEN|tok_live_[A-Za-z0-9_-]+/i)
assert.equal(signerWarningRows(waapDaemon, fallback).length, 0)

console.log('ALL SIGNER HEALTH TESTS PASS')
