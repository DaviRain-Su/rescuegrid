/* ===========================================================
   RescueGrid - Sui-only public app data.

   Main is the Sui Hackathon branch. Keep public UI data scoped to
   Sui-native venues and protocols. Non-Sui expansion data is preserved
   on snapshot/pre-sui-hackathon-scope and in post-MVP docs.
   =========================================================== */

const curveUp = [100, 100.3, 100.6, 100.5, 101.0, 101.4, 101.3, 101.8, 102.2, 102.0, 102.7, 103.0, 103.3, 103.1, 103.8, 104.2]

function strategyParsed({ intent, summary, params, ptb, guardian, meta, stats, verdict }) {
  return {
    intent,
    summary,
    params,
    ptb,
    guardian,
    meta,
    backtest: {
      curve: curveUp,
      stats,
      verdict,
    },
  }
}

export function attachMarketData(RG) {
  RG.parsedFundingArb = strategyParsed({
    intent: 'Sui-native perp hedge',
    summary: 'Hedge spot SUI inventory with a scoped Bluefin SUI-PERP short while the policy keeps collateral, funding and liquidation limits inside Sui-only venues.',
    params: [
      { k: 'Pair', v: 'SUI-PERP' },
      { k: 'Legs', v: 'Long DeepBook spot / Short Bluefin perp' },
      { k: 'Funding', v: '+12.4% APR watched' },
      { k: 'Notional', v: '<= 1,000 USDC' },
      { k: 'Rebalance', v: 'each funding window' },
    ],
    ptb: [
      { op: 'MoveCall', fn: 'policy::assert_within_budget', args: 'cap=2000, spent=sum', note: 'budget ceiling across Sui legs' },
      { op: 'MoveCall', fn: 'deepbook::place_limit_order', args: 'pool=SUI/USDC, side=buy, sz=spot', note: 'maintain spot inventory on DeepBook' },
      { op: 'MoveCall', fn: 'bluefin::open_position', args: 'mkt=SUI-PERP, side=short, sz=delta', note: 'hedge downside on Sui perps' },
      { op: 'MoveCall', fn: 'policy::assert_delta_neutral', args: 'net_delta within band', note: 'abort if hedge drifts too far' },
      { op: 'MoveCall', fn: 'policy::log_activity', args: 'action=sui-perp-hedge', note: 'on-chain activity log' },
    ],
    guardian: [
      { level: 'pass', label: 'Sui venue scope', detail: 'Both legs stay inside Sui-native venues: DeepBook spot and Bluefin perp.' },
      { level: 'pass', label: 'Funding watched', detail: 'The agent tracks funding but does not claim risk-free carry.' },
      { level: 'warn', label: 'Liquidation buffer', detail: 'The Bluefin leg has liquidation risk; Guardian keeps a margin buffer before resizing.' },
      { level: 'pass', label: 'Budget ceiling', detail: 'Policy hard-caps total collateral at 2,000 USDC on-chain.' },
    ],
    meta: { name: 'SUI Perp Hedge', strategy: 'funding-arb', budget: 2000, scope: 'SUI-PERP', slip: 0.5 },
    stats: [{ k: 'Funding watched', v: '+12.4%' }, { k: 'Max drawdown', v: '-1.1%' }, { k: 'Net 30d', v: '+3.0%' }],
    verdict: 'The hedge reduced downside volatility while preserving Sui-only custody and policy enforcement.',
  })

  RG.parsedLP = strategyParsed({
    intent: 'Cetus LP range manager',
    summary: 'Provide liquidity to a Cetus SUI/USDC pool in a tight range, then let the agent re-center and compound fees while respecting policy limits.',
    params: [
      { k: 'Pool', v: 'Cetus SUI/USDC' },
      { k: 'Range', v: '+/- 6% band' },
      { k: 'APY', v: '~28% fees + rewards' },
      { k: 'Budget', v: '1,000 USDC' },
      { k: 'Rebalance', v: 'on +/- 4% drift' },
    ],
    ptb: [
      { op: 'MoveCall', fn: 'policy::assert_within_budget', args: 'cap=1000, spent=sum', note: 'budget ceiling' },
      { op: 'MoveCall', fn: 'cetus::open_position', args: 'pool=SUI/USDC, lower=-6%, upper=+6%', note: 'concentrated range position' },
      { op: 'MoveCall', fn: 'cetus::collect_and_compound', args: 'position=id, compound=true', note: 'compound fees and rewards' },
      { op: 'MoveCall', fn: 'policy::log_activity', args: 'action=lp', note: 'on-chain activity log' },
    ],
    guardian: [
      { level: 'pass', label: 'IL exposure', detail: 'The range is narrow but the agent re-centers before price exits the band.' },
      { level: 'warn', label: 'Rebalance frequency', detail: 'Choppy markets trigger more re-centers; each costs a small Sui transaction fee.' },
      { level: 'pass', label: 'Pool liquidity', detail: 'Cetus SUI/USDC is deep enough for this demo size.' },
      { level: 'pass', label: 'Budget ceiling', detail: 'Policy caps LP capital at 1,000 USDC on-chain.' },
    ],
    meta: { name: 'Cetus SUI/USDC LP', strategy: 'lp-manage', budget: 1000, scope: 'SUI/USDC', slip: 1.0 },
    stats: [{ k: 'Fees earned', v: '+5.9%' }, { k: 'IL estimate', v: '-1.4%' }, { k: 'Net 30d', v: '+4.5%' }],
    verdict: 'Auto-re-centering captured fee income through volatility while staying inside a Sui policy.',
  })

  RG.parsedLendYield = strategyParsed({
    intent: 'Sui stablecoin yield router',
    summary: 'Park idle USDC where it earns the most across Sui money markets and migrate only when the edge beats the move cost.',
    params: [
      { k: 'Asset', v: 'USDC' },
      { k: 'Best rate', v: 'Scallop 7.4%' },
      { k: 'Migrate', v: 'if +0.5% better' },
      { k: 'Budget', v: '5,000 USDC' },
      { k: 'Check', v: 'hourly' },
    ],
    ptb: [
      { op: 'MoveCall', fn: 'policy::assert_within_budget', args: 'cap=5000, spent=sum', note: 'budget ceiling' },
      { op: 'MoveCall', fn: 'scallop::supply', args: 'asset=USDC, amt=5000', note: 'route to the top-rate money market' },
      { op: 'MoveCall', fn: 'policy::assert_rate_improved', args: 'min_delta=0.5%', note: 'only migrate when materially better' },
      { op: 'MoveCall', fn: 'policy::log_activity', args: 'action=lend', note: 'on-chain activity log' },
    ],
    guardian: [
      { level: 'pass', label: 'Principal mode', detail: 'Supply-only into Sui money markets. No borrowing or leverage.' },
      { level: 'pass', label: 'Migration cost', detail: 'The agent moves only when the edge beats withdraw and supply cost.' },
      { level: 'warn', label: 'Protocol risk', detail: 'Funds sit in third-party Sui lending contracts; exposure is capped per venue.' },
      { level: 'pass', label: 'Budget ceiling', detail: 'Policy caps deployed stablecoins at 5,000 USDC on-chain.' },
    ],
    meta: { name: 'Sui USDC Yield Router', strategy: 'lending', budget: 5000, scope: 'USDC', slip: 0.2 },
    stats: [{ k: 'Avg APY', v: '7.1%' }, { k: 'Migrations', v: '4' }, { k: 'Net 30d', v: '+0.6%' }],
    verdict: 'Routing idle USDC across Sui lending venues beat a static single-venue deposit.',
  })

  RG.parsedSpotArb = strategyParsed({
    intent: 'Sui DEX spread capture',
    summary: 'Compare DeepBook and Cetus SUI spot prices, then execute only when a same-chain spread clears fees and slippage.',
    params: [
      { k: 'Asset', v: 'SUI spot' },
      { k: 'Legs', v: 'Buy DeepBook / Sell Cetus' },
      { k: 'Spread', v: '+0.19%' },
      { k: 'Size', v: '<= 2,000 USDC' },
      { k: 'Trigger', v: 'spread > 0.10%' },
    ],
    ptb: [
      { op: 'MoveCall', fn: 'policy::assert_within_budget', args: 'cap=2000, spent=sum', note: 'budget ceiling' },
      { op: 'MoveCall', fn: 'deepbook::place_limit_order', args: 'SUI/USDC, buy sz=delta', note: 'buy cheaper Sui venue' },
      { op: 'MoveCall', fn: 'cetus::swap_exact_in', args: 'SUI/USDC, sell sz=delta', note: 'sell richer Sui venue' },
      { op: 'MoveCall', fn: 'policy::log_activity', args: 'action=sui-spot-spread', note: 'on-chain activity log' },
    ],
    guardian: [
      { level: 'pass', label: 'Spread vs cost', detail: 'The spread clears estimated Sui DEX fees and slippage.' },
      { level: 'pass', label: 'Same-chain settlement', detail: 'Both legs stay on Sui under the same policy boundary.' },
      { level: 'warn', label: 'Book movement', detail: 'The agent re-quotes before execution and aborts if the spread disappears.' },
      { level: 'pass', label: 'Budget ceiling', detail: 'Policy hard-caps per-cycle size at 2,000 USDC on-chain.' },
    ],
    meta: { name: 'Sui Spot Spread', strategy: 'spot-arb', budget: 2000, scope: 'SUI spot', slip: 0.2 },
    stats: [{ k: 'Cycles', v: '31' }, { k: 'Avg spread', v: '+0.13%' }, { k: 'Net 30d', v: '+0.48%' }],
    verdict: 'Same-chain spread capture compounds small Sui DEX edges without leaving the policy boundary.',
  })

  RG.riskTax = {
    market: { label: 'Market', c: '#5AA6FF' },
    liquidity: { label: 'Liquidity', c: '#2EE6CE' },
    liq: { label: 'Liquidation', c: '#FF5470' },
    oracle: { label: 'Oracle', c: '#FFC24B' },
    contract: { label: 'Smart-contract', c: '#9DABBA' },
    venue: { label: 'Sui venue', c: '#FF9F45' },
    funding: { label: 'Funding flip', c: '#A78BFA' },
  }

  RG.catalog = [
    { id: 'risk-grid', name: 'Risk Response Grid', cat: 'Risk Response', status: 'available', scenario: 'safe', icon: 'shield', blurb: 'Auto-deploy a DeepBook buy ladder, pause or reduce exposure when SUI drops, volatility spikes, or liquidity thins.', metric: { l: 'Trigger', v: '-8% / 1h' }, adapters: ['DeepBook'], risks: ['market', 'liquidity'], capital: '500+ USDC' },
    { id: 'sui-perp-hedge', name: 'Sui Perp Hedge', cat: 'Risk Response', status: 'testnet', scenario: 'funding-arb', icon: 'swap', blurb: 'Hedge SUI spot inventory with a scoped Bluefin SUI-PERP short, with funding and liquidation guards.', metric: { l: 'Funding watched', v: '+12.4% APR' }, adapters: ['DeepBook', 'Bluefin'], risks: ['funding', 'liq', 'liquidity'], capital: '2,000+ USDC' },
    { id: 'sui-spot-spread', name: 'Sui DEX Spread Capture', cat: 'Arbitrage', status: 'testnet', scenario: 'spot', icon: 'scale', blurb: 'Compare DeepBook and Cetus spot prices and execute only when the same-chain spread clears fees and slippage.', metric: { l: 'Spread', v: '+0.19%' }, adapters: ['DeepBook', 'Cetus'], risks: ['liquidity', 'market'], capital: '2,000+ USDC' },
    { id: 'lend-optimizer', name: 'Sui Lending Rate Optimizer', cat: 'Lending', status: 'available', scenario: 'lend', icon: 'percent', blurb: 'Route idle stablecoins across Scallop, NAVI and Suilend, migrating only when the edge beats the move cost.', metric: { l: 'Best APY', v: '7.4%' }, adapters: ['Scallop', 'NAVI', 'Suilend'], risks: ['contract', 'liquidity'], capital: '5,000 USDC' },
    { id: 'borrow-guardian', name: 'Borrow Health Guardian', cat: 'Lending', status: 'testnet', scenario: null, icon: 'shield', blurb: 'Watch Sui lending health and auto-repay or deleverage before liquidation when LTV worsens.', metric: { l: 'Action', v: 'auto-repay' }, adapters: ['Suilend', 'NAVI'], risks: ['liq', 'oracle'], capital: 'collateral' },
    { id: 'lp-range', name: 'Cetus LP Range Manager', cat: 'LP', status: 'available', scenario: 'lp', icon: 'droplet', blurb: 'Place a concentrated Cetus range, compound fees and auto re-center as price drifts, exiting on volatility.', metric: { l: 'Fee APR', v: '~28%' }, adapters: ['Cetus'], risks: ['market', 'liquidity'], capital: '1,000+ USDC' },
    { id: 'dca', name: 'DeepBook DCA / Accumulation', cat: 'Automation', status: 'available', scenario: 'dca', icon: 'target', blurb: 'Schedule recurring SUI or DEEP buys by time, volatility band or drawdown level.', metric: { l: 'Cadence', v: 'daily xN' }, adapters: ['DeepBook'], risks: ['market'], capital: '100+ / run' },
    { id: 'tpsl', name: 'Sui Take-Profit / Stop-Loss', cat: 'Automation', status: 'testnet', scenario: 'hedge', icon: 'activity', blurb: 'Trailing stop, take-profit and stop-loss automation for Sui positions through scoped DeepBook and Bluefin actions.', metric: { l: 'Type', v: 'trailing' }, adapters: ['DeepBook', 'Bluefin'], risks: ['market', 'liquidity'], capital: 'position' },
    { id: 'peg-rescue', name: 'Sui Stablecoin / Peg Rescue', cat: 'Risk Response', status: 'soon', scenario: null, icon: 'shield', blurb: 'On depeg, pool imbalance or oracle mismatch: reduce exposure, swap to safer Sui collateral, or pause the strategy.', metric: { l: 'Trigger', v: 'depeg' }, adapters: ['Cetus', 'DeepBook'], risks: ['oracle', 'liquidity'], capital: '-' },
    { id: 'rebalancer', name: 'Sui Portfolio Rebalancer', cat: 'Rebalance', status: 'soon', scenario: null, icon: 'scale', blurb: 'Hold target weights across SUI, DEEP, WAL, stables, LP and lending positions; rebalance when drift exceeds a band.', metric: { l: 'Trigger', v: 'drift > 5%' }, adapters: ['DeepBook', 'Cetus', 'Scallop'], risks: ['market', 'liquidity'], capital: '-' },
    { id: 'watchtower', name: 'Sui Alert-Only Watchtower', cat: 'Watchtower', status: 'available', scenario: null, watch: true, icon: 'eye', blurb: 'Monitor any Sui market or position with zero execution authority, then upgrade to an autonomous policy when ready.', metric: { l: 'Authority', v: 'none' }, adapters: ['DeepBook', 'Cetus', 'Scallop'], risks: [], capital: 'free' },
  ]

  RG.detail = {
    'sui-perp-hedge': {
      thesis: 'Sui perp funding and mark-price drift can create a useful hedge signal. RescueGrid keeps the visible scope inside Sui: DeepBook spot inventory and a Bluefin SUI-PERP hedge, both bounded by the same Move policy.',
      legs: [
        { venue: 'DeepBook', asset: 'SUI spot', side: 'Long', size: '1,000 USDC', collateral: 'USDC', exp: 'spot inventory', expC: 'var(--safe)' },
        { venue: 'Bluefin', asset: 'SUI-PERP', side: 'Short', size: '1,000 USDC', collateral: 'USDC', exp: 'hedges downside', expC: 'var(--safe)' },
      ],
      yield: [
        { label: 'Funding watched', v: '+12.4%', c: 'var(--safe)' },
        { label: 'Trading fees', v: '-0.4%', c: 'var(--t1)' },
        { label: 'Gas', v: 'sponsored', c: 'var(--t2)' },
      ],
      net: { label: 'Hedge value', v: 'Sui-only risk reduction' },
      risk: [
        { key: 'funding', level: 'warn', note: 'Funding can flip; the policy unwinds if net carry becomes unfavorable.' },
        { key: 'liq', level: 'warn', note: 'The Bluefin leg has liquidation risk; Guardian enforces a margin buffer.' },
        { key: 'liquidity', level: 'pass', note: 'DeepBook and Bluefin depth are checked before any action.' },
      ],
      permissions: ['Trade DeepBook SUI/USDC within scope', 'Open or close Bluefin SUI-PERP hedge within scope', 'Read Sui oracle and funding feeds', 'Never withdraw or transfer externally'],
      timeline: [
        { t: 'trigger', d: 'SUI downside or funding condition crosses threshold' },
        { t: 't0', d: 'Size DeepBook spot and Bluefin hedge under the policy cap' },
        { t: 'each window', d: 'Re-check funding, delta and liquidation buffer' },
        { t: 'on flip', d: 'Unwind or resize the hedge and return to monitoring' },
      ],
    },
    'sui-spot-spread': {
      thesis: 'Sui spot books can diverge briefly across DeepBook and AMM pools. RescueGrid treats this as same-chain spread capture only.',
      legs: [
        { venue: 'DeepBook', asset: 'SUI/USDC', side: 'Buy', size: '2,000 USDC', collateral: 'USDC', exp: 'cheaper ask', expC: 'var(--safe)' },
        { venue: 'Cetus', asset: 'SUI/USDC', side: 'Sell', size: '2,000 USDC', collateral: 'SUI', exp: 'richer bid', expC: 'var(--safe)' },
      ],
      yield: [
        { label: 'Gross spread', v: '+0.19%', c: 'var(--safe)' },
        { label: 'DEX fees + gas', v: '-0.08%', c: 'var(--t1)' },
        { label: 'Slippage buffer', v: '-0.03%', c: 'var(--t1)' },
      ],
      net: { label: 'Net spread', v: '+0.08%' },
      risk: [
        { key: 'liquidity', level: 'warn', note: 'The spread can disappear before execution; Guardian aborts if re-quote fails.' },
        { key: 'market', level: 'pass', note: 'Both legs settle on Sui under the same budget and slippage policy.' },
      ],
      permissions: ['Trade DeepBook SUI/USDC within scope', 'Swap Cetus SUI/USDC within scope', 'Read Sui price and pool feeds', 'Never touch non-Sui venues'],
      timeline: [
        { t: 'scan', d: 'Compare DeepBook and Cetus quotes' },
        { t: 'trigger', d: 'Spread clears fees and slippage guard' },
        { t: 't0', d: 'Execute same-chain legs under the policy cap' },
        { t: 'post', d: 'Log activity on-chain and return to monitoring' },
      ],
    },
    'lp-range': {
      thesis: 'A concentrated Cetus liquidity position earns fees while price stays in range. The agent keeps the range centered, compounds fees and exits during large moves.',
      legs: [{ venue: 'Cetus', asset: 'SUI/USDC', side: 'LP +/- 6%', size: '1,000 USDC', collateral: '50 / 50', exp: 'fees + rewards', expC: 'var(--safe)' }],
      yield: [
        { label: 'Swap fees', v: '+14.2%', c: 'var(--safe)' },
        { label: 'CETUS incentives', v: '+14.2%', c: 'var(--safe)' },
        { label: 'Impermanent loss', v: '-1.4%', c: 'var(--danger)' },
        { label: 'Rebalance cost', v: '-0.3%', c: 'var(--t1)' },
      ],
      net: { label: 'Net fee APR', v: '~26.7%' },
      risk: [
        { key: 'market', level: 'warn', note: 'Price leaving the band stops fee income; the agent re-centers before the range exits.' },
        { key: 'liquidity', level: 'pass', note: 'Cetus SUI/USDC depth is sufficient for this demo size.' },
      ],
      permissions: ['Open or adjust Cetus CLMM positions', 'Collect and compound fees', 'Re-center range within policy', 'Never withdraw externally'],
      timeline: [
        { t: 't0', d: 'Open a concentrated range around the current mid' },
        { t: 'on drift', d: 'Withdraw and re-deposit around the new mid' },
        { t: 'continuous', d: 'Collect and compound swap fees and rewards' },
      ],
    },
    'lend-optimizer': {
      thesis: 'Stablecoin supply rates drift across Sui money markets. The agent holds USDC where the risk-adjusted rate is highest.',
      legs: [{ venue: 'Scallop', asset: 'USDC', side: 'Supply', size: '5,000 USDC', collateral: '-', exp: '7.4% APY', expC: 'var(--safe)' }],
      yield: [
        { label: 'Supply APY', v: '+5.9%', c: 'var(--safe)' },
        { label: 'Reward APY', v: '+1.5%', c: 'var(--safe)' },
        { label: 'Migration cost', v: '-0.2%', c: 'var(--t1)' },
      ],
      net: { label: 'Net APY', v: '7.2%' },
      risk: [
        { key: 'contract', level: 'warn', note: 'Funds sit in third-party Sui lending contracts; exposure is capped.' },
        { key: 'liquidity', level: 'pass', note: 'Withdrawal liquidity is healthy across Scallop, NAVI and Suilend at this size.' },
      ],
      permissions: ['Supply or withdraw on Scallop, NAVI and Suilend', 'Migrate between Sui money markets', 'Read rate and utilization feeds', 'No borrowing'],
      timeline: [
        { t: 't0', d: 'Supply to the top-rate Sui market' },
        { t: 'hourly', d: 'Compare risk-adjusted rates across Sui venues' },
        { t: 'on edge', d: 'Withdraw and re-supply to the better venue' },
      ],
    },
    'risk-grid': {
      thesis: 'This policy pre-authorizes a DeepBook buy ladder into a sharp SUI drop, strictly within a budget cap.',
      legs: [{ venue: 'DeepBook', asset: 'SUI/USDC', side: 'Buy ladder', size: '500 USDC', collateral: 'USDC', exp: 'avg -6% vs market', expC: 'var(--safe)' }],
      yield: [
        { label: 'Avg entry vs market', v: '-6.2%', c: 'var(--safe)' },
        { label: 'Trading fees', v: '-0.4%', c: 'var(--t1)' },
        { label: 'Gas', v: 'sponsored', c: 'var(--t2)' },
      ],
      net: { label: 'Dip captured', v: '~6% under market' },
      risk: [
        { key: 'market', level: 'warn', note: 'A continued fall buys deeper into a downtrend; the budget cap hard-limits exposure.' },
        { key: 'liquidity', level: 'warn', note: 'Books thin mid-crash; the agent re-quotes and respects the slippage cap.' },
      ],
      permissions: ['Place or cancel DeepBook limit orders', 'Read Sui price feed', 'Never exceed budget or withdraw funds'],
      timeline: [
        { t: 'trigger', d: 'SUI -8% / 1h breaches the reference price' },
        { t: 't0', d: 'Deploy rung #1 of the rescue grid' },
        { t: 'laddered', d: 'Fill lower rungs as price falls, within budget' },
      ],
    },
  }

  RG.detail['funding-harvest'] = RG.detail['sui-perp-hedge']
  RG.detail['spot-arb'] = RG.detail['sui-spot-spread']

  RG.chains = [{ id: 'sui', name: 'Sui', live: true, c: '#5AA6FF' }]

  RG.protocols = {
    cetus: { name: 'Cetus', kind: 'AMM DEX', c: '#2FD9E6' },
    suilend: { name: 'Suilend', kind: 'Lending', c: '#8C7BFF' },
    navi: { name: 'NAVI', kind: 'Lending', c: '#34E0A1' },
    scallop: { name: 'Scallop', kind: 'Lending', c: '#5AA6FF' },
    alphalend: { name: 'AlphaLend', kind: 'Lending', c: '#3E7BFF' },
    current: { name: 'Current', kind: 'Lending', c: '#22C7B8' },
    aftermath: { name: 'Aftermath', kind: 'AMM / LST', c: '#FF9F45' },
    bluefin: { name: 'Bluefin', kind: 'Perp / Spot', c: '#3E7BFF' },
    deepbook: { name: 'DeepBook', kind: 'CLOB', c: '#2EE6CE' },
    spring: { name: 'SpringSui', kind: 'Liquid staking', c: '#5AA6FF' },
    haedal: { name: 'Haedal', kind: 'Liquid staking', c: '#22C7B8' },
    volo: { name: 'Volo', kind: 'Liquid staking', c: '#6E8BFF' },
    alphafi: { name: 'AlphaFi', kind: 'Yield aggregator', c: '#A78BFA' },
    kai: { name: 'Kai', kind: 'Yield vault', c: '#46D39A' },
    mole: { name: 'Mole', kind: 'Yield vault', c: '#FF9F45' },
    bucket: { name: 'Bucket', kind: 'CDP / Farm', c: '#FFC24B' },
    ember: { name: 'Ember', kind: 'Capital allocator', c: '#8C7BFF' },
    ondo: { name: 'Ondo', kind: 'RWA yield', c: '#34E0A1' },
    kaio: { name: 'KAIO', kind: 'RWA vault', c: '#46D39A' },
    turbos: { name: 'Turbos', kind: 'CLMM DEX', c: '#F97316' },
    momentum: { name: 'Momentum', kind: 'CLMM DEX', c: '#2EE6CE' },
    magma: { name: 'Magma', kind: 'AMM DEX', c: '#EF4444' },
    steamm: { name: 'STEAMM', kind: 'AMM DEX', c: '#14B8A6' },
    sudo: { name: 'Sudo', kind: 'Perps', c: '#6366F1' },
    dipcoin: { name: 'DipCoin', kind: 'Perps', c: '#F59E0B' },
  }

  RG.yields = [
    { proto: 'suilend', market: 'USDC', type: 'Lending', chain: 'sui', tvl: 48.2, base: 5.1, reward: 1.7, risk: 'low', trend: [6.2, 6.3, 6.1, 6.5, 6.6, 6.4, 6.8] },
    { proto: 'navi', market: 'SUI', type: 'Lending', chain: 'sui', tvl: 61.5, base: 3.4, reward: 0.8, risk: 'low', trend: [4.0, 4.1, 4.0, 4.2, 4.1, 4.3, 4.2] },
    { proto: 'scallop', market: 'USDC', type: 'Lending', chain: 'sui', tvl: 33.1, base: 5.9, reward: 1.5, risk: 'low', trend: [7.0, 7.1, 7.3, 7.2, 7.4, 7.3, 7.4] },
    { proto: 'alphalend', market: 'USDC', type: 'Lending', chain: 'sui', tvl: 62.9, base: 4.9, reward: 0.7, risk: 'med', trend: [5.1, 5.4, 5.2, 5.7, 5.5, 5.8, 5.6] },
    { proto: 'current', market: 'haSUI', type: 'Lending', chain: 'sui', tvl: 11.6, base: 3.1, reward: 0.0, risk: 'low', trend: [3.0, 3.0, 3.1, 3.1, 3.2, 3.1, 3.1] },
    { proto: 'cetus', market: 'SUI/USDC', type: 'LP', chain: 'sui', tvl: 22.8, base: 14.2, reward: 14.2, risk: 'med', trend: [25, 26, 24, 29, 27, 30, 28.4] },
    { proto: 'cetus', market: 'DEEP/SUI', type: 'LP', chain: 'sui', tvl: 6.4, base: 31.0, reward: 33.1, risk: 'high', trend: [52, 58, 49, 66, 61, 70, 64.1] },
    { proto: 'bluefin', market: 'SUI/USDC', type: 'LP', chain: 'sui', tvl: 14.2, base: 18.4, reward: 13.3, risk: 'med', trend: [28, 30, 29, 33, 31, 34, 31.7] },
    { proto: 'turbos', market: 'SUI/USDC', type: 'LP', chain: 'sui', tvl: 4.4, base: 10.2, reward: 1.8, risk: 'med', trend: [10.0, 10.8, 11.5, 10.9, 12.2, 11.8, 12.0] },
    { proto: 'momentum', market: 'SUI/USDC', type: 'LP', chain: 'sui', tvl: 6.3, base: 12.1, reward: 2.2, risk: 'med', trend: [12.4, 13.1, 12.8, 14.2, 13.6, 14.8, 14.3] },
    { proto: 'magma', market: 'SUI/USDC', type: 'LP', chain: 'sui', tvl: 4.5, base: 13.3, reward: 3.1, risk: 'med', trend: [13.8, 14.1, 13.7, 15.4, 15.9, 16.8, 16.4] },
    { proto: 'steamm', market: 'SUI/USDC', type: 'LP', chain: 'sui', tvl: 2.6, base: 8.8, reward: 0.4, risk: 'med', trend: [8.5, 8.8, 9.1, 8.7, 9.3, 9.1, 9.2] },
    { proto: 'aftermath', market: 'afSUI/SUI', type: 'LST', chain: 'sui', tvl: 18.9, base: 9.6, reward: 0.0, risk: 'low', trend: [9.4, 9.5, 9.5, 9.6, 9.5, 9.7, 9.6] },
    { proto: 'spring', market: 'sSUI/SUI', type: 'LST', chain: 'sui', tvl: 51.1, base: 3.2, reward: 0.0, risk: 'low', trend: [3.1, 3.2, 3.2, 3.3, 3.2, 3.2, 3.2] },
    { proto: 'haedal', market: 'haSUI', type: 'LST', chain: 'sui', tvl: 120.3, base: 3.1, reward: 0.0, risk: 'low', trend: [3.0, 3.1, 3.0, 3.1, 3.2, 3.1, 3.1] },
    { proto: 'volo', market: 'vSUI', type: 'LST', chain: 'sui', tvl: 52.0, base: 3.3, reward: 0.0, risk: 'low', trend: [3.2, 3.3, 3.2, 3.4, 3.3, 3.3, 3.3] },
    { proto: 'alphafi', market: 'stSUI', type: 'LST', chain: 'sui', tvl: 5.9, base: 3.7, reward: 0.4, risk: 'low', trend: [3.5, 3.6, 3.8, 3.9, 3.8, 4.0, 4.1] },
    { proto: 'kai', market: 'USDC looped', type: 'Vault', chain: 'sui', tvl: 9.8, base: 11.0, reward: 7.2, risk: 'high', trend: [16, 17, 15, 19, 18, 20, 18.2] },
    { proto: 'alphafi', market: 'SUI yield agg', type: 'Vault', chain: 'sui', tvl: 12.5, base: 8.6, reward: 1.2, risk: 'med', trend: [8.8, 9.1, 9.3, 9.6, 9.4, 10.1, 9.8] },
    { proto: 'ember', market: 'USDC vault', type: 'Vault', chain: 'sui', tvl: 32.3, base: 2.5, reward: 0.0, risk: 'med', trend: [2.4, 2.5, 2.5, 2.6, 2.5, 2.5, 2.5] },
    { proto: 'mole', market: 'USDC strategy', type: 'Vault', chain: 'sui', tvl: 8.3, base: 5.8, reward: 0.8, risk: 'med', trend: [5.7, 5.9, 6.1, 6.4, 6.2, 6.8, 6.6] },
    { proto: 'bucket', market: 'BUCK farm', type: 'Farm', chain: 'sui', tvl: 38.0, base: 4.8, reward: 1.4, risk: 'med', trend: [5.9, 6.0, 6.2, 6.4, 6.3, 6.5, 6.2] },
    { proto: 'bucket', market: 'BUCK CDP', type: 'CDP', chain: 'sui', tvl: 9.0, base: 0.0, reward: 3.8, risk: 'med', trend: [3.4, 3.6, 3.7, 3.9, 3.8, 3.8, 3.8] },
    { proto: 'ondo', market: 'USDY', type: 'RWA', chain: 'sui', tvl: 23.1, base: 3.6, reward: 0.0, risk: 'low', trend: [3.4, 3.5, 3.5, 3.6, 3.6, 3.6, 3.6] },
    { proto: 'kaio', market: 'RWA vault', type: 'RWA', chain: 'sui', tvl: 20.4, base: 4.2, reward: 0.0, risk: 'med', trend: [4.0, 4.0, 4.1, 4.2, 4.2, 4.2, 4.2] },
    { proto: 'deepbook', market: 'SUI/USDC', type: 'CLOB', chain: 'sui', tvl: 40.0, base: 0.0, reward: 11.5, risk: 'med', trend: [10, 11, 10.5, 12, 11, 12, 11.5] },
  ]

  RG.perpVenues = {
    deepbook: { name: 'DeepBook spot', kind: 'dex', tag: 'Sui', c: '#2EE6CE' },
    bluefin: { name: 'Bluefin', kind: 'dex', tag: 'Sui', c: '#3E7BFF' },
    sudo: { name: 'Sudo Perps', kind: 'dex', tag: 'Sui', c: '#6366F1' },
    dipcoin: { name: 'DipCoin Perps', kind: 'dex', tag: 'Sui', c: '#F59E0B' },
  }
  RG.perps = [
    { sym: 'SUI', mark: 4.182, venues: [{ v: 'deepbook', funding: 0.0, oi: 40.0, px: 4.181 }, { v: 'bluefin', funding: 12.4, oi: 8.2, px: 4.183 }, { v: 'sudo', funding: 6.3, oi: 6.3, px: 4.184 }, { v: 'dipcoin', funding: 4.1, oi: 2.0, px: 4.186 }] },
    { sym: 'DEEP', mark: 0.1043, venues: [{ v: 'deepbook', funding: 0.0, oi: 12.0, px: 0.1043 }, { v: 'bluefin', funding: 8.6, oi: 2.4, px: 0.1045 }] },
  ]

  RG.spotVenues = {
    deepbook: { name: 'DeepBook', kind: 'dex', tag: 'Sui', c: '#2EE6CE' },
    cetus: { name: 'Cetus', kind: 'dex', tag: 'Sui', c: '#2FD9E6' },
    bluefin: { name: 'Bluefin Spot', kind: 'dex', tag: 'Sui', c: '#3E7BFF' },
    turbos: { name: 'Turbos', kind: 'dex', tag: 'Sui', c: '#F97316' },
    momentum: { name: 'Momentum', kind: 'dex', tag: 'Sui', c: '#2EE6CE' },
    magma: { name: 'Magma', kind: 'dex', tag: 'Sui', c: '#EF4444' },
    steamm: { name: 'STEAMM', kind: 'dex', tag: 'Sui', c: '#14B8A6' },
  }
  RG.spots = [
    { sym: 'SUI', venues: [{ v: 'deepbook', bid: 4.178, ask: 4.185 }, { v: 'cetus', bid: 4.190, ask: 4.196 }, { v: 'bluefin', bid: 4.181, ask: 4.188 }, { v: 'turbos', bid: 4.187, ask: 4.193 }, { v: 'momentum', bid: 4.191, ask: 4.197 }, { v: 'magma', bid: 4.174, ask: 4.183 }, { v: 'steamm', bid: 4.180, ask: 4.189 }] },
    { sym: 'DEEP', venues: [{ v: 'deepbook', bid: 0.1048, ask: 0.1050 }, { v: 'cetus', bid: 0.1054, ask: 0.1057 }, { v: 'turbos', bid: 0.1051, ask: 0.1055 }] },
    { sym: 'WAL', venues: [{ v: 'deepbook', bid: 0.626, ask: 0.629 }, { v: 'cetus', bid: 0.631, ask: 0.634 }, { v: 'momentum', bid: 0.629, ask: 0.633 }] },
  ]

  RG.riskBudget = { authorized: 10500, atRisk: 6480, dailyLossCap: 800, dailyLossUsed: 142 }
  RG.venueLimits = [
    { venue: 'DeepBook', kind: 'dex', exposure: 2750, cap: 4000 },
    { venue: 'Cetus', kind: 'dex', exposure: 1000, cap: 3000 },
    { venue: 'Bluefin', kind: 'dex', exposure: 980, cap: 2500 },
    { venue: 'Scallop', kind: 'lend', exposure: 1750, cap: 3000 },
    { venue: 'NAVI', kind: 'lend', exposure: 1200, cap: 3000 },
    { venue: 'Suilend', kind: 'lend', exposure: 1150, cap: 3000 },
    { venue: 'Turbos', kind: 'dex', exposure: 420, cap: 1200 },
    { venue: 'Momentum', kind: 'dex', exposure: 360, cap: 1200 },
    { venue: 'Bucket', kind: 'cdp', exposure: 300, cap: 1000 },
    { venue: 'AlphaLend', kind: 'lend', exposure: 680, cap: 2000 },
  ]
  RG.liquidations = [
    { policy: 'Sui Perp Hedge', venue: 'Bluefin', side: 'Short', liqPx: 5.21, markPx: 4.18, buffer: 24.6, health: 'safe' },
    { policy: 'WAL Downside Hedge', venue: 'Bluefin', side: 'Short', liqPx: 0.71, markPx: 0.63, buffer: 12.7, health: 'warn' },
  ]
  RG.oracles = [
    { feed: 'Pyth / SUI/USD', status: 'ok', age: '0.4s', dev: '0.02%' },
    { feed: 'Pyth / DEEP/USD', status: 'ok', age: '0.6s', dev: '0.05%' },
    { feed: 'Switchboard / WAL/USD', status: 'stale', age: '14s', dev: '0.31%' },
  ]
  RG.signers = [
    { name: 'zkLogin session key', kind: 'zklogin', status: 'ok', detail: 'epoch 612 / 614, about 36h left' },
    { name: 'Cloud agent executor', kind: 'cloud', status: 'ok', detail: '0x7a3f...c91e, sponsored gas' },
    { name: 'Local daemon', kind: 'local', status: 'offline', detail: 'not running, cloud handling policies' },
  ]

  RG.capabilities = {
    can: [
      'Trade only on Sui venues each policy scopes',
      'Stay within every budget and Sui venue cap',
      'Open, close or rebalance positions it created',
      'Read Sui price, lending, LP and funding feeds',
      'Pause itself when Guardian checks fail',
    ],
    cannot: [
      'Withdraw or transfer funds to any external address',
      'Exceed a budget, leverage or slippage limit',
      'Touch assets or venues outside policy scope',
      'Change its own policy or raise its own limits',
      'Approve token spend beyond the scoped amount',
      'Act after you revoke the on-chain Policy Object',
    ],
  }

  RG.dataFeeds = [
    { id: 'llama', scope: 'sui', group: 'Market data', name: 'Sui DeFi yields & TVL', provider: 'DefiLlama', endpoint: 'yields.llama.fi/pools?chain=Sui', type: 'REST', access: 'live', cadence: '60s', powers: 'Sui yield monitor and opportunities', test: 'https://yields.llama.fi/pools' },
    { id: 'protocols', scope: 'sui', group: 'Market data', name: 'Sui protocol registry', provider: 'DefiLlama', endpoint: 'api.llama.fi/protocols?chain=Sui', type: 'REST', access: 'live', cadence: '5m', powers: 'Protocol coverage and adapter prioritization', test: 'https://api.llama.fi/protocols' },
    { id: 'pyth', scope: 'sui', group: 'Market data', name: 'Sui spot & oracle prices', provider: 'Pyth / Hermes', endpoint: 'hermes.pyth.network?query=sui', type: 'REST / SSE', access: 'live', cadence: '400ms', powers: 'Prices, risk gauge and Guardian', test: 'https://hermes.pyth.network/v2/price_feeds?query=sui&asset_type=crypto' },
    { id: 'cg', scope: 'sui', group: 'Market data', name: 'SUI / DEEP / WAL 24h data', provider: 'CoinGecko', endpoint: 'api.coingecko.com/sui-tokens', type: 'REST', access: 'live', cadence: '60s', powers: 'Tickers and sparklines', test: 'https://api.coingecko.com/api/v3/ping' },
    { id: 'suirpc', scope: 'sui', group: 'On-chain', name: 'Sui full-node RPC', provider: 'Sui / Mysten', endpoint: 'fullnode.testnet.sui.io', type: 'JSON-RPC', access: 'live', cadence: 'realtime', powers: 'Balances, policy objects and checkpoints', test: null },
    { id: 'deepbook', scope: 'sui', group: 'On-chain', name: 'DeepBook order book', provider: 'DeepBook indexer', endpoint: 'deepbook-indexer.testnet', type: 'REST / WS', access: 'live', cadence: 'realtime', powers: 'Spot books and CLOB depth', test: null },
    { id: 'clmm', scope: 'sui', group: 'On-chain', name: 'Sui CLMM pool adapters', provider: 'Cetus / Turbos / Momentum', endpoint: 'Sui RPC + public pool APIs', type: 'REST / RPC', access: 'mixed', cadence: '15s', powers: 'LP range and same-chain DEX spread monitors', test: null },
    { id: 'lst', scope: 'sui', group: 'On-chain', name: 'Sui LST and vault feeds', provider: 'SpringSui / Haedal / Volo / AlphaFi', endpoint: 'Sui RPC + protocol APIs', type: 'REST / RPC', access: 'mixed', cadence: '60s', powers: 'Liquid staking, vault and idle-yield monitors', test: null },
    { id: 'cdp-rwa', scope: 'sui', group: 'On-chain', name: 'Sui CDP and RWA feeds', provider: 'Bucket / Ondo / KAIO / Ember', endpoint: 'Sui RPC + protocol APIs', type: 'REST / RPC', access: 'mixed', cadence: '60s', powers: 'CDP, peg-risk, RWA and capital allocator monitors', test: null },
    { id: 'bluefin', scope: 'sui', group: 'Derivatives', name: 'Bluefin funding rates', provider: 'Bluefin', endpoint: 'public Sui funding endpoint', type: 'REST / WS', access: 'mixed', cadence: '5s', powers: 'Sui perp hedge monitor', test: null },
    { id: 'perps-extra', scope: 'sui', group: 'Derivatives', name: 'Sui-native perps watch feeds', provider: 'Bluefin / Sudo / DipCoin', endpoint: 'public perps endpoints', type: 'REST / WS', access: 'mixed', cadence: '5s', powers: 'Funding, liquidation and venue-risk watchtower', test: null },
    { id: 'signer', scope: 'sui', group: 'Execution', name: 'Sui agent signer / executor', provider: 'zkLogin + Cloudflare', endpoint: 'durable object + Sui signer', type: 'internal', access: 'proxy', cadence: 'on demand', powers: 'Policy execution and gas sponsor', test: null },
  ]

  RG.runtimes = {
    cloud: {
      mode: 'cloud',
      label: 'Cloud agent',
      icon: 'cloud',
      status: 'online',
      host: 'Cloudflare Worker + Durable Object',
      region: 'auto / nearest edge',
      uptime: '14d 06h',
      llm: 'Claude / server-side',
      heartbeat: '2s ago',
      loopMs: 850,
      tick: 'every 8s',
      watching: 3,
      gas: { station: 'RescueGrid Gas Station', bal: 4.81, unit: 'SUI' },
      privacy: 'Decision logic runs on our edge; only signed Sui transactions hit chain.',
      tags: ['always-on', 'zero-setup', 'sponsored gas'],
      health: [
        { k: 'Worker', v: 'healthy', ok: true },
        { k: 'Durable Object', v: 'persistent state synced', ok: true },
        { k: 'RPC connection', v: 'fullnode.testnet, 41ms', ok: true },
        { k: 'Signer (zkLogin)', v: 'epoch 612, about 36h left', ok: true },
      ],
      log: [
        { t: '14:39:58', d: 'Heartbeat, 3 Sui policies evaluated, no action' },
        { t: '14:31:50', d: 'Risk re-evaluated, SUI vol up, within policy' },
        { t: '14:20:11', d: 'DeepBook SUI/USDC book checked, trigger not met' },
      ],
    },
    local: {
      mode: 'local',
      label: 'Local agent',
      icon: 'cpu',
      status: 'offline',
      host: 'Your machine / daemon',
      region: 'localhost:8787',
      uptime: '-',
      llm: 'Ollama / Claude Desktop / BYO',
      heartbeat: 'never',
      loopMs: null,
      tick: 'every 8s',
      watching: 0,
      gas: { station: 'RescueGrid Gas Station', bal: 4.81, unit: 'SUI' },
      privacy: 'Decision logic never leaves your machine.',
      tags: ['private', 'BYO LLM', 'self-hosted'],
      health: [
        { k: 'Daemon process', v: 'not running', ok: false },
        { k: 'Local LLM', v: 'no endpoint detected', ok: false },
        { k: 'RPC connection', v: 'would use your Sui RPC', ok: null },
        { k: 'Signer (zkLogin)', v: 'shared session key', ok: true },
      ],
      log: [
        { t: '-', d: 'Daemon offline, cloud is currently handling Sui policies' },
        { t: 'setup', d: 'Run: npx rescuegrid-agent --local to start the daemon' },
      ],
    },
  }

  RG.guardianRules = [
    { id: 'slip', label: 'Max slippage', kind: 'pct', val: 1.2, min: 0.2, max: 3, step: 0.1, on: true, desc: 'Abort an order if expected slippage exceeds this.' },
    { id: 'liq', label: 'Min pool liquidity', kind: 'usd', val: 250000, min: 50000, max: 1000000, step: 50000, on: true, desc: 'Skip Sui venues thinner than this depth.' },
    { id: 'lev', label: 'Max leverage', kind: 'x', val: 4, min: 1, max: 10, step: 0.5, on: true, desc: 'Cap notional on the Bluefin hedge leg.' },
    { id: 'buffer', label: 'Min liq. buffer', kind: 'pct', val: 15, min: 5, max: 50, step: 1, on: true, desc: 'Deleverage before margin gets this close to liquidation.' },
    { id: 'depeg', label: 'Pause on stable depeg', kind: 'pct', val: 0.5, min: 0.1, max: 3, step: 0.1, on: true, desc: 'Halt if a stablecoin drifts past this from $1.' },
    { id: 'oracle', label: 'Max oracle staleness', kind: 'sec', val: 10, min: 2, max: 60, step: 1, on: false, desc: 'Block execution if the price feed is older than this.' },
  ]
  RG.simScenarios = [
    { id: 'crash', label: 'SUI -15% flash crash', hits: { slip: 'trigger', liq: 'trigger', buffer: 'block', lev: 'pass', depeg: 'pass', oracle: 'pass' } },
    { id: 'depeg', label: 'USDC depeg to $0.97', hits: { depeg: 'block', slip: 'trigger', liq: 'pass', lev: 'pass', buffer: 'pass', oracle: 'pass' } },
    { id: 'thin', label: 'Liquidity drains 80%', hits: { liq: 'block', slip: 'trigger', lev: 'pass', buffer: 'pass', depeg: 'pass', oracle: 'pass' } },
    { id: 'oracle', label: 'Oracle feed stalls 30s', hits: { oracle: 'block', slip: 'pass', liq: 'pass', lev: 'pass', buffer: 'pass', depeg: 'pass' } },
    { id: 'calm', label: 'Normal market conditions', hits: { slip: 'pass', liq: 'pass', lev: 'pass', buffer: 'pass', depeg: 'pass', oracle: 'pass' } },
  ]
  RG.guardianPresets = [
    { id: 'conservative', name: 'Conservative', desc: 'Tight limits, capital preservation first.', vals: { slip: 0.4, liq: 500000, lev: 2, buffer: 30, depeg: 0.3, oracle: 8 }, on: { slip: true, liq: true, lev: true, buffer: true, depeg: true, oracle: true } },
    { id: 'balanced', name: 'Balanced', desc: 'Default posture, sensible risk/return.', vals: { slip: 1.2, liq: 250000, lev: 4, buffer: 15, depeg: 0.5, oracle: 10 }, on: { slip: true, liq: true, lev: true, buffer: true, depeg: true, oracle: false } },
    { id: 'aggressive', name: 'Aggressive', desc: 'Loose limits, chase edge and accept more risk.', vals: { slip: 2.5, liq: 100000, lev: 8, buffer: 8, depeg: 1.5, oracle: 30 }, on: { slip: true, liq: false, lev: true, buffer: true, depeg: false, oracle: false } },
  ]
}
