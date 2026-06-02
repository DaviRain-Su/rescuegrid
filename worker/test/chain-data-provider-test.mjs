import assert from 'node:assert/strict'
import {
  CHAIN_DATA_PROVIDER_JSON_RPC,
  JsonRpcChainDataProvider,
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

{
  assert.equal(configuredChainDataProviderKind({}), CHAIN_DATA_PROVIDER_JSON_RPC)
  assert.equal(configuredChainDataProviderKind({ CHAIN_DATA_PROVIDER: 'jsonrpc' }), CHAIN_DATA_PROVIDER_JSON_RPC)
  assert.equal(configuredChainDataProviderKind({ RESCUEGRID_CHAIN_DATA_PROVIDER: 'graphql' }), 'graphql')
  assert.equal(unsupportedChainDataProvider('graphql').code, 'UNSUPPORTED_CHAIN_DATA_PROVIDER')
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
  assert.equal(provider.error.code, 'UNSUPPORTED_CHAIN_DATA_PROVIDER')
  assert.throws(() => requireChainDataProvider({ CHAIN_DATA_PROVIDER: 'graphql' }, { client: fakeClient }), /Unsupported ChainDataProvider/)
}

console.log('\nALL CHAIN DATA PROVIDER TESTS PASS')
