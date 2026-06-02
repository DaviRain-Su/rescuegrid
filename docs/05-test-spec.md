# RescueGrid Test Spec v1.0

状态：Draft
日期：2026-06-01
定位：RescueGrid：自主 DeFi 风险响应 Agent
原则：测试先于生产实现；实现偏离本文件时，先改规格再改测试和代码。

## 1. Test Layers

- Move unit tests：Mandate + Wrapper 创建、撤销、授权、预算、滑点、过期、事件。
- Worker API tests：intent parse、preview、policy API、activity API、runtime status、agent tick。
- Guardian tests：各类 block reason 和允许路径。
- ExecutorAdapter tests：adapter registry、ExecutionPlan、preview、PTB build conformance。
- Integration tests：Worker + Sui Testnet package + Deepbook execution。
- Browser QA：Dashboard 登录、确认、状态展示、撤销。
- Demo acceptance：完整 create -> autonomous execute -> activity log -> revoke -> blocked-after-revoke 闭环。

## 2. Move Tests

### `create_policy`

Happy path:

- owner 创建有效 Policy（同时创建 MoveGate Mandate + RescuePolicyWrapper），事件 `PolicyCreated` 包含 `mandate_id` 和 `wrapper_id`。
- `budget_ceiling > 0` 且 `max_slippage_bps <= MAX_ALLOWED_SLIPPAGE_BPS` 创建成功。
- 创建后的 `RescuePolicyWrapper` 是 shared object，MoveGate Mandate 也必须可被授权 agent 后续无 owner co-sign 引用。
- `mandate_id` 在 Wrapper 中正确关联。
- MoveGate creation fee payment、FeeConfig、ProtocolTreasury、MandateRegistry、AgentRegistry 和 AgentPassport 参数全部正确传入。

Boundary:

- `max_slippage_bps == MAX_ALLOWED_SLIPPAGE_BPS` 创建成功。
- `expires_at_ms` 恰好等于最大生命周期边界时创建成功。
- MoveGate Mandate expiry 采用 `now_ms < expires_at_ms`，因此执行时 `now_ms == expires_at_ms` 必须被视为 expired。

Error / attack:

- `budget_ceiling == 0` abort。
- `max_slippage_bps > MAX_ALLOWED_SLIPPAGE_BPS` abort。
- `expires_at_ms <= now_ms` abort。
- `expires_at_ms` 超过最大生命周期 abort。
- `agent == @0x0` abort。

### `revoke_policy`

Happy path:

- owner 撤销未撤销 Policy，调用 MoveGate `revoke_mandate`，发出 `PolicyRevoked`。
- MoveGate Mandate 的 `revoked` 标志被设置。

Boundary:

- 临近过期但未过期的 Policy 仍可撤销。

Error / attack:

- 非 owner 撤销 abort。
- 重复撤销 abort（MoveGate 层拒绝）。

### `assert_policy_valid`

Happy path:

- 正确 pool_id、预算、滑点、agent 匹配时通过。
- 注意：agent/revoked/expiry 由 MoveGate `authorize_action` 层检验，`assert_policy_valid` 只检查 RescueGrid 特有约束。

Boundary:

- `spent_amount + amount == budget_ceiling` 通过。
- `slippage_bps == max_slippage_bps` 通过。

Error / attack:

- 错误 pool abort。
- 错误 agent abort。
- `spent_amount + amount > budget_ceiling` abort。
- `slippage_bps > max_slippage_bps` abort。
- `spent_amount + amount` 溢出 abort。

### `record_agent_trade`

Happy path:

- 成功记录交易后 `spent_amount` 增加。
- MoveGate AuthToken 通过 `movegate::receipt::create_success_receipt` 被正确消费（PTB 结束后无法再使用）。
- MoveGate ActionReceipt 被创建并 freeze。
- 事件 `AgentTradeExecuted` 包含 `mandate_id`、`wrapper_id`、agent、pool、spent after、budget、slippage、client order id、timestamp。
- Dashboard 从事件 metadata 读取 transaction digest。

