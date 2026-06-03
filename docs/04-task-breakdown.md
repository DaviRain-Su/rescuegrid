# RescueGrid Task Breakdown v1.0

状态：Draft
日期：2026-06-01
定位：RescueGrid：自主 DeFi 风险响应 Agent

任务类型：

- `Commit`：进入主线的生产或项目文档工作，必须保持规格一致。
- `Explore`：验证外部依赖或不确定实现，不能直接当作可发布代码；探索结论进入规格后再转 Commit。

## Phase A - Docs Foundation

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| A1 | Commit | 1h | 固化 PRD | `docs/01-prd.md` 明确 MVP、non-goals、演示闭环 |
| A2 | Commit | 1h | 固化架构 | `docs/02-architecture.md` 明确 Dashboard、Worker、Durable Object、Move、Runtime Core、ExecutorAdapter、Deepbook 边界 |
| A3 | Commit | 2h | 固化技术规格 | `docs/03-technical-spec.md` 明确 Move surface、API、状态机、Guardian、adapter contract |
| A4 | Commit | 1h | 固化任务拆解 | `docs/04-task-breakdown.md` 把后续实现切成 ≤4h 任务 |
| A5 | Commit | 1h | 固化测试规格 | `docs/05-test-spec.md` 明确每个核心行为的测试和 demo 验收 |

## Phase B - External Feasibility Checks

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| B0 | Explore | 3h | 核验 MoveGate 合约稳定性、SDK/PTB 适配性和 Mandate 访问模型 | 确认 contract ABI 稳定、live creation fee 可读取、TypeName/allowed_coin_types 可构造、agent 可在无 owner co-sign 的 PTB 中访问 Mandate，否则触发独立 Policy 回退 |
| B1 | Explore | 2h | 核验 Sui Testnet Deepbook 可用 pool | 记录 pool id、资产、精度、测试资金获取方式 |
| B2 | Explore | 3h | 最小 Deepbook Testnet 下单脚本 | 能完成一笔测试交易或明确 Testnet 阻塞项 |
| B3 | Explore | 2h | 核验 zkLogin 最新接入流程 | 记录 dashboard 登录最小链路和 SDK 版本 |
| B4 | Explore | 2h | 核验 Cloudflare Durable Object alarm/runtime 限制 | 记录 tick 周期、持久状态、部署配置 |
| B5 | Explore | 2h | 验证 MoveGate AuthToken + Deepbook + RescuePolicyWrapper + ActionReceipt 同一 PTB 可组合性 | 仅当 B0 结论为 MoveGate 可用时执行；最小脚本能构建包含 authorize_action → Deepbook swap → record_agent_trade/create_success_receipt 的 PTB |
| B6 | Explore | 1h | pi-worker 快速浏览 | 已产出 [`docs/07-pi-worker-assessment.md`](07-pi-worker-assessment.md)：可作为 operator/agent-session layer，不替换 MVP deterministic Worker hot path |
| B7 | Explore | 2h | pi-worker 深度验证 | 仅当需要 operator console 或 local/cloud agent parity 时运行 terminal-agent 示例；验收为读策略状态和 proposal-only strategy draft，不接触 `AGENT_KEY` |
| B8 | Explore | 2h | LeafSheep/CDPM adapter feasibility note | 明确它只能作为 Post-MVP Sui mainnet PositionManager adapter 参考，不进入 MVP critical path |

## Phase C - Move Package

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| C1 | Commit | 1h | 初始化 Sui Move package + MoveGate 依赖 | `sui move build` 通过，MoveGate 作为外部依赖正确引入 |
| C2 | Commit | 2h | 实现 shared `RescuePolicyWrapper` object 和 events | 字段（含 `mandate_id` 引用）、share object 行为和事件与技术规格一致 |
| C3 | Commit | 3h | 实现 create policy PTB/helper 和 `revoke_policy` | 单笔 PTB 创建 MoveGate Mandate + Wrapper 并确保 Mandate 可被 agent 后续访问；若 PTB 无法稳定构造 MoveGate `TypeName`，用薄 Move helper 负责创建；撤销通过 MoveGate revoke；单元测试覆盖 happy/error path |
| C4 | Commit | 1.5h | 实现 `assert_policy_valid` | 测试覆盖 pool_id、budget、slippage 校验（agent/expiry/revoked 由 MoveGate 覆盖） |
| C5 | Commit | 3h | 实现 `record_agent_trade`（通过 MoveGate receipt 消费 AuthToken） | 测试覆盖 AuthToken 单次消费、ActionReceipt 创建、spent_amount 递增、错误 token 拒绝 |
| C6 | Commit | 1h | Move 单元测试全量通过 | `sui move test` 通过，失败测试覆盖关键 abort |
| C7 | Commit | 2h | Testnet publish script | 可以部署并输出 package id 和 wrapper object id |

