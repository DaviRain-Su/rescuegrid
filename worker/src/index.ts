// RescueGrid API Worker (Cloudflare Workers + Hono).
// E2/E3/E4/E5/E7 are wired for the Sui-first MVP: parse, build policy tx,
// chain-authoritative reads, Durable Object runtime, and gated agent ticks.
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { parseIntent } from './parse.js'
import { strategyHash } from './strategy-core.js'
import { buildCreatePolicyTx, buildRevokeTx } from './sui-tx.js'
import { requireChainDataProvider } from './chain-data-provider.js'
import { DEPLOYMENT } from './sui-tx.js'
import { getSuiProtocolCoverage } from './sui-protocol-registry.js'
import { runTick, validateExecutionPlan } from './tick.js'
import { validateForceTrigger, validateTickAuthorization, validateTickBody } from './tick-auth.js'
import { buildFundingReadiness, parseIntentWithStability, resolveFundingThresholds } from './read-surfaces.js'
import {
  appendRuntimeActivity,
  runtimeErrorEvent,
  runtimeEventFromTickResult,
  runtimeEventToFeedItem,
  mergeActivityItems,
  shortWrapperId,
} from './runtime-activity.js'
import { AGENT_ADDRESS, DEFAULT_TICK_INTERVAL_SECONDS, MAX_ACTIVE_POLICIES_PER_DEPLOYMENT } from './config.js'
import { getExecutorAdapter, unsupportedExecutor, unsupportedExecutorTarget } from './executor-adapters.js'
import { activationPolicyPreflight, reconcilePolicyListRuntimeState, reconcilePolicyRuntimeState, revokePolicyPreflight } from './policy-api.js'
import type { ParseDefaults, Strategy } from './types.js'

export interface Env {
  AGENT_RUNTIME: DurableObjectNamespace
  // secrets (wrangler secret / .dev.vars): OWNER_KEY, AGENT_KEY, INTERNAL_AGENT_TICK_TOKEN
  OWNER_KEY?: string
  AGENT_KEY?: string
  INTERNAL_AGENT_TICK_TOKEN?: string
  RESCUEGRID_DEMO_MODE?: string
  EXECUTION_ENABLED?: string
  REQUIRED_DBUSDC_BALANCE?: string
  REQUIRED_DEEP_BALANCE?: string
  REQUIRED_AGENT_SUI_GAS_MIST?: string
  CHAIN_DATA_PROVIDER?: string
  RESCUEGRID_CHAIN_DATA_PROVIDER?: string
}

const app = new Hono<{ Bindings: Env }>()
const PARSE_CACHE_MAX_ENTRIES = 200
const parseCache = new Map<string, Record<string, unknown>>()
function chainDataProvider(env: Env): any {
  return requireChainDataProvider(env) as any
}

function setParseCache(key: string, value: Record<string, unknown>) {
  if (parseCache.size >= PARSE_CACHE_MAX_ENTRIES) {
    const firstKey = parseCache.keys().next().value
    if (firstKey !== undefined) parseCache.delete(firstKey)
  }
  parseCache.set(key, value)
}

async function fetchRuntimeJson(env: Env, wrapperId: string, path: string): Promise<Record<string, any> | null> {
  try {
    const stub = env.AGENT_RUNTIME.get(env.AGENT_RUNTIME.idFromName(wrapperId))
    const res = await stub.fetch(`https://do${path}`)
    if (!res.ok) return null
    return await res.json<Record<string, any>>()
  } catch {
    return null
  }
}

async function readRuntimeState(env: Env, wrapperId: string): Promise<Record<string, any> | null> {
  return fetchRuntimeJson(env, wrapperId, '/state')
}

async function readRuntimeActivity(env: Env, wrapperId: string): Promise<Record<string, any>[]> {
  const body = await fetchRuntimeJson(env, wrapperId, '/activity')
  const activity = body?.runtime_activity
  return Array.isArray(activity) ? activity : []
}

async function runtimeFeedForWrappers(env: Env, wrapperIds: string[]): Promise<Record<string, any>[]> {
  const perPolicy = await Promise.all(wrapperIds.map(async (wrapperId) => {
    const activity = await readRuntimeActivity(env, wrapperId)
    const label = shortWrapperId(wrapperId)
    return activity.map((event) => runtimeEventToFeedItem(event, label))
  }))
  return perPolicy.flat()
}

