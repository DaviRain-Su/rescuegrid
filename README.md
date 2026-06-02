# RescueGrid

> Autonomous DeFi risk-rescue agent on Sui — on a leash you control.

RescueGrid is an AI agent that monitors your positions, decides, and executes real trades on Deepbook — strictly inside a **Move Policy Object** you authorize once.

This repo is the full implementation of the [Claude Design handoff](docs/), not just the mockup:

- **Web dashboard** — a Vite + React SPA, recreated pixel-faithfully from the design prototype.
- **`core/`** — shared, SDK-agnostic logic (chain constants, canonical `strategy_hash`, NL intent parser, Guardian) reused by the frontend, the Worker, and any future local agent.
- **`rescuegrid::policy` Move package** — `RescuePolicyWrapper` on top of MoveGate, **deployed to Sui Testnet**.
- **Cloudflare Worker** — frontend API + autonomous cloud agent runtime: parse/build/read/activate, then monitor → decide → execute.

Owner actions are still signed in your wallet, but the frontend gets parse/build/read state from the Worker first. Direct chain reads remain only as a local fallback when `VITE_WORKER_URL` is absent or temporarily down. Architecture overview: [`docs/02-architecture.md`](docs/02-architecture.md); build status: [`docs/STATUS.md`](docs/STATUS.md).

## Quickstart

**Demo mode** (no backend, no credentials — fully clickable):

```bash
npm install
npm run dev      # http://localhost:5173
```

**Live mode** (real Sui Testnet backend + wallet):

```bash
# 1) backend
cd worker && npm install && npm run dev      # http://localhost:8787

# 2) frontend (new shell)
cp .env.example .env.local   # set VITE_WORKER_URL=http://localhost:8787
npm install && npm run dev   # http://localhost:5173

# optional: print deployed on-chain ids
npm run config
```

```bash
npm run build    # production build → dist/
npm run preview  # serve the production build
cd worker && npm test   # 23 backend checks (hash + guardian + tick)
```

A live deployment already exists on Sui Testnet (see [`docs/STATUS.md`](docs/STATUS.md) / `npm run config`); the Move package is published and the agent runtime is provisioned.

Post-hackathon multivenue planning lives in [`docs/06-post-mvp-multivenue-roadmap.md`](docs/06-post-mvp-multivenue-roadmap.md). `pi-worker` integration notes live in [`docs/07-pi-worker-assessment.md`](docs/07-pi-worker-assessment.md); it is a good future operator/agent-session layer, not a replacement for the current deterministic Worker hot path.

## The flow

`Landing → Sign in → Dashboard`, all client-side routes in one SPA:

- **Landing** — pitch page: hero rescue-grid visual, the gap, how-it-works, "Why Sui" (granted-vs-denied capabilities), features, sub-track alignment.
- **Sign in** — connect a Sui wallet (Slush or any standard wallet); optional Google zkLogin via Enoki. No seed phrase pasted, no extension lock-in.
- **Command center** — live portfolio KPIs, a SUI/USDC Deepbook chart, an animated radial risk gauge, agent reasoning trail, open positions, and an agent live feed.
- **New strategy** — natural language → parsed intent + human-readable **PTB preview** + 30-day backtest + **Guardian** risk checks (including a hard **BLOCK** path) → Move Policy config → Local/Cloud mode → one-signature deploy.
- **Agent activity** — filterable on-chain log of every autonomous decision (executions, retries, failures, guardian blocks), with clickable tx hashes opening a **Sui explorer drawer**.
- **Policies** — your on-chain authority as cards (budget bars, scope, expiry, revoke) with an **Inspect** slide-over exposing the `AgentPolicy` Move struct, delegated-vs-denied capabilities, protocol allow-list, gas/signing, and audit trail.
- **Profile** — wallet identity, real balances/assets, the active session, the agent's delegated authority, and gas posture; live values when a wallet is connected.

### The centerpiece demo

Hit **Simulate flash crash** (top right): SUI drops −8.4%, the risk gauge spikes red, then the agent autonomously fires a rescue grid on Deepbook — partial fill → re-quote → fills → on-chain log — all without a signature. There's also a global **Emergency stop** circuit breaker, and a **Tweaks** panel (bottom-right gear) to live-toggle accent color, crash severity, and market jitter.

## Live mode (real wallet + Worker)

By default the app runs **self-contained in demo mode** (mock data, simulated sign-in). To run it against the real Sui Testnet backend:

1. Set `VITE_WORKER_URL` in `.env.local` (`cd worker && npm run dev`, default `http://localhost:8787`).
2. **Sign in with a Sui wallet** — install [Slush](https://slush.app) (or any standard Sui wallet), switch it to **Testnet**, and grab test SUI from the faucet. No signups, no API keys. The sign-in screen shows a "Connect <wallet>" button.

With a connected wallet + Worker URL, **New strategy → Sign & deploy** parses via the Worker, builds the unsigned `create_policy` transaction in the Worker, you sign it in your wallet, and the policy's Durable Object runtime is registered. Live policy list, summary, market, balances, activity, and revoke are Worker-first; if the Worker is unavailable, read-only views fall back to direct Sui/DeepBook reads. Creating/revoking costs only the ~0.01 SUI MoveGate fee + gas; no DBUSDC needed.

**zkLogin (optional):** if you'd rather use Google zkLogin, also set `VITE_ENOKI_API_KEY` (Enoki public key from [portal.enoki.mystenlabs.com](https://portal.enoki.mystenlabs.com)) and `VITE_GOOGLE_CLIENT_ID` (Google OAuth Web client, registered in the Enoki portal). Then "Continue with Google" performs real zkLogin. Wallet login needs none of this.

> The agent (autonomous execution) signs with a dedicated key held by the Worker (`worker/.dev.vars`), never your zkLogin key. Live Deepbook execution is gated pending testnet DBUSDC (see `docs/B-feasibility-findings.md`).

## Tech

- **Vite + React 18** (JSX) with a Cloudflare Worker backend for live mode; shared, SDK-agnostic logic lives in `core/` (reused by the Worker too). Demo mode still uses plausible mock data in [`src/data.js`](src/data.js).
- Design system (`neon-on-near-black`, glassy dark fintech) lives in [`src/styles.css`](src/styles.css); landing-only styles in [`src/landing.css`](src/landing.css).

```
src/
  main.jsx                 # entry
  App.jsx                  # app shell, nav, crash orchestration, routing
  api.js                   # Worker-first frontend API client
  chain-read.js            # direct-chain fallback for read-only live views
  data.js                  # demo/mock data layer
  styles.css / landing.css # design tokens + components
  components/
    primitives.jsx         # Icon, Sparkline, RiskGauge, Token, Logo, helpers
    Landing.jsx            # pitch / marketing page
    ZkLogin.jsx            # sign-in entry
    Dashboard.jsx          # command center + reasoning panel
    NewStrategy.jsx        # intent → review → policy → deploy
    Views.jsx              # activity log + policies
    Detail.jsx             # policy inspect slide-over + tx explorer drawer
    Profile.jsx            # wallet identity, balances, session, agent authority
    TweaksPanel.jsx        # live demo controls
core/                      # shared logic — frontend + Worker + future local agent
  deployment.js            # on-chain ids / constants
  strategy.js              # canonical strategy_hash + NL intent parser
  guardian.js              # Guardian decision logic
```

> Testnet implementation. MoveGate / RescuePolicyWrapper and the Worker runtime are implemented; live autonomous DeepBook execution is still gated on funding the agent BalanceManager with DBUSDC.
