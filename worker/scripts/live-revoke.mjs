// Broadcast a REAL revoke_policy on testnet (agent-as-owner), proving the
// owner revocation path. Usage: node scripts/live-revoke.mjs <wrapperId> <mandateId>
import { readFileSync } from 'node:fs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { buildRevokeTx, getClient } from '../src/sui-tx.js'

const [, , wrapperId, mandateId] = process.argv
if (!wrapperId || !mandateId) { console.error('usage: live-revoke.mjs <wrapperId> <mandateId>'); process.exit(2) }
const key = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/^AGENT_KEY=(\S+)/m)?.[1]
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(key).secretKey)
const owner = kp.getPublicKey().toSuiAddress()
const client = getClient()

const tx = buildRevokeTx({ wrapperId, mandateId, ownerAddress: owner })
const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showEvents: true, showEffects: true } })
console.log('status:', res.effects?.status?.status, '| digest:', res.digest)
const ev = (res.events || []).find(e => String(e.type).endsWith('::PolicyRevoked'))
console.log('PolicyRevoked emitted:', !!ev)
process.exit(res.effects?.status?.status === 'success' ? 0 : 1)
