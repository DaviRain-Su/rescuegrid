# RescueGrid

> Autonomous DeFi risk-rescue agent on Sui — on a leash you control.

RescueGrid is an AI agent for Sui Testnet that monitors positions, decides under Guardian policy checks, and is designed to execute DeepBook rescue trades strictly inside a **MoveGate Mandate + RescuePolicyWrapper** you authorize once. The current verified scope proves real Testnet policy create/read/revoke, live Worker read surfaces, and execution/funding gates; successful real DeepBook execution was intentionally deferred/skipped for now.

This repo is the full implementation of the [Claude Design handoff](docs/), not just the mockup:

- **Web dashboard** — a Vite + React SPA, recreated pixel-faithfully from the design prototype.
- **`core/`** — shared, SDK-agnostic logic (chain constants, canonical `strategy_hash`, NL intent parser, Guardian) reused by the frontend, the Worker, and any future local agent.
- **`rescuegrid::policy` Move package** — `RescuePolicyWrapper` on top of MoveGate, **deployed to Sui Testnet**.
- **Cloudflare Worker** — frontend API + autonomous agent runtime: parse/build/read/activate, then monitor → decide → readiness/blocked execution checks.

Owner actions are still signed in your wallet, but the frontend gets parse/build/read state from the Worker first. Direct chain reads remain only as a local fallback when `VITE_WORKER_URL` is absent or temporarily down. Architecture overview: [`docs/02-architecture.md`](docs/02-architecture.md); build status: [`docs/STATUS.md`](docs/STATUS.md).

## Quickstart

**Demo mode** (no backend, no credentials — fully clickable):

```bash
npm install
npm run dev -- --host localhost --port 5175      # http://localhost:5175
```

**Live mode** (real Sui Testnet backend + wallet):

```bash
# 1) backend
cd worker && npm install && npm run dev -- --port 8787      # http://localhost:8787

# 2) frontend (new shell)
cp .env.example .env.local   # set VITE_WORKER_URL=http://localhost:8787
npm install && npm run dev -- --host localhost --port 5175  # http://localhost:5175

# optional: print deployed on-chain ids
npm run config
```

```bash
npm run build                       # production build → dist/
npm --prefix worker test            # backend checks
npm --prefix worker run typecheck   # Worker TypeScript
npm run test:auth-wallets           # sign-in wallet / Enoki option contract
npm run test:activity-ledger        # Agent Activity normalization / signer evidence
npm run test:session-mode           # live/read-only/demo session boundaries
npm run test:dashboard-live         # live dashboard avoids demo crash/spark fallbacks
npm run test:policy-inspect         # Policy Inspect MoveGate/Wrapper copy contract
npm run test:data-sources           # Data Sources provider/replay/private diagnostics
npm run test:wallet-flow            # mock wallet create/revoke orchestration
npm run test:wallet-evidence        # wallet click-through evidence artifact contract
npm run test:mission-readiness      # PRD readiness gate contract
npm run test:demo-execution-report  # strict execution report artifact contract
npm run test:safety-negative-report # safety-negative report artifact contract
cd move/rescuegrid && sui move test # Move tests
npm run config                      # sanitized Testnet deployment IDs
npm run wallet:evidence -- --format markdown --out .rescuegrid/wallet-clickthrough-evidence.md
npm run wallet:evidence:preflight   # require local frontend + Worker readiness before manual wallet QA
npm run wallet:evidence:verify -- --input .rescuegrid/wallet-clickthrough-evidence.md --require-worker
npm run funding:request             # secret-safe external DBUSDC/DEEP funding handoff
npm run funding:request -- --format markdown --out .rescuegrid/funding-request.md
npm run funding:watch -- --json     # secret-safe readiness watch; no policy while blocked
npm run funding:watch:report        # same watch + .rescuegrid/funding-watch-report.json
npm run mission:readiness           # final PRD gate; currently expected to be blocked
npm run mission:readiness:report    # same gate + .rescuegrid/mission-readiness-report.json
npm run chain-data:status -- --json # secret-safe ChainDataProvider status; add --probe for bounded live read
npm run safety:negative             # live Testnet validate-plan safety proof; creates/revokes test policies
npm run safety:negative:report      # live safety proof + .rescuegrid/safety-negative-report.json on pass
npm run demo:loop                   # create -> activate/tick -> revoke live demo evidence
npm run demo:execute                # strict mode: preflight funding/signer, then require structured AgentTradeExecuted evidence
npm run demo:execute:report         # strict mode + .rescuegrid/demo-execute-report.json on pass
RESCUEGRID_FRONTEND_URL=http://localhost:5175 RESCUEGRID_WORKER_URL=http://localhost:8787 npm run baseline:smoke
```