## Phase D - Web Dashboard

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| D1 | Commit | 2h | 初始化前端 app | 本地 dev server 可打开 dashboard |
| D2 | Commit | 3h | 实现 zkLogin 登录 UI | 标准 Sui wallet 和 Enoki Google zkLogin 都能作为登录入口，连接后能显示 owner address |
| D3 | Commit | 3h | 实现 intent input + preview panel | 能展示结构化策略、warnings、PTB preview |
| D4 | Commit | 3h | 实现 policy status view | 展示 budget、spent、risk score、runtime state |
| D5 | Commit | 2h | 实现 revoke flow | 用户确认后发起 revoke API |
| D6 | Commit | 2h | 前端错误和空状态 | parse、policy、activity 失败有明确 UI 状态 |

## Phase E - Worker and Durable Object

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| E1 | Commit | 2h | 初始化 Cloudflare Worker project | 本地 wrangler dev 可运行 |
| E2 | Commit | 3h | 实现 `/api/intents/parse` | 支持 risk_response 模板和错误响应 |
| E3 | Commit | 3h | 实现 `/api/policies` | 能提交 create policy 或生成签名请求 |
| E4 | Commit | 2h | 实现 `/api/policies/:wrapper_id/activity` | 能聚合 Mandate、Wrapper、chain event 和 runtime state |
| E5 | Commit | 3h | 实现 Durable Object policy runtime | 每个 policy 独立状态，支持 alarm tick |
| E6 | Commit | 3h | 实现 Guardian checks | 按技术规格顺序检查 `ExecutionPlan` 并返回 blocked reason |
| E7 | Commit | 3h | 实现 `/api/agent/tick` | 支持 no-op、blocked、executed、stopped 状态 |
| E8 | Commit | 2h | 状态同步与恢复 | activity API 以链上状态为准，runtime stale 时自动纠正 |
| E9 | Commit | 3h | 实现 Runtime Core + adapter registry | Runtime Core 能选择 `deepbook` adapter；未知 `executor_kind` 返回 `UNSUPPORTED_EXECUTOR` |

## Phase F - Protocol Execution Adapter

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| F1 | Commit | 3h | 固化 `deepbook` ExecutorAdapter | 基于 Phase B 结论实现选定 pool 的 market read、plan、preview、PTB build |
| F2 | Commit | 3h | 集成 Deepbook SDK/Transaction Builder | Worker 能构建交易 payload |
| F3 | Commit | 3h | 把 authorize_action、Deepbook call、ActionReceipt 和 Wrapper record 放入同一执行链路 | 成功交易会产生 MoveGate ActionReceipt 和 `AgentTradeExecuted` |
| F4 | Commit | 2h | 失败恢复和幂等处理 | 重试不会重复扣预算；runtime activity 按 tx digest 去重，chain `AgentTradeExecuted` 胜过同 digest runtime 成功行，后续更强成功证据可替换旧 unresolved/error 行 |

## Phase G - Demo Hardening

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| G1 | Commit | 2h | Demo seed/config | 一条命令输出所需 env、package id、agent address |
| G2 | Commit | 2h | Demo script | `npm run demo:loop` 覆盖 create -> activate/monitor -> internal tick -> revoke -> post-revoke tick；若 DBUSDC/DEEP 未到位，execute leg 必须明确输出 documented funding gate 且 `execution_claimed=false` |
| G3 | Commit | 2h | README quickstart | 新用户能按步骤跑起演示 |
| G4 | Commit | 3h | Final docs + QA pass | 子验收 1：PRD/架构/规格与实际实现保持一致；子验收 2：用浏览器、Worker 日志和链上查询验证完整闭环 |
| G5 | Commit | 1h | External funding handoff | `npm run funding:request` 输出 public BalanceManager、DBUSDC/DEEP coin type、缺口数量和后续验证命令；`npm run funding:watch:report` 持久化同一 readiness gate 的 machine-readable JSON；不泄漏任何 secret |
| G6 | Commit | 1h | Live safety negative-path validator | `npm run safety:negative` 用 live Worker + Sui Testnet fixture policy 证明 over-budget、over-slippage、wrong pool/agent、mandate mismatch、expired、revoked 全部通过 `/api/execution/validate-plan` 在提交前被挡住，且 wrapper spend / execution success activity 不变；`npm run safety:negative:report` 只在全量通过后写 `.rescuegrid/safety-negative-report.json` |
| G7 | Commit | 1h | Browser wallet evidence artifact | `npm run wallet:evidence -- --format markdown --out .rescuegrid/wallet-clickthrough-evidence.md` 生成只读、gitignored 的 Slush/std wallet create/revoke 证据模板，列出 frontend preflight、Worker public state、runtime/readiness signer posture、create tx、wrapper、mandate、revoke tx 和截图字段；`npm run wallet:evidence:preflight` 在手工 QA 前要求本地 frontend、登录边界和 Worker public state 就绪；`npm run wallet:evidence:verify -- --input .rescuegrid/wallet-clickthrough-evidence.md` 校验填好的 tx/event 一致性和 Worker detail create/revoke activity 同步；生成模板或 preflight 通过不得被当作已完成 click-through |
| G8 | Commit | 1h | Mission readiness gate | `npm run mission:readiness` 汇总 validation scripts、safety-negative report、真实钱包证据、funding readiness 和 strict `AgentTradeExecuted` report；`npm run mission:readiness:report` 持久化同一份 JSON 到 `.rescuegrid/mission-readiness-report.json`；只有全部通过才返回 `status=ready`，当前资金/钱包/执行证据未完成时必须返回 `status=blocked` 且不得创建 policy 或提交 PTB |

