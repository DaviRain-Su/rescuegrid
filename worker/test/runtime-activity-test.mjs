import assert from 'node:assert/strict'
import {
  MAX_RUNTIME_ACTIVITY,
  appendRuntimeActivity,
  mergeActivityItems,
  runtimeErrorEvent,
  runtimeEventDedupeKey,
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
    funding: {
      blockers: [
        { code: 'INSUFFICIENT_DBUSDC', label: 'BalanceManager DBUSDC below required threshold', asset: 'DBUSDC', observed: '0', required: '100000' },
      ],
      execution_blockers: [
        { code: 'EXECUTION_DISABLED', label: 'Execution disabled', observed: 'false', required: 'true' },
        { code: 'INSUFFICIENT_DBUSDC', label: 'BalanceManager DBUSDC below required threshold', asset: 'DBUSDC', observed: '0', required: '100000' },
      ],
      criteria: [
        { asset: 'DBUSDC', holder: '0xbm', observed_balance: '0', threshold: '100000', blocker_code: 'INSUFFICIENT_DBUSDC', usable: false },
      ],
    },
    execution_claimed: false,
  }, { wrapperId: WRAPPER, nowMs: NOW + 1 })
  const feed = runtimeEventToFeedItem(event)
  assert.equal(feed.kind, 'guardian')
  assert.deepEqual(feed.blocker_codes, ['INSUFFICIENT_DBUSDC', 'INSUFFICIENT_DEEP'])
  assert.equal(feed.blockers[0].observed, '0')
  assert.equal(feed.blockers[0].required, '100000')
  assert.equal(feed.execution_blockers[0].code, 'EXECUTION_DISABLED')
  assert.equal(feed.execution_blockers[0].observed, 'false')
  assert.equal(feed.execution_blockers[0].required, 'true')
  assert.equal(feed.funding_criteria[0].code, 'INSUFFICIENT_DBUSDC')
  assert.equal(feed.funding_criteria[0].asset, 'DBUSDC')
  assert.equal(feed.funding_criteria[0].observed, '0')
  assert.equal(feed.funding_criteria[0].required, '100000')
  assert.equal(feed.execution_claimed, false)
}

{
  const event = runtimeEventFromTickResult({
    action: 'blocked',
    code: 'WAAP_APPROVAL_PENDING',
    blocker_codes: ['WAAP_APPROVAL_PENDING'],
    blocker_labels: ['WaaP approval pending'],
    detail: 'Execution blocked by waap: waap signer is waiting for owner approval',
    signer_kind: 'waap',
    approval_state: 'pending',
    execution_claimed: false,
    execution_success_evidence: false,
  }, { wrapperId: WRAPPER, nowMs: NOW + 4 })
  const feed = runtimeEventToFeedItem(event)
  assert.equal(event.signer_kind, 'waap')
  assert.equal(event.approval_state, 'pending')
  assert.equal(feed.signer_kind, 'waap')
  assert.equal(feed.approval_state, 'pending')
  assert.deepEqual(feed.blocker_codes, ['WAAP_APPROVAL_PENDING'])
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
  const first = runtimeEventFromTickResult({
    action: 'executed',
    tx_digest: 'same-digest',
    spend_delta: '100000',
    execution_claimed: true,
    execution_success_evidence: true,
  }, { wrapperId: WRAPPER, nowMs: NOW + 10 })
  const duplicate = runtimeEventFromTickResult({
    action: 'executed',
    tx_digest: 'same-digest',
    spend_delta: '100000',
    execution_claimed: true,
    execution_success_evidence: true,
  }, { wrapperId: WRAPPER, nowMs: NOW + 11 })
  let events = appendRuntimeActivity([], first)
  events = appendRuntimeActivity(events, duplicate)
  assert.equal(events.length, 1)
  assert.equal(events[0].tx_digest, 'same-digest')
  assert.equal(runtimeEventDedupeKey(events[0]), 'tx:same-digest')
}

{
  const unresolved = runtimeEventFromTickResult({
    action: 'error',
    code: 'UNRESOLVED_TRANSACTION',
    tx_digest: 'eventually-success',
    execution_claimed: false,
    execution_success_evidence: false,
  }, { wrapperId: WRAPPER, nowMs: NOW + 12 })
  const resolved = runtimeEventFromTickResult({
    action: 'executed',
    tx_digest: 'eventually-success',
    spend_delta: '100000',
    execution_claimed: true,
    execution_success_evidence: true,
  }, { wrapperId: WRAPPER, nowMs: NOW + 13 })
  let events = appendRuntimeActivity([], unresolved)
  events = appendRuntimeActivity(events, resolved)
  assert.equal(events.length, 1)
  assert.equal(events[0].action, 'executed')
  assert.equal(events[0].execution_success_evidence, true)
}

{
  const runtime = runtimeEventToFeedItem(runtimeEventFromTickResult({
    action: 'executed',
    tx_digest: 'chain-wins',
    spend_delta: '100000',
    execution_claimed: true,
    execution_success_evidence: true,
  }, { wrapperId: WRAPPER, nowMs: NOW + 14 }))
  const chain = {
    source: 'chain',
    kind: 'exec',
    title: 'AgentTradeExecuted',
    tx: 'chain-wins',
    tx_digest: 'chain-wins',
    timestamp_ms: NOW + 15,
    execution_claimed: true,
  }
  const merged = mergeActivityItems([runtime], [chain])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].source, 'chain')
  assert.equal(merged[0].tx, 'chain-wins')
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
