import assert from 'node:assert/strict'
import {
  normalizePolicyEvent,
  policyEventToFeedItem,
  policyEventsToFeedItems,
} from '../src/chain.js'

const WRAPPER = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
const MANDATE = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const NOW = Date.UTC(2026, 5, 2, 14, 0, 0)

function rawEvent(type, parsedJson, tx = 'digest', timestampMs = NOW) {
  return {
    type: `0x1::policy::${type}`,
    id: { txDigest: tx },
    timestampMs: String(timestampMs),
    parsedJson,
  }
}

{
  const event = normalizePolicyEvent(rawEvent('PolicyCreated', {
    wrapper_id: WRAPPER,
    mandate_id: MANDATE,
    budget_ceiling: '500000000',
    max_slippage_bps: 120,
  }, 'create-digest'))
  assert.equal(event.type, 'PolicyCreated')
  assert.equal(event.tx, 'create-digest')
  assert.equal(event.timestamp_ms, NOW)

  const feed = policyEventToFeedItem(event)
  assert.equal(feed.source, 'chain')
  assert.equal(feed.kind, 'policy')
  assert.equal(feed.policy, '0x1234…cdef')
  assert.equal(feed.title, 'Policy authority created')
  assert.equal(feed.detail, 'Budget 500 USDC · max slip 1.2%')
  assert.equal(feed.tx, 'create-digest')
  assert.equal(feed.wrapper_id, WRAPPER)
  assert.equal(feed.mandate_id, MANDATE)
}

{
  const event = normalizePolicyEvent(rawEvent('AgentTradeExecuted', {
    wrapper_id: WRAPPER,
    mandate_id: MANDATE,
    base_amount_received: '24000000',
    quote_amount_spent: '100000',
    slippage_bps: 87,
    spent_amount_after: '200000',
    budget_ceiling: '500000000',
  }, 'trade-digest', NOW + 1))
  const feed = policyEventToFeedItem(event)
  assert.equal(feed.kind, 'exec')
  assert.equal(feed.source, 'chain')
  assert.equal(feed.amount, -0.1)
  assert.equal(feed.execution_claimed, true)
  assert.equal(feed.tx, 'trade-digest')
  assert.match(feed.detail, /Spent 0.1 USDC/)
}

{
  const event = normalizePolicyEvent(rawEvent('PolicyRevoked', {
    wrapper_id: WRAPPER,
    mandate_id: MANDATE,
  }, 'revoke-digest', NOW + 2))
  const feed = policyEventToFeedItem(event, 'custom-policy')
  assert.equal(feed.kind, 'guardian')
  assert.equal(feed.policy, 'custom-policy')
  assert.equal(feed.title, 'Policy revoked by owner')
  assert.equal(feed.amount, 0)
}

{
  const known = normalizePolicyEvent(rawEvent('PolicyCreated', {
    wrapper_id: WRAPPER,
    mandate_id: MANDATE,
    budget_ceiling: '1',
    max_slippage_bps: 1,
  }))
  const unknown = normalizePolicyEvent(rawEvent('UnknownEvent', { wrapper_id: WRAPPER }))
  const items = policyEventsToFeedItems([known, unknown])
  assert.equal(items.length, 1)
  assert.equal(items[0].chain_event, 'PolicyCreated')
}

console.log('\nALL POLICY EVENT FEED TESTS PASS')