Current G5 implementation status: `worker/scripts/funding-handoff.mjs`, `worker/scripts/funding-watch.mjs`, root `npm run funding:request`, `npm run funding:watch` and `npm run funding:watch:report` reuse `buildExecutionReadiness` to produce a read-only external funding request/watch. The output includes public agent / BalanceManager ids, DeepBook pool, DBUSDC/DEEP coin types, observed/required/missing amounts, signer readiness, signer capability matrix, WaaP external-signer posture, blocker codes and the next `npm run daemon -- status --json` / `npm run funding:watch -- --json` / `npm run funding:watch:report` / `npm run demo:execute` verification commands. `npm run funding:request -- --format markdown --out .rescuegrid/funding-request.md` writes the same secret-safe handoff as a gitignored provider artifact, and `npm run funding:watch:report` writes `.rescuegrid/funding-watch-report.json` with the latest blocked/ready execution gate. It does not create policies, submit PTBs or print secrets while blocked.

Current G6 implementation status: `worker/scripts/validate-safety-negative-paths.mjs` is exposed at root as `npm run safety:negative` and `npm run safety:negative:report`. It is intentionally live-Testnet and secret-safe: it creates a current-run active policy and a short-lived expired policy using the scripted agent-key owner path, validates the safety blockers through the non-mutating Worker `/api/execution/validate-plan` endpoint, revokes the active policy, and verifies no spend or execution-success activity was created. The report variant writes `.rescuegrid/safety-negative-report.json` only after all required blockers are proven.

Current G7 implementation status: `scripts/wallet-clickthrough-evidence.mjs` is exposed at root as `npm run wallet:evidence`, `npm run wallet:evidence:preflight` and `npm run wallet:evidence:verify`. It is read-only: it can fetch frontend reachability, source-level login guardrails, public Worker root/runtime/readiness/chain-data posture, signer capability kind list, selected signer capability and WaaP external-signer posture, writes a gitignored `.rescuegrid/wallet-clickthrough-evidence.md` artifact, keeps `actual_clickthrough_completed=false` until manually filled, records required owner/create/revoke/wrapper/mandate/screenshot evidence fields, and verifies a filled artifact against Sui `PolicyCreated` / `PolicyRevoked` transaction events plus Worker detail create/revoke activity and revoked-state reads without claiming DeepBook execution. Direct verifier runs may treat Worker reads as optional unless `--require-worker` is passed; the final `mission:readiness` gate requires Worker detail evidence. The preflight path fails before manual QA if the local frontend, explicit no-auto-connect login boundary or Worker public state is not ready.

Current G8 implementation status: `scripts/mission-readiness.mjs` is exposed at root as `npm run mission:readiness` / `npm run mission:readiness:report` and covered by `npm run test:mission-readiness`. It is a read-only final PRD gate: required package scripts must exist, safety-negative evidence must come from `.rescuegrid/safety-negative-report.json` and prove live Sui Testnet active/expired wrapper ids plus revoke tx, wallet click-through evidence must verify against Sui create/revoke events and Worker detail activity, execution funding readiness must pass through the same `buildExecutionReadiness` contract as `/api/execution/readiness` / `funding:watch` and include signer capability / external-signer posture, and strict execution must provide `.rescuegrid/demo-execute-report.json` from `npm run demo:execute:report` proving the full create -> execute -> revoke -> post-revoke loop for one wrapper. That strict report must include Testnet purpose/chain metadata, wrapper/mandate/strategy ids, successful create and revoke txs, all G2 loop assertions, `AgentTradeExecuted` evidence, `execution_claimed=true`, spend increase, a tick tx digest, and post-revoke `POLICY_REVOKED` / `execution_claimed=false` no-execution evidence with create/execute/revoke event types. The report variant writes the aggregate readiness JSON even when status is `blocked`, so reviewers can inspect the exact remaining blockers without treating the artifact as completion. It intentionally returns blocked in the current repo state until DBUSDC/DEEP funding, filled browser-wallet evidence and strict execution evidence exist; fresh checkouts must also regenerate the gitignored safety report artifact.

