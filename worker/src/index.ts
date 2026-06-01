// RescueGrid API Worker (Cloudflare Workers + Hono).
// E2 (/api/intents/parse) is live; E3/E4/E7 are wired as typed stubs and filled
// in next. The Durable Object agent runtime (E5) is exported as a stub binding.
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { parseIntent } from './parse.js'
import { AGENT_ADDRESS } from './config.js'
import type { ParseDefaults } from './types.js'

export interface Env {
  AGENT_RUNTIME: DurableObjectNamespace
  // secrets (wrangler secret / .dev.vars): OWNER_KEY, AGENT_KEY, INTERNAL_AGENT_TICK_TOKEN
  OWNER_KEY?: string
  AGENT_KEY?: string
  INTERNAL_AGENT_TICK_TOKEN?: string
  RESCUEGRID_DEMO_MODE?: string
}

const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', cors())

app.get('/', (c) => c.json({ service: 'rescuegrid-worker', agent: AGENT_ADDRESS, status: 'ok' }))

// ── E2: parse natural-language intent into a structured strategy ──────────
app.post('/api/intents/parse', async (c) => {
  let body: { owner?: string; text?: string; defaults?: ParseDefaults }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400)
  }
  if (!body.owner || !body.text) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'owner and text are required.' }, 400)
  }
  const result = parseIntent(body.text, body.owner, body.defaults ?? {})
  return c.json(result, result.status === 'ok' ? 200 : 422)
})

// ── E3: create policy (build + submit create_policy PTB) — next ───────────
app.post('/api/policies', (c) =>
  c.json({ status: 'error', code: 'NOT_IMPLEMENTED', message: 'E3 pending.' }, 501))

// ── E4: aggregated activity ───────────────────────────────────────────────
app.get('/api/policies/:wrapper_id/activity', (c) =>
  c.json({ status: 'error', code: 'NOT_IMPLEMENTED', message: 'E4 pending.' }, 501))

// ── revoke ────────────────────────────────────────────────────────────────
app.post('/api/policies/:wrapper_id/revoke', (c) =>
  c.json({ status: 'error', code: 'NOT_IMPLEMENTED', message: 'revoke pending.' }, 501))

// ── E7: internal agent tick ─────────────────────────────────────────────--
app.post('/api/agent/tick', (c) =>
  c.json({ status: 'error', code: 'NOT_IMPLEMENTED', message: 'E7 pending.' }, 501))

export default app

// ── E5: Durable Object agent runtime (stub; alarm/tick filled in next) ────
export class AgentRuntime {
  state: DurableObjectState
  env: Env
  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }
  async fetch(_req: Request): Promise<Response> {
    return new Response(JSON.stringify({ status: 'ok', note: 'AgentRuntime stub' }), {
      headers: { 'content-type': 'application/json' },
    })
  }
}