app.use('/api/*', cors())
app.use('/api/*', bodyLimit({ maxSize: 50 * 1024 }))

app.get('/', (c) => c.json({ service: 'rescuegrid-worker', agent: AGENT_ADDRESS, status: 'ok' }))

// ── E2: parse natural-language intent into a structured strategy ──────────
app.post('/api/intents/parse', async (c) => {
  let body: { owner?: string; text?: string; defaults?: ParseDefaults }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400)
  }
  if (!body || typeof body !== 'object') {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'JSON body must be an object.' }, 400)
  }
  if (!body.owner || !/^0x[0-9a-fA-F]+$/.test(body.owner) || !body.text || typeof body.text !== 'string') {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'owner and text are required.' }, 400)
  }
  const boundedCache = {
    get: (k: string) => parseCache.get(k),
    set: (k: string, v: Record<string, unknown>) => setParseCache(k, v),
  }
  const result = parseIntentWithStability(parseIntent, boundedCache, body)
  return c.json(result, result.status === 'ok' ? 200 : 422)
})

// ── E3: build the create_policy PTB for the frontend (zkLogin) to sign ────
// Returns the serialized unsigned transaction; the owner's zkLogin signer adds
// gas and signs + executes. The Worker never holds the owner key.
app.post('/api/policies', async (c) => {
  let body: { owner?: string; strategy?: Strategy; strategy_hash?: string; confirmed?: boolean }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400)
  }
  const { owner, strategy, strategy_hash, confirmed } = body
  if (!confirmed) return c.json({ status: 'error', code: 'CONFIRM_REQUIRED', message: 'confirmed must be true.' }, 400)
  if (!owner || !strategy) return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'owner and strategy required.' }, 400)
  if (strategy.owner !== owner) return c.json({ status: 'error', code: 'OWNER_MISMATCH', message: 'strategy.owner != owner.' }, 422)
  if (strategy.agent !== AGENT_ADDRESS) return c.json({ status: 'error', code: 'AGENT_MISMATCH', message: 'strategy.agent != deployment agent.' }, 422)
  if (!getExecutorAdapter(strategy.executor_kind)) {
    return c.json({ status: 'error', code: 'UNSUPPORTED_EXECUTOR', message: unsupportedExecutor(strategy.executor_kind).detail }, 422)
  }
  const adapter = getExecutorAdapter(strategy.executor_kind)
  if (adapter && !adapter.supportsTarget(strategy.pool_id)) {
    return c.json({ status: 'error', code: 'UNSUPPORTED_EXECUTOR_TARGET', message: unsupportedExecutorTarget(strategy.executor_kind, strategy.pool_id).detail }, 422)
  }

  // recompute hash from the canonical strategy (no strategy_hash field inside)
  const recomputed = strategyHash(strategy)
  if (strategy_hash && strategy_hash !== recomputed) {
    return c.json({ status: 'error', code: 'HASH_MISMATCH', message: 'strategy_hash does not match server recomputation.' }, 422)
  }

  let activePolicyLimit
  try {
    const chainData = chainDataProvider(c.env)
    activePolicyLimit = await chainData.countActivePoliciesByDeployment({
      limit: MAX_ACTIVE_POLICIES_PER_DEPLOYMENT,
    })
  } catch (e) {
    return c.json({ status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) }, 502)
  }
  if (activePolicyLimit.limit_reached) {
    return c.json({
      status: 'error',
      code: 'ACTIVE_POLICY_LIMIT_REACHED',
      message: `Deployment already has ${activePolicyLimit.active} active policies; max is ${activePolicyLimit.limit}.`,
      active_policy_count: activePolicyLimit.active,
      max_active_policies: activePolicyLimit.limit,
      scanned_policies: activePolicyLimit.scanned,
      pages_scanned: activePolicyLimit.pages_scanned,
    }, 409)
  }

  const tx = buildCreatePolicyTx({ strategy: { ...strategy, strategy_hash: recomputed }, ownerAddress: owner })
  return c.json({
    status: 'ok',
    tx_json: tx.serialize(),
    strategy_hash: recomputed,
    agent_address: AGENT_ADDRESS,
    active_policy_count: activePolicyLimit.active,
    max_active_policies: activePolicyLimit.limit,
    sign_with: 'owner signer (frontend wallet or scripted Testnet validation key); read PolicyCreated for wrapper_id',
  })
})