## Phase H - Post-MVP Composability

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| H1 | Explore | 3h | Local CLI daemon design spike | 明确 `rescuegrid daemon run/status/tick/logs` 命令、key storage、外部 signer 和 activity sync |
| H2 | Commit | 4h | 抽出 Runtime Core package | Worker 和 CLI daemon 可复用 PolicyReader、Guardian、ExecutorAdapter registry、ActivityWriter 接口 |
| H3 | Commit | 4h | Sui Top 25/26 registry and watch data layer | DefiLlama Sui non-CEX Top 25/26、volume exceptions、Sui RPC、public pool API 被统一映射成 protocol、venue、market、risk metadata；CEX 和 non-Sui venue 不得进入当前分支 |
| H4 | Explore | 4h | Liquid Sui DEX adapter design | 明确 DeepBook、Cetus、Bluefin Spot、Turbos、Momentum 的 quote/depth/pool/position constraints；Magma、STEAMM、Aftermath AMM 等长尾 DEX 只有连续达标才进入执行候选 |
| H5 | Explore | 4h | Sui lending execution design | 明确 NAVI、Suilend、Scallop、AlphaLend 的 market id、collateral/debt state、repay sizing、withdrawal liquidity、stale-state pre-step 和 hot-potato ticket 约束 |
| H6 | Explore | 3h | Watch-only protocol design | 明确 Bucket、Current、SpringSui、Haedal、Volo、AlphaFi、Kai、Mole、Ondo、KAIO、MatrixDock、Ember、Bluefin Pro、Sudo、DipCoin 的可读状态、redemption/liquidity/issuer/margin 风险和禁止执行边界 |
| H7 | Commit | 4h | Adapter SDK skeleton | 新 adapter 必须提供 readMarket、planExecution、buildPtb、parseExecutionResult、liquidity gate、volume gate 和 conformance tests |
| H8 | Commit | 3h | Liquid Sui DEX read adapters | DeepBook、Cetus、Turbos、Momentum、Bluefin Spot 暴露 quote/depth/spread read model 和 SUI/USD-stable spread matrix；非 DeepBook 不得注册 executor |
| H9 | Commit | 3h | Sui lending read adapters | NAVI、Suilend、Scallop、AlphaLend 暴露 reserve、obligation、health-factor 和 liquidation-buffer read model；不得注册 repay/withdraw/borrow executor |

Current H1/H2 implementation status: `npm run daemon -- status|policies list|watch list/add/remove/sync|tick|run|logs` uses the same Runtime Core and ChainDataProvider boundaries as the Worker. `watch sync --owner <0x...>` persists only active agent-matching wrappers into `.rescuegrid/daemon.json`; `run` then ticks the persisted watched set and writes local JSONL activity logs. Live local submission still requires `--execution-enabled`, local daemon signer mode and real DBUSDC/DEEP funding.

Current H3 implementation status: `/api/protocols` exposes the Sui protocol coverage registry, and `/api/protocols/watchlist` exposes 31 Sui-only market rows with protocol, venue, market, risk, adapter and data-source metadata. DeepBook is represented as the only configured executor path, but market watch rows keep `execution_enabled=false` and `execution_blocker_code=FUNDING_GATED` until live DBUSDC/DEEP funding is available.

Current H4/H5 implementation status: `/api/adapters/candidates` exposes the Sui-only adapter constraint registry. Cetus, Turbos and Momentum are represented as CLMM candidates with `clmm_pool_id` / tick-range / position semantics; Bluefin Spot is represented as a route-constrained spot aggregator candidate, not a broad signer target. Suilend and Scallop have SDK-confirmed lending schemas with lending market, reserve, obligation and owner-cap/key constraints. NAVI and AlphaLend remain `research_pending` until SDK/package-address and position semantics are verified. All rows keep `registered_executor=false` and `execution_enabled=false`.

Current H6 implementation status: `/api/protocols/watch-boundaries` exposes 15 Sui-only watch boundaries for Bucket, Current, SpringSui, Haedal, Volo, AlphaFi, Kai, Mole, Ondo, KAIO, MatrixDock, Ember, Bluefin Pro, Sudo and DipCoin. The registry records readable state, redemption/liquidity/issuer/margin risk domains, future target fields and no-execution reasons. DipCoin is `roadmap_only` because it is not in the current DefiLlama top-26 registry baseline; all rows keep `registered_executor=false`, `execution_enabled=false` and `execution_blocker_code=WATCH_ONLY_BOUNDARY`.

Current H7 implementation status: `worker/src/executor-adapter-sdk.js` is the adapter SDK skeleton. It defines the required interface, liquidity/volume gate methods, conformance requirements, `createAdapterGate`, registry construction and unsupported-executor helpers. `worker/src/deepbook-adapter.js` is the first plugin, while `worker/src/executor-adapters.js` only assembles the registered registry. `worker/test/executor-adapter-sdk-test.mjs` and `worker/test/executor-adapters-test.mjs` lock the SDK contract, duplicate-kind rejection, missing-method rejection, DeepBook target support and unsigned PTB build boundary.

