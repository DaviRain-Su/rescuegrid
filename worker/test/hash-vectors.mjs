// Verify strategy_hash against the spec test vectors (docs/03-technical-spec.md §5).
import { canonicalize, blake2b256Hex, strategyHash } from '../src/strategy-core.js'

let fail = 0
const check = (name, got, want) => {
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) console.log(`        got  ${got}\n        want ${want}`)
}

// Vector 1 — the full structured strategy. Building it from unsorted keys to
// prove canonicalize() sorts to the spec's exact canonical form.
const strategy = {
  version: '1',
  strategy_type: 'risk_response',
  owner: '0x1111111111111111111111111111111111111111111111111111111111111111',
  agent: '0x2222222222222222222222222222222222222222222222222222222222222222',
  chain: 'sui:testnet',
  pool_id: '0x4444444444444444444444444444444444444444444444444444444444444444',
  budget_coin_type: '0x3333333333333333333333333333333333333333333333333333333333333333::usdc::USDC',
  budget_ceiling: '500000000',
  trigger: { metric: 'price_drop_pct', asset: 'SUI', threshold_pct: '8' },
  execution: { order_type: 'market_or_ioc', max_slippage_bps: 100, max_single_trade_amount: '100000000' },
  expires_at_ms: 1780000000000,
}
const expectedCanonical = '{"agent":"0x2222222222222222222222222222222222222222222222222222222222222222","budget_ceiling":"500000000","budget_coin_type":"0x3333333333333333333333333333333333333333333333333333333333333333::usdc::USDC","chain":"sui:testnet","execution":{"max_single_trade_amount":"100000000","max_slippage_bps":100,"order_type":"market_or_ioc"},"expires_at_ms":1780000000000,"owner":"0x1111111111111111111111111111111111111111111111111111111111111111","pool_id":"0x4444444444444444444444444444444444444444444444444444444444444444","strategy_type":"risk_response","trigger":{"asset":"SUI","metric":"price_drop_pct","threshold_pct":"8"},"version":"1"}'

check('canonicalize(strategy) matches spec', canonicalize(strategy), expectedCanonical)
check('strategy_hash', strategyHash(strategy), '0x76db36393f9eb39a0267a225c9a99bd8e491b69bf9bb2c39e14ec0c67da1d838')

// Vectors 2-4 — hash over exact canonical UTF-8 input.
check('empty string', blake2b256Hex(''), '0x0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8')
check('cjk text object', blake2b256Hex('{"text":"当 SUI 下跌超过 8% 时启动 500 USDC 风险响应策略。"}'),
  '0x041503ce868c54347445d99743f185ba13ece965d179e0f40c36e22083c3e80f')
check('bignum strings', blake2b256Hex('{"amount":"1000000000000000000000000","threshold_pct":"8.0"}'),
  '0x93bc4163c34e49983b49c47cc70821f1c6b236ba418cf02cbe88adf653db03fa')

console.log(fail === 0 ? '\nALL VECTORS PASS' : `\n${fail} VECTOR(S) FAILED`)
process.exit(fail === 0 ? 0 : 1)
