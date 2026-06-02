import assert from 'node:assert/strict'
import {
  apiFailure,
  createPolicyWithWallet,
  policyCreatedWrapperId,
  revokePolicyWithWallet,
} from './wallet-flow.js'

const owner = '0x1111111111111111111111111111111111111111111111111111111111111111'
const strategy = { owner, agent: '0xagent', executor_kind: 'deepbook' }
const meta = { name: 'SUI Crash Rescue Grid', budget: 500 }

assert.equal(apiFailure('Build failed', { code: 'HASH_MISMATCH' }).message, 'Build failed: HASH_MISMATCH')
assert.equal(policyCreatedWrapperId({ events: [{ type: '0x1::policy::Other', parsedJson: {} }] }), null)

{
  const calls = []
  const result = await createPolicyWithWallet({
    owner,
    text: '',
    meta,
    parseIntent: async (actualOwner, text) => {
      calls.push(['parse', actualOwner, text])
      return { status: 'ok', strategy, strategy_hash: 'hash-1' }
    },
    buildPolicyTx: async (actualOwner, actualStrategy, hash) => {
      calls.push(['build', actualOwner, actualStrategy, hash])
      return { status: 'ok', tx_json: '{"kind":"create"}' }
    },
    signAndExec: async ({ transaction }) => {
      calls.push(['sign', transaction])
      return { digest: 'tx-create' }
    },
    suiClient: {
      async waitForTransaction(args) {
        calls.push(['wait', args])
        return {
          events: [
            {
              type: '0x92::policy::PolicyCreated',
              parsedJson: { wrapper_id: '0xwrapper' },
            },
          ],
        }
      },
    },
    activatePolicy: async (wrapperId, actualStrategy) => {
      calls.push(['activate', wrapperId, actualStrategy])
      return { status: 'ok', wrapper_id: wrapperId, runtime_state: 'Monitoring' }
    },
    txFrom: (txJson) => ({ txJson }),
    sleep: async () => {},
  })
  assert.equal(result.wrapperId, '0xwrapper')
  assert.equal(result.digest, 'tx-create')
  assert.equal(result.strategyHash, 'hash-1')
  assert.equal(calls[0][0], 'parse')
  assert.match(calls[0][2], /500 USDC rescue grid/)
  assert.deepEqual(calls[1], ['build', owner, strategy, 'hash-1'])
  assert.deepEqual(calls[2], ['sign', { txJson: '{"kind":"create"}' }])
  assert.deepEqual(calls[3][1], {
    digest: 'tx-create',
    options: { showObjectChanges: true, showEvents: true },
  })
  assert.deepEqual(calls[4], ['activate', '0xwrapper', strategy])
}

{
  let activationAttempts = 0
  const result = await createPolicyWithWallet({
    owner,
    text: 'custom rescue intent',
    meta,
    parseIntent: async () => ({ status: 'ok', strategy, strategy_hash: 'hash-2' }),
    buildPolicyTx: async () => ({ status: 'ok', tx_json: '{"kind":"create"}' }),
    signAndExec: async () => ({ digest: 'tx-create-retry' }),
    suiClient: {
      async waitForTransaction() {
        return { events: [{ type: '0x92::policy::PolicyCreated', parsedJson: { wrapper_id: '0xretry' } }] }
      },
    },
    activatePolicy: async () => {
      activationAttempts += 1
      return activationAttempts === 1
        ? { status: 'error', code: 'CHAIN_READ_FAILED' }
        : { status: 'ok', wrapper_id: '0xretry' }
    },
    txFrom: (txJson) => txJson,
    sleep: async () => {},
  })
  assert.equal(result.wrapperId, '0xretry')
  assert.equal(activationAttempts, 2)
}

{
  await assert.rejects(
    () => createPolicyWithWallet({
      owner,
      meta,
      parseIntent: async () => ({ status: 'error', code: 'UNSUPPORTED_STRATEGY' }),
    }),
    /Parse failed: UNSUPPORTED_STRATEGY/,
  )
}

{
  let signed = false
  await assert.rejects(
    () => createPolicyWithWallet({
      owner,
      meta,
      parseIntent: async () => ({ status: 'ok', strategy, strategy_hash: 'hash-3' }),
      buildPolicyTx: async () => ({ status: 'error', code: 'ACTIVE_POLICY_LIMIT_REACHED' }),
      signAndExec: async () => { signed = true },
    }),
    /Build failed: ACTIVE_POLICY_LIMIT_REACHED/,
  )
  assert.equal(signed, false)
}

{
  await assert.rejects(
    () => createPolicyWithWallet({
      owner,
      meta,
      parseIntent: async () => ({ status: 'ok', strategy, strategy_hash: 'hash-4' }),
      buildPolicyTx: async () => ({ status: 'ok', tx_json: '{}' }),
      signAndExec: async () => ({}),
      txFrom: (txJson) => txJson,
    }),
    /transaction digest/,
  )
}

{
  let activated = false
  await assert.rejects(
    () => createPolicyWithWallet({
      owner,
      meta,
      parseIntent: async () => ({ status: 'ok', strategy, strategy_hash: 'hash-5' }),
      buildPolicyTx: async () => ({ status: 'ok', tx_json: '{}' }),
      signAndExec: async () => ({ digest: 'tx-no-event' }),
      suiClient: { async waitForTransaction() { return { events: [] } } },
      activatePolicy: async () => { activated = true },
      txFrom: (txJson) => txJson,
    }),
    /PolicyCreated event missing/,
  )
  assert.equal(activated, false)
}

{
  const calls = []
  const result = await revokePolicyWithWallet({
    owner,
    wrapperId: '0xwrapper',
    buildRevokeTx: async (actualOwner, wrapperId) => {
      calls.push(['build-revoke', actualOwner, wrapperId])
      return { status: 'ok', tx_json: '{"kind":"revoke"}', wrapper_id: wrapperId, mandate_id: '0xmandate' }
    },
    signAndExec: async ({ transaction }) => {
      calls.push(['sign-revoke', transaction])
      return { digest: 'tx-revoke' }
    },
    txFrom: (txJson) => ({ txJson }),
  })
  assert.deepEqual(result, { wrapperId: '0xwrapper', mandateId: '0xmandate', digest: 'tx-revoke' })
  assert.deepEqual(calls, [
    ['build-revoke', owner, '0xwrapper'],
    ['sign-revoke', { txJson: '{"kind":"revoke"}' }],
  ])
}

{
  let signed = false
  await assert.rejects(
    () => revokePolicyWithWallet({
      owner,
      wrapperId: '0xrevoked',
      buildRevokeTx: async () => ({ status: 'error', code: 'ALREADY_REVOKED' }),
      signAndExec: async () => { signed = true },
    }),
    /Revoke build failed: ALREADY_REVOKED/,
  )
  assert.equal(signed, false)
}

console.log('ALL WALLET FLOW TESTS PASS')
