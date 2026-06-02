export function splitAuthWallets(wallets = [], isEnokiWallet = () => false) {
  const standardWallets = []
  const enokiWallets = []
  for (const wallet of wallets || []) {
    if (isEnokiWallet(wallet)) enokiWallets.push(wallet)
    else standardWallets.push(wallet)
  }
  return { standardWallets, enokiWallets }
}

export function enokiWalletLabel(wallet, providerLabel = 'Google') {
  const name = wallet?.name || providerLabel || 'zkLogin'
  const escapedProvider = String(providerLabel || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (escapedProvider && new RegExp(escapedProvider, 'i').test(name)) return `Continue with ${providerLabel}`
  if (/google/i.test(name)) return 'Continue with Google'
  if (/enoki|zklogin/i.test(name) && providerLabel) return `Continue with ${providerLabel}`
  return `Continue with ${name}`
}

export function authStatusLine({
  standardWallets = [],
  enokiWallets = [],
  workerConfigured = false,
  enokiConfigured = false,
} = {}) {
  const hasStandard = standardWallets.length > 0
  const hasEnoki = enokiWallets.length > 0
  if (hasStandard && hasEnoki) return '● Sui wallet + Google zkLogin ready · testnet'
  if (hasStandard) return '● Sui wallet ready · testnet - real on-chain sign-in'
  if (hasEnoki) return '● Google zkLogin ready · testnet - no seed phrase'
  if (enokiConfigured) return '○ Google zkLogin configured - waiting for Enoki wallet provider'
  if (workerConfigured) return '○ no wallet - choose demo mock data or Worker read-only'
  return '○ no wallet - demo runs on mock data'
}

export function missingWalletMessage({ standardWallets = [], enokiWallets = [], enokiConfigured = false } = {}) {
  if (standardWallets.length > 0) return null
  if (enokiWallets.length > 0) return null
  if (enokiConfigured) return 'Google zkLogin is configured, but the Enoki wallet provider is still loading. Reload if it does not appear.'
  return 'No Sui wallet detected. Install Slush, switch it to Testnet, then reload.'
}