Boundary:

- 最后一笔交易刚好花完预算。

Error / attack:

- `quote_amount_spent == 0` abort。
- 非授权 agent abort。
- 超预算 abort。
- 撤销后记录 abort（MoveGate AuthToken 无法从已撤销 Mandate 获得）。
- AuthToken 来源不是当前 Policy 关联的 Mandate abort。
- AuthToken protocol 不是 `RESCUEGRID_PROTOCOL_ADDRESS` abort。
- AuthToken amount 不等于 `quote_amount_spent` abort。

### Guardian block runtime log

Happy path:

- Guardian block 写入 Worker runtime activity log。
- 不提交 Deepbook transaction。
- 不创建 MoveGate ActionReceipt。
- 不改变 `spent_amount`。

## 3. Worker API Tests

### `POST /api/intents/parse`

Happy path:

- 输入“当 SUI 下跌超过 8% 时启动 500 USDC 风险响应策略。”返回 `status=ok`。
- 响应包含 `strategy`、`strategy_hash`、`guardian_warnings`、`ptb_preview`。
- `strategy.strategy_type` 必须等于 `risk_response`。
- `strategy.executor_kind` 必须等于 `deepbook`。
- 响应包含部署配置中的 `agent_address`，且 preview 明确展示该 address。
- preview 必须包含 owner、agent、executor、pool、budget、slippage、expiry。

Boundary:

- 用户省略滑点时使用 `DEFAULT_MAX_SLIPPAGE_BPS`。
- 用户省略过期时间时使用默认有效期，但不超过最大生命周期。
- `strategy_hash` canonicalization 覆盖空输入、中文输入和大数字 decimal string；必须匹配 `docs/03-technical-spec.md` 的 hash vectors。

Error:

- 缺失预算返回 `INTENT_AMBIGUOUS`。
- 不支持 chain 返回 `UNSUPPORTED_CHAIN`。
- 不支持 strategy 返回 `UNSUPPORTED_STRATEGY`。
- 不支持 executor 返回 `UNSUPPORTED_EXECUTOR`。
- 滑点超过硬上限返回 `GUARDIAN_STATIC_BLOCK`。

### `POST /api/policies`

Happy path:

- `confirmed=true` 且 strategy hash 匹配时返回 owner 待签名的 `tx_json`。
- 成功响应包含 `tx_json`、`strategy_hash`、`agent_address`、`active_policy_count` 和 `max_active_policies`。
- Worker 不持有 owner key，不提交交易，不在本接口激活 Durable Object。
- 前端或脚本用 owner signer 执行 `tx_json` 后，必须从 `PolicyCreated` event 读取 `wrapper_id` 和 `mandate_id`。

Error:

- `confirmed=false` 拒绝。
- `strategy.agent` 不等于部署配置 `RESCUEGRID_AGENT_ADDRESS` 时拒绝。
- strategy hash 不匹配拒绝。
- 活跃 Policy 数达到 `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` 时返回 `ACTIVE_POLICY_LIMIT_REACHED`。
- 返回 `tx_json` 前的链读取失败返回 `CHAIN_READ_FAILED`。

### `POST /api/policies/:wrapper_id/activate`

Happy path:

- create transaction finalize 后，传入 `wrapper_id` 和可选 `strategy` 注册 Durable Object runtime。
- activation 先读取链上 wrapper 和 Mandate，确认未撤销、未过期。
- 如果传入 `strategy`，其 hash 必须匹配链上 wrapper `strategy_hash`。
- 成功返回 `runtime_state=Monitoring`，并写入 runtime activation activity。

Error:

- 不存在的 wrapper 返回 `NOT_FOUND`。
- 不存在的 Mandate 返回 `MANDATE_NOT_FOUND`。
- revoked / expired Policy 分别返回 `POLICY_REVOKED` / `POLICY_EXPIRED`，不激活 Durable Object。
- `strategy_hash` 不匹配返回 `HASH_MISMATCH`。

