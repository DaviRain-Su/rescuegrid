import assert from 'node:assert/strict'
import { strategyHash } from '../src/strategy-core.js'
import { activationPolicyPreflight, reconcilePolicyListRuntimeState, reconcilePolicyRuntimeState, revokePolicyPreflight } from '../src/policy-api.js'

const NOW = Date.UTC(2026, 5, 2, 12, 0, 0)
const STRATEGY = {
  version: '1',
  strategy_type: 'risk_response',
  owner: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  agent: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  chain: 'sui:testnet',
  executor_kind: 'deepbook',
  pool_id: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  budget_coin_type: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee::usdc::USDC',
  budget_ceiling: '500000000',
  trigger: { metric: 'price_drop_pct', asset: 'SUI', threshold_pct: '8' },
  execution: { order_type: 'market_or_ioc', max_slippage_bps: 100, max_single_trade_amount: '100000000' },
  expires_at_ms: NOW + 86_400_000,
}
const WRAPPER = {
  wrapper_id: '0x1111111111111111111111111111111111111111111111111111111111111111',
  mandate_id: '0x2222222222222222222222222222222222222222222222222222222222222222',
  owner: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  strategy_hash: strategyHash(STRATEGY),
}
const ACTIVE_MANDATE = {
  id: WRAPPER.mandate_id,
  owner: WRAPPER.owner,
  revoked: false,
  expires_at_ms: String(NOW + 1_000),
}
const REVOKED_MANDATE = { ...ACTIVE_MANDATE, revoked: true }
const EXPIRED_MANDATE = { ...ACTIVE_MANDATE, expires_at_ms: String(NOW) }

{
  const result = revokePolicyPreflight({ wrapper: null, mandate: null, owner: WRAPPER.owner })
  assert.equal(result.ok, false)
  assert.equal(result.status, 404)
  assert.equal(result.body.code, 'NOT_FOUND')
}

{
  const result = revokePolicyPreflight({ wrapper: WRAPPER, mandate: ACTIVE_MANDATE, owner: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' })
  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  assert.equal(result.body.code, 'OWNER_MISMATCH')
}

{
  const result = revokePolicyPreflight({ wrapper: WRAPPER, mandate: null, owner: WRAPPER.owner })
  assert.equal(result.ok, false)
  assert.equal(result.status, 404)
  assert.equal(result.body.code, 'MANDATE_NOT_FOUND')
}

{
  const result = revokePolicyPreflight({ wrapper: WRAPPER, mandate: REVOKED_MANDATE, owner: WRAPPER.owner })
  assert.equal(result.ok, false)
  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'ALREADY_REVOKED')
  assert.equal(result.body.wrapper_id, WRAPPER.wrapper_id)
  assert.equal(result.body.mandate_id, WRAPPER.mandate_id)
  assert.equal(result.body.runtime_state, 'Revoked')
}

{
  const result = revokePolicyPreflight({ wrapper: WRAPPER, mandate: ACTIVE_MANDATE, owner: WRAPPER.owner })
  assert.equal(result.ok, true)
  assert.equal(result.status, 200)
}

{
  const result = activationPolicyPreflight({ wrapper: null, mandate: null, strategy: STRATEGY, nowMs: NOW })
  assert.equal(result.ok, false)
  assert.equal(result.status, 404)
  assert.equal(result.body.code, 'NOT_FOUND')
}

{
  const result = activationPolicyPreflight({ wrapper: WRAPPER, mandate: null, strategy: STRATEGY, nowMs: NOW })
  assert.equal(result.ok, false)
  assert.equal(result.status, 404)
  assert.equal(result.body.code, 'MANDATE_NOT_FOUND')
}

{
  const result = activationPolicyPreflight({ wrapper: WRAPPER, mandate: REVOKED_MANDATE, strategy: STRATEGY, nowMs: NOW })
  assert.equal(result.ok, false)
  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'POLICY_REVOKED')
  assert.equal(result.body.runtime_state, 'Revoked')
}

{
  const result = activationPolicyPreflight({ wrapper: WRAPPER, mandate: EXPIRED_MANDATE, strategy: STRATEGY, nowMs: NOW })
  assert.equal(result.ok, false)
  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'POLICY_EXPIRED')
  assert.equal(result.body.runtime_state, 'Expired')
}

