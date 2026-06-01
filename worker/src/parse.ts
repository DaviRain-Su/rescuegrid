// E2 — natural-language intent -> structured risk_response strategy.
// MVP supports only strategy_type "risk_response" (docs §5). Template/keyword
// parser: extract asset, drop-threshold and budget; everything else from config
// + defaults. Off-chain Guardian warnings here are advisory; the chain enforces.
import { strategyHash } from './strategy-core.js'
import {
  AGENT_ADDRESS, BUDGET_COIN_TYPE, BUDGET_COIN_DECIMALS, CHAIN, CONFIG,
  DEFAULT_MAX_SLIPPAGE_BPS, DEFAULT_POOL_ID, MAX_ALLOWED_SLIPPAGE_BPS,
  MAX_POLICY_LIFETIME_SECONDS,
} from './config.js'
import type { ParseDefaults, ParseResult, Strategy, GuardianWarning } from './types.js'

const POOL_BY_ASSET: Record<string, { pool_id: string; quote_decimals: number }> = {
  SUI: CONFIG.deepbook.pools.SUI_DBUSDC,
  DEEP: CONFIG.deepbook.pools.DEEP_DBUSDC,
  WAL: CONFIG.deepbook.pools.WAL_DBUSDC,
}

function pow10(n: number): bigint {
  let r = 1n
  for (let i = 0; i < n; i++) r *= 10n
  return r
}

/** "500", "500.5" USDC -> smallest-unit decimal string. */
function toUnits(human: number, decimals: number): string {
  // avoid float drift: split int/frac
  const [intPart, fracPart = ''] = String(human).split('.')
  const frac = (fracPart + '0'.repeat(decimals)).slice(0, decimals)
  return (BigInt(intPart) * pow10(decimals) + BigInt(frac || '0')).toString()
}

function fromUnits(units: string, decimals: number): string {
  const v = BigInt(units)
  const d = pow10(decimals)
  const whole = v / d
  const frac = (v % d).toString().padStart(decimals, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : `${whole}`
}

export function parseIntent(
  text: string,
  owner: string,
  defaults: ParseDefaults = {},
  nowMs: number = Date.now(),
): ParseResult {
  const t = text.trim()
  if (!t) return { status: 'error', code: 'INTENT_AMBIGUOUS', message: 'Empty intent.' }

  // asset (default SUI)
  const assetMatch = t.match(/\b(SUI|DEEP|WAL)\b/i)
  const asset = (assetMatch?.[1] || 'SUI').toUpperCase()
  const poolCfg = POOL_BY_ASSET[asset]
  if (!poolCfg) {
    return { status: 'error', code: 'UNSUPPORTED_ASSET', message: `Asset ${asset} has no supported Deepbook pool on testnet.` }
  }

  // drop threshold: "8%", "8 %", "more than 8 percent"
  const thMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/i)
  if (!thMatch) {
    return { status: 'error', code: 'INTENT_AMBIGUOUS', message: 'Trigger threshold is missing — say e.g. "drops more than 8%".' }
  }
  const threshold_pct = thMatch[1]

  // budget: "500 USDC", "500 usdc", "$500"
  const budgetMatch = t.match(/(?:\$\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:USDC|usdc)?\b/g)
  const budgetNum = (() => {
    const m = t.match(/(\d[\d,]*(?:\.\d+)?)\s*USDC/i) || t.match(/\$\s*(\d[\d,]*(?:\.\d+)?)/)
    return m ? Number(m[1].replace(/,/g, '')) : NaN
  })()
  void budgetMatch
  if (!Number.isFinite(budgetNum) || budgetNum <= 0) {
    return { status: 'error', code: 'INTENT_AMBIGUOUS', message: 'Budget is missing — say e.g. "a 500 USDC rescue grid".' }
  }

  const budget_ceiling = toUnits(budgetNum, BUDGET_COIN_DECIMALS)
  // per-rung / per-trade cap: 1/5 of budget (5-rung grid), min 1 unit
  const perTrade = (BigInt(budget_ceiling) / 5n) || 1n
  const max_single_trade_amount = perTrade.toString()

  const max_slippage_bps = Math.min(
    defaults.max_slippage_bps ?? DEFAULT_MAX_SLIPPAGE_BPS,
    MAX_ALLOWED_SLIPPAGE_BPS,
  )

  const lifetimeS = Math.min(defaults.expires_in_seconds ?? 86400, MAX_POLICY_LIFETIME_SECONDS)
  const expires_at_ms = nowMs + lifetimeS * 1000

  const strategy: Strategy = {
    version: '1',
    strategy_type: 'risk_response',
    owner,
    agent: AGENT_ADDRESS,
    chain: CHAIN,
    pool_id: defaults.pool_id ?? poolCfg.pool_id ?? DEFAULT_POOL_ID,
    budget_coin_type: BUDGET_COIN_TYPE,
    budget_ceiling,
    trigger: { metric: 'price_drop_pct', asset, threshold_pct },
    execution: { order_type: 'market_or_ioc', max_slippage_bps, max_single_trade_amount },
    expires_at_ms,
  }

  const guardian_warnings = staticGuardian(strategy, budgetNum)
  const ptb_preview = buildPreview(strategy, budgetNum)

  return {
    status: 'ok',
    strategy,
    strategy_hash: strategyHash(strategy),
    agent_address: AGENT_ADDRESS,
    guardian_warnings,
    ptb_preview,
  }
}

function staticGuardian(s: Strategy, budgetHuman: number): GuardianWarning[] {
  const out: GuardianWarning[] = [
    { code: 1, level: 'pass', label: 'Slippage bound', detail: `Capped at ${(s.execution.max_slippage_bps / 100).toFixed(2)}% on-chain.` },
    { code: 2, level: 'pass', label: 'Budget ceiling', detail: `Policy hard-caps spend at ${budgetHuman} USDC on-chain.` },
  ]
  if (budgetHuman >= 1000) {
    out.push({ code: 6, level: 'warn', label: 'Capital concentration', detail: 'Large budget routes to a single pair — consider splitting scope.' })
  }
  return out
}

function buildPreview(s: Strategy, budgetHuman: number): string[] {
  return [
    `Create MoveGate Mandate and RescuePolicyWrapper for owner ${s.owner}`,
    `Allow agent ${s.agent} to trade only pool ${s.pool_id}`,
    `Set budget ceiling to ${budgetHuman} ${budgetSymbol()}`,
    `Set max slippage to ${(s.execution.max_slippage_bps / 100).toFixed(2)}%`,
    `Trigger when ${s.trigger.asset} drops ≥ ${s.trigger.threshold_pct}% (Pyth)`,
    `Expire policy at ${new Date(s.expires_at_ms).toISOString()}`,
  ]
}

function budgetSymbol(): string { return 'USDC' }

export { fromUnits, toUnits }
