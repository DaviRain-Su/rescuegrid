import assert from 'node:assert/strict'
import { countActivePoliciesByDeployment, isActivePolicySnapshot } from '../src/chain.js'

const NOW = Date.UTC(2026, 5, 2, 12, 0, 0)

function moveObject(fields) {
  return {
    data: {
      content: {
        dataType: 'moveObject',
        fields,
      },
    },
  }
}

function createdEvent(wrapperId) {
  return {
    type: '0x1::policy::PolicyCreated',
    parsedJson: { wrapper_id: wrapperId },
  }
}

function fakeClient({ wrappers, mandates, events }) {
  return {
    async queryEvents() {
      return {
        data: events,
        hasNextPage: false,
        nextCursor: null,
      }
    },
    async getObject({ id }) {
      if (wrappers[id]) return moveObject(wrappers[id])
      if (mandates[id]) return moveObject(mandates[id])
      return { data: null }
    },
  }
}

function activeFixture(n) {
  const wrappers = {}
  const mandates = {}
  const events = []
  for (let i = 0; i < n; i += 1) {
    const wrapperId = `0xwrap${i}`
    const mandateId = `0xmandate${i}`
    events.push(createdEvent(wrapperId))
    wrappers[wrapperId] = {
      mandate_id: mandateId,
      owner: `0xowner${i}`,
      agent: `0xagent${i}`,
      pool_id: '0xpool',
      budget_coin_type: 'coin',
      budget_ceiling: '1',
      spent_amount: '0',
      max_slippage_bps: 100,
      strategy_hash: [],
    }
    mandates[mandateId] = {
      owner: `0xowner${i}`,
      agent: `0xagent${i}`,
      revoked: false,
      expires_at_ms: String(NOW + 1_000),
    }
  }
  return { wrappers, mandates, events }
}

{
  assert.equal(isActivePolicySnapshot({ mandate: null, nowMs: NOW }), false)
  assert.equal(isActivePolicySnapshot({ mandate: { revoked: true, expires_at_ms: String(NOW + 1) }, nowMs: NOW }), false)
  assert.equal(isActivePolicySnapshot({ mandate: { revoked: false, expires_at_ms: String(NOW) }, nowMs: NOW }), false)
  assert.equal(isActivePolicySnapshot({ mandate: { revoked: false, expires_at_ms: String(NOW + 1) }, nowMs: NOW }), true)
}

{
  const fixtures = activeFixture(10)
  const result = await countActivePoliciesByDeployment({
    client: fakeClient(fixtures),
    limit: 10,
    nowMs: NOW,
  })
  assert.equal(result.active, 10)
  assert.equal(result.limit, 10)
  assert.equal(result.limit_reached, true)
  assert.equal(result.scanned, 10)
  assert.equal(result.pages_scanned, 1)
}

{
  const fixtures = activeFixture(2)
  fixtures.events.push(createdEvent('0xwrap0')) // duplicate PolicyCreated evidence must not double count.
  fixtures.events.push(createdEvent('0xrevoked'))
  fixtures.events.push(createdEvent('0xexpired'))
  fixtures.events.push(createdEvent('0xmissing'))
  fixtures.wrappers['0xrevoked'] = { ...fixtures.wrappers['0xwrap0'], mandate_id: '0xrevokedMandate' }
  fixtures.mandates['0xrevokedMandate'] = { owner: '0xowner', agent: '0xagent', revoked: true, expires_at_ms: String(NOW + 1_000) }
  fixtures.wrappers['0xexpired'] = { ...fixtures.wrappers['0xwrap0'], mandate_id: '0xexpiredMandate' }
  fixtures.mandates['0xexpiredMandate'] = { owner: '0xowner', agent: '0xagent', revoked: false, expires_at_ms: String(NOW) }

  const result = await countActivePoliciesByDeployment({
    client: fakeClient(fixtures),
    limit: 10,
    nowMs: NOW,
  })
  assert.equal(result.active, 2)
  assert.equal(result.limit_reached, false)
  assert.equal(result.scanned, 5)
}

console.log('\nALL ACTIVE POLICY LIMIT TESTS PASS')
