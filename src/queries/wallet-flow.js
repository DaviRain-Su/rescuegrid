import { Transaction } from '@mysten/sui/transactions'
import deployment from '../../core/deployment.js'

export function apiFailure(label, result) {
  const message = result?.message || result?.code || 'unknown error'
  return new Error(`${label}: ${message}`)
}

function extractDigest(result) {
  return result?.digest || result?.effects?.transactionDigest || result?.transactionDigest || null
}

export function policyCreatedEvent(txResult) {
  const event = (txResult?.events || []).find((e) => String(e.type).endsWith('::policy::PolicyCreated'))
  return event?.parsedJson || null
}

export function policyCreatedWrapperId(txResult) {
  return policyCreatedEvent(txResult)?.wrapper_id || null
}

function cleanJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function unsignedStrategy(strategy = {}) {
  const { strategy_hash: _strategyHash, ...rest } = cleanJson(strategy)
  return rest
}

function wrapperFileFragment(wrapperId) {
  const raw = String(wrapperId || 'unknown').replace(/^0x/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (!raw) return 'unknown'
  if (raw.length <= 16) return raw
  return `${raw.slice(0, 8)}-${raw.slice(-8)}`
}

export function walletActivationStrategyFilename(wrapperId) {
  return `wallet-strategy-${wrapperFileFragment(wrapperId)}.json`
}

export function walletActivationStrategyPath(wrapperId) {
  return `.rescuegrid/${walletActivationStrategyFilename(wrapperId)}`
}

export function buildActivationStrategyArtifact({
  owner,
  wrapperId,
  mandateId = null,
  createTxDigest,
  strategy,
  strategyHash,
  activation = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  return {
    purpose: 'rescuegrid_activation_strategy',
    artifact_version: 1,
    generated_at: generatedAt,
    chain: deployment.chain,
    network: 'Sui Testnet',
    owner_address: owner,
    wrapper_id: wrapperId,
    mandate_id: mandateId,
    create_tx_digest: createTxDigest,
    strategy_hash: strategyHash,
    strategy_file_suggested_path: walletActivationStrategyPath(wrapperId),
    strategy: unsignedStrategy(strategy),
    activation: {
      status: activation?.status || null,
      wrapper_id: activation?.wrapper_id || wrapperId,
      runtime_state: activation?.runtime_state || null,
    },
    next_commands: {
      strict_execution_report: `npm run demo:execute:wallet-report -- --wrapper-id ${wrapperId} --strategy-file ${walletActivationStrategyPath(wrapperId)} --create-tx-digest ${createTxDigest}`,
    },
  }
}

export function serializeActivationStrategyArtifact(artifact) {
  return `${JSON.stringify(artifact, null, 2)}\n`
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
  const createdEvent = policyCreatedEvent(txResult)
  const wrapperId = createdEvent?.wrapper_id || null
  if (!wrapperId) throw new Error('PolicyCreated event missing from wallet transaction result.')
  const mandateId = createdEvent?.mandate_id || null

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
    mandateId,
    digest,
    strategyHash: parsed.strategy_hash,
    activation,
    activationStrategyArtifact: buildActivationStrategyArtifact({
      owner,
      wrapperId,
      mandateId,
      createTxDigest: digest,
      strategy: parsed.strategy,
      strategyHash: parsed.strategy_hash,
      activation,
    }),
    activationStrategyFilename: walletActivationStrategyFilename(wrapperId),
    activationStrategyPath: walletActivationStrategyPath(wrapperId),
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
