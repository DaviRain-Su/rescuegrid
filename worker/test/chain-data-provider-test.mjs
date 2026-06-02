import assert from 'node:assert/strict'
import {
  CHAIN_DATA_PROVIDER_JSON_RPC,
  GraphqlChainDataProvider,
  JsonRpcChainDataProvider,
  configuredGraphqlEndpoint,
  configuredChainDataProviderKind,
  requireChainDataProvider,
  resolveChainDataProvider,
  unsupportedChainDataProvider,
} from '../src/chain-data-provider.js'
import { DEPLOYMENT } from '../src/sui-tx.js'

const WRAPPER_ID = '0x1111111111111111111111111111111111111111111111111111111111111111'
const MANDATE_ID = '0x2222222222222222222222222222222222222222222222222222222222222222'
const wrapperFields = {
  owner: '0x333',
  mandate_id: MANDATE_ID,
  agent: DEPLOYMENT.agent.address,
  pool_id: DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id,
  budget_coin_type: DEPLOYMENT.deepbook.dbusdc_coin_type,
  budget_ceiling: '500000000',
  spent_amount: '100000000',
  max_slippage_bps: 100,
  strategy_hash: [1, 2, 3],
}
const mandateFields = {
  owner: wrapperFields.owner,
  agent: DEPLOYMENT.agent.address,
  revoked: false,
  expires_at_ms: '1800000000000',
}
const fakeClient = {
  async getObject({ id }) {
    if (id === WRAPPER_ID) return { data: { content: { dataType: 'moveObject', fields: wrapperFields } } }
    if (id === MANDATE_ID) return { data: { content: { dataType: 'moveObject', fields: mandateFields } } }
    if (id === '0x6') return { data: { content: { dataType: 'moveObject', fields: { timestamp_ms: '1770000000000' } } } }
    return { data: null }
  },
  async devInspectTransactionBlock() {
    return { results: [{ returnValues: [[[1, 0, 0, 0, 0, 0, 0, 0]]] }] }
  },
  async getBalance({ owner, coinType }) {
    return { owner, coinType, totalBalance: '12345' }
  },
  async queryEvents() {
    return { data: [], hasNextPage: false, nextCursor: null }
  },
}

