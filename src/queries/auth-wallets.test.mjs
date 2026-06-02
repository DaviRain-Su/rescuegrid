import assert from 'node:assert/strict'
import {
  authStatusLine,
  enokiWalletLabel,
  missingWalletMessage,
  splitAuthWallets,
} from './auth-wallets.js'

const slush = { name: 'Slush' }
const suiWallet = { name: 'Sui Wallet' }
const enokiGoogle = { name: 'Enoki Google' }
const enokiGeneric = { name: 'Enoki zkLogin' }
const isEnokiWallet = (wallet) => /^Enoki/.test(wallet?.name || '')

{
  const split = splitAuthWallets([slush, enokiGoogle, suiWallet], isEnokiWallet)
  assert.deepEqual(split.standardWallets.map((w) => w.name), ['Slush', 'Sui Wallet'])
  assert.deepEqual(split.enokiWallets.map((w) => w.name), ['Enoki Google'])
}

assert.equal(enokiWalletLabel(enokiGoogle), 'Continue with Google')
assert.equal(enokiWalletLabel(enokiGeneric), 'Continue with Google')
assert.equal(enokiWalletLabel({ name: 'Custom OAuth' }), 'Continue with Custom OAuth')

assert.equal(
  authStatusLine({ standardWallets: [slush], enokiWallets: [enokiGoogle] }),
  '● Sui wallet + Google zkLogin ready · testnet',
)
assert.equal(
  authStatusLine({ standardWallets: [slush], workerConfigured: true }),
  '● Sui wallet ready · testnet - real on-chain sign-in',
)
assert.equal(
  authStatusLine({ enokiWallets: [enokiGoogle] }),
  '● Google zkLogin ready · testnet - no seed phrase',
)
assert.equal(
  authStatusLine({ enokiConfigured: true }),
  '○ Google zkLogin configured - waiting for Enoki wallet provider',
)
assert.equal(
  authStatusLine({ workerConfigured: true }),
  '○ no wallet - choose demo mock data or Worker read-only',
)

assert.equal(missingWalletMessage({ standardWallets: [slush] }), null)
assert.equal(missingWalletMessage({ enokiWallets: [enokiGoogle] }), null)
assert.match(missingWalletMessage({ enokiConfigured: true }), /Enoki wallet provider/)
assert.match(missingWalletMessage({}), /Install Slush/)

console.log('ALL AUTH WALLET TESTS PASS')
