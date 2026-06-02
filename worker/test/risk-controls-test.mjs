import assert from 'node:assert/strict'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import {
  OWNER_CONTROL_ACTION_SET_GLOBAL_STOP,
  OWNER_CONTROL_ACTION_SET_STRATEGY_STOP,
  buildGlobalStopControlMessage,
  buildRiskControlMessage,
  buildStrategyStopControlMessage,
  buildVenueStopControlMessage,
  canonicalVenueName,
  isGlobalStopped,
  isStrategyStopped,
  isVenueStopped,
  normalizeVenueKey,
  parseRiskControlMessage,
  parseVenueStopControlMessage,
  riskControlStorageKey,
  verifyRiskControl,
  verifyVenueStopControl,
} from '../src/risk-controls.js'

const NOW = Date.UTC(2026, 5, 3, 12, 0, 0)
const keypair = new Ed25519Keypair()
const owner = keypair.getPublicKey().toSuiAddress()
const otherOwner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const wrapperId = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
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
  assert.equal(isVenueStopped('DeepBook', [{ owner, venue: 'deepbook' }], owner), true)
  assert.equal(isVenueStopped('DeepBook', [{ owner: otherOwner, venue: 'deepbook' }], owner), false)
  assert.equal(isVenueStopped('Cetus', [{ venue: 'DeepBook' }]), false)
  assert.equal(isGlobalStopped(owner, [{ owner, stopped: true }]), true)
  assert.equal(isGlobalStopped(owner, [{ owner: otherOwner, stopped: true }]), false)
  assert.equal(isStrategyStopped(wrapperId, [{ owner, wrapper_id: wrapperId, stopped: true }], owner), true)
  assert.equal(isStrategyStopped(wrapperId, [{ owner: otherOwner, wrapper_id: wrapperId, stopped: true }], owner), false)
}

{
  const parsed = parseVenueStopControlMessage(message, { nowMs: NOW + 1_000 })
  assert.equal(parsed.owner, owner)
  assert.equal(parsed.action, 'set_venue_stop')
  assert.equal(parsed.scope, 'venue')
  assert.equal(parsed.venue, 'DeepBook')
  assert.equal(parsed.venue_key, 'deepbook')
  assert.equal(parsed.stopped, true)
  assert.equal(riskControlStorageKey(parsed), `${owner}:set_venue_stop:deepbook`)
}

{
  const verified = await verifyVenueStopControl({ owner, message, signature: signed.signature }, { nowMs: NOW + 1_000 })
  assert.equal(verified.ok, true)
  assert.equal(verified.control.owner, owner)
  assert.equal(verified.control.venue, 'DeepBook')
}

{
  const globalMessage = buildGlobalStopControlMessage({
    owner,
    stopped: true,
    nonce: 'nonce-global-123',
    issued_at_ms: NOW,
  })
  const globalSigned = await keypair.signPersonalMessage(new TextEncoder().encode(globalMessage))
  const verified = await verifyRiskControl({ owner, message: globalMessage, signature: globalSigned.signature }, { nowMs: NOW + 1_000 })
  assert.equal(verified.ok, true)
  assert.equal(verified.control.action, OWNER_CONTROL_ACTION_SET_GLOBAL_STOP)
  assert.equal(verified.control.scope, 'global')
  assert.equal(verified.control.target_key, 'global')
}

{
  const strategyMessage = buildStrategyStopControlMessage({
    owner,
    wrapper_id: wrapperId,
    stopped: true,
    nonce: 'nonce-strategy-123',
    issued_at_ms: NOW,
  })
  const parsed = parseRiskControlMessage(strategyMessage, { nowMs: NOW + 1_000 })
  assert.equal(parsed.action, OWNER_CONTROL_ACTION_SET_STRATEGY_STOP)
  assert.equal(parsed.scope, 'strategy')
  assert.equal(parsed.wrapper_id, wrapperId)
  assert.equal(parsed.target_key, wrapperId)
  assert.equal(riskControlStorageKey(parsed), `${owner}:set_strategy_stop:${wrapperId}`)
}

{
  const built = buildRiskControlMessage({
    action: OWNER_CONTROL_ACTION_SET_GLOBAL_STOP,
    owner,
    stopped: false,
    nonce: 'nonce-generic-1',
    issued_at_ms: NOW,
  })
  const parsed = parseRiskControlMessage(built, { nowMs: NOW + 1_000 })
  assert.equal(parsed.action, OWNER_CONTROL_ACTION_SET_GLOBAL_STOP)
  assert.equal(parsed.stopped, false)
}

{
  const verified = await verifyVenueStopControl({
    owner: otherOwner,
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