{
  const result = activationPolicyPreflight({
    wrapper: WRAPPER,
    mandate: ACTIVE_MANDATE,
    strategy: { ...STRATEGY, trigger: { ...STRATEGY.trigger, threshold_pct: '10' } },
    nowMs: NOW,
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 422)
  assert.equal(result.body.code, 'HASH_MISMATCH')
  assert.equal(result.body.expected_strategy_hash, WRAPPER.strategy_hash)
}

{
  const result = activationPolicyPreflight({ wrapper: WRAPPER, mandate: ACTIVE_MANDATE, strategy: STRATEGY, nowMs: NOW })
  assert.equal(result.ok, true)
  assert.equal(result.status, 200)
}

{
  const result = activationPolicyPreflight({ wrapper: WRAPPER, mandate: ACTIVE_MANDATE, strategy: null, nowMs: NOW })
  assert.equal(result.ok, true, 'strategy-less activation is allowed but only after wrapper/mandate liveness checks')
}

{
  const policy = { wrapper_id: WRAPPER.wrapper_id, runtime_state: 'Monitoring', runtime_state_stale: false }
  const reconciled = reconcilePolicyRuntimeState(policy, { runtime_state: 'Revoked' })
  assert.equal(reconciled.runtime_state, 'Monitoring', 'chain-active state wins over stale terminal runtime state')
  assert.equal(reconciled.runtime_state_stale, true)
}

{
  const policy = { wrapper_id: WRAPPER.wrapper_id, runtime_state: 'Revoked', runtime_state_stale: false }
  const reconciled = reconcilePolicyRuntimeState(policy, { runtime_state: 'Monitoring' })
  assert.equal(reconciled.runtime_state, 'Revoked', 'chain-revoked state wins over stale runtime monitoring state')
  assert.equal(reconciled.runtime_state_stale, true)
}

{
  const policy = { wrapper_id: WRAPPER.wrapper_id, runtime_state: 'Expired', runtime_state_stale: false }
  const reconciled = reconcilePolicyRuntimeState(policy, { runtime_state: 'Revoked' })
  assert.equal(reconciled.runtime_state, 'Expired', 'chain-expired state wins over wrong terminal runtime state')
  assert.equal(reconciled.runtime_state_stale, true)
}

{
  const policy = { wrapper_id: WRAPPER.wrapper_id, runtime_state: 'Monitoring', runtime_state_stale: false }
  const reconciled = reconcilePolicyRuntimeState(policy, { runtime_state: 'Monitoring' })
  assert.equal(reconciled.runtime_state, 'Monitoring')
  assert.equal(reconciled.runtime_state_stale, false)
}

{
  const policy = { wrapper_id: WRAPPER.wrapper_id, runtime_state: 'Monitoring', runtime_state_stale: true }
  const reconciled = reconcilePolicyRuntimeState(policy, { runtime_state: 'Inactive' })
  assert.equal(reconciled.runtime_state, 'Monitoring')
  assert.equal(reconciled.runtime_state_stale, false)
}

{
  const active = { wrapper_id: WRAPPER.wrapper_id, runtime_state: 'Monitoring', runtime_state_stale: false }
  const revoked = { wrapper_id: '0x3333333333333333333333333333333333333333333333333333333333333333', runtime_state: 'Revoked', runtime_state_stale: false }
  const inactive = { wrapper_id: '0x4444444444444444444444444444444444444444444444444444444444444444', runtime_state: 'Monitoring', runtime_state_stale: true }
  const reconciled = reconcilePolicyListRuntimeState([active, revoked, inactive], {
    [active.wrapper_id]: { runtime_state: 'Revoked' },
    [revoked.wrapper_id]: { runtime_state: 'Monitoring' },
    [inactive.wrapper_id]: { runtime_state: 'Inactive' },
  })
  assert.equal(reconciled[0].runtime_state, 'Monitoring')
  assert.equal(reconciled[0].runtime_state_stale, true)
  assert.equal(reconciled[1].runtime_state, 'Revoked')
  assert.equal(reconciled[1].runtime_state_stale, true)
  assert.equal(reconciled[2].runtime_state, 'Monitoring')
  assert.equal(reconciled[2].runtime_state_stale, false)
}

console.log('\nALL POLICY API TESTS PASS')
