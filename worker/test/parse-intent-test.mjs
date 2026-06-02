import assert from 'node:assert/strict'
import { parseIntent } from '../../core/strategy.js'
import { DEPLOYMENT } from '../src/sui-tx.js'

const OWNER = '0x1111111111111111111111111111111111111111111111111111111111111111'
const TEXT = 'When SUI drops more than 8%, deploy a 500 USDC rescue grid'
const NOW = Date.UTC(2026, 5, 2, 15, 30, 0)

{
  const parsed = parseIntent(TEXT, OWNER, {}, NOW)
  assert.equal(parsed.status, 'ok')
  assert.equal(parsed.strategy.executor_kind, 'deepbook')
  assert.ok(parsed.ptb_preview.some((line) => line.includes('deepbook executor adapter')))
}

{
  const parsed = parseIntent('When DEEP drops more than 8%, deploy a 500 USDC rescue grid', OWNER, {}, NOW)
  assert.equal(parsed.status, 'ok')
  assert.equal(parsed.strategy.pool_id, DEPLOYMENT.deepbook.pools.DEEP_DBUSDC.pool_id)
  assert.equal(parsed.strategy.executor_kind, 'deepbook')
}

{
  const parsed = parseIntent(TEXT, OWNER, { executor_kind: 'cetus' }, NOW)
  assert.equal(parsed.status, 'error')
  assert.equal(parsed.code, 'UNSUPPORTED_EXECUTOR')
}

{
  const parsed = parseIntent(TEXT, OWNER, { strategy_type: 'funding_rate_harvest' }, NOW)
  assert.equal(parsed.status, 'error')
  assert.equal(parsed.code, 'UNSUPPORTED_STRATEGY')
}

{
  const parsed = parseIntent(TEXT, OWNER, { chain: 'evm:1' }, NOW)
  assert.equal(parsed.status, 'error')
  assert.equal(parsed.code, 'UNSUPPORTED_CHAIN')
}

{
  const parsed = parseIntent(TEXT, OWNER, { max_slippage_bps: 500 }, NOW)
  assert.equal(parsed.status, 'ok')
  assert.equal(parsed.strategy.execution.max_slippage_bps, 500)
}

{
  const parsed = parseIntent(TEXT, OWNER, { max_slippage_bps: 501 }, NOW)
  assert.equal(parsed.status, 'error')
  assert.equal(parsed.code, 'GUARDIAN_STATIC_BLOCK')
}

{
  const parsed = parseIntent(TEXT, OWNER, { max_slippage_bps: 12.5 }, NOW)
  assert.equal(parsed.status, 'error')
  assert.equal(parsed.code, 'GUARDIAN_STATIC_BLOCK')
}

console.log('\nALL PARSE INTENT TESTS PASS')