Current H8 implementation status: `/api/adapters/dex-reads` exposes 5 Sui-only DEX read adapters: DeepBook order book, Cetus CLMM, Turbos CLMM, Momentum CLMM and Bluefin Spot route aggregator. The surface records 8 supported market rows and a 10-row SUI/USD-stable spread matrix. It intentionally returns read schemas and comparable quote/depth fields, not live computed arbitrage. DeepBook remains the only existing execution adapter and stays `FUNDING_GATED`; every other row is `READ_ONLY_ADAPTER`, `execution_enabled=false` and `autonomous_execution_allowed=false`.

Current H9 implementation status: `/api/adapters/lending-reads` exposes 4 Sui-only lending read adapters: NAVI, Suilend, Scallop and AlphaLend. The surface records 5 supported market rows and a 4-row borrow-health matrix with reserve, obligation, health-factor, liquidation-buffer, oracle freshness and repay dry-run fields. Suilend and Scallop are `READ_ONLY_LENDING_ADAPTER`; NAVI and AlphaLend are `RESEARCH_PENDING_READ_ONLY`. All rows keep `registered_executor=false`, `execution_enabled=false` and `autonomous_execution_allowed=false`.

## Phase I - Post-MVP Multivenue Expansion

Phase I is a product expansion track, not a hackathon dependency. Planning baseline: [`docs/06-post-mvp-multivenue-roadmap.md`](06-post-mvp-multivenue-roadmap.md).

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| I1 | Explore | 4h | VenueAccount data model spike | 明确 Sui policy、EVM smart account、Solana delegate、Hyperliquid API wallet、CEX subaccount/API key 的统一字段和差异字段 |
| I2 | Explore | 4h | Hyperliquid adapter feasibility | 核验 API wallet、subaccount/vault、nonce、expiresAfter、TWAP、leverage/margin、revocation UX，产出 paper-trade adapter spec |
| I3 | Explore | 4h | OKX/Binance CEX adapter safety model | 明确 trade-only key、IP allow-list、subaccount、no-withdraw 默认、order id evidence、local signer 或 signer service 边界 |
| I4 | Explore | 4h | LI.FI settlement adapter feasibility | 核验 quote/status/chains/tokens/tools endpoints、Sui/Solana/EVM 覆盖、失败恢复和 API rate limits；只作为再平衡/settlement adapter |
| I5 | Explore | 4h | deBridge settlement adapter feasibility | 核验 DLN route、order tracking、cancel/reclaim、hooks、success-required/non-atomic 行为；只作为再平衡/settlement adapter |
| I6 | Commit | 4h | StrategyMandate v2 draft spec | 明确 `venue_scope`、`settlement_scope`、per-venue budget、bridge fee/ETA、human-confirm action set 和 mandate hash |
| I7 | Commit | 4h | ActivityEvent v2 draft spec | 支持 chain tx、CEX order id、Hyperliquid cloid、bridge order id、quote id、partial/recoverable 状态 |
| I8 | Explore | 4h | Cross-venue inventory model | 明确预置库存、再平衡阈值、桥不进 hot path、套利只从 paper/tiny-size 开始 |

## Phase J - Post-MVP Sui Data, Privacy and Signer Hardening

Phase J is based on [`docs/08-sui-data-agent-stack-assessment.md`](08-sui-data-agent-stack-assessment.md). It is not a hackathon dependency, but it should start before production because Sui JSON-RPC has a published deactivation deadline.

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| J1 | Explore | 3h | ChainDataProvider design | Worker reads are behind `ChainDataProvider`; current JSON-RPC/SuiClient path remains as `JsonRpcChainDataProvider` |
| J2 | Commit | 4h | GraphQL policy/activity read spike | Implement read-only GraphQL provider for policy list, wrapper snapshots and activity history; compare output against current Worker endpoints |
| J3 | Explore | 3h | gRPC monitoring spike | Decide whether agent tick should use gRPC streaming for price/event triggers or keep timer polling for MVP-like policies |
| J4 | Explore | 3h | Archival Store history/replay design | Define historical activity, performance replay and judge/demo replay queries that need archival-backed data |
| J5 | Explore | 4h | Seal + Walrus private policy record design | Define encrypted strategy snapshot, backtest, reasoning trace and incident report schema; explicitly exclude wallet/agent private keys |
| J6 | Explore | 3h | Sui Stack CRM pattern adaptation | Map shared-object ACL + Walrus blob id + version events into `PolicyPrivateRecord` or equivalent object design |
| J7 | Explore | 4h | WaaP/external signer adapter design | Draft `SignerAdapter` for `worker-secret`, `local-daemon`, `waap`, `hardware`, `remote-signer`; validate whether `waap-cli send-tx --tx-json ... --chain sui:testnet` can sign a Guardian-approved RescueGrid PTB; require security review before production submission |
| J8 | Commit | 1h | Sui Agent Skills setup note | Add recommended Sui skills to engineering setup for data access, PTBs, Move tests, publish and frontend dApp Kit workflows |

