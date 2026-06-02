# RescueGrid — Build Status

日期：2026-06-03 · 环境：Sui Testnet

A running snapshot of what is built and how it was verified. Demo-facing summary for judges / handoff.

## What ships

| Layer | Status | Verified by |
| --- | --- | --- |
| **Web dashboard** (Vite + React) | ✅ Sui-only public scope | `npm run build` (2,420 modules); landing → zkLogin → dashboard, flash-crash demo; public Markets/Catalog/Profile/Data Sources hide non-Sui/CEX/bridge content for Hackathon submission |
| **Move package** `rescuegrid::policy` | ✅ deployed | `sui move test` 8/8; published `0x92f6e3…bb78` |
| **Worker API** (Cloudflare + Hono) | ✅ all endpoints | `npm test` + `npm run typecheck`; parse static Guardian block + runtime activity log + detail/list runtime stale reconciliation + runtime activity idempotency + activation/revoke preflight + ExecutorAdapter registry + adapter target gate + adapter SDK conformance + ChainDataProvider boundary + Sui protocol registry + active policy cap covered |
| **Sign-in** | ✅ | Sui wallet (Slush/std, no creds) primary; Enoki zkLogin optional |
| **Frontend ↔ Worker contract** | ✅ wired | live reads are Worker-first with direct-chain fallback; create/revoke use Worker-built unsigned txs; post-create activation passes the parsed strategy trigger into the policy runtime |
| **Live write loop** (create / list / revoke) | ✅ **verified on-chain** | real policy created (`9SQWkBne…`) + revoked (`Gzniih…`); endpoints return live data; post-revoke reads `Revoked` |
| **Live execution** (Deepbook order) | 🟡 gated | builders + dry-run; blocked on testnet DBUSDC funding |

## On-chain (testnet)

- rescuegrid package: `0x92f6e3218151e4d16fa51fd49df974a84ea744510f5e5a8ff79a01aacf27bb78`
- agent: `0x9eeed099…2ee43` · passport `0x0e7421…f8e6b` · BalanceManager `0x2e2e818f…aec2` (unfunded)
- reuses deployed MoveGate `0xec91e6…cf884a` · Deepbook `SUI_DBUSDC` pool `0x1c1936…7163a5`
- See `deployment.testnet.json` (`npm run config`).

## Phase ledger

- **B** feasibility — ✅ GO (`docs/B-feasibility-findings.md`): MoveGate Mandate shareable w/o owner co-sign, AuthToken hot-potato, Deepbook pools live.
- **C** Move — ✅ C1–C7. RescuePolicyWrapper + create/revoke/assert/record; thin helper builds `vector<TypeName>`; AuthToken consumed via MoveGate receipt; published.
- **E** Worker — ✅ E1–E9. parse (`executor_kind=deepbook`, unsupported strategy/executor errors, static slippage hard-cap `GUARDIAN_STATIC_BLOCK`, strategy_hash matches spec vectors) · create_policy PTB (zkLogin-signed, dry-run success) · activate only after wrapper/mandate liveness + strategy-hash preflight · active policy cap (`ACTIVE_POLICY_LIMIT_REACHED`) · list/detail activity (chain-authoritative + Durable Object runtime feed, chain-wins `runtime_state_stale` reconciliation) · Guardian · tick state machine now lives in `worker/src/runtime-core.js` and is reused by Worker tick + local daemon · Durable Object alarm · state sync · adapter registry with `UNSUPPORTED_EXECUTOR`, adapter target gating (`UNSUPPORTED_EXECUTOR_TARGET`) and adapter SDK conformance · signer adapter boundary (`worker-secret` implemented for Testnet Worker; `local-daemon` implemented only under `RESCUEGRID_DAEMON_MODE=true`; `waap`/`hardware`/`remote-signer` remain explicit `UNSUPPORTED_SIGNER` kinds).
- **F** Deepbook — 🟡 F1/F3 builders structurally verified (serialize + dry-run of create). `deepbook` ExecutorAdapter now produces an ExecutionPlan, exposes the H7 adapter SDK surface (`readMarket`, liquidity gate, volume gate, preview, unsigned PTB build, execution result parsing) and builds the unsigned PTB through the registry; F4 failure recovery/idempotency is covered at the runtime activity layer (same tx digest de-dupes, chain `AgentTradeExecuted` wins over runtime success rows, stronger success evidence can replace unresolved/error rows). Agent + BalanceManager are provisioned on-chain. **Blocked:** DBUSDC mint is permissioned and the SUI_DBUSDC pool is illiquid, so the BM can't be self-funded → live execution dry-run pending an external DBUSDC source. `EXECUTION_ENABLED=false` until then.
- **D** dashboard wiring — ✅ sign-in (Sui wallet primary, zkLogin optional); live create-policy (parse → build → wallet-sign → activate with strategy trigger); live D4 list/activity includes runtime stale markers + D5 revoke with `ALREADY_REVOKED` preflight; live policies/activity/summary/market/balances poll every 5 seconds per `docs/05-test-spec.md`; expanded blocked activity now surfaces blocker code, observed value and required threshold; D6 Worker parse errors show an explicit strategy-builder error card instead of silently falling back to demo data; responsive + lazy-loaded landing; D3 live PTB preview separately surfaces owner, deployment agent, pool, budget, slippage and expiry; Active Strategy detail matches live runtime activity by wrapper id as well as display name; Policy Inspect now names the real MoveGate Mandate + `RescuePolicyWrapper` model instead of the older AgentPolicy/AgentCap/sponsored-gas story. **Live write loop proven on-chain** (see below).
- **G** packaging — ✅ G1 `npm run config`; G2 `npm run demo:loop` script covers create -> activate/monitor -> internal tick -> revoke -> post-revoke no-execution; `npm run baseline:smoke` accepts `RESCUEGRID_FRONTEND_URL` / `RESCUEGRID_WORKER_URL` for non-default local ports; G3 README quickstart; this status doc. The execute leg currently reports the documented DBUSDC/DEEP funding gate until F is unblocked.
- **H** composability — 🟡 local daemon scaffold exists (`npm run daemon -- status|tick|run|logs`) and runs the same Runtime Core module (`worker/src/runtime-core.js`) from the local process with JSONL activity logs, runtime boundary reporting, registered adapter reporting, local-agent mismatch checks, force-trigger demo gating and Mainnet external-signer gating. `local-daemon` signer mode now signs with the local `AGENT_KEY` only when `RESCUEGRID_DAEMON_MODE=true`; live submission still requires `--execution-enabled`, a matching deployed agent address and a funded BalanceManager. `waap`/`hardware`/`remote-signer` remain unsupported until the external signer spike is validated. H3 protocol registry baseline is implemented at `/api/protocols`: DefiLlama Sui `chainTvls.Sui` top 26 plus Turbos as an explicit DEX volume exception, with every entry scoped to `chain=sui` and only DeepBook marked as the live executor.
- **J** Sui data / signer hardening — 🟡 J1 ChainDataProvider boundary is partially implemented. `JsonRpcChainDataProvider` remains the default provider, and Worker read endpoints, `runTick` and Durable Object price monitoring resolve reads through `worker/src/chain-data-provider.js`. `GraphqlChainDataProvider`, gRPC monitoring, Archival Store replay and external signer production hardening remain future work.