### `GET /api/policies?owner=`

Happy path:

- 返回 owner 的链上 Policy 列表，不混入 demo fixture。
- 每个 row 使用链上 wrapper/mandate 字段填充 `status`、`revoked`、`expires_at_ms`、budget 和 wrapper 字段。
- Durable Object runtime state 不冲突时可更新 `runtime_state`。
- 链上 terminal state 与 runtime state 冲突时，链上状态优先且 row 返回 `runtime_state_stale=true`。

### `POST /api/policies/:wrapper_id/revoke`

Happy path:

- owner 确认撤销时，Worker 返回 owner 待签名的 revoke `tx_json`、`wrapper_id` 和 `mandate_id`。
- 前端或脚本用 owner signer 执行 `tx_json` 后，后续 list/activity 读到 chain-authoritative `Revoked` 状态。

Error:

- 非 owner 请求拒绝。
- 已撤销 Policy 返回 `ALREADY_REVOKED`，且不返回第二笔 signable revoke transaction。

### `GET /api/policies/:wrapper_id/activity`

Happy path:

- 返回 MoveGate Mandate snapshot、RescuePolicyWrapper snapshot、runtime state、events。
- `activity` 合并链上 `PolicyCreated` / `PolicyRevoked` / `AgentTradeExecuted` feed rows 和 Durable Object runtime feed rows，并按 timestamp 倒序。
- `chain_activity` 单独返回链上 feed rows，便于确认链上审计证据没有被 runtime log 覆盖。
- budget 数字以字符串返回，避免 JS integer loss。
- 当链上状态与 Durable Object runtime state 冲突时，链上状态优先，`runtime_state_stale=true`。
- 同一个 tx digest 只能在合并后的 `activity` 中出现一次；若 runtime 成功记录和链上 `AgentTradeExecuted` 同时存在，链上事件优先。

Error:

- 不存在的 policy 返回 `NOT_FOUND`。
- 链读取失败返回 `CHAIN_READ_FAILED`。

### `GET /api/runtime/status`

Happy path:

- 返回 `chain=sui:testnet`、部署 agent address、BalanceManager id 和 AgentPassport id。
- 默认 signer 为 `worker-secret`；未配置 `AGENT_KEY` 时 `available=false`、`execution_enabled=false`、`blocker_code=EXECUTION_DISABLED`。
- `AGENT_KEY` 不是有效 Sui private key 时，`signer.available=false`、`signer.address=null`、`unavailable_code=INVALID_SIGNER_SECRET`，响应仍不得泄漏原始 secret。
- `AGENT_KEY` 可解析但派生地址不等于部署 agent address 时，`signer.available=false`、`signer.address=<derived public address>`、`signer.expected_address=<deployment agent>`、`unavailable_code=SIGNER_ADDRESS_MISMATCH`。
- `CHAIN_DATA_PROVIDER=graphql` 且配置 `SUI_GRAPHQL_URL` / `SUI_GRAPHQL_ENDPOINT` 时，返回 `chain_data_provider.kind=graphql` 和 `graphql_configured=true`。
- `known_signer_kinds` 包含 `worker-secret`、`local-daemon`、`waap`、`hardware` 和 `remote-signer`。

Security / boundary:

- 响应不得包含 `AGENT_KEY`、owner key、WaaP session file、permission token 或任何 secret value。
- `SIGNER_KIND=waap` 在 adapter spike 通过前必须返回 `UNSUPPORTED_SIGNER`，不能因为文档支持 Sui 就自动打开执行。
- `execution.enabled` 只有在 signer available 且 `EXECUTION_ENABLED=true` 时才为 true。
- Profile / Accounts UI 必须把 status 作为可见状态展示，不能把 `execution_configured=true` 当成可执行。