// ── E4: aggregated activity (chain-authoritative) ─────────────────────────
app.get('/api/policies/:wrapper_id/activity', async (c) => {
  const wrapperId = c.req.param('wrapper_id')
  if (!/^0x[0-9a-fA-F]+$/.test(wrapperId)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid wrapper id.' }, 400)
  }
  try {
    const chainData = chainDataProvider(c.env)
    const result = await chainData.getActivity(wrapperId)
    if (result.status !== 'ok') return c.json(result, 404)

    // E8: reconcile Durable Object runtime state with chain. Chain wins.
    const runtimeState = await readRuntimeState(c.env, wrapperId)
    const runtimeActivity = await readRuntimeActivity(c.env, wrapperId)
    const p = reconcilePolicyRuntimeState(result.policy as Record<string, any>, runtimeState)
    const policyLabel = shortWrapperId(wrapperId)
    const chainActivity = chainData.policyEventsToFeedItems(result.events, policyLabel)
    const runtimeFeed = runtimeActivity.map((event) => runtimeEventToFeedItem(event, policyLabel))

    return c.json({
      ...result,
      policy: p,
      runtime: runtimeState,
      runtime_activity: runtimeActivity,
      chain_activity: chainActivity,
      activity: mergeActivityItems(runtimeFeed, chainActivity),
    }, 200)
  } catch (e) {
    return c.json({ status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) }, 502)
  }
})

// ── list policies for an owner (from PolicyCreated events) ────────────────
app.get('/api/policies', async (c) => {
  const owner = c.req.query('owner')
  if (!owner || !/^0x[0-9a-fA-F]+$/.test(owner)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'owner query param required.' }, 400)
  }
  try {
    const chainData = chainDataProvider(c.env)
    const policies = await chainData.listPoliciesByOwner(owner)
    const runtimePairs: [string | null, Record<string, any> | null][] = await Promise.all(policies.map(async (policy: any) => {
      const runtime = policy.wrapper_id ? await readRuntimeState(c.env, policy.wrapper_id) : null
      return [policy.wrapper_id ?? null, runtime] as [string | null, Record<string, any> | null]
    }))
    const runtimeByWrapperId = Object.fromEntries(runtimePairs.filter(([wrapperId]) => Boolean(wrapperId)))
    return c.json({ status: 'ok', policies: reconcilePolicyListRuntimeState(policies, runtimeByWrapperId) })
  } catch (e) {
    return c.json({ status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) }, 502)
  }
})

// ── live dashboard: real portfolio summary + market snapshot ──────────────
app.get('/api/summary', async (c) => {
  const owner = c.req.query('owner')
  if (!owner || !/^0x[0-9a-fA-F]+$/.test(owner)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'owner query param required.' }, 400)
  }
  try {
    const chainData = chainDataProvider(c.env)
    return c.json({ status: 'ok', summary: await chainData.getOwnerSummary(owner) })
  } catch (e) {
    return c.json({ status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) }, 502)
  }
})

app.get('/api/market', async (c) => {
  try {
    const chainData = chainDataProvider(c.env)
    return c.json({ status: 'ok', market: await chainData.getMarket() })
  } catch (e) {
    return c.json({ status: 'error', code: 'MARKET_READ_FAILED', message: String((e as Error).message) }, 502)
  }
})

app.get('/api/protocols', (c) => {
  const includeDisplayOnly = c.req.query('include_display_only') !== 'false'
  return c.json(getSuiProtocolCoverage({ includeDisplayOnly }))
})