const gqlCalls = []
const gqlEvents = [
  {
    type: `${DEPLOYMENT.rescuegrid.package_id}::policy::AgentTradeExecuted`,
    timestampMs: '1770000001000',
    transactionBlock: { digest: 'tx-exec' },
    parsedJson: {
      wrapper_id: WRAPPER_ID,
      mandate_id: MANDATE_ID,
      quote_amount_spent: '1000000',
      base_amount_received: '250000',
      slippage_bps: 20,
      spent_amount_after: '101000000',
      budget_ceiling: '500000000',
    },
  },
  {
    type: `${DEPLOYMENT.rescuegrid.package_id}::policy::PolicyCreated`,
    timestampMs: '1770000000000',
    transactionBlock: { digest: 'tx-create' },
    parsedJson: {
      wrapper_id: WRAPPER_ID,
      mandate_id: MANDATE_ID,
      owner: wrapperFields.owner,
      agent: DEPLOYMENT.agent.address,
      pool_id: DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id,
      budget_coin_type: DEPLOYMENT.deepbook.dbusdc_coin_type,
      budget_ceiling: '500000000',
      max_slippage_bps: 100,
      expires_at_ms: '1800000000000',
      strategy_hash: [1, 2, 3],
    },
  },
]
const fakeFetchGraphql = async ({ name, variables }) => {
  gqlCalls.push({ name, variables })
  if (name === 'readObject') {
    const fieldsById = {
      [WRAPPER_ID]: wrapperFields,
      [MANDATE_ID]: mandateFields,
      '0x6': { timestamp_ms: '1770000000000' },
    }
    return { object: { fields: fieldsById[variables.id] ?? null } }
  }
  if (name === 'policyEvents') {
    return {
      events: {
        nodes: gqlEvents,
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    }
  }
  throw new Error(`unexpected query ${name}`)
}
const fakeFallback = {
  async getBalances(owner) {
    return [{ sym: 'SUI', owner }]
  },
  async readBalanceManagerBalance() {
    return 42n
  },
  async getAgentSuiGasBalance(owner) {
    return { owner, totalBalance: '99' }
  },
  async getMarket() {
    return { SUI_DBUSDC: { last_price: '4.2' } }
  },
}

{
  assert.equal(configuredChainDataProviderKind({}), CHAIN_DATA_PROVIDER_JSON_RPC)
  assert.equal(configuredChainDataProviderKind({ CHAIN_DATA_PROVIDER: 'jsonrpc' }), CHAIN_DATA_PROVIDER_JSON_RPC)
  assert.equal(configuredChainDataProviderKind({ RESCUEGRID_CHAIN_DATA_PROVIDER: 'graphql' }), 'graphql')
  assert.equal(configuredGraphqlEndpoint({ SUI_GRAPHQL_URL: 'https://example.test/graphql' }), 'https://example.test/graphql')
  assert.equal(unsupportedChainDataProvider('bogus').code, 'UNSUPPORTED_CHAIN_DATA_PROVIDER')
}

{
  const provider = resolveChainDataProvider({}, { client: fakeClient })
  assert.equal(provider.available, true)
  assert.equal(provider.kind, CHAIN_DATA_PROVIDER_JSON_RPC)
  assert.equal(provider instanceof JsonRpcChainDataProvider, true)
  assert.equal(requireChainDataProvider({}, { client: fakeClient }).kind, CHAIN_DATA_PROVIDER_JSON_RPC)
}

{
  const provider = new JsonRpcChainDataProvider({ client: fakeClient })
  const wrapper = await provider.readWrapper(WRAPPER_ID)
  assert.equal(wrapper.wrapper_id, WRAPPER_ID)
  assert.equal(wrapper.mandate_id, MANDATE_ID)
  assert.equal(wrapper.max_slippage_bps, 100)

  const mandate = await provider.readMandate(MANDATE_ID)
  assert.equal(mandate.id, MANDATE_ID)
  assert.equal(mandate.revoked, false)

  assert.equal(await provider.readClockTimestampMs(), 1770000000000)
  assert.equal((await provider.readBalanceManagerBalance(DEPLOYMENT.deepbook.dbusdc_coin_type)).toString(), '1')
  assert.equal((await provider.getAgentSuiGasBalance()).totalBalance, '12345')
}

{
  const provider = resolveChainDataProvider({ CHAIN_DATA_PROVIDER: 'graphql' }, { client: fakeClient })
  assert.equal(provider.available, false)
  assert.equal(provider.error.code, 'GRAPHQL_ENDPOINT_REQUIRED')
  assert.throws(() => requireChainDataProvider({ CHAIN_DATA_PROVIDER: 'graphql' }, { client: fakeClient }), /GraphQL ChainDataProvider requires/)
}

{
  const provider = resolveChainDataProvider(
    { CHAIN_DATA_PROVIDER: 'graphql' },
    { fetchGraphql: fakeFetchGraphql, fallback: fakeFallback },
  )
  assert.equal(provider.available, true)
  assert.equal(provider instanceof GraphqlChainDataProvider, true)
  assert.equal(requireChainDataProvider(
    { CHAIN_DATA_PROVIDER: 'graphql' },
    { fetchGraphql: fakeFetchGraphql, fallback: fakeFallback },
  ).kind, 'graphql')

  const wrapper = await provider.readWrapper(WRAPPER_ID)
  assert.equal(wrapper.wrapper_id, WRAPPER_ID)
  assert.equal(wrapper.mandate_id, MANDATE_ID)
  assert.equal(wrapper.strategy_hash, '0x010203')

  const mandate = await provider.readMandate(MANDATE_ID)
  assert.equal(mandate.id, MANDATE_ID)
  assert.equal(mandate.revoked, false)
  assert.equal(await provider.readClockTimestampMs(), 1770000000000)

  const events = await provider.queryPolicyEvents(WRAPPER_ID, 10)
  assert.equal(events.length, 2)
  assert.equal(events[0].type, 'AgentTradeExecuted')

  const policies = await provider.listPoliciesByOwner(wrapperFields.owner)
  assert.equal(policies.length, 1)
  assert.equal(policies[0].wrapper_id, WRAPPER_ID)
  assert.equal(policies[0].status, 'active')

  const active = await provider.countActivePoliciesByDeployment({ limit: 10, nowMs: 1770000000000 })
  assert.equal(active.active, 1)
  assert.equal(active.limit_reached, false)

  const summary = await provider.getOwnerSummary(wrapperFields.owner, 1770000000000)
  assert.equal(summary.active_policies, 1)
  assert.equal(summary.total_authorized, 500000000)

  const activity = await provider.listActivityByOwner(wrapperFields.owner)
  assert.equal(activity.length, 2)
  assert.equal(activity[0].source, 'chain')

  const detail = await provider.getActivity(WRAPPER_ID, 1770000000000)
  assert.equal(detail.status, 'ok')
  assert.equal(detail.policy.wrapper_id, WRAPPER_ID)
  assert.equal(detail.events.length, 2)

  assert.deepEqual(await provider.getMarket(), { SUI_DBUSDC: { last_price: '4.2' } })
  assert.equal((await provider.readBalanceManagerBalance(DEPLOYMENT.deepbook.dbusdc_coin_type)).toString(), '42')
  assert.equal((await provider.getAgentSuiGasBalance('0xagent')).totalBalance, '99')
  assert.equal(gqlCalls.some((call) => call.name === 'policyEvents'), true)
}

console.log('\nALL CHAIN DATA PROVIDER TESTS PASS')