### `GET /api/execution/readiness`

Happy path:

- 返回 `chain=sui:testnet`、`scope.executor_kind=deepbook`、`scope.market_id=SUI_DBUSDC`、部署 agent address、BalanceManager id 和 AgentPassport id。
- 返回 runtime signer/status evidence、BalanceManager DBUSDC/DEEP、agent SUI gas、thresholds、funding blockers 和 execution blockers。
- 当 `EXECUTION_ENABLED=false` 或 signer unavailable 时，`execution_ready=false` 且 `blocker_codes` 包含执行 blocker。
- 当 BalanceManager 缺少 DBUSDC/DEEP 或 agent 缺少 SUI gas 时，`funding_ready=false` 且 `funding_blocker_codes` 包含对应资产 blocker。
- `dbusdc_threshold`、`deep_threshold`、`sui_gas_threshold` 请求参数只能提高本次检查门槛，不能低于 Worker 配置的 minimum。

Security / boundary:

- 响应不得包含 `AGENT_KEY`、owner key、WaaP session file、permission token 或任何 secret value。
- `execution_claimed` 必须始终为 `false`；只有实际 tick 返回 `AgentTradeExecuted` + spend increase 才能声明执行成功。
- `npm run demo:execute` strict preflight 必须使用该 endpoint，而不是维护第二套资金/签名判断。

### `npm run funding:request`

Happy path:

- 输出 `purpose=external_deepbook_testnet_funding_request`、`chain=sui:testnet`、部署 agent address、AgentPassport id、BalanceManager id、DeepBook `SUI_DBUSDC` pool id、DBUSDC coin type 和 DEEP coin type。
- 输出 BalanceManager DBUSDC / DEEP 的 observed、required、missing、usable 和 blocker code。
- 输出 agent gas address 的 SUI_MIST observed、required、missing、usable 和 blocker code。
- 输出 `next_verification.readiness_command="npm run daemon -- status --json"` 和 `next_verification.strict_execution_command="npm run demo:execute"`。
- 支持 `--dbusdc-threshold` / `--deep-threshold` / `--sui-gas-threshold`，且这些 request threshold 只能通过 `buildExecutionReadiness` 提高门槛，不能弱化 Worker 配置 minimum。

Security / boundary:

- 必须复用 `buildExecutionReadiness`，不能复制一套资金和 signer 判断。
- 必须是 read-only；不得创建 policy、不得提交 PTB、不得修改 BalanceManager。
- 响应不得包含 `AGENT_KEY`、owner key、`INTERNAL_AGENT_TICK_TOKEN`、WaaP session file、permission token 或任何 secret value。
- `execution_claimed` 必须始终为 `false`；`ready_for_strict_execution=true` 只代表 preflight ready，不能代表已经执行成功。

### `POST /api/agent/tick`

Happy path:

- trigger false 返回 `action=no_op`。
- trigger true 且检查通过返回 `action=executed` 和 tx digest。
- tick 必须通过 adapter registry 选择 `deepbook` adapter；不能直接调用 Deepbook-specific runtime code。
- 内部 token 有效且 `RESCUEGRID_DEMO_MODE=true` 时，`force_trigger=true` 可以绕过自然市场触发条件。

Blocked:

- revoked 返回 `stopped_revoked`。
- expired 返回 `stopped_expired`。
- 滑点超限返回 `blocked`。
- 预算超限返回 `blocked`。
- pool mismatch 返回 `blocked`。
- owner global stop 命中时返回 `GLOBAL_STOPPED`，不提交交易。
- wrapper strategy stop 命中时返回 `STRATEGY_STOPPED`，不提交交易。
- target venue 被同一 owner 的 runtime control 停止时返回 `VENUE_STOPPED`，不提交交易。
- 其他 owner 的 global / strategy / venue stop 不能阻塞当前 wrapper。
- trigger 已命中但 runtime risk controls 读取失败时返回 `RISK_CONTROLS_UNAVAILABLE`，不提交交易。

