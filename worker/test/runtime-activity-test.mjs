import assert from 'node:assert/strict'
import {
  MAX_RUNTIME_ACTIVITY,
  appendRuntimeActivity,
  runtimeErrorEvent,
  runtimeEventFromTickResult,
  runtimeEventToFeedItem,
  shortWrapperId,
  sortActivityItems,
} from '../src/runtime-activity.js'

const WRAPPER = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
const NOW = Date.UTC(2026, 5, 2, 13, 0, 0)

{
  assert.equal(shortWrapperId(WRAPPER), '0x1234…cdef')
  assert.equal(shortWrapperId('0xabc'), '0xabc')
}

{
  const event = runtimeEventFromTickResult({
    action: 'no_op',
    code: 'TRIGGER_NOT_MET',
    detail: 'Trigger condition not met; monitoring.',
    execution_claimed: false,
  }, { wrapperId: WRAPPER, nowMs: NOW })
  assert.equal(event.source, 'runtime')
  assert.equal(event.wrapper_id, WRAPPER)
  assert.equal(event.action, 'no_op')
  assert.equal(event.execution_claimed, false)

  const feed = runtimeEventToFeedItem(event)
  assert.equal(feed.kind, 'monitor')
  assert.equal(feed.policy, '0x1234…cdef')
  assert.equal(feed.title, 'Agent tick · no action')
  assert.equal(feed.amount, 0)
  assert.equal(feed.timestamp_ms, NOW)
}

{
  const event = runtimeEventFromTickResult({
    action: 'blocked',
    code: 'INSUFFICIENT_DBUSDC',
    blocker_codes: ['INSUFFICIENT_DBUSDC', 'INSUFFICIENT_DEEP'],
    blocker_labels: ['Insufficient DBUSDC', 'Insufficient DEEP'],
    execution_claimed: false,
  }, { wrapperId: WRAPPER, nowMs: NOW + 1 })
  const feed = runtimeEventToFeedItem(event)
  assert.equal(feed.kind, 'guardian')
  assert.deepEqual(feed.blocker_codes, ['INSUFFICIENT_DBUSDC', 'INSUFFICIENT_DEEP'])
  assert.equal(feed.execution_claimed, false)
}

{
  const event = runtimeEventFromTickResult({
    action: 'executed',
    tx_digest: 'digest',
    spend_delta: '100000',
    execution_claimed: true,
    execution_success_evidence: true,
  }, { wrapperId: WRAPPER, nowMs: NOW + 2 })
  const feed = runtimeEventToFeedItem(event)
  assert.equal(feed.kind, 'exec')
  assert.equal(feed.tx, 'digest')
  assert.equal(feed.amount, -0.1)
  assert.equal(feed.execution_claimed, true)
}

{
  const event = runtimeErrorEvent(new Error('boom'), { wrapperId: WRAPPER, nowMs: NOW + 3 })
  const feed = runtimeEventToFeedItem(event)
  assert.equal(event.code, 'RUNTIME_ERROR')
  assert.equal(feed.kind, 'fail')
  assert.equal(feed.execution_claimed, false)
}

{
  let events = []
  for (let i = 0; i < MAX_RUNTIME_ACTIVITY + 5; i++) {
    events = appendRuntimeActivity(events, runtimeEventFromTickResult({ action: 'no_op' }, { wrapperId: WRAPPER, nowMs: NOW + i }))
  }
  assert.equal(events.length, MAX_RUNTIME_ACTIVITY)
  assert.equal(events[0].timestamp_ms, NOW + MAX_RUNTIME_ACTIVITY + 4)
}

{
  const sorted = sortActivityItems([
    { timestamp_ms: 1, title: 'old' },
    { timestamp_ms: 3, title: 'new' },
    { timestamp_ms: 2, title: 'mid' },
  ])
  assert.deepEqual(sorted.map((x) => x.title), ['new', 'mid', 'old'])
}

console.log('\nALL RUNTIME ACTIVITY TESTS PASS')
