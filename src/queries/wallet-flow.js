import { Transaction } from '@mysten/sui/transactions'

export function apiFailure(label, result) {
  const message = result?.message || result?.code || 'unknown error'
  return new Error(`${label}: ${message}`)
}

function extractDigest(result) {
  return result?.digest || result?.effects?.transactionDigest || result?.transactionDigest || null
}

export function policyCreatedWrapperId(txResult) {
  const event = (txResult?.events || []).find((e) => String(e.type).endsWith('::policy::PolicyCreated'))
  return event?.parsedJson?.wrapper_id || null
}

function defaultStrategyText(meta = {}) {
  return `When SUI drops more than 8%, deploy a ${meta.budget || 500} USDC rescue grid`
}

async function activateWithRetry({
  wrapperId,
  strategy,
  activatePolicy,
  attempts = 3,
  delayMs = 500,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let last = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await activatePolicy(wrapperId, strategy)
    if (last?.status === 'ok') return last
    if (attempt < attempts) await sleep(delayMs)
  }
  throw apiFailure('Activation failed', last)
}

export async function createPolicyWithWallet({
  owner,
  text,
  meta = {},
  parseIntent,
  buildPolicyTx,
  signAndExec,
  suiClient,
  activatePolicy,
  txFrom = Transaction.from,
  activationAttempts,
  activationDelayMs,
  sleep,
}) {
  const parsed = await parseIntent(owner, text || defaultStrategyText(meta))
  if (parsed.status !== 'ok') throw apiFailure('Parse failed', parsed)

  const built = await buildPolicyTx(owner, parsed.strategy, parsed.strategy_hash)
  if (built.status !== 'ok') throw apiFailure('Build failed', built)

  const signed = await signAndExec({ transaction: txFrom(built.tx_json) })
  const digest = extractDigest(signed)
  if (!digest) throw new Error('Wallet did not return a transaction digest.')

  const txResult = await suiClient.waitForTransaction({
    digest,
    options: { showObjectChanges: true, showEvents: true },
  })
  const wrapperId = policyCreatedWrapperId(txResult)
  if (!wrapperId) throw new Error('PolicyCreated event missing from wallet transaction result.')

  const activation = await activateWithRetry({
    wrapperId,
    strategy: parsed.strategy,
    activatePolicy,
    attempts: activationAttempts,
    delayMs: activationDelayMs,
    sleep,
  })

  return {
    meta,
    wrapperId,
    digest,
    strategyHash: parsed.strategy_hash,
    activation,
  }
}

export async function revokePolicyWithWallet({
  owner,
  wrapperId,
  buildRevokeTx,
  signAndExec,
  txFrom = Transaction.from,
}) {
  const built = await buildRevokeTx(owner, wrapperId)
  if (built.status !== 'ok') throw apiFailure('Revoke build failed', built)

  const signed = await signAndExec({ transaction: txFrom(built.tx_json) })
  const digest = extractDigest(signed)
  if (!digest) throw new Error('Wallet did not return a revoke transaction digest.')

  return {
    wrapperId: built.wrapper_id || wrapperId,
    mandateId: built.mandate_id || null,
    digest,
  }
}