Error:

- market read failed 返回 `error`，不提交交易。
- adapter plan failed 返回 `error`，不提交交易。
- unknown executor 返回 `UNSUPPORTED_EXECUTOR`，不提交交易。
- Deepbook transaction failed 返回 `error`，不更新成功状态。
- 同一个已提交 digest 被重试或重新读取时，runtime activity 不重复展示成功；若先记录 unresolved/error，后续同 digest 得到 `AgentTradeExecuted` + spend increase 证据时，可以用成功记录替换旧 unresolved/error。
- 缺失或错误 internal token 时返回 `401` 或 `403`，不运行 tick。
- 生产部署或 `RESCUEGRID_DEMO_MODE=false` 时提交 `force_trigger=true` 返回 `FORCE_TRIGGER_DISABLED`。

### `GET/POST /api/risk/controls`

- GET 按 owner 返回 `global_stopped`、`global_stops`、`strategy_stops`、`strategy_stop_records`、`venue_stops`、`venue_stop_records` 和完整 `control_records`。
- POST 必须验证 Sui personal-message signature，签名地址必须等于 `owner`。
- message domain 必须是 `RescueGrid` / `sui:testnet`，action 必须是 `set_global_stop`、`set_strategy_stop` 或 `set_venue_stop`。
- `set_strategy_stop` 必须校验链上 wrapper owner 等于签名 owner。
- expired message、owner mismatch、signature mismatch 和 replayed nonce 必须失败。
- 成功写入后，后续 tick 在 trigger 命中时必须分别返回 `GLOBAL_STOPPED`、`STRATEGY_STOPPED` 或 `VENUE_STOPPED`。

### `GET/POST /api/risk/venue-stops`

- 兼容旧接口；GET 只返回 venue control view。
- POST 只接受 `set_venue_stop`，其他 action 必须返回 `BAD_CONTROL_ACTION`。

## 4. Guardian Tests

Happy path:

- Mandate 未撤销/未过期，Wrapper 剩余额度足够、滑点在范围内、pool 匹配时 allow。

Boundary:

- proposed amount 等于 remaining budget 时 allow。
- estimated slippage 等于 max slippage 时 allow。

Block cases:

- proposed amount 大于 remaining budget。
- estimated slippage 大于 max slippage。
- MoveGate Mandate revoked。
- MoveGate Mandate expired。
- Wrapper mandate_id 与 Mandate id 不一致。测试构造方式：创建两个有效 Mandate/Wrapper fixture，故意把 Wrapper A 与 Mandate B 传入 Guardian；预期返回 `MANDATE_MISMATCH`，不提交交易。
- pool mismatch。
- remaining budget 为 0。

Advisory:

- concentration risk score 高时 UI 显示 warning，但 MVP 不因此自动 abort，除非后续技术规格升级为强制检查。
- UI warning 断言方式：显示包含 “Concentration risk” 的文本标签、severity badge 和解释文案；不能只依赖颜色变化。

## 5. ExecutorAdapter Tests

### Registry

- `deepbook` 是唯一 MVP registered adapter。
- unknown `executor_kind` 返回 `UNSUPPORTED_EXECUTOR`。
- Runtime Core 只能通过 registry 获取 adapter，不能直接 import Deepbook execution path。
- Adapter SDK conformance test 必须拒绝缺少 `readMarket`、`planExecution`、`buildPtb`、`parseExecutionResult`、`liquidityGate` 或 `volumeGate` 的 adapter。
- Adapter SDK registry 必须拒绝重复 `kind`，并通过 `createAdapterGate` 固定 liquidity/volume gate 的公共 shape。
- Sui DEX read adapter tests must prove `/api/adapters/dex-reads` covers DeepBook, Cetus, Turbos, Momentum and Bluefin Spot with 10 read-only spread matrix rows, while Cetus/Turbos/Momentum/Bluefin never register executor authority.
- Sui lending read adapter tests must prove `/api/adapters/lending-reads` covers NAVI, Suilend, Scallop and AlphaLend with reserve, obligation and health matrix fields, while no lending protocol registers repay/withdraw/borrow executor authority.