app.get('/api/balances', async (c) => {
  const owner = c.req.query('owner')
  if (!owner || !/^0x[0-9a-fA-F]+$/.test(owner)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'owner query param required.' }, 400)
  }
  try {
    const chainData = chainDataProvider(c.env)
    const [holdings, dbusdcBalance, deepBalance, suiBalance] = await Promise.all([
      chainData.getBalances(owner),
      chainData.readBalanceManagerBalance(DEPLOYMENT.deepbook.dbusdc_coin_type),
      chainData.readBalanceManagerBalance(DEPLOYMENT.deepbook.deep_coin_type),
      chainData.getAgentSuiGasBalance(DEPLOYMENT.agent.address),
    ])
    const thresholds = resolveFundingThresholds({
      configured: {
        DBUSDC: c.env.REQUIRED_DBUSDC_BALANCE,
        DEEP: c.env.REQUIRED_DEEP_BALANCE,
        SUI_MIST: c.env.REQUIRED_AGENT_SUI_GAS_MIST,
      },
      requested: {
        DBUSDC: c.req.query('dbusdc_threshold'),
        DEEP: c.req.query('deep_threshold'),
        SUI_MIST: c.req.query('sui_gas_threshold'),
      },
    }) as Record<string, { required: string; configured: string; requested: string | null; source: string }>
    const funding = buildFundingReadiness({
      agentAddress: DEPLOYMENT.agent.address,
      balanceManagerId: DEPLOYMENT.agent.balance_manager_id,
      dbusdcBalance: dbusdcBalance.toString(),
      deepBalance: deepBalance.toString(),
      suiBalanceMist: String(suiBalance.totalBalance ?? '0'),
      executionEnabled: c.env.EXECUTION_ENABLED === 'true',
      requiredDbusdcBalance: thresholds.DBUSDC.required,
      requiredDeepBalance: thresholds.DEEP.required,
      requiredSuiGasMist: thresholds.SUI_MIST.required,
      thresholdMetadata: thresholds,
    })
    return c.json({
      status: 'ok',
      owner,
      holdings,
      agent: { address: DEPLOYMENT.agent.address, balance_manager_id: DEPLOYMENT.agent.balance_manager_id },
      balance_manager: {
        id: DEPLOYMENT.agent.balance_manager_id,
        holder: 'agent_balance_manager',
        balances: { DBUSDC: funding.balances.DBUSDC, DEEP: funding.balances.DEEP },
      },
      sui_gas: { holder: DEPLOYMENT.agent.address, balance_mist: funding.balances.SUI_MIST },
      funding,
      readiness_state: funding.readiness_state,
      ready: funding.ready,
      blockers: funding.blockers,
      blocker_labels: funding.blocker_labels,
      blocker_codes: funding.blocker_codes,
    })
  } catch (e) {
    return c.json({ status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) }, 502)
  }
})

// ── D4: owner activity feed (merged on-chain policy events) ───────────────
app.get('/api/activity', async (c) => {
  const owner = c.req.query('owner')
  if (!owner || !/^0x[0-9a-fA-F]+$/.test(owner)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'owner query param required.' }, 400)
  }
  try {
    const chainData = chainDataProvider(c.env)
    const chainActivity = await chainData.listActivityByOwner(owner)
    const policies = await chainData.listPoliciesByOwner(owner)
    const runtimeActivity = await runtimeFeedForWrappers(c.env, policies.map((p: any) => p.wrapper_id).filter(Boolean))
    return c.json({
      status: 'ok',
      activity: mergeActivityItems(runtimeActivity, chainActivity).slice(0, 100),
      sources: {
        chain_events: chainActivity.length,
        runtime_events: runtimeActivity.length,
      },
    })
  } catch (e) {
    return c.json({ status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) }, 502)
  }
})

// ── D5: build the owner-signed revoke tx (frontend zkLogin signs) ─────────
app.post('/api/policies/:wrapper_id/revoke', async (c) => {
  const wrapperId = c.req.param('wrapper_id')
  if (!/^0x[0-9a-fA-F]+$/.test(wrapperId)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid wrapper id.' }, 400)
  }
  let body: { owner?: string; confirmed?: boolean }
  try { body = await c.req.json() } catch { return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON.' }, 400) }
  if (!body.confirmed) return c.json({ status: 'error', code: 'CONFIRM_REQUIRED', message: 'confirmed must be true.' }, 400)
  try {
    const chainData = chainDataProvider(c.env)
    const wrapper = await chainData.readWrapper(wrapperId)
    const mandate = wrapper ? await chainData.readMandate(wrapper.mandate_id) : null
    const preflight = revokePolicyPreflight({ wrapper, mandate, owner: body.owner })
    if (!preflight.ok) return c.json(preflight.body, preflight.status as 400)
    const liveWrapper = wrapper!
    const tx = buildRevokeTx({ wrapperId, mandateId: liveWrapper.mandate_id, ownerAddress: liveWrapper.owner })
    return c.json({ status: 'ok', tx_json: tx.serialize(), wrapper_id: wrapperId, mandate_id: liveWrapper.mandate_id, sign_with: 'owner signer (frontend wallet or scripted Testnet validation key)' })
  } catch (e) {
    return c.json({ status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) }, 502)
  }
})