## Live write loop — verified on-chain (2026-06-02)

Broadcast with the dedicated agent key (agent-as-owner for the test):
- `create_policy` → tx `9SQWkBneN2jZ1ovETaZyRkx8UrwntSUBceBwPT2gRYdP` → wrapper `0x85703d17…55ea4`, mandate `0x1587a441…33825`.
- Worker endpoints returned it live: `/api/policies?owner=` (1), `/api/activity?owner=` (PolicyCreated), `/api/policies/:id/activity` (`Monitoring`, spent 0).
- `revoke_policy` → tx `GzniihEkpUNJG3dr1K1e5J3f5YWJ75B6yBnYMvmWEfmg` → `PolicyRevoked`; post-revoke reads `revoked:true` / `runtime_state: Revoked`, activity = 2 events.

So create / list / activity / revoke are real on testnet. In the browser, a connected Sui wallet drives the same Worker-first flow (no DBUSDC needed); read-only screens can fall back to direct Sui/DeepBook reads when `VITE_WORKER_URL` is absent.

## Baseline smoke — verified locally (2026-06-02)

With Worker `http://localhost:8787` and frontend `http://localhost:5175` running:

- `RESCUEGRID_FRONTEND_URL=http://localhost:5175 RESCUEGRID_WORKER_URL=http://localhost:8787 npm run baseline:smoke` passed.
- Evidence covered deployment id consistency, `.env.local` Worker URL, Worker service root, frontend Vite env, Sui Testnet fullnode, RescueGrid package, agent passport, BalanceManager, DeepBook `SUI_DBUSDC` pool and Testnet indexer.
- Funding gate stayed explicit: BalanceManager `DBUSDC_raw=0`, `DEEP_raw=0`, `EXECUTION_ENABLED=false`, and the smoke asserted `EXECUTION_DISABLED` with no execution tx submitted.

## Known gaps / next

1. **DBUSDC funding** — the only true remaining gap, and **self-funding is confirmed impossible** on this testnet: DBUSDC `mint` is TreasuryCap-gated (cap not public), DEEP `mint` returns `FunctionNotFound` on the current package, and a SUI→DBUSDC swap needs DEEP for taker fees (a zero-DEEP swap fills 0 even with a live bid). Needs an **external DBUSDC source** (DeepBook-team faucet, or an address that already holds DBUSDC/DEEP). Once the agent BalanceManager holds DBUSDC: flip `EXECUTION_ENABLED=true` and rerun `npm run demo:loop`; the tick path will replay the execution PTB through `worker/src/executor-adapters.js`.
2. **Browser wallet click-through** — connect Slush (testnet) and run create/revoke from the UI against `VITE_WORKER_URL` (the on-chain txs above prove the underlying Worker path; the current UI now uses Worker-built txs again).
3. **zkLogin live test** (optional) — only if using Enoki instead of a wallet.
