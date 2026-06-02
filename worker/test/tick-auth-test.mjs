import assert from 'node:assert/strict'
import { validateForceTrigger, validateTickAuthorization } from '../src/tick-auth.js'

{
  const missing = validateTickAuthorization({ authorizationHeader: undefined, expectedToken: 'configured-token' })
  assert.equal(missing.ok, false)
  assert.equal(missing.status, 401)
  assert.equal(missing.body.code, 'INVALID_AUTHORIZATION')
  assert.deepEqual(missing.body.blocker_codes, ['INVALID_AUTHORIZATION'])
  assert.equal(missing.body.execution_claimed, false)
}

{
  const invalid = validateTickAuthorization({ authorizationHeader: 'Bearer wrong-token', expectedToken: 'configured-token' })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.status, 401)
  assert.equal(invalid.body.code, 'INVALID_AUTHORIZATION')
}

{
  const unset = validateTickAuthorization({ authorizationHeader: 'Bearer configured-token', expectedToken: undefined })
  assert.equal(unset.ok, false, 'missing configured tick token keeps endpoint closed')
  assert.equal(unset.body.code, 'INVALID_AUTHORIZATION')
}

{
  const valid = validateTickAuthorization({ authorizationHeader: 'Bearer configured-token', expectedToken: 'configured-token' })
  assert.equal(valid.ok, true)
}

{
  const rejected = validateForceTrigger({ forceTriggerRequested: true, demoMode: 'false' })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.status, 403)
  assert.equal(rejected.body.code, 'FORCE_TRIGGER_DISABLED')
  assert.deepEqual(rejected.body.blocker_codes, ['FORCE_TRIGGER_DISABLED'])
  assert.equal(rejected.body.execution_claimed, false)
}

{
  const allowed = validateForceTrigger({ forceTriggerRequested: true, demoMode: 'true' })
  assert.equal(allowed.ok, true)
  assert.equal(allowed.forceTrigger, true)
}

{
  const notRequested = validateForceTrigger({ forceTriggerRequested: false, demoMode: 'false' })
  assert.equal(notRequested.ok, true)
  assert.equal(notRequested.forceTrigger, false)
}

console.log('\nALL TICK AUTH TESTS PASS')