// ── activate a policy's Durable Object runtime (called after the frontend
//    executes the create_policy tx) ────────────────────────────────────────
app.post('/api/policies/:wrapper_id/activate', async (c) => {
  const wrapperId = c.req.param('wrapper_id')
  if (!/^0x[0-9a-fA-F]+$/.test(wrapperId)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid wrapper id.' }, 400)
  }
  // Optional strategy lets the runtime evaluate the real price-drop trigger
  // (threshold_pct + asset). It is not on-chain — only its hash is — so the
  // owner hands it to the runtime here.
  let body: { strategy?: Strategy } = {}
  try { body = await c.req.json() } catch { /* activate may carry no body */ }
  try {
    const chainData = chainDataProvider(c.env)
    const wrapper = await chainData.readWrapper(wrapperId)
    const mandate = wrapper ? await chainData.readMandate(wrapper.mandate_id) : null
    const preflight = activationPolicyPreflight({ wrapper, mandate, strategy: body.strategy ?? null })
    if (!preflight.ok) return c.json(preflight.body, preflight.status as 400)
  } catch (e) {
    return c.json({ status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) }, 502)
  }
  const stub = c.env.AGENT_RUNTIME.get(c.env.AGENT_RUNTIME.idFromName(wrapperId))
  const res = await stub.fetch('https://do/activate', {
    method: 'POST',
    body: JSON.stringify({ wrapperId, strategy: body.strategy ?? null }),
  })
  return c.json(await res.json(), res.status as 200)
})

// ── agent runtime state (observability): the Durable Object's live view —
//    runtime_state, last action/tick, and the price-drop monitor (last price,
//    running peak, drawdown, trigger). Does not touch chain. ────────────────
app.get('/api/policies/:wrapper_id/runtime', async (c) => {
  const wrapperId = c.req.param('wrapper_id')
  if (!/^0x[0-9a-fA-F]+$/.test(wrapperId)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid wrapper id.' }, 400)
  }
  const stub = c.env.AGENT_RUNTIME.get(c.env.AGENT_RUNTIME.idFromName(wrapperId))
  const res = await stub.fetch('https://do/state')
  return c.json(await res.json(), res.status as 200)
})

// ── E7 safety preflight: non-mutating, chain-backed execution-plan validation ─
app.post('/api/execution/validate-plan', async (c) => {
  let body: {
    wrapper_id?: string
    mandate_id?: string
    executor_kind?: string
    proposed?: {
      pool_id?: string
      amount?: string | number
      estimated_slippage_bps?: number
      agent_id?: string
    }
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400)
  }
  if (!body.wrapper_id || !/^0x[0-9a-fA-F]+$/.test(body.wrapper_id)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Valid wrapper_id required.' }, 400)
  }
  if (body.mandate_id && !/^0x[0-9a-fA-F]+$/.test(body.mandate_id)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid mandate_id.' }, 400)
  }
  const proposed = body.proposed ?? {}
  if (!proposed.pool_id || !/^0x[0-9a-fA-F]+$/.test(proposed.pool_id)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Valid proposed.pool_id required.' }, 400)
  }
  const amount = String(proposed.amount ?? '')
  if (!/^\d+$/.test(amount)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Valid proposed.amount required.' }, 400)
  }
  const slippage = Number(proposed.estimated_slippage_bps)
  if (!Number.isSafeInteger(slippage) || slippage < 0) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Valid proposed.estimated_slippage_bps required.' }, 400)
  }
  if (proposed.agent_id && !/^0x[0-9a-fA-F]+$/.test(proposed.agent_id)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid proposed.agent_id.' }, 400)
  }

  const result = await validateExecutionPlan(chainDataProvider(c.env), {
    wrapperId: body.wrapper_id,
    mandateId: body.mandate_id,
    proposed: {
      pool_id: proposed.pool_id,
      amount,
      estimated_slippage_bps: slippage,
      agent_id: proposed.agent_id,
    },
    expectedAgentId: DEPLOYMENT.agent.address,
    executorKind: body.executor_kind || 'deepbook',
  })
  return c.json({ status: 'ok', ...result })
})

