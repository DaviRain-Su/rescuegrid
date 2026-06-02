import assert from 'node:assert/strict'
import { sessionCapabilities } from './session-mode.js'

assert.deepEqual(sessionCapabilities(), {
  liveMode: false,
  readOnlyLiveMode: false,
  liveReadsEnabled: false,
  demoMode: false,
  demoControlsEnabled: false,
  walletWritesEnabled: false,
})

assert.deepEqual(sessionCapabilities({ sessionMode: 'demo' }), {
  liveMode: false,
  readOnlyLiveMode: false,
  liveReadsEnabled: false,
  demoMode: true,
  demoControlsEnabled: true,
  walletWritesEnabled: false,
})

assert.deepEqual(sessionCapabilities({ sessionMode: 'wallet', account: { address: '0xowner' }, workerConfigured: true }), {
  liveMode: true,
  readOnlyLiveMode: false,
  liveReadsEnabled: true,
  demoMode: false,
  demoControlsEnabled: false,
  walletWritesEnabled: true,
})

assert.deepEqual(sessionCapabilities({ sessionMode: 'readonly', workerConfigured: true }), {
  liveMode: false,
  readOnlyLiveMode: true,
  liveReadsEnabled: true,
  demoMode: false,
  demoControlsEnabled: false,
  walletWritesEnabled: false,
})

assert.deepEqual(sessionCapabilities({ sessionMode: 'readonly', workerConfigured: false }), {
  liveMode: false,
  readOnlyLiveMode: false,
  liveReadsEnabled: false,
  demoMode: false,
  demoControlsEnabled: false,
  walletWritesEnabled: false,
})

console.log('session mode tests passed')