### ExecutionPlan conformance

- Deepbook adapter returns `executor_kind=deepbook`、`target_id=pool_id`、`quote_amount`、`estimated_slippage_bps`、`action_type=ACTION_DEEPBOOK_RESCUE`。
- Guardian sees the same `quote_amount` and `estimated_slippage_bps` that later appear in PTB arguments。
- Adapter preview lines include executor, pool, budget impact, slippage and expected event。

### PTB build

- Adapter build fails if plan target differs from Wrapper `pool_id`。
- Adapter build fails if plan action type differs from `ACTION_DEEPBOOK_RESCUE`。
- Adapter does not sign or submit; signing belongs to Runtime Core signer boundary。

## 6. Integration Tests

### Policy lifecycle

1. Deploy Move package to Sui Testnet.
2. Create Policy with test owner and agent.
3. Read MoveGate Mandate and RescuePolicyWrapper, then verify linked fields.
4. Revoke Policy.
5. Confirm subsequent `authorize_action` + trade record aborts.

### Agent autonomous execution

1. Create active Policy with sufficient Testnet budget（MoveGate Mandate + RescuePolicyWrapper）。
2. Activate Durable Object runtime.
3. In automated tests, use a dev-only mock price feed or `force_trigger=true` test hook to satisfy the trigger condition; natural market movement is not required.
4. Run agent tick.
5. Confirm Deepbook transaction digest exists.
6. Confirm `AgentTradeExecuted` event exists with correct `mandate_id` and `wrapper_id`.
7. Confirm `spent_amount` increased in RescuePolicyWrapper.
8. Confirm MoveGate ActionReceipt was created（`freeze_object`）。
9. Confirm MoveGate Mandate `spent_this_epoch` and `total_actions` updated.

Production-like e2e tests must not depend on `force_trigger=true`; they must use a controlled mock market provider in non-production or a real trigger condition.

### Guardian block

1. Create Policy with low max slippage.
2. Force estimated slippage above limit.
3. Run tick.
4. Confirm no Deepbook transaction submitted.
5. Confirm block reason is visible in activity.

### Revoke enforcement

1. Create active Policy.
2. Revoke as owner.
3. Run agent tick.
4. Confirm action is `stopped_revoked`.
5. Attempt direct `authorize_action` + `record_agent_trade` as agent.
6. Confirm chain abort.

### Concurrent policy isolation

1. Create 10 active policies with distinct owners and wrapper ids.
2. Activate 10 Durable Object runtimes.
3. Run one tick for each policy.
4. Confirm each runtime reads only its own mandate id, wrapper id, budget, market snapshot and last action.
5. Confirm creating an 11th active policy returns `ACTIVE_POLICY_LIMIT_REACHED`.

## 7. Browser QA

MVP desktop viewport:

- Dashboard loads without console errors.
- Login shows owner address.
- Intent input accepts the sample strategy.
- If Worker intent parsing returns an error or the Worker parse request fails, the strategy builder shows an explicit parse error card instead of silently presenting demo data as a live parse result.
- Preview panel shows all critical policy parameters.
- Confirm flow creates Policy and updates state.
- Activity view shows events and budget within one 5 second polling interval after chain state changes.
- Revoke button changes state to revoked within one 5 second polling interval.
- Policy Inspect names the real MoveGate Mandate + RescuePolicyWrapper model and does not show stale AgentPolicy, AgentCap, or sponsored-gas claims.
- Profile / Accounts shows the live runtime signer kind, deployment agent, execution blocker and Worker data-provider status when `VITE_WORKER_URL` is configured.
- Primary buttons have text labels and disabled/loading states.

Post-MVP mobile viewport:

