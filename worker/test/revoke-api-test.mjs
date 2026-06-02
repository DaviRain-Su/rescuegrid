import assert from 'node:assert/strict'
import { revokePolicyPreflight } from '../src/policy-api.js'

const WRAPPER = {
  wrapper_id: '0x1111111111111111111111111111111111111111111111111111111111111111',
  mandate_id: '0x2222222222222222222222222222222222222222222222222222222222222222',
  owner: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
}
const ACTIVE_MANDATE = {
  id: WRAPPER.mandate_id,
  owner: WRAPPER.owner,
  revoked: false,
  expires_at_ms: '9999999999999',
}
const REVOKED_MANDATE = { ...ACTIVE_MANDATE, revoked: true }

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

console.log('\nALL REVOKE API TESTS PASS')