The verified live Worker URL for this repo is the local Worker at `http://localhost:8787`, and the verified frontend port is `http://localhost:5175`. If Vite or Wrangler uses another port, pass `RESCUEGRID_FRONTEND_URL` / `RESCUEGRID_WORKER_URL` to `npm run baseline:smoke`. Sui objects are deployed on **Sui Testnet only** (see [`docs/STATUS.md`](docs/STATUS.md) / `npm run config`); do not treat this README as Mainnet or Cloudflare production-deploy evidence.

Post-hackathon multivenue planning lives in [`docs/06-post-mvp-multivenue-roadmap.md`](docs/06-post-mvp-multivenue-roadmap.md). `pi-worker` integration notes live in [`docs/07-pi-worker-assessment.md`](docs/07-pi-worker-assessment.md). Sui GraphQL/gRPC/Archival Store, Seal/Walrus, WaaP, Sui Stack CRM, and Sui Agent Skills are assessed in [`docs/08-sui-data-agent-stack-assessment.md`](docs/08-sui-data-agent-stack-assessment.md). Market research, strategy-template expansion, and the next frontend design brief live in [`docs/09-market-product-and-frontend-roadmap.md`](docs/09-market-product-and-frontend-roadmap.md). Engineering setup and Sui Agent Skills routing live in [`docs/10-engineering-setup.md`](docs/10-engineering-setup.md).

## The flow

`Landing → Sign in → Dashboard`, all client-side routes in one SPA:

- **Landing** — pitch page: hero rescue-grid visual, the gap, how-it-works, "Why Sui" (granted-vs-denied capabilities), features, sub-track alignment.
- **Sign in** — connect a Sui wallet (Slush or any standard wallet); optional Google zkLogin via Enoki. No seed phrase pasted, no extension lock-in.
- **Command center** — live portfolio KPIs, a SUI/USDC Deepbook chart, an animated radial risk gauge, agent reasoning trail, open positions, and an agent live feed.
- **New strategy** — natural language → parsed intent + human-readable **PTB preview** + 30-day backtest + **Guardian** risk checks (including a hard **BLOCK** path) → Move Policy config → Local/Cloud mode → one-signature deploy.
- **Risk center** — global budget, strategy controls, Sui venue caps, liquidation/oracle/live runtime signer health, stale-data warnings, Guardian rule simulation, and global / strategy / venue emergency-stop surfaces.
- **Agent activity** — audit ledger for autonomous decisions and policy actions, with strategy / venue / status / tx-or-order filters, expandable reason/input/PTB/Guardian/budget evidence, and clickable tx hashes opening a **Sui explorer drawer**.
- **Policies** — your on-chain authority as cards (budget bars, scope, expiry, revoke) with an **Inspect** slide-over exposing the MoveGate Mandate + `RescuePolicyWrapper` shape, delegated-vs-denied capabilities, protocol allow-list, gas/signing, and audit trail.
- **Profile** — wallet identity, real balances/assets, the active session, the agent's delegated authority, signer / external-signer posture, and gas posture; live values when a wallet is connected.

### The centerpiece demo