Current J1/J2 implementation status: `worker/src/chain-data-provider.js` now keeps `JsonRpcChainDataProvider` as the default Worker read provider and adds a configurable `GraphqlChainDataProvider` spike. The GraphQL provider supports wrapper/mandate object snapshots, policy-module events, owner policy lists, owner activity and owner summary through an injected transport or `SUI_GRAPHQL_URL` / `SUI_GRAPHQL_ENDPOINT`; balance, gas and DeepBook market reads still fall back to JSON-RPC. `/api/chain-data/status` and `npm run chain-data:status -- --json` expose the same secret-safe provider posture; `--probe` runs a bounded read probe, and `--provider graphql --owner <0x...> --wrapper-id <0x...> --json` compares GraphQL owner-policy/activity output against JSON-RPC without printing endpoint URLs. `worker/test/chain-data-provider-test.mjs` and `worker/test/chain-data-status-cli-test.mjs` compare the GraphQL-shaped fixture output against the current Worker read shapes and CLI redaction rules. Real endpoint enablement still requires validating the query shape against the latest Sui GraphQL schema.

Current J3 implementation status: `worker/src/monitoring-provider.js` adds an explicit MonitoringProvider posture for runtime status. The default `timer-polling` provider remains active and keeps Durable Object alarms as the tick driver. `MONITORING_PROVIDER=grpc` is visible as a disabled spike boundary only: it can report endpoint configured, but it returns `GRPC_MONITORING_NOT_IMPLEMENTED`, keeps `execution_hot_path_unchanged=true`, and never takes over Runtime Core scheduling until a real streaming integration and replay contract are validated.

Current J4 implementation status: `worker/src/archival-replay.js` and `/api/archival/replay-contract` define the Worker-first archival replay contract for `historical_activity`, `performance_replay` and `judge_demo_replay`. The default provider is `none` with `ARCHIVAL_REPLAY_DISABLED`; `ARCHIVAL_REPLAY_PROVIDER=archival-store` can only report endpoint posture and remains `not_validated` until query shape, replay reconciliation and secret redaction are tested against a real provider. Data Sources displays this replay contract as replay-only and non-executable.

Current J5 implementation status: `worker/src/private-policy-records.js` and `/api/private-records/contract` define the Worker-first private policy record contract for Seal + Walrus. The default provider is `none` with `PRIVATE_RECORDS_DISABLED`; `PRIVATE_RECORD_PROVIDER=seal-walrus` reports only Seal/Walrus posture and remains `not_validated` even when both are configured until encrypted write/read, Sui ACL and chain-anchor validation land. Initial record contracts cover `strategy_snapshot`, `backtest_report`, `agent_reasoning_trace` and `incident_report`, all with client-side encryption required and `signing_secret_allowed=false`. Data Sources displays the contract as storage-only and non-executable.

Current J6 implementation status: the same `/api/private-records/contract` now includes the Sui Stack CRM-style `PolicyPrivateRecord` object contract. It maps the future shared object fields, reader ACL, version table, optimistic `expected_current_version` flow, operation contracts and plaintext-free event contracts for create/version/grant/revoke/archive. This is still `contract_only`: no Move module, no mutation endpoint and no Seal/Walrus storage hot path are enabled yet.

Current J7 implementation status: `worker/src/signer-adapters.js` now exposes explicit signer kinds (`worker-secret`, `local-daemon`, `waap`, `hardware`, `remote-signer`) and `worker/src/runtime-status.js` exposes `/api/runtime/status` for non-secret cloud agent, signer, execution and data-provider status. The runtime status includes a public `signer_capabilities` matrix plus `external_signer` posture so Profile/Risk can distinguish known signer kinds from execution-ready signer paths. `worker-secret` and `local-daemon` derive the configured secret public address and remain unavailable with `INVALID_SIGNER_SECRET` or `SIGNER_ADDRESS_MISMATCH` unless it matches the deployed RescueGrid agent. `waap` now has a local-daemon-only CLI adapter spike: it stays `UNSUPPORTED_SIGNER` by default and in Cloud Worker mode, and becomes available only when `RESCUEGRID_DAEMON_MODE=true`, `RESCUEGRID_WAAP_CLI_ENABLED=true`, the configured `RESCUEGRID_WAAP_SUI_ADDRESS` matches the deployed RescueGrid agent, and the local daemon injects the reviewed WaaP submission runner; otherwise the matched-address posture returns `WAAP_RUNNER_MISSING`. The adapter serializes the RescueGrid PTB to Sui `tx_json`, sets sender to the agent address, and hands it to an injected `waap-cli send-tx --tx-json ... --chain sui:testnet --json` runner. It parses single JSON and result-event NDJSON, accepts common Sui digest keys, and maps approval-pending, approval-denied, policy-blocked and timeout outcomes to stable non-success codes. Runtime tick handling now converts those signer outcomes into non-submitted `blocked` activity with `signer_kind` and `approval_state`; Agent Activity can filter signer blocks, treat WaaP approval states as approval-required rows, and show signer kind, approval state and signer blocker codes in the expanded audit row. This proves command composition, signer boundary and local failure-state mapping in tests, but real WaaP execution still needs a live WaaP session, approval/privilege validation and security review before production use.

