// One-time on-chain setup for the dedicated agent (signed by AGENT_KEY):
//   1. register the agent's MoveGate passport
//   2. create/share a BalanceManager through the old self-funding probe
// Prints the new passport id + balance_manager id to wire into deployment.
//
// This script is obsolete for the current deployment. The agent passport and
// BalanceManager are already deployed, and DBUSDC/DEEP execution funding must
// come through the external funding handoff/proof path. It is blocked by default
// so it cannot sign or mutate Testnet state accidentally.
import { Transaction } from '@mysten/sui/transactions'
import { getClient, DEPLOYMENT } from '../src/sui-tx.js'
import { buildAgentSetupTx } from '../src/deepbook.js'
import { loadAgentKeypairFromDevVars } from './agent-key-loader.mjs'

function help() {
  console.log(`Obsolete RescueGrid agent on-chain setup probe.

The current Testnet deployment already has a registered agent passport and
BalanceManager in deployment.testnet.json. DBUSDC/DEEP execution funding must
use the external funding handoff/proof path:
  npm run funding:request -- --format markdown --out .rescuegrid/funding-request.md
  npm run funding:proof -- --tx <provider_funding_tx_digest> --json

This script is disabled by default. To re-run the historical setup probe against
a changed deployment, set RESCUEGRID_RUN_OBSOLETE_AGENT_SETUP=true or pass
--force-obsolete-setup. No AGENT_KEY or private key value is printed.`)
}

const args = new Set(process.argv.slice(2))
if (args.has('--help') || args.has('-h')) {
  help()
  process.exit(0)
}

if (process.env.RESCUEGRID_RUN_OBSOLETE_AGENT_SETUP !== 'true' && !args.has('--force-obsolete-setup')) {
  console.log(JSON.stringify({
    status: 'blocked',
    code: 'OBSOLETE_AGENT_SETUP_PROBE',
    detail: 'The deployed agent passport and BalanceManager already exist; use funding:request and funding:proof for external DBUSDC/DEEP BalanceManager funding.',
    commands: [
      'npm run funding:request -- --format markdown --out .rescuegrid/funding-request.md',
      'npm run funding:proof -- --tx <provider_funding_tx_digest> --json',
    ],
  }, null, 2))
  process.exit(1)
}

const kp = loadAgentKeypairFromDevVars()
const agent = kp.getPublicKey().toSuiAddress()
const client = getClient()
const MG = DEPLOYMENT.movegate
console.log('agent:', agent)

async function exec(tx, label) {
  const res = await client.signAndExecuteTransaction({
    signer: kp, transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  })
  const status = res.effects?.status?.status
  console.log(`${label}: ${status} (${res.digest})`)
  if (status !== 'success') { console.log(JSON.stringify(res.effects?.status)); process.exit(1) }
  return res
}

// 1. register passport (idempotent-ish: skip if already has one)
const has = await client.devInspectTransactionBlock // noop ref
let passportId = null
{
  const tx = new Transaction()
  tx.moveCall({ target: `${MG.published_at}::passport::register_agent`, arguments: [tx.object(MG.agent_registry), tx.object('0x6')] })
  const res = await exec(tx, 'register_agent')
  passportId = (res.objectChanges || []).find((o) => o.objectType?.endsWith('::passport::AgentPassport'))?.objectId
}

// 2. mint + BalanceManager + deposit + share
let bmId = null
{
  const tx = buildAgentSetupTx({ suiInMist: 300_000_000n, agentAddress: agent }) // swap 0.3 SUI -> DBUSDC
  const res = await exec(tx, 'agent_setup(swap+BM+deposit+share)')
  bmId = (res.objectChanges || []).find((o) => o.objectType?.endsWith('::balance_manager::BalanceManager'))?.objectId
}

console.log('\n--- wire into deployment ---')
console.log('AGENT_ADDRESS=' + agent)
console.log('AGENT_PASSPORT_ID=' + passportId)
console.log('BALANCE_MANAGER_ID=' + bmId)