Hit **Simulate flash crash** (top right): SUI drops −8.4%, the risk gauge spikes red, then the demo animates an autonomous rescue grid story — partial fill → re-quote → fills → log — all without a signature. This centerpiece is a demo simulation, not evidence of a completed real DeepBook fill in the current Testnet validation. There's also a global **Emergency stop** circuit breaker, and a **Tweaks** panel (bottom-right gear) to live-toggle accent color, crash severity, and market jitter.

## Live mode (real wallet + Worker)

By default the app runs **self-contained in demo mode** (mock data, simulated sign-in). To run it against the real Sui Testnet backend:

1. Start the Worker on `http://localhost:8787` and set `VITE_WORKER_URL=http://localhost:8787` in `.env.local`.
2. **Sign in with a Sui wallet** — install [Slush](https://slush.app) (or any standard Sui wallet), switch it to **Testnet**, and grab test SUI from the faucet. No signups, no API keys. The sign-in screen shows a "Connect <wallet>" button. If `VITE_ENOKI_API_KEY` and `VITE_GOOGLE_CLIENT_ID` are configured, the same sign-in screen also exposes "Continue with Google" through Enoki zkLogin.

With a connected wallet + Worker URL, **New strategy → Sign & deploy** parses via the Worker, builds the unsigned `create_policy` transaction in the Worker, you sign it in your wallet, and the policy's Durable Object runtime is registered. Live policy list, summary, market, balances, activity, and revoke are Worker-first; if the Worker is unavailable, read-only views fall back to direct Sui/DeepBook reads. The no-wallet Worker read surface is an explicit **Open Worker read-only** sign-in option, not an automatic dashboard jump. Creating/revoking costs only the ~0.01 SUI MoveGate fee + gas; no DBUSDC needed.

> Wallet click-through evidence path: `npm run wallet:evidence -- --format markdown --out .rescuegrid/wallet-clickthrough-evidence.md` creates a gitignored manual evidence artifact for the real Slush / standard Sui wallet flow. The script is read-only: it snapshots frontend reachability/login guardrails plus public Worker root/runtime/readiness/chain-data status, but it does not create a policy, submit a PTB or claim a live wallet click-through. Run `npm run wallet:evidence:preflight` before manual QA to require the local frontend, login boundary and Worker public status to be ready. During the browser run, set `Actual click-through completed: true` and fill the artifact with owner address, create tx digest, `wrapper_id`, `mandate_id`, strategy hash, revoke tx digest and screenshots/evidence references for sign-in, create approval, active policy, activity rows, revoke approval and revoked state. After filling it, run `npm run wallet:evidence:verify -- --input .rescuegrid/wallet-clickthrough-evidence.md --require-worker` to reject obvious secret assignments, then check the manual evidence fields plus the create/revoke digests against Sui `PolicyCreated` / `PolicyRevoked` events and required Worker detail reads.

Worker read surfaces also expose Sui-only composability metadata: `/api/protocols` returns the DefiLlama Sui top-26 plus volume exceptions registry, `/api/protocols/watchlist` maps that universe into protocol/venue/market/risk rows, `/api/adapters/candidates` lists the H4/H5 DEX/lending target schemas and preflight gates, `/api/protocols/watch-boundaries` lists H6 watch-only read surfaces and no-execution boundaries, `/api/adapters/dex-reads` defines the DeepBook/Cetus/Turbos/Momentum/Bluefin Spot quote/depth/spread read model, and `/api/adapters/lending-reads` defines NAVI/Suilend/Scallop/AlphaLend reserve, obligation and health-factor read models. `/api/chain-data/status` reports the selected Worker ChainDataProvider, transport, read model and optional `?probe=true` schema/read probe without printing endpoint URLs or secrets. `/api/archival/replay-contract` defines the long-range historical activity, performance replay and judge/demo replay contracts without enabling an Archival Store provider yet. `/api/execution/readiness` is the unified cloud/local agent preflight for signer status, BalanceManager DBUSDC/DEEP and agent SUI gas; Profile consumes it directly and `demo:execute` uses it before creating any strict-mode test policy. Data Sources, Markets, Strategy Catalog and Strategy Builder now consume the DEX/lending read surfaces directly, so users can see adapter counts, spread/health rows, template read models and execution blockers instead of only static demo labels. Builder deploy is blocked for read-only or missing adapters; Active Strategy Detail shows Sui-only live legs, venue inventory, PnL/carry, open orders, ticks, approvals and Guardian limits. DeepBook appears as the only configured executor path, but watchlist rows keep `execution_enabled=false` with `FUNDING_GATED` until DBUSDC/DEEP funding is real; adapter candidates, DEX/lending read adapters, replay contracts, read-only strategy templates and watch-only boundaries also stay non-executable unless explicitly noted. The H7 adapter SDK skeleton lives in `worker/src/executor-adapter-sdk.js`: it owns conformance, liquidity/volume gate helpers, registry construction and unsupported-executor errors, while `worker/src/deepbook-adapter.js` is the first registered plugin.

`/api/private-records/contract` defines the Seal + Walrus private policy record contract for encrypted strategy snapshots, backtest reports, owner-facing agent reasoning summaries and incident reports, plus the future Sui `PolicyPrivateRecord` shared-object shape with reader ACL, version table, optimistic `expected_current_version`, operation contracts and plaintext-free events. The default provider is `none`; `seal-walrus` can only report configuration posture and remains `not_validated` until encrypted write/read, ACL and chain-anchor validation land. Wallet keys, `AGENT_KEY`, WaaP session files, permission tokens and raw hidden model reasoning are explicitly disallowed payload fields.

The Worker also exposes `/api/runtime/status` for non-secret cloud agent, signer, execution, data-provider and monitoring-provider posture. Profile and Risk Center consume this in live mode so users can see whether the runtime is `worker-secret`, `local-daemon`, `waap` or another explicit signer kind, the actual signer public address derived from the configured secret or external signer config, why execution is currently blocked, and whether monitoring is still Durable Object timer polling. The endpoint now includes a public signer capability matrix plus `external_signer` posture so the UI can distinguish "known future signer kind" from "execution-ready signer". WaaP is presented as a local-daemon-only path, not as something the Cloud Worker can run directly. `worker-secret` / `local-daemon` are available only when the secret is valid and its public address matches the deployed RescueGrid agent. `waap` is now a local-daemon-only CLI signer spike: it stays unavailable in the Cloud Worker runtime and becomes available only with `RESCUEGRID_DAEMON_MODE=true`, `RESCUEGRID_WAAP_CLI_ENABLED=true`, a configured `RESCUEGRID_WAAP_SUI_ADDRESS` matching the deployed RescueGrid agent, and an injected local `waap-cli` submission runner. A configured WaaP address or permission token alone returns `WAAP_RUNNER_MISSING`, not execution readiness. The spike parses WaaP JSON/NDJSON output and maps approval-pending, approval-denied, policy-blocked and timeout states to explicit non-success codes without logging permission tokens; runtime activity preserves `signer_kind` and `approval_state` so Agent Activity can filter signer blocks and show signer kind, approval state and WaaP/signer blocker codes in expanded audit rows. `MONITORING_PROVIDER=grpc` is visible only as a disabled spike boundary and cannot replace timer polling until Runtime Core/Durable Object streaming semantics are implemented. This is not production WaaP or gRPC support yet.

> ChainDataProvider validation path: `npm run chain-data:status -- --json` prints the selected read provider, transport and fallback read model without live GraphQL probing. Add `--probe` for a bounded clock/schema/events read, and use `--provider graphql --endpoint <url> --owner <0x...> --wrapper-id <0x...> --json` to compare GraphQL owner-policy/activity output against JSON-RPC. The script is read-only and redacts endpoint URLs and signer secrets.

**zkLogin (optional):** if you'd rather use Google zkLogin, also set `VITE_ENOKI_API_KEY` (Enoki public key from [portal.enoki.mystenlabs.com](https://portal.enoki.mystenlabs.com)) and `VITE_GOOGLE_CLIENT_ID` (Google OAuth Web client, registered in the Enoki portal). The app registers the Enoki Google wallet and surfaces "Continue with Google" on the sign-in screen; `npm run test:auth-wallets` covers the wallet/Enoki option contract. Wallet login needs none of this.

> Agent-key validation path: mission validation used the dedicated Worker-held agent key from `worker/.dev.vars` through secret-safe scripts to create/list/revoke current-run policies on Sui Testnet. Do not print or commit `.dev.vars` values; evidence records only public signer/owner/agent addresses, object IDs, strategy hashes, and tx digests.

> Demo-loop validation path: with the local Worker running and `INTERNAL_AGENT_TICK_TOKEN` + `RESCUEGRID_DEMO_MODE=true` configured, `npm run demo:loop` creates a Testnet policy, activates the Durable Object runtime, forces one internal tick, records either a real execution or the documented funding gate, revokes, then proves the post-revoke tick stops without execution.

> Strict execution validation path: after the BalanceManager is funded with usable DBUSDC/DEEP and `EXECUTION_ENABLED=true`, run `npm run demo:execute` or `npm run demo:execute:report`. It first preflights `/api/runtime/status`, BalanceManager DBUSDC/DEEP, and agent SUI gas before creating any policy; if the preflight is blocked, the script fails without leaving a test policy behind. Once preflight passes, it uses the same live loop but fails unless the forced tick produces structured `AgentTradeExecuted` evidence, `execution_claimed=true` and an on-chain spend increase. The report variant writes `.rescuegrid/demo-execute-report.json` only after the full create -> execute -> revoke -> post-revoke sequence passes, including create/revoke success tx evidence, all G2 loop assertions, public `AgentTradeExecuted` fields for the same wrapper/mandate/tick digest, and a post-revoke `POLICY_REVOKED` / `execution_claimed=false` no-execution proof for the same wrapper.

> Funding watch path: `npm run funding:watch -- --json` runs the same readiness contract once and prints public blockers. `npm run funding:watch:report` writes the same machine-readable gate evidence to `.rescuegrid/funding-watch-report.json`, including blocked reports. `npm run funding:watch -- --wait --run-demo --worker-url http://localhost:8787` polls until signer/funding readiness is true, then launches strict `demo:execute`; while blocked, it does not create a policy or submit a PTB.

> Local daemon scaffold: `npm run daemon -- status --json` shows the local agent address, chain, registered executor adapters, signer kind, watched policies, log path, external signer posture and best-effort execution readiness using the same preflight helper as `/api/execution/readiness`. `npm run daemon -- policies list --owner <0x...> --json` lists owner policies from the same chain reader and marks which wrappers are currently watched by the daemon; `npm run daemon -- watch sync --owner <0x...> --json` persists active matching wrappers into `.rescuegrid/daemon.json` for later `run`. `npm run daemon -- tick --wrapper-id <0x...>` runs the same Runtime Core tick path from the local process and writes JSONL activity under `.rescuegrid/daemon/`. It defaults to monitoring only; live submission still requires `--execution-enabled`, a matching signer address, and a funded BalanceManager. `--signer-kind local-daemon` signs only from the local daemon runtime with the local `AGENT_KEY`; `--signer-kind waap --waap-cli-enabled --waap-sui-address <agent>` can hand a RescueGrid-generated Sui `tx_json` to `waap-cli send-tx` from the local daemon only. The daemon readiness path injects the reviewed WaaP runner; without that runner the same signer posture returns `WAAP_RUNNER_MISSING`. The WaaP adapter handles result-event NDJSON and explicit approval/policy/timeout non-success states. WaaP permission tokens are read from env and never persisted. Mainnet refuses `worker-secret` and requires an external/user-controlled signer mode.

> Funding/execution gate: the deployed agent BalanceManager is currently unfunded for execution (`DBUSDC=0`, `DEEP=0` in final validation). Readiness surfaces correctly remain blocked with labels such as `EXECUTION_DISABLED`, `INSUFFICIENT_DBUSDC`, and `INSUFFICIENT_DEEP`. `npm run funding:request` produces a secret-safe handoff with public agent / BalanceManager ids, DBUSDC/DEEP coin types, observed balances, missing amounts and the exact verification commands to rerun after external funding; signer and external-signer posture is allowlisted before serialization so raw tokens, sessions, runner output and key material cannot enter the artifact. Add `--format markdown --out .rescuegrid/funding-request.md` to create a gitignored artifact for a funding provider. The handoff and funding-watch JSON include `execution_gate.readiness_only=true` and `strict_execution_report_required=true`: even a ready funding gate is not execution evidence until `npm run demo:execute:report` writes a passing `.rescuegrid/demo-execute-report.json`. `npm run funding:watch -- --json` is the repeatable no-policy readiness check, `npm run funding:watch:report` persists it as `.rescuegrid/funding-watch-report.json`, and `npm run funding:watch -- --wait --run-demo --worker-url http://localhost:8787` can hand off to strict execution only after readiness is true. Real DeepBook execution was explicitly deferred/skipped until usable Testnet DBUSDC/DEEP funding exists; this repo must not claim a successful live DeepBook fill yet.

## Final validation snapshot

Observed final mission evidence is Testnet-only:

- Validators passed: `npm run build`, `npm --prefix worker test`, `npm --prefix worker run typecheck`, `cd move/rescuegrid && sui move test`, and `npm run config`.
- `RESCUEGRID_FRONTEND_URL=http://localhost:5173 RESCUEGRID_WORKER_URL=http://localhost:8787 npm run baseline:smoke` passed against local Worker/frontend services and Sui Testnet reads, including `/api/runtime/status`, `/api/chain-data/status`, signer/agent/data-provider checks and secret-leak assertions.
- Browser/API surfaces were verified on `http://localhost:5175` with live Worker reads to `http://localhost:8787`.
- Scripted agent-key Testnet validation created, listed, surfaced in UI/API, and revoked a current-run policy; chain and Worker reads stayed consistent post-revoke.
- `npm run safety:negative` is the live safety-negative validator: with a local Worker and scripted Testnet agent key config, it creates active/expiring test policies, checks over-budget, over-slippage, wrong pool, wrong agent, mandate-wrapper mismatch, expired and revoked plans through the non-mutating `/api/execution/validate-plan` path, then verifies wrapper spend and execution-success activity stay unchanged. `npm run safety:negative:report` writes the same proof to `.rescuegrid/safety-negative-report.json` only after all required blockers pass.
- Latest machine-readable safety run generated on 2026-06-02T22:59:22.584Z: active create tx `3VadLjNAeKfm7qk2MxtitiRSSpdThW3hSozRvRRUDCQ1`, expiring create tx `rDhFNivs7aoJvz3XHZW4zxRtLtMxpSo4mqmb9F99iD7`, revoke tx `Dm5hepDZuzVf9RNHdzTCCbtJyzazJq8Zo7RtP6KvDnpM`, blocker codes `OVER_BUDGET`, `OVER_SLIPPAGE`, `WRONG_POOL`, `WRONG_AGENT`, `MANDATE_MISMATCH`, `POLICY_EXPIRED`, `POLICY_REVOKED`, all with `submitted=false`, `execution_claimed=false` and spend `0 -> 0`.
- `npm run demo:loop` is the G2 live demo validator: create -> activate/monitor -> force tick -> revoke -> post-revoke tick. In the current funding state it should report the documented execution gate, not a fake fill. `npm run demo:execute` is the strict variant: it preflights execution readiness before policy creation, then requires structured `AgentTradeExecuted` evidence, `execution_claimed=true` and an on-chain spend increase.
- `npm run wallet:evidence -- --format markdown --out .rescuegrid/wallet-clickthrough-evidence.md` is the read-only browser-wallet evidence artifact generator. `npm run wallet:evidence:preflight` checks local frontend reachability, source-level login guardrails and Worker public readiness before manual wallet QA. `npm run wallet:evidence:verify -- --input .rescuegrid/wallet-clickthrough-evidence.md --require-worker` verifies a filled artifact by rejecting obvious secret assignments, requiring explicit click-through completion plus sign-in/create/revoke/active/revoked screenshot or evidence references, then checking the create/revoke tx digests against Sui `PolicyCreated` / `PolicyRevoked` events and required Worker detail reads. The generated blank artifact and preflight pass are not themselves proof that the browser wallet flow was clicked.
- `npm run mission:readiness` is the secret-safe final PRD gate. It checks required validation scripts, requires `.rescuegrid/safety-negative-report.json` from `npm run safety:negative:report`, verifies the filled wallet artifact, reads the same execution funding readiness contract used by `funding:watch`, allowlists signer capability / external-signer posture before serializing funding evidence, and keeps `execution_gate.readiness_only=true` / `strict_execution_report_required=true` in the aggregate funding check. It then requires `.rescuegrid/demo-execute-report.json` from `npm run demo:execute:report` proving the full create -> execute -> revoke -> post-revoke strict loop: Testnet purpose/chain metadata, owner/wrapper/mandate/strategy ids, successful create and revoke txs, all G2 assertions, structured `AgentTradeExecuted` evidence for the same wrapper/mandate/tick digest, `execution_claimed=true`, spend increase, and post-revoke `POLICY_REVOKED` no-execution evidence. The aggregate gate also requires the verified browser wallet artifact and strict execution report to describe the same owner-created policy lifecycle: owner, wrapper, mandate, strategy hash and create/revoke tx digests must match. When the wallet artifact is incomplete, the blocked report includes click-through status, Worker URL and exact missing field counts, and points operators back through `wallet:evidence` generation plus `wallet:evidence:preflight` before manual QA. `npm run mission:readiness:report` writes the same aggregate JSON to `.rescuegrid/mission-readiness-report.json` even while blocked. In the current local validation with safety evidence present, it should still return non-zero with `status=blocked` because the browser wallet artifact is incomplete, DBUSDC/DEEP funding is not ready, and no strict execution report exists; on a fresh checkout, rerun `npm run safety:negative:report` first if the gitignored safety report is missing.
- Latest demo-loop run passed on 2026-06-03: create tx `49dk3PCrukukRLkuKFEJc1s3QQwAj4cc2E1v8uxP1fSv`, wrapper `0x2a358220…948593e`, forced tick `EXECUTION_DISABLED` with `execution_claimed=false` and spend `0 -> 0`, revoke tx `CuK54YNnw7vb5PxxQy2p66JdvKfSvzy8K8VXUPzYfCQg`, post-revoke tick `POLICY_REVOKED`.
- Funding/readiness, tick auth, trigger-not-met, Guardian safety, revoked/failed/unresolved paths all remained non-success with unchanged spend and no execution-success activity; transaction-bearing runtime activity is idempotent by digest, and chain success evidence wins over duplicate runtime success rows.
- Live policy lists reconcile Durable Object runtime state with chain state; terminal chain state wins and stale runtime rows surface as `runtime_state_stale`.
- Successful real DeepBook execution was not run and should remain documented as deferred until the DBUSDC/DEEP gate is satisfied.

## Tech

- **Vite + React** (JSX) with TanStack Query for live Worker/chain reads, public feed queries, mutation state and transaction detail caching; TanStack Router for app/deep-link navigation; TanStack Table for scanner-style market tables; and TanStack Form for the strategy builder's editable policy fields. Query/Router Devtools run in development only. The Cloudflare Worker remains the live-mode API backend; shared, SDK-agnostic logic lives in `core/` (reused by the Worker too), and protocol execution plugins conform to the Worker-side ExecutorAdapter SDK. Demo mode still uses plausible mock data in [`src/data.js`](src/data.js).
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

> Testnet implementation. MoveGate / RescuePolicyWrapper and the Worker runtime are implemented; live autonomous DeepBook execution is still gated on funding the agent BalanceManager with DBUSDC and DEEP, and was explicitly skipped/deferred in the final validation evidence.