Current J8 implementation status: [`docs/10-engineering-setup.md`](10-engineering-setup.md) maps the recommended Sui Agent Skills to RescueGrid work areas, validation commands and guardrails. The setup keeps skills as developer workflow references only, with Worker-first reads, Sui-only hackathon scope, no secret storage in docs/logs/Walrus/Seal, and no live-execution claims without adapter/funding evidence.

## Phase K - Post-MVP Product Breadth and Frontend Design

Phase K is based on [`docs/09-market-product-and-frontend-roadmap.md`](09-market-product-and-frontend-roadmap.md). It turns market research into design and implementation backlog. It is not a hackathon dependency, but it should guide the next product demo because the current UI still reads as one rescue strategy rather than a composable DeFi agent platform.

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| K1 | Explore | 2h | Competitor/product matrix | Confirm comparable products and extract UI patterns for AI agents, automation, vaults, perps funding, lending and LP managers |
| K2 | Commit | 4h | Strategy Marketplace shell | Add category tabs, strategy cards, adapter badges, risk badges and availability status; unsupported templates must be clearly marked coming soon |
| K3 | Commit | 4h | Opportunity Scanner shell | Add funding heatmap, perp spread matrix, lending APY table, LP opportunity table and stablecoin peg monitor using mock or read-only data |
| K4 | Commit | 4h | Strategy detail templates | Add detail views for Funding Rate Harvest, Lending Optimizer and LP Range Manager with capital flow, yield decomposition, risk decomposition and Guardian rules |
| K5 | Explore | 3h | Strategy Builder v2 design | Specify multi-leg template selection, venue/adapters, capital constraints, PTB/action preview, Guardian checks and signer/agent mode |
| K6 | Commit | 4h | Active Strategy Detail v2 | Show live legs, net exposure, PnL/carry attribution, open orders, last tick, next tick, pending approvals and pause/resume/revoke actions |
| K7 | Commit | 3h | Risk Center | Show global budget, strategy controls, venue caps, liquidation watch list, oracle/source health, signer status, stale-data warnings and global / strategy / venue emergency-stop controls |
| K8 | Commit | 3h | Agent Ledger v2 | Add strategy/venue/status filters plus expandable rows for reason, input snapshot, execution plan, Guardian result, tx/order id and budget impact |

Current K2/K4 implementation status: Strategy Marketplace and Strategy Detail now consume Worker adapter readiness through `src/queries/adapter-surfaces.js`. Catalog tabs include Funding and Perps, strategy cards show read-only/coming-soon/available states, and adapter badges reflect exact Worker blockers such as `FUNDING_GATED`, `READ_ONLY_ADAPTER`, `READ_ONLY_LENDING_ADAPTER` and `RESEARCH_PENDING_READ_ONLY`. Non-DeepBook templates open read-model detail instead of jumping to policy preview; detail pages show the same adapter readiness plus current read-only permissions.

Current K3 implementation status: Market Monitor now consumes Worker adapter surfaces through `src/queries/adapter-surfaces.js`. The Sui DEX Spreads tab shows `/api/adapters/dex-reads` counts, spread rows and execution blockers; the Yield Monitor shows `/api/adapters/lending-reads` counts, health rows and lending execution blockers. Data Sources also shows both Worker adapter surfaces alongside the feed list. These UI surfaces are read-only and must not imply non-DeepBook execution.

Current K5/K6 implementation status: Strategy Builder now reuses the shared readiness helper in `src/queries/strategy-readiness.js`, shows a Builder-level adapter readiness panel, and blocks final deploy for templates whose selected adapters are read-only, missing, or only watch surfaces. DeepBook-only templates can still preview/create the policy shape; multi-venue Sui templates such as Cetus, Scallop/NAVI/Suilend and Bluefin Pro stay read-only until their executor and wrapper target constraints exist. Active Strategy Detail v2 shows live legs, net exposure, PnL/carry, open orders, execution ticks, pending approvals and Guardian limits; the Sui inventory flow uses Sui venue labels only and no longer crashes when a venue node is opened.

Current K7 implementation status: Risk Center now exposes the full Sui-first risk-control surface: global risk and daily-loss budgets, strategy-level pause/resume controls, Sui venue stop/resume controls, venue exposure caps, liquidation watch, oracle health, signer/executor health, stale-data warning summaries, Guardian rule editor/simulator and the capability matrix. In live wallet mode, global / strategy / venue controls use owner-signed Sui personal messages to persist Worker Durable Object runtime controls. Tick reads those controls after trigger evaluation and before PTB signing, returning `GLOBAL_STOPPED`, `STRATEGY_STOPPED` or `VENUE_STOPPED` for matching owner controls. This is a runtime pre-submit gate, not a MoveGate Mandate revoke.

