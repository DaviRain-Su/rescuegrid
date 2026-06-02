export function sessionCapabilities({ sessionMode = 'signed-out', workerConfigured = false, account = null } = {}) {
  const liveMode = sessionMode === 'wallet' && Boolean(account)
  const readOnlyLiveMode = sessionMode === 'readonly' && Boolean(workerConfigured)
  const liveReadsEnabled = liveMode || readOnlyLiveMode
  const demoMode = sessionMode === 'demo'
  return {
    liveMode,
    readOnlyLiveMode,
    liveReadsEnabled,
    demoMode,
    demoControlsEnabled: demoMode,
    walletWritesEnabled: liveMode,
  }
}
