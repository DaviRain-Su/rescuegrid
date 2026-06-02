import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  buildChainDataStatusReport,
  chainDataStatusEnv,
  chainDataStatusExitCode,
  compareActivitySnapshots,
  comparePolicyListSnapshots,
  parseChainDataStatusArgs,
  redactReportForPrint,
  resolveChainDataStatusConfig,
} from '../scripts/chain-data-status.mjs'

const SECRET_ENDPOINT = 'https://token-secret.example/graphql?api_key=super-secret'
const OWNER = '0x111'
const WRAPPER_ID = '0x222'

const flags = parseChainDataStatusArgs([
  '--provider',
  'graphql',
  '--endpoint',
  SECRET_ENDPOINT,
  '--probe',
  '--owner',
  OWNER,
  '--wrapper-id',
  WRAPPER_ID,
  '--json',
])
assert.equal(flags.get('--provider'), 'graphql')
assert.equal(flags.get('--endpoint'), SECRET_ENDPOINT)
assert.equal(flags.get('--probe'), 'true')
assert.equal(flags.get('--json'), 'true')

const runtimeEnv = chainDataStatusEnv({}, { flags, includeDevVars: false })
assert.equal(runtimeEnv.CHAIN_DATA_PROVIDER, 'graphql')
assert.equal(runtimeEnv.SUI_GRAPHQL_URL, SECRET_ENDPOINT)

const config = resolveChainDataStatusConfig(flags, runtimeEnv)
assert.equal(config.json, true)
assert.equal(config.probe, true)
assert.equal(config.owner, OWNER)
assert.equal(config.wrapper_id, WRAPPER_ID)
assert.equal(config.endpoint, SECRET_ENDPOINT)

const basePolicy = {
  wrapper_id: WRAPPER_ID,
  mandate_id: '0x333',
  owner: OWNER,
  agent: '0xagent',
  status: 'active',
  budget_ceiling: '500',
  spent_amount: '10',
  budget_coin_type: '0xcoin',
  pool_id: '0xpool',
  strategy_hash: '0xhash',
}
assert.equal(comparePolicyListSnapshots({ selected: [basePolicy], jsonRpc: [basePolicy] }).status, 'match')
const policyMismatch = comparePolicyListSnapshots({
  selected: [{ ...basePolicy, spent_amount: '11' }],
  jsonRpc: [basePolicy],
})
assert.equal(policyMismatch.status, 'mismatch')
assert.equal(policyMismatch.mismatched_fields[0].field, 'spent_amount')

const baseActivity = {
  status: 'ok',
  policy: basePolicy,
  events: [
    { type: 'PolicyCreated', tx: 'tx-create' },
    { type: 'AgentTradeExecuted', tx: 'tx-exec' },
  ],
}
assert.equal(compareActivitySnapshots({ selected: baseActivity, jsonRpc: baseActivity }).status, 'match')
const activityMismatch = compareActivitySnapshots({
  selected: { ...baseActivity, events: [{ type: 'PolicyCreated', tx: 'tx-create' }] },
  jsonRpc: baseActivity,
})
assert.equal(activityMismatch.status, 'mismatch')
assert.deepEqual(activityMismatch.missing_events_in_selected, ['AgentTradeExecuted:tx-exec'])

const fakeStatus = async () => ({
  status: 'ok',
  chain: 'sui:testnet',
  provider_kind: 'graphql',
  provider_status: 'ready',
  available: true,
  configured: true,
  endpoint_configured: true,
  graphql_configured: true,
  worker_first: true,
  transport: 'http-graphql',
  read_model: { policy_objects: 'graphql', balances: 'json-rpc-fallback' },
  probe: { status: 'ok' },
})
const selectedProvider = {
  async listPoliciesByOwner(owner) {
    assert.equal(owner, OWNER)
    return [basePolicy]
  },
  async getActivity(wrapperId) {
    assert.equal(wrapperId, WRAPPER_ID)
    return baseActivity
  },
}
const jsonRpcProvider = {
  async listPoliciesByOwner(owner) {
    assert.equal(owner, OWNER)
    return [basePolicy]
  },
  async getActivity(wrapperId) {
    assert.equal(wrapperId, WRAPPER_ID)
    return baseActivity
  },
}
const report = await buildChainDataStatusReport({
  env: runtimeEnv,
  probe: true,
  owner: OWNER,
  wrapperId: WRAPPER_ID,
  endpoint: SECRET_ENDPOINT,
  generatedAt: '2026-06-03T00:00:00.000Z',
}, { getStatus: fakeStatus, selectedProvider, jsonRpcProvider })
assert.equal(report.status, 'ok')
assert.equal(report.comparisons.length, 2)
assert.equal(report.comparisons[0].status, 'match')
assert.equal(report.comparisons[1].status, 'match')
assert.equal(chainDataStatusExitCode(report), 0)

const printable = redactReportForPrint(report, { env: runtimeEnv })
const printableJson = JSON.stringify(printable)
assert.equal(printableJson.includes(SECRET_ENDPOINT), false)
assert.equal(printableJson.includes('super-secret'), false)
const redactedError = redactReportForPrint({ message: `failed at ${SECRET_ENDPOINT}` }, { env: runtimeEnv })
assert.equal(redactedError.message.includes('[redacted-url]'), true)

const unavailableReport = {
  chain_data_provider: {
    provider_kind: 'graphql',
    provider_status: 'unavailable',
    available: false,
  },
  comparisons: [],
}
assert.equal(chainDataStatusExitCode(unavailableReport), 1)
const mismatchReport = {
  chain_data_provider: {
    provider_kind: 'graphql',
    provider_status: 'ready',
    available: true,
  },
  comparisons: [{ name: 'owner_policy_list', status: 'mismatch' }],
}
assert.equal(chainDataStatusExitCode(mismatchReport), 1)

const help = spawnSync(process.execPath, ['scripts/chain-data-status.mjs', '--help'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})
assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /ChainDataProvider status/i)
assert.match(help.stdout, /endpoint URLs/i)
assert.equal(help.stdout.includes('AGENT_KEY='), false)

console.log('\nALL CHAIN DATA STATUS CLI TESTS PASS')