Current H/K accounts implementation status: Profile consumes the Worker `/api/runtime/status` read surface and shows the runtime signer kind, signer capability matrix, deployment agent, execution blocker, chain data-provider mode, WaaP local-daemon-only boundary, permission-token posture and submission-runner posture. This is status transparency only; it does not enable `waap`, hardware or remote signer execution.

Current K8 implementation status: Agent Activity now builds a normalized ledger row model for demo and live rows, inferring strategy, Sui venue, status, Guardian block state, signer block state, human-approval state and tx/order identifiers. The view adds strategy, venue, status, signer block and tx/order/policy search filters while preserving quick event/outcome filters. Expanded rows now include explicit tx digest, venue order id, ledger status, signer kind, approval state, signer blocker codes, reason, input snapshot, execution plan, Guardian result, PnL impact and budget impact.

## Hackathon Critical Path

MVP 任务清单约 76h（含 B8 feasibility note 和 E9 adapter registry），Phase H 约 18h 且不进入 hackathon critical path。单人 hackathon 应优先跑最小可演示闭环。Critical path 只保留证明 Sub-track 2 的必要任务：

1. A1-A5：锁定文档契约。
2. B0、B1、B2、B5：先验证 MoveGate 适配性与 Mandate 访问模型、Deepbook pool、最小下单和 AuthToken + Deepbook + Wrapper + ActionReceipt 同一 PTB 可组合性；B5 仅在 B0 通过后执行。
3. C1-C4、C6、C7：完成 Wrapper 合约、Policy 创建/撤销/授权校验和 Testnet publish；Guardian block 只写 runtime log，不写链上 block event。
4. E2、E3、E6、E7、E8、E9：实现 parse、policy create、Guardian、agent tick、状态同步和 adapter registry。
5. F1、F3：固化 Deepbook adapter，并把 MoveGate AuthToken + Deepbook + ActionReceipt + Wrapper record 接入同一执行链路。
6. D2-D5：Dashboard 只做登录、preview、status、revoke 的最小 UI。
7. G1、G2、G4：跑通配置、demo script 和最终验证。

Polish 可延后：D1 的完整视觉打磨、D6 的细粒度空状态、B7 pi-worker 深度验证、B8 LeafSheep/CDPM 深度验证、F4 幂等增强、Phase H、Phase I、Phase J、Phase K、Post-MVP browser QA。

如果 B0 发现 MoveGate 不适合，退回到独立实现 RescuePolicy Object（回退为旧版 Phase C 估计 14h）。

## Dependency Order

1. Phase A must be complete before implementation.
2. Phase B must complete before committing Deepbook or zkLogin production code.
3. B5 depends on B0 returning "MoveGate usable"; skip B5 and switch to the independent `RescuePolicy` fallback if B0 fails.
4. Move Package should land before Worker execution code.
5. Worker parse/preview can start before Move publish, but must use the technical spec types.
6. Dashboard D2 has no Worker dependency; it only needs the chosen zkLogin path.
7. Dashboard D3 can use mocked `/api/intents/parse` until E2 exists.
8. Dashboard D4 needs E3/E4 for real Policy data, but may start with fixtures.
9. Dashboard D5 needs E3 or the final revoke API shape before real-chain testing.
10. Demo Hardening starts only after one Testnet transaction is confirmed.
11. Post-MVP adapters depend on Runtime Core + adapter registry; they must not be implemented by branching Deepbook-specific runtime code.
12. Phase I depends on Phase H adapter boundaries and must not change hackathon MVP acceptance.
13. Phase J depends on Worker-first read semantics; GraphQL/gRPC migration must not move production reads directly into the frontend.
14. Phase K depends on the adapter registry and Worker-first API shape; frontend breadth must not imply real execution support until an adapter exists.

## Stop Conditions

- MoveGate 合约不可用、Mandate 无法被 agent 无 owner co-sign 访问，或与 RescueGrid 需求不兼容：退回到独立实现 shared RescuePolicy Object；Phase C 估时回到 14h。
- Deepbook Testnet pool is unavailable：stop before Phase C; either find another documented Testnet-compatible Deepbook route, or downgrade the demo to simulated execution and mark Sub-track 2 as blocked in PRD/test spec.
- MoveGate AuthToken + Deepbook + RescuePolicyWrapper + ActionReceipt 无法在同一 PTB 中组合：pause and redesign the Policy execution path.
- Any adapter requires signing or submitting before Guardian approves an `ExecutionPlan`：stop and redesign the adapter interface.
- zkLogin setup blocks demo：allow temporary wallet connect only if PRD marks zkLogin as delayed and demo still proves Policy autonomy.
- Any implementation needs Mainnet funds：stop; MVP scope is Testnet.