- Strategy input, preview, status, activity and revoke controls do not overlap.
- Long addresses and tx digests truncate or wrap cleanly.
- Primary actions remain reachable.

Post-MVP accessibility:

- Buttons have clear labels.
- Risk warnings are not color-only.
- Loading and error states are visible.
- All primary actions are reachable by Tab and activatable by keyboard.

Concurrency:

- MVP supports at most 10 active policies per deployment.
- Creating the 11th active policy returns `ACTIVE_POLICY_LIMIT_REACHED`.
- Ten active Durable Object instances must not leak runtime state into each other.

## 8. Demo Acceptance Script

The final demo should be backed by `npm run demo:loop` plus browser evidence. The script must prove this exact sequence against the live Worker and Sui Testnet:

1. Start with no active Policy.
2. Login with zkLogin on Sui Testnet.
3. Enter: “当 SUI 下跌超过 8% 时启动 500 USDC 风险响应策略。”
4. Show structured strategy and PTB preview.
5. Show `executor_kind=deepbook` in structured strategy.
6. Confirm and create Policy.
7. Show mandate id, wrapper id and budget ceiling.
8. Let Cloud Agent tick attempt one Deepbook Testnet trade; demo may use a dev-only manual trigger or mock price feed if the real 8% price drop is not happening.
9. Show transaction digest and `AgentTradeExecuted` event, or show the documented DBUSDC/DEEP Testnet funding gate with `execution_claimed=false`.
10. Revoke Policy from Dashboard.
11. Run or wait for another tick.
12. Show Agent cannot execute after revoke.

Passing criteria:

- At least one real Sui Testnet transaction is visible.
- At least one real Deepbook-related execution is visible, or a documented Testnet blocker is explicitly shown by `npm run demo:loop` with fallback approved before demo.
- Once DBUSDC/DEEP funding is available, `npm run demo:execute` or `node worker/scripts/validate-demo-loop.mjs --require-execution` must replace the fallback path. Strict mode must preflight runtime signer status, BalanceManager DBUSDC/DEEP and agent SUI gas before policy creation, fail without creating a test policy when the known gate is not ready, and fail after creation unless the forced tick proves `AgentTradeExecuted`, `execution_claimed=true` and on-chain spend increase.
- Revocation is visible both in UI and chain state.
- No step requires exposing a user private key to the Agent.
- The deployed agent address shown in preview matches the agent recorded in the Mandate and Wrapper.

## 9. Post-MVP Local CLI Daemon Tests

These tests are not MVP gates, but they define the composability target.

- `rescuegrid daemon run` loads local agent config and starts periodic ticks.
- `rescuegrid daemon status --json` shows agent address, chain, registered adapters, watched policies and best-effort execution readiness using the same funding/signer blocker model as `/api/execution/readiness`.
- `rescuegrid daemon policies list --owner <0x...> --json` reads the owner's chain-authoritative policies through the same ChainDataProvider boundary, returns wrapper / mandate / status / budget fields, and marks whether each wrapper is in the daemon watched set.
- `rescuegrid daemon watch list|add|remove|sync` persists the local watched set in daemon config; `watch sync --owner <0x...>` adds only active policies whose Mandate agent matches the deployed RescueGrid agent, skipping revoked/expired or mismatched-agent wrappers.
- daemon uses the same Runtime Core and ExecutorAdapter registry as Cloud Agent.
- daemon refuses to run when the local agent address does not match the Policy Mandate agent.
- daemon writes local activity logs and can recover after restart without double-submitting an already confirmed action.
- daemon supports external signer mode before any Mainnet policy is accepted.

## 10. Open Test Decisions

Before implementation starts, resolve and update `docs/03-technical-spec.md` if needed:

- Exact Sui Testnet pool id and coin decimals.
- Exact zkLogin SDK flow and test provider.
- Exact Deepbook call shape for the selected pool.
- Exact adapter package boundary between Worker and future CLI daemon.
