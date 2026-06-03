// Obsolete funding probe for the old permissionless DEEP mint assumption.
//
// The current RescueGrid funding path is external BalanceManager funding:
//   npm run funding:request -- --format markdown --out .rescuegrid/funding-request.md
//   npm run funding:proof -- --tx <provider_funding_tx_digest> --json
//
// This probe is kept only for explicit re-validation if Testnet changes. It is
// blocked by default so it cannot spend gas or sign with AGENT_KEY accidentally.
import { Transaction } from '@mysten/sui/transactions'
import { getClient } from '../src/sui-tx.js'
import { loadAgentKeypairFromDevVars } from './agent-key-loader.mjs'

function help() {
  console.log(`Obsolete RescueGrid DEEP faucet probe.

The official funding path is external DBUSDC/DEEP BalanceManager funding:
  npm run funding:request -- --format markdown --out .rescuegrid/funding-request.md
  npm run funding:proof -- --tx <provider_funding_tx_digest> --json

This probe is disabled by default because the current Testnet DEEP mint route is
not a supported RescueGrid funding path. To re-check a changed Testnet package,
set RESCUEGRID_RUN_OBSOLETE_FUNDING_PROBE=true or pass --force-obsolete-probe.
No AGENT_KEY or private key value is printed.`)
}

const args = new Set(process.argv.slice(2))
if (args.has('--help') || args.has('-h')) {
  help()
  process.exit(0)
}

if (process.env.RESCUEGRID_RUN_OBSOLETE_FUNDING_PROBE !== 'true' && !args.has('--force-obsolete-probe')) {
  console.log(JSON.stringify({
    status: 'blocked',
    code: 'OBSOLETE_FUNDING_PROBE',
    detail: 'DEEP permissionless mint is not the official RescueGrid funding path; use funding:request and funding:proof for external BalanceManager funding.',
    commands: [
      'npm run funding:request -- --format markdown --out .rescuegrid/funding-request.md',
      'npm run funding:proof -- --tx <provider_funding_tx_digest> --json',
    ],
  }, null, 2))
  process.exit(1)
}

const DEEP_PKG = '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8'
const kp = loadAgentKeypairFromDevVars()
const owner = kp.getPublicKey().toSuiAddress()
const c = getClient()
const amount = BigInt(process.argv[2] || '10000000') // 10 DEEP (6dp)

const tx = new Transaction()
tx.moveCall({ target: `${DEEP_PKG}::deep::mint`, arguments: [tx.pure.address(owner), tx.pure.u64(amount)] })
try {
  const r = await c.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showBalanceChanges: true, showEffects: true } })
  console.log('status:', r.effects?.status?.status, '| err:', r.effects?.status?.error || 'none')
  console.log('balanceChanges:', JSON.stringify((r.balanceChanges || []).map(b => ({ coin: b.coinType.split('::').pop(), amt: b.amount }))))
} catch (e) {
  console.log('ERR:', String(e.message).slice(0, 200))
}