// ── E7: internal agent tick (token-gated; force_trigger only in demo mode) ─
app.post('/api/agent/tick', async (c) => {
  const auth = c.req.header('Authorization')
  const expected = c.env.INTERNAL_AGENT_TICK_TOKEN
  const authResult = validateTickAuthorization({ authorizationHeader: auth, expectedToken: expected })
  if (!authResult.ok) return c.json(authResult.body, authResult.status as 401)
  let body: { wrapper_id?: string; force_trigger?: boolean }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400)
  }
  const bodyResult = validateTickBody({ wrapperId: body.wrapper_id })
  if (!bodyResult.ok) return c.json(bodyResult.body, bodyResult.status as 400)
  const forceResult = validateForceTrigger({ forceTriggerRequested: body.force_trigger === true, demoMode: c.env.RESCUEGRID_DEMO_MODE })
  if (!forceResult.ok) return c.json(forceResult.body, forceResult.status as 403)
  const result = await runTick(c.env, { wrapperId: bodyResult.wrapperId, forceTrigger: forceResult.forceTrigger })
  return c.json({ status: 'ok', ...result })
})

export default app

// ── E5: Durable Object agent runtime — one instance per policy (idFromName =
//    wrapper_id). Persists runtime state and self-schedules ticks via alarms.
//    Chain state stays authoritative (E8): stopped_* halts the loop. ────────
export class AgentRuntime {
  state: DurableObjectState
  env: Env
  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/activate' && req.method === 'POST') {
      const { wrapperId, strategy } = await req.json<{ wrapperId: string; strategy?: any }>()
      await this.state.storage.put('wrapperId', wrapperId)
      await this.state.storage.put('runtime_state', 'Monitoring')
      await this.state.storage.put('errorCount', 0)
      await this.state.storage.put('executorKind', strategy?.executor_kind || 'deepbook')
      if (strategy?.trigger) {
        await this.state.storage.put('monitor', {
          threshold_pct: Number(strategy.trigger.threshold_pct) || 0,
          asset: strategy.trigger.asset || 'SUI',
        })
      }
      const activity = (await this.state.storage.get<Record<string, any>[]>('runtimeActivity')) ?? []
      await this.state.storage.put('runtimeActivity', appendRuntimeActivity(activity, runtimeEventFromTickResult({
        action: 'activated',
        detail: 'Durable Object runtime activated and alarm tick scheduled.',
        execution_claimed: false,
      }, { wrapperId })))
      await this.state.storage.setAlarm(Date.now() + DEFAULT_TICK_INTERVAL_SECONDS * 1000)
      return this.json({ status: 'ok', wrapper_id: wrapperId, runtime_state: 'Monitoring' })
    }
    if (url.pathname === '/state') {
      return this.json({
        status: 'ok',
        wrapper_id: (await this.state.storage.get('wrapperId')) ?? null,
        runtime_state: (await this.state.storage.get('runtime_state')) ?? 'Inactive',
        last_tick_ms: (await this.state.storage.get('lastTickMs')) ?? null,
        last_action: (await this.state.storage.get('lastAction')) ?? null,
        error_count: (await this.state.storage.get('errorCount')) ?? 0,
        monitor: (await this.state.storage.get('monitor')) ?? null,
        executor_kind: (await this.state.storage.get('executorKind')) ?? 'deepbook',
        last_price: (await this.state.storage.get('lastPrice')) ?? null,
        peak_price: (await this.state.storage.get('peakPrice')) ?? null,
        drawdown_pct: (await this.state.storage.get('drawdownPct')) ?? null,
        trigger_met: (await this.state.storage.get('triggerMet')) ?? false,
        activity_count: ((await this.state.storage.get<Record<string, any>[]>('runtimeActivity')) ?? []).length,
        last_error: (await this.state.storage.get('lastError')) ?? null,
      })
    }
    if (url.pathname === '/activity') {
      return this.json({
        status: 'ok',
        wrapper_id: (await this.state.storage.get('wrapperId')) ?? null,
        runtime_activity: (await this.state.storage.get<Record<string, any>[]>('runtimeActivity')) ?? [],
      })
    }
    if (url.pathname === '/tick' && req.method === 'POST') {
      return this.json(await this.tickOnce())
    }
    return this.json({ status: 'error', code: 'NOT_FOUND' }, 404)
  }

  async alarm(): Promise<void> {
    let terminal = false
    try {
      const result = await this.tickOnce()
      terminal = result.action === 'stopped_revoked' || result.action === 'stopped_expired'
    } catch (e) {
      const n = ((await this.state.storage.get<number>('errorCount')) ?? 0) + 1
      await this.state.storage.put('errorCount', n)
      await this.state.storage.put('lastAction', 'error')
      await this.state.storage.put('lastError', String((e as Error).message || e))
      await this.state.storage.put('lastTickMs', Date.now())
      const wrapperId = (await this.state.storage.get<string>('wrapperId')) ?? null
      const activity = (await this.state.storage.get<Record<string, any>[]>('runtimeActivity')) ?? []
      await this.state.storage.put('runtimeActivity', appendRuntimeActivity(activity, runtimeErrorEvent(e, { wrapperId })))
      // Non-terminal error: keep monitoring. Consider exponential backoff after consecutive errors.
    }
    if (!terminal) {
      await this.state.storage.setAlarm(Date.now() + DEFAULT_TICK_INTERVAL_SECONDS * 1000)
    }
  }

  async monitorPrice(asset: string): Promise<number> {
    const pool = asset === 'SUI' ? 'SUI_DBUSDC' : null
    if (!pool) return 0
    const market = await chainDataProvider(this.env).getMarket() as Record<string, { last_price?: number }>
    return Number(market[pool]?.last_price) || 0
  }

  async tickOnce(): Promise<Record<string, unknown>> {
    const wrapperId = (await this.state.storage.get<string>('wrapperId')) ?? null
    if (!wrapperId) return { status: 'error', action: 'error', detail: 'No wrapper registered.' }

    // Real price-drop trigger: monitor the live mainnet SUI/USDC market signal,
    // track the running peak, fire when drawdown >= the policy threshold. The
    // threshold came from the strategy handed in at activate (not on-chain).
    let market: { triggerMet: boolean; price: string } | undefined
    const monitor = (await this.state.storage.get<{ threshold_pct: number; asset: string }>('monitor')) ?? null
    const executorKind = (await this.state.storage.get<string>('executorKind')) ?? 'deepbook'
    if (monitor && monitor.threshold_pct > 0) {
      try {
        const price = await this.monitorPrice(monitor.asset)
        if (price > 0) {
          let peak = (await this.state.storage.get<number>('peakPrice')) ?? price
          if (price > peak) peak = price
          const drawdownPct = ((peak - price) / peak) * 100
          const triggerMet = drawdownPct >= monitor.threshold_pct
          await this.state.storage.put('lastPrice', price)
          await this.state.storage.put('drawdownPct', Number(drawdownPct.toFixed(3)))
          await this.state.storage.put('triggerMet', triggerMet)
          // re-arm the peak after a trigger so it doesn't fire every tick in a slump
          await this.state.storage.put('peakPrice', triggerMet ? price : peak)
          market = { triggerMet, price: String(price) }
        }
      } catch { /* price read is best-effort; fall through to monitoring */ }
    }

    const result = await runTick(this.env, { wrapperId, market, executorKind })
    const rsMap: Record<string, string> = {
      stopped_revoked: 'Revoked',
      stopped_expired: 'Expired',
      blocked: 'Monitoring',
      executed: 'Monitoring',
      no_op: 'Monitoring',
      error: 'Monitoring',
    }
    await this.state.storage.put('runtime_state', rsMap[result.action] ?? 'Monitoring')
    await this.state.storage.put('lastTickMs', Date.now())
    await this.state.storage.put('lastAction', result.action)
    const activity = (await this.state.storage.get<Record<string, any>[]>('runtimeActivity')) ?? []
    await this.state.storage.put('runtimeActivity', appendRuntimeActivity(activity, runtimeEventFromTickResult(result, { wrapperId })))
    if (result.action === 'error') {
      const n = ((await this.state.storage.get<number>('errorCount')) ?? 0) + 1
      await this.state.storage.put('errorCount', n)
    }
    return { status: 'ok', ...result }
  }
}
