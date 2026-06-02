import assert from 'node:assert/strict'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import {
  buildVenueStopControlMessage,
  canonicalVenueName,
  isVenueStopped,
  normalizeVenueKey,
  parseVenueStopControlMessage,
  verifyVenueStopControl,
} from '../src/risk-controls.js'

const NOW = Date.UTC(2026, 5, 3, 12, 0, 0)
const keypair = new Ed25519Keypair()
const owner = keypair.getPublicKey().toSuiAddress()
const message = buildVenueStopControlMessage({
  owner,
  venue: 'deepbook',
  stopped: true,
  nonce: 'nonce-123456',
  issued_at_ms: NOW,
})
const signed = await keypair.signPersonalMessage(new TextEncoder().encode(message))

{
  assert.equal(canonicalVenueName('deepbook'), 'DeepBook')
  assert.equal(canonicalVenueName('Bluefin Pro'), 'Bluefin Pro')
  assert.equal(normalizeVenueKey('Bluefin Pro'), 'bluefin-pro')
  assert.equal(isVenueStopped('DeepBook', ['deepbook']), true)
  assert.equal(isVenueStopped('Cetus', [{ venue: 'DeepBook' }]), false)
}

{
  const parsed = parseVenueStopControlMessage(message, { nowMs: NOW + 1_000 })
  assert.equal(parsed.owner, owner)
  assert.equal(parsed.venue, 'DeepBook')
  assert.equal(parsed.venue_key, 'deepbook')
  assert.equal(parsed.stopped, true)
}

{
  const verified = await verifyVenueStopControl({ owner, message, signature: signed.signature }, { nowMs: NOW + 1_000 })
  assert.equal(verified.ok, true)
  assert.equal(verified.control.owner, owner)
  assert.equal(verified.control.venue, 'DeepBook')
}

{
  const verified = await verifyVenueStopControl({
    owner: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    message,
    signature: signed.signature,
  }, { nowMs: NOW + 1_000 })
  assert.equal(verified.ok, false)
  assert.equal(verified.body.code, 'OWNER_MISMATCH')
}

{
  const verified = await verifyVenueStopControl({ owner, message, signature: signed.signature }, { nowMs: NOW + 20 * 60 * 1000 })
  assert.equal(verified.ok, false)
  assert.equal(verified.body.code, 'CONTROL_EXPIRED')
}

{
  const other = buildVenueStopControlMessage({
    owner,
    venue: 'Cetus',
    stopped: true,
    nonce: 'nonce-abcdef',
    issued_at_ms: NOW,
  })
  const verified = await verifyVenueStopControl({ owner, message: other, signature: signed.signature }, { nowMs: NOW + 1_000 })
  assert.equal(verified.ok, false)
  assert.equal(verified.body.code, 'INVALID_OWNER_CONTROL_SIGNATURE')
}

console.log('\nALL RISK CONTROL TESTS PASS')
