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
- `npm run safety:negative` 必须通过 live Worker + Sui Testnet fixture policy 证明 over-budget、over-slippage、wrong pool、wrong agent、mandate-wrapper mismatch、expired 和 revoked plans 全部通过 `/api/execution/validate-plan` 在提交前 blocked，且 wrapper spend、API spend、execution-success activity 和 `AgentTradeExecuted` chain activity 均不增加。
- `npm run safety:negative:report` 必须在同一 live proof 全部通过后写 `.rescuegrid/safety-negative-report.json`，report 包含 `purpose=rescuegrid_safety_negative_report`、`phase=pass`、全部 blocker code、`submitted=false`、`execution_claimed=false`、spend unchanged、success activity unchanged 和 `chain_success_activity_total=0`。
- `npm run safety:negative -- --help` 不得输出 `AGENT_KEY`、owner key、`INTERNAL_AGENT_TICK_TOKEN`、WaaP permission token 或任何 secret value。

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
- 默认返回 `monitoring_provider.kind=timer-polling`、`provider_status=active`、`tick_driver=durable-object-alarm` 和 `execution_hot_path_unchanged=true`。
- `MONITORING_PROVIDER=grpc` 即使配置 `SUI_GRPC_URL` / `SUI_GRPC_ENDPOINT`，也必须返回 `monitoring_provider.provider_status=unavailable`、`blocker_code=GRPC_MONITORING_NOT_IMPLEMENTED`、`grpc_configured=true` 和 `execution_hot_path_unchanged=true`。
- `known_signer_kinds` 包含 `worker-secret`、`cloud-per-user`、`local-daemon`、`waap`、`hardware` 和 `remote-signer`。
- `signer_capabilities` 必须覆盖所有 known signer kinds，返回 selected、runtime_scope、custody_model、support flags、available / execution_enabled、runner posture 和 blocker code；不得因为某个 signer kind 出现在 capability matrix 里就暗示它可执行。
- `external_signer.kind=waap` 必须返回 selected、status、local_daemon_only、waap_cli_enabled、submission_runner_configured、permission_token_configured、address / expected_address 和 public blocker code。
- `cloud_per_user_signer.kind=cloud-per-user` 必须返回 selected、status、Seal/Walrus requirement flags、per-user agent / MoveGate AgentPassport requirement flags、public blocker code 和 `secrets_returned=false`。

Security / boundary:

- 响应不得包含 `AGENT_KEY`、owner key、WaaP session file、permission token 或任何 secret value。
- 响应不得包含 Seal token、Walrus token、per-user agent private key、decrypted key material 或 decryptor output。
- 响应不得包含 gRPC endpoint URL 或 endpoint token。
- `SIGNER_KIND=cloud-per-user` 必须返回 `PER_USER_CLOUD_SIGNER_NOT_VALIDATED`、`available=false`、`execution.enabled=false`；不得因为 Seal/Walrus env 看似配置就启用签名或提交。
- `SIGNER_KIND=waap` 默认必须返回 `UNSUPPORTED_SIGNER`，不能因为文档支持 Sui 就自动打开执行。
- `SIGNER_KIND=waap` 只有在 `RESCUEGRID_DAEMON_MODE=true`、`RESCUEGRID_WAAP_CLI_ENABLED=true`、`RESCUEGRID_WAAP_SUI_ADDRESS=<deployment agent>` 且 runtime 注入了本地 `waap-cli` submission runner 时才可报告 `available=true`。
- `SIGNER_KIND=waap` 在 Cloud Worker runtime 中必须保持 unavailable；`waap-cli` 只能通过 local daemon 注入 runner 调用。
- `SIGNER_KIND=waap` 地址缺失必须返回 `WAAP_ADDRESS_MISSING`；地址不匹配必须返回 `SIGNER_ADDRESS_MISMATCH`；地址匹配但未注入 runner 必须返回 `WAAP_RUNNER_MISSING`。
- WaaP submit 测试必须证明 adapter 先把 RescueGrid PTB serialize 成 `tx_json`，把 sender 固定为部署 agent address，再交给 runner；不得调用 Sui SDK keypair signer。
- WaaP submit 测试必须覆盖单 JSON 与 newline-delimited JSON 输出；多行输出优先使用 `event=result`，并能从 `digest`、`txDigest`、`transactionDigest`、`txHash` 或 `hash` 中提取 Sui digest。
- WaaP submit 测试必须把 `approval_pending` / `approval_denied` / `policy_blocked` / timeout 映射为 `WAAP_APPROVAL_PENDING`、`WAAP_APPROVAL_DENIED`、`WAAP_POLICY_BLOCKED`、`WAAP_TIMEOUT`，不能把等待审批或策略拒绝误报为成功。
- Runtime tick 测试必须证明上述 WaaP signer 状态会进入 `blocked` tick result，保留 `signer_kind` 和 `approval_state`，并保持 `submitted=false`、`execution_claimed=false`。
- WaaP permission token 可以从 env 传入 runner，但 status、logs、errors 和 config file 不得包含 token 值。
- `execution.enabled` 只有在 signer available 且 `EXECUTION_ENABLED=true` 时才为 true。
- Profile / Accounts UI 必须把 status 作为可见状态展示，不能把 `execution_configured=true` 当成可执行；Risk Center signer health 也必须从同一 runtime signer status 派生，而不是只展示静态 signer 行。
- 当 `known_signer_kinds` 包含 `cloud-per-user` 或 `waap` 时，前端必须显示 `cloud-per-user` 是未验证的 Seal/Walrus per-user signer boundary、WaaP 是 local-daemon-only external signer boundary；在 Cloud Worker 模式选中 `SIGNER_KIND=waap` 或任意模式选中 `SIGNER_KIND=cloud-per-user` 时必须显示不可用 blocker，而不是暗示云端可直接执行。

### `GET /api/chain-data/status`

Happy path:

- 默认返回 `chain=sui:testnet`、`provider_kind`、`known_provider_kinds`、`provider_status`、`worker_first=true` 和 `read_model`。
- 默认响应不得执行 GraphQL/schema probe；`probe.status=skipped`。
- `?probe=true` 对 `json-rpc` provider 读取 clock object；对 `graphql` provider 执行 schema probe、clock object read 和 1-row policy events query。
- `CHAIN_DATA_PROVIDER=graphql` 但未配置 endpoint / injected transport 时，返回 `provider_status=unavailable` 和 `error.code=GRAPHQL_ENDPOINT_REQUIRED`。
- GraphQL probe 失败时返回 `provider_status=probe_failed`，不能把失败误判成可用。

Security / boundary:

- 响应不得包含 `AGENT_KEY`、owner key、GraphQL endpoint URL、WaaP session file、permission token 或任何 secret value。
- Data Sources UI 必须把 provider kind、transport、probe status 和 read model 作为诊断状态展示；GraphQL `json-rpc-fallback` 字段必须显式可见，不能暗示所有读取都已迁到 GraphQL。

### `GET /api/archival/replay-contract`

Happy path:

- 默认返回 `provider.kind=none`、`provider.provider_status=disabled`、`provider.blocker_code=ARCHIVAL_REPLAY_DISABLED`。
- 返回 `query_contracts`，且 id 必须包含且仅包含 `historical_activity`、`performance_replay`、`judge_demo_replay`。
- 每个 query contract 必须有 required inputs、required outputs、primary sources、current fallback、consumers 和 `must_not_claim_execution=true`。
- `ARCHIVAL_REPLAY_PROVIDER=archival-store` 且配置 endpoint 时，返回 `provider.endpoint_configured=true`、`provider.provider_status=not_validated`，不能返回 ready。
- Data Sources UI 必须显示 Archival replay contract 的 provider、contract count 和 blocker，不能暗示 long-range replay 已接管当前 activity。

Security / boundary:

- 响应不得包含 Archival Store endpoint URL、endpoint token、`AGENT_KEY`、owner key、WaaP token 或 Worker secret。
- `execution_hot_path_unchanged` 和 `activity_hot_path_unchanged` 必须保持 true，直到真实 archival provider 和 reconciliation 测试落地。

### `GET /api/private-records/contract`

Happy path:

- 默认返回 `provider.kind=none`、`provider.provider_status=disabled`、`provider.blocker_code=PRIVATE_RECORDS_DISABLED`。
- 返回 `record_contracts`，且 id 必须包含且仅包含 `strategy_snapshot`、`backtest_report`、`agent_reasoning_trace`、`incident_report`。
- 返回 `object_contract.object_type=rescuegrid::private_record::PolicyPrivateRecord`、`implementation_status=contract_only`、`ownership=shared_object` 和 `blocker_code=POLICY_PRIVATE_RECORD_MOVE_NOT_IMPLEMENTED`。
- `object_contract` 必须包含 `current_version`、`latest_walrus_blob_id`、`seal_access_object_id`、version table 字段和 reader ACL 字段。
- 返回 `operation_contracts`，且 id 必须包含且仅包含 `create_policy_private_record`、`add_private_record_version`、`grant_private_record_reader`、`revoke_private_record_reader`、`archive_policy_private_record`。
- `add_private_record_version` 必须要求 `expected_current_version`，并在 preconditions 中声明它等于 object current version。
- 返回 `event_contracts`，且 id 必须包含且仅包含 `PolicyPrivateRecordCreated`、`PolicyPrivateRecordVersionAdded`、`PolicyPrivateRecordReaderGranted`、`PolicyPrivateRecordReaderRevoked`、`PolicyPrivateRecordArchived`。
- 每个 event contract 必须有 `plaintext_allowed=false` 和 `secret_values_allowed=false`。
- 每个 record contract 必须有 encrypted payload fields、chain anchor fields、authorized readers、disallowed fields、required redactions、consumers、`client_side_encryption_required=true` 和 `signing_secret_allowed=false`。
- `PRIVATE_RECORD_PROVIDER=seal-walrus` 但 Seal/Walrus 姿态不完整时，返回 `provider_status=unavailable` 和 `PRIVATE_RECORDS_CONFIG_REQUIRED`。
- `PRIVATE_RECORD_PROVIDER=seal-walrus` 且 Seal/Walrus 姿态完整时，返回 `provider_status=not_validated`，不能返回 ready。
- Data Sources UI 必须显示 Private policy records 的 provider、record count、object contract status、operation/event count 和 provider/object blocker，不能暗示已经启用 Seal/Walrus 存储。

Security / boundary:

- 响应不得包含 Seal/Walrus endpoint URL、endpoint token、`AGENT_KEY`、owner key、WaaP token、WaaP session file、raw hidden model reasoning 或 Worker secret。
- `AGENT_KEY`、owner wallet private key、WaaP permission token 和 raw hidden model reasoning 只能作为 disallowed schema metadata 出现，不能作为 payload。
- `storage_hot_path_unchanged` 和 `execution_hot_path_unchanged` 必须保持 true，直到真实 Seal/Walrus write/read、Sui ACL 和 chain-anchor 验证落地。
- Reader revoke 只能声明移除未来 decrypt authorization，不得声称能追回已下载的 ciphertext 或 plaintext。

### `npm run chain-data:status`

Happy path:

- 默认 `npm run chain-data:status -- --json` 输出 `chain_data_provider.provider_kind`、`provider_status`、`transport`、`read_model` 和 `probe.status=skipped`。
- `--probe` 使用和 `/api/chain-data/status?probe=true` 相同的 bounded probe。
- `--provider graphql --owner <0x...> --wrapper-id <0x...> --json` 对比 GraphQL provider 与 JSON-RPC baseline 的 owner policy list 和 wrapper activity，并输出 `comparisons[].status=match`。

Error / boundary:

- `--provider graphql` 但 endpoint 缺失时退出码必须为 1。
- GraphQL probe 失败、owner policy list mismatch、wrapper activity mismatch 或 compare error 时退出码必须为 1。
- 输出不得包含 GraphQL endpoint URL、`AGENT_KEY`、owner key、`INTERNAL_AGENT_TICK_TOKEN`、WaaP permission token 或 WaaP session value。
- 测试必须覆盖参数解析、endpoint 脱敏、policy list match/mismatch、activity match/mismatch 和 exit-code 判定。

### `GET /api/execution/readiness`

Happy path:

- 返回 `chain=sui:testnet`、`scope.executor_kind=deepbook`、`scope.market_id=SUI_DBUSDC`、部署 agent address、BalanceManager id 和 AgentPassport id。
- 返回 runtime signer/status evidence、BalanceManager DBUSDC/DEEP、agent SUI gas、thresholds、funding blockers 和 execution blockers。
- 返回 `signer_capabilities`、`external_signer` 和 `cloud_per_user_signer`，且字段语义与 `/api/runtime/status` 一致；WaaP 地址、permission token、runner、Seal/Walrus posture 和 per-user signer blocker 只能以 public posture / blocker code 出现。
- 当 `EXECUTION_ENABLED=false` 或 signer unavailable 时，`execution_ready=false` 且 `blocker_codes` 包含执行 blocker。
- 当 BalanceManager 缺少 DBUSDC/DEEP 或 agent 缺少 SUI gas 时，`funding_ready=false` 且 `funding_blocker_codes` 包含对应资产 blocker。
- `dbusdc_threshold`、`deep_threshold`、`sui_gas_threshold` 请求参数只能提高本次检查门槛，不能低于 Worker 配置的 minimum。

Security / boundary:

- 响应不得包含 `AGENT_KEY`、owner key、WaaP session file、permission token 或任何 secret value。
- `execution_claimed` 必须始终为 `false`；只有实际 tick 返回 `AgentTradeExecuted` + spend increase 才能声明执行成功。
- `npm run demo:execute` strict preflight 必须使用该 endpoint，而不是维护第二套资金/签名判断。

### `npm run demo:execute:report`

Happy path:

- 等同于 `npm run demo:execute` 的 strict mode，但在完整 create -> execute -> revoke -> post-revoke 闭环通过后写入 `.rescuegrid/demo-execute-report.json`。
- report 必须包含 `purpose=rescuegrid_demo_execution_report`、`phase=pass`、`chain=sui:testnet`、`require_execution=true`、`owner_address`、`delegated_agent_address`、`pool_id`、`wrapper_id`、`mandate_id`、`strategy_hash`、create/revoke tx digest、`create_tx.status=success`、`create_tx.timestamp_ms`、`revoke_tx.status=success`、`revoke_tx.timestamp_ms`、`tick_outcome=executed`、`tick_tx_digest`、`execution_claimed=true`、`agent_trade_event_found=true`、结构化 `agent_trade_event`、`spend_increased=true`；`agent_trade_event` 必须是同一 tick tx 的 `AgentTradeExecuted`，且包含并匹配 `mandate_id`、`wrapper_id`、`delegated_agent_address` 和 `pool_id`，同时带出 `quote_amount_spent`、`base_amount_received`、`spent_amount_after`、`budget_ceiling`、`slippage_bps`、`client_order_id`、`executed_at_ms`。`create_tx_digest`、`tick_tx_digest`、`revoke_tx_digest` 必须互不相同，且时间顺序必须满足 `create_tx.timestamp_ms <= agent_trade_event.executed_at_ms <= revoke_tx.timestamp_ms`。
- `assertions` 必须包含 `G2-CREATE`、`G2-ACTIVATE-MONITOR`、`G2-EXECUTE`、`G2-REVOKE` 和 `G2-POST-REVOKE-NO-EXECUTION`。
- report 必须包含 post-revoke evidence：`post_revoke.action=stopped_revoked`、`post_revoke.code=POLICY_REVOKED`、`post_revoke.execution_claimed=false`、`post_revoke.final_policy_status=revoked`、`post_revoke.final_runtime_state=Revoked`，且 `post_revoke.chain_event_types` 必须包含 `PolicyCreated`、`AgentTradeExecuted` 和 `PolicyRevoked`。

Security / boundary:

- `--out` 只在完整 strict execution pass 后写 report；preflight blocked 时不得创建 policy，也不得写出可被 `mission:readiness` 当作 success 的 report。
- report 不得包含 `AGENT_KEY`、owner key、`INTERNAL_AGENT_TICK_TOKEN`、WaaP session file、permission token 或任何 secret value。

### `npm run demo:execute:wallet-report`

Happy path:

- 用于 final browser-wallet same-wrapper gate：输入 `--wrapper-id <wallet_created_wrapper>`、`--strategy-file <activation_strategy_file>` 和可选 `--create-tx-digest <wallet_create_tx_digest>` 后，脚本必须读取链上 wrapper/mandate/create tx，校验 strategy JSON 的 canonical hash 等于 wrapper `strategy_hash`，且 owner/agent/pool 与 wrapper 一致。
- 脚本必须先通过 `/api/execution/readiness` strict preflight，再调用 `/api/policies/:wrapper_id/activate` 激活该现有 wrapper，然后 `force_trigger` 一次 `/api/agent/tick` 并要求 structured `AgentTradeExecuted`、`execution_claimed=true` 和 spend increase。
- 脚本不得创建 policy，也不得替 owner revoke；tick 成功后必须输出 `awaiting_wallet_revoke`，等待用户从浏览器钱包撤销同一个 wrapper。发现链上 `PolicyRevoked` 后，脚本必须运行 post-revoke tick，要求 `POLICY_REVOKED`、`execution_claimed=false`，再写 `.rescuegrid/demo-execute-report.json`。
- 写出的 report 必须满足 `npm run demo:execute:report` 的所有 strict report 字段要求，并且 owner/wrapper/mandate/strategy hash/create/revoke tx digest 可以和 wallet artifact 做同一 lifecycle continuity 比较。

Security / boundary:

- 不得读取、打印或提交 owner key；不得自动 revoke；不得在 funding preflight blocked 时 force tick 或写 success report。
- `activation_strategy_file` 只允许作为公开策略参数输入，不得包含 `AGENT_KEY`、owner key、`INTERNAL_AGENT_TICK_TOKEN`、WaaP session file、permission token 或任何 secret value。

### `npm run safety:negative:report`

Happy path:

- 等同于 `npm run safety:negative` 的 live Testnet safety proof，但在 active/expiring policy、validate-plan cases、revoke 和 post-revoke non-mutation checks 全部通过后写入 `.rescuegrid/safety-negative-report.json`。
- report 必须包含 `purpose=rescuegrid_safety_negative_report`、`phase=pass`、`chain=sui:testnet`、active/expiring wrapper ids、active revoke tx digest、`assertions` 包含 `VAL-SAFETY-001`、`VAL-SAFETY-002`、`VAL-SAFETY-003`、`VAL-SAFETY-005`、`VAL-SAFETY-008`。
- report 必须包含 validated codes：`OVER_BUDGET`、`OVER_SLIPPAGE`、`WRONG_POOL`、`WRONG_AGENT`、`MANDATE_MISMATCH`、`POLICY_EXPIRED`、`POLICY_REVOKED`。
- 每个 evidence row 必须证明 `submitted=false`、`execution_claimed=false`、spend unchanged、execution-success activity unchanged、`chain_success_activity_count=0`。

Security / boundary:

- `--out` 只在完整 safety-negative pass 后写 report；任何 missing blocker、mutating blocker、claimed execution 或 chain success activity 都不得写出可被 `mission:readiness` 当作 success 的 report。
- report 不得包含 `AGENT_KEY`、owner key、`INTERNAL_AGENT_TICK_TOKEN`、WaaP session file、permission token 或任何 secret value。

### `npm run funding:request`

Happy path:

- 输出 `purpose=external_deepbook_testnet_funding_request`、`chain=sui:testnet`、部署 agent address、AgentPassport id、BalanceManager id、DeepBook `SUI_DBUSDC` pool id、DBUSDC coin type 和 DEEP coin type。
- 输出 BalanceManager DBUSDC / DEEP 的 observed、required、missing、usable 和 blocker code。
- 输出 agent gas address 的 SUI_MIST observed、required、missing、usable 和 blocker code。
- 输出 signer readiness、`signer_capabilities`、`external_signer` 和 `cloud_per_user_signer` posture；若 WaaP 地址匹配但 local submission runner 未注入，必须保留 `WAAP_RUNNER_MISSING`，不能把 permission-token configured 当作 execution ready；`cloud-per-user` 必须保留 `PER_USER_CLOUD_SIGNER_NOT_VALIDATED`，不能把 Seal/Walrus configured posture 当作 execution ready。
- 输出 `next_verification.readiness_command="npm run daemon -- status --json"`、`next_verification.funding_watch_command="npm run funding:watch -- --json"`、`next_verification.funding_watch_report_command="npm run funding:watch:report"`、`next_verification.funding_proof_command="npm run funding:proof -- --tx <provider_funding_tx_digest> --json"`、`next_verification.funding_proof_report_command="npm run funding:proof:report -- --tx <provider_funding_tx_digest>"`、`next_verification.strict_execution_command="npm run demo:execute"`、`next_verification.strict_execution_report_command="npm run demo:execute:report"`、`next_verification.wallet_strict_execution_report_command` 和 `next_verification.success_condition`，其中 success condition 必须要求同一 wrapper/mandate/tick digest 的结构化 `AgentTradeExecuted` evidence、`execution_claimed=true`、on-chain spend increase、互不相同的 create/tick/revoke digest 和 create <= execute <= revoke timestamp order。最终 browser-wallet same-wrapper gate 应使用 `wallet_strict_execution_report_command`。
- 输出 `execution_gate` 机器字段：`readiness_only=true`、`execution_claimed=false`、`strict_execution_report_required=true`、`strict_execution_report_path=".rescuegrid/demo-execute-report.json"`，并按当前 readiness 设置 `policy_creation_allowed` / `policy_creation_blocked`。即使 `ready_for_strict_execution=true`，该 artifact 也只能表示 preflight ready，不能表示执行成功。
- 支持 `--dbusdc-threshold` / `--deep-threshold` / `--sui-gas-threshold`，且这些 request threshold 只能通过 `buildExecutionReadiness` 提高门槛，不能弱化 Worker 配置 minimum。
- 支持 `--format markdown --out .rescuegrid/funding-request.md` 生成可转发 funding provider 的 artifact；artifact 必须包含 public agent / BalanceManager / coin type / observed / required / missing / next verification commands / structured execution success condition，且不得包含任何 secret。

Security / boundary:

- 必须复用 `buildExecutionReadiness`，不能复制一套资金和 signer 判断。
- 必须是 read-only；不得创建 policy、不得提交 PTB、不得修改 BalanceManager。
- 响应不得包含 `AGENT_KEY`、owner key、`INTERNAL_AGENT_TICK_TOKEN`、WaaP session file、permission token 或任何 secret value。
- `--out` 只允许写入 handoff artifact，不得改变 readiness、创建 policy、提交 PTB 或隐式调用 `demo:execute`。
- `execution_claimed` 必须始终为 `false`；`ready_for_strict_execution=true` 只代表 preflight ready，不能代表已经执行成功。

### `npm run funding:proof`

Happy path:

- `npm run funding:proof -- --tx <provider_funding_tx_digest> --json` 必须读取 provider 提供的 Sui tx digest，输出 `purpose=rescuegrid_external_funding_proof`、`chain=sui:testnet`、tx success status、checkpoint/timestamp、sender、公开 balance changes、Move-call targets、asset hints、target evidence（目标 BalanceManager object 或 agent gas address）、当前 BalanceManager / agent gas readiness、signer capability posture 和 `execution_gate`。
- `npm run funding:proof:report -- --tx <provider_funding_tx_digest>` 或 `--out .rescuegrid/funding-proof-report.json` 必须写出同一 JSON。blocked 状态也要写出，供 reviewer 查看 provider tx digest 与当前余额 gate 的差异。
- `funding_proven=true` 只有在 tx digest 读取成功、tx evidence 锚到部署的 BalanceManager 或 agent gas address、且当前 DBUSDC/DEEP/SUI gas readiness 通过时成立；单独的 successful tx digest 不得把 `funding_proven` 或 `ready_for_strict_execution` 置为 true。
- successful tx digest 如果只有相关 asset hints、但没有目标 BalanceManager / agent gas address evidence，report 必须 `status=failed`、`funding_proven=false`，并暴露 `FUNDING_TX_TARGET_NOT_PROVEN`。
- `ready_for_strict_execution=true` 还必须要求 signer/execution flag readiness 通过；若资金已到账但 `EXECUTION_ENABLED=false` 或 signer 不匹配，report 必须保持 `status=blocked` 并保留对应 blocker code。
- 支持 `--tx` / `--digest` / `--dbusdc-tx` / `--deep-tx` / `--sui-gas-tx`，允许 provider 使用一笔或多笔交易完成交付。

Security / boundary:

- 必须是 read-only；不得签名、不得提交 PTB、不得创建 policy、不得修改 BalanceManager。
- 必须复用 `buildExecutionReadiness` 和 `buildFundingHandoff`，不能复制或弱化 funding/signer gate。
- 输出不得包含 `AGENT_KEY`、owner key、`INTERNAL_AGENT_TICK_TOKEN`、WaaP session file、permission token、runner output 或任何 secret value。
- `execution_claimed` 必须始终为 `false`；funding proof 只能证明 provider digest + live readiness，不得被当作 DeepBook execution evidence。

### `npm run funding:watch`

Happy path:

- 默认 `npm run funding:watch -- --json` 运行一次，复用 `buildExecutionReadiness` + `buildFundingHandoff` 输出 `purpose=deepbook_execution_funding_watch`、`funding_ready`、`execution_ready`、blocker codes、signer capability posture、external signer posture、public funding targets 和 next verification commands。
- `npm run funding:watch:report` 或 `--out .rescuegrid/funding-watch-report.json` 必须写出最新 watch JSON；blocked 状态也要写，且不得被当作 strict execution pass。watch JSON 必须透传同一 `execution_gate` 语义字段，明确 watcher ready 只表示可以进入 strict execution validator。
- `--wait --interval-ms <ms> --max-attempts <n>` 轮询同一 readiness contract，直到 `execution_ready=true` 或达到 attempts 上限。
- `--run-demo` / `--execute` 只有在 `execution_ready=true` 后才启动 strict `demo:execute`；blocked 状态必须返回非零退出码且不创建 policy。
- `--fail-until-ready` 在资金/签名仍 blocked 时返回非零退出码，用于外部 funding watcher 或 CI gate。

Security / boundary:

- 必须复用 `buildExecutionReadiness`，不能复制资金、signer 或 BalanceManager 判断。
- blocked 状态不得创建 policy、不得提交 PTB、不得调用 strict demo runner。
- 输出不得包含 `AGENT_KEY`、owner key、`INTERNAL_AGENT_TICK_TOKEN`、WaaP session file、permission token 或任何 secret value。
- `--out` 只允许写入 latest watch artifact，不得改变 readiness、创建 policy、提交 PTB 或隐式调用 `demo:execute`。
- `execution_claimed` 必须始终为 `false`；watcher ready 只代表可以进入 strict execution validator。

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
- Sign-in lists standard Sui wallets and, when Enoki is registered, the Google zkLogin wallet; Enoki wallets must not be filtered out by the standard-wallet list.
- Intent input accepts the sample strategy.
- If Worker intent parsing returns an error or the Worker parse request fails, the strategy builder shows an explicit parse error card instead of silently presenting demo data as a live parse result.
- Preview panel shows all critical policy parameters.
- Confirm flow creates Policy and updates state.
- `npm run test:auth-wallets` covers the frontend sign-in option contract: standard wallets and Enoki wallets are split, Google zkLogin gets a visible "Continue with Google" label, Enoki-only availability is not reported as "no wallet", and configured-but-not-mounted Enoki shows a provider-loading state.
- `npm run test:session-mode` covers the frontend session boundary: demo mode enables demo controls, wallet mode enables live reads and wallet writes, Worker read-only mode enables live reads without wallet writes, and non-demo sessions disable flash-crash demo controls.
- `npm run test:wallet-flow` covers the frontend wallet orchestration contract with a mock signer: parse -> build `tx_json` -> wallet sign -> `waitForTransaction(showObjectChanges/showEvents)` -> require `PolicyCreated.wrapper_id` -> activate runtime, plus revoke build -> wallet sign.
- `npm run test:wallet-evidence` covers the wallet click-through evidence artifact contract: the artifact is read-only, captures frontend reachability/login guardrails plus public Worker status/readiness posture, signer capability posture and external signer posture, lists create/revoke evidence fields plus `activation_strategy_file`, keeps `actual_clickthrough_completed=false` until manually filled, requires `actual_clickthrough_completed=true` plus wallet name, `Network: Sui Testnet`, sign-in/create/revoke/active/revoked screenshot or evidence references and `strict_execution_report_reference` before verification, rejects obvious secret assignments such as `AGENT_KEY`, owner/private keys, tick tokens, WaaP permission/session values or seed phrases across `=`, `:`, JSON-style and common camelCase field spellings, verifies local screenshot references are readable non-empty files when local paths are used, requires activation state `Monitoring` and post-revoke status `revoked`, reads `activation_strategy_file` before chain calls, rejects secret-bearing strategy files, recomputes the canonical strategy hash and compares available owner/wrapper/mandate/create digest metadata, reads `--execution-report` before chain calls when provided, rejects secret-bearing or non-wallet strict reports, verifies the strict report's structured `AgentTradeExecuted` evidence plus owner/wrapper/mandate/hash/create/revoke continuity, verifies filled create/revoke tx digests against Sui events, verifies Worker detail create/revoke activity plus revoked-state reads when Worker evidence is required, verifies `strict_execution_report_reference` against the expected `--execution-report` path when provided, and never claims DeepBook execution. It also covers `wallet:evidence:apply-strategy`: the helper can fill only machine-derived owner/create/wrapper/mandate/hash fields from the UI-downloaded strategy JSON, refuses secret-bearing or conflicting files, supports markdown and JSON artifacts, and does not set click-through completion. It covers `wallet:evidence:apply-report`: the helper accepts only wallet-created strict execution reports with complete structured `AgentTradeExecuted` evidence, refuses secret-bearing or conflicting files, supports markdown and JSON artifacts, and fills only strict-report/revoke/status fields without setting click-through completion. The generated manual flow must place a strict execution window after activation and before revoke so the same wallet-created wrapper can produce the strict execution report required by `mission:readiness`.
- `npm run wallet:evidence:preflight` must fail before manual wallet QA if the local frontend is unreachable, wallet auto-connect is not disabled, the Worker read-only entry is not explicit, no-wallet demo entry is not explicit, the activation strategy evidence export UI is missing, Worker writes do not require Worker config, public Worker status/readiness endpoints are unavailable, or those Worker endpoints do not semantically match the expected RescueGrid Testnet service, deployed agent, Worker-first chain-data posture, preflight-only execution readiness and non-secret external-signer posture. Passing preflight is only environment evidence, not click-through proof.
- `npm run wallet:evidence -- --format markdown --out .rescuegrid/wallet-clickthrough-evidence.md` must be run before real wallet QA; after wallet create + UI activation, `npm run wallet:evidence:apply-strategy -- --input .rescuegrid/wallet-clickthrough-evidence.md --strategy-file <activation_strategy_file>` may fill the machine-derived owner address, create tx digest, `wrapper_id`, `mandate_id`, strategy hash, `activation_strategy_file` and activation runtime state, but it must leave `Actual click-through completed: false` and revoke/screenshot fields manual. The same wrapper must remain active for `npm run demo:execute:wallet-report -- --wrapper-id <wrapper_id> --strategy-file <activation_strategy_file> --create-tx-digest <create_tx_digest>` before wallet revoke, because final mission readiness compares the verified wallet artifact with the strict execution report. After that report writes, `npm run wallet:evidence:apply-report -- --input .rescuegrid/wallet-clickthrough-evidence.md --execution-report .rescuegrid/demo-execute-report.json` may fill the machine-derived revoke tx digest, post-revoke status and strict report reference, but it must still leave `Actual click-through completed: false` and screenshot fields manual. During the browser run, set `Actual click-through completed: true` only after the real click-through is complete and fill the artifact with screenshots/evidence references for sign-in, wallet approvals, active policy, activity rows and revoked state. Local screenshot paths must point to readable non-empty files; external URLs remain audit references and are not fetched by the verifier. `strict_execution_report_reference` must match the strict report path passed to `mission:readiness -- --execution-report`, and the referenced strict report must describe the same owner-created wrapper lifecycle as the wallet artifact. After filling it, `npm run wallet:evidence:verify -- --input .rescuegrid/wallet-clickthrough-evidence.md --require-worker --execution-report .rescuegrid/demo-execute-report.json` must pass or report the exact missing/mismatched field, including manual evidence file readability, activation/revoke lifecycle state, activation strategy file readability, secret scan, hash and lifecycle mismatches; final mission readiness invokes the same verifier with Worker detail evidence required.
- `npm run test:mission-readiness` covers the final PRD readiness report contract: `status=ready` only when required scripts, safety-negative report evidence, filled wallet evidence, funding readiness, `.rescuegrid/funding-proof-report.json` target evidence and strict execution evidence all pass; incomplete safety report evidence, incomplete wallet evidence, missing funding readiness, missing funding proof report or missing strict execution evidence must classify as `blocked`; contradictory artifacts such as a safety report missing required blocker codes, wrong chain, missing active/expired wrapper ids, missing revoke tx digest, a funding proof report with successful tx evidence but no target BalanceManager / agent gas evidence, or a strict execution report with `execution_claimed=false`, missing structured `AgentTradeExecuted` event evidence, missing spend increase, missing create/revoke success tx evidence, missing create/revoke timestamps, duplicate create/tick/revoke digests, out-of-order create/execute/revoke timestamps, missing required G2 loop assertions or missing post-revoke no-execution proof must classify as `failed`. Incomplete wallet evidence in the mission report must expose `actual_clickthrough_completed`, `worker_url`, `missing_fields`, `missing_field_count`, `required_core_fields` and `required_manual_fields`, and the next action must route through artifact generation plus `wallet:evidence:preflight` before manual browser QA. Funding-blocked next actions must route through external handoff, `funding:proof -- --tx <provider_funding_tx_digest> --json`, `funding:proof:report -- --tx <provider_funding_tx_digest>`, target proof inspection for `transaction_evidence.target_evidence_passed=true`, `funding:watch -- --json` and `funding:watch:report`. The mission report must allowlist funding signer capability, external-signer posture, funding proof target evidence and `AgentTradeExecuted` public event fields before serialization, preserving public fields such as `permission_token_configured` while excluding raw permission tokens, sessions and runner output. Funding evidence must also include `execution_gate.readiness_only=true`, `execution_gate.execution_claimed=false` and `execution_gate.strict_execution_report_required=true` in both ready and blocked states so aggregate reports cannot treat funding readiness or funding proof as execution evidence. It must also fail if the verified browser wallet artifact and strict execution report do not describe the same owner-created policy lifecycle: owner, wrapper, mandate, strategy hash and create/revoke tx digests must match; strict execution must additionally fail if the structured event wrapper/mandate/tick digest, delegated agent, pool id or create/execute/revoke sequence does not match the report. `mission:readiness:report` and `--out` must write the same aggregate JSON that stdout prints, including blocked reports, without converting blockers into success.
- `npm run test:demo-execution-report` covers the strict execution report helper: executed reports include all G2 loop assertions, `execution_claimed=true`, `agent_trade_event_found=true`, structured `agent_trade_event`, `spend_increased=true`, distinct create/tick/revoke tx digests, create/execute/revoke timestamp order and post-revoke no-execution evidence; funding-gated reports stay non-executed and cannot satisfy the mission gate.
- `npm run test:safety-negative-report` covers the safety-negative report helper: reports only pass when all required blocker codes are present and every evidence row is pre-submission, non-executed, non-mutating and has no chain success activity.
- `npm run mission:readiness` and `npm run mission:readiness:report` are read-only and may return non-zero while the project is externally blocked. They must not create policies, submit PTBs, call `demo:execute`, call `demo:execute:wallet-report`, or print `AGENT_KEY`, owner key, `INTERNAL_AGENT_TICK_TOKEN`, WaaP permission token, WaaP session value or endpoint secrets.
- Activity view shows events and budget within one 5 second polling interval after chain state changes.
- `npm run test:activity-ledger` covers the Activity ledger normalization contract: signer blocker code extraction, WaaP approval evidence rows, signer-block filter state, non-signer funding blockers, and policy lookup by wrapper id.
- Activity view preserves signer approval evidence (`signer_kind`, `approval_state`, `WAAP_APPROVAL_*`), exposes signer blocker rows in expanded audit details, and the signer / approval filters treat WaaP approval rows as signer-blocked and approval-required blockers.
- Dashboard live/read-only mode must not show the flash-crash demo control or read the local demo crash state for the live chart, banner, reasoning, ticker or activity feed.
- `npm run test:dashboard-live` covers the live Dashboard isolation contract: live/read-only mode coerces demo crash state to idle, uses live sparkline/history/flat live price fallback instead of demo spark data, and selects live activity rows instead of demo activity rows.
- Dashboard sidebar global stop/resume in live wallet mode must use the same owner-signed `/api/risk/controls` path as Risk Center; read-only live mode must refuse signing actions and must not mutate local demo policy state.
- Revoke button changes state to revoked within one 5 second polling interval.
- Policy Inspect names the real MoveGate Mandate + RescuePolicyWrapper model and does not show stale AgentPolicy, AgentCap, or sponsored-gas claims.
- `npm run test:policy-inspect` covers the Policy Inspect copy contract: live inspect copy must name `MoveGate Mandate + RescuePolicyWrapper`, describe owner-signed create/revoke and explicit agent gas, and reject stale `AgentPolicy`, `AgentCap` or sponsored-gas phrasing.
- Profile / Accounts shows the live runtime signer kind, deployment agent, execution blocker, Worker data-provider status, known signer kinds, `cloud-per-user` posture and WaaP/local-daemon external signer boundary when `VITE_WORKER_URL` is configured.
- Risk Center signer/executor health prefers live `/api/runtime/status` rows and raises signer warnings from those rows when available; static `RG.signers` is only the no-runtime fallback.
- Data Sources shows Worker ChainDataProvider status from `/api/chain-data/status`, including provider kind, transport, probe status and read model.
- Data Sources shows Archival replay contract status from `/api/archival/replay-contract`, including provider status, contract count and replay-only blocker.
- `npm run test:data-sources` covers the Data Sources diagnostic contract: ChainDataProvider provider/transport/probe/read-model rows, explicit JSON-RPC fallback warnings, archival replay contract count/replay-only blocker, and private-record provider/object/operation/event contract blockers.
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
- `npm run safety:negative:report` provides the machine-readable safety-negative acceptance proof for the fallback path: every known Guardian / wrapper / mandate blocker must be pre-submission and non-mutating, and `.rescuegrid/safety-negative-report.json` must pass `mission:readiness`.
- Once DBUSDC/DEEP funding is available, `npm run demo:execute` or `node worker/scripts/validate-demo-loop.mjs --require-execution` must replace the fallback path for the self-contained scripted-owner strict loop. Strict mode must preflight runtime signer status, BalanceManager DBUSDC/DEEP and agent SUI gas before policy creation, fail without creating a test policy when the known gate is not ready, and fail after creation unless the forced tick proves structured `AgentTradeExecuted` evidence, `execution_claimed=true` and on-chain spend increase. To satisfy the final browser-wallet aggregate gate, run `npm run demo:execute:wallet-report -- --wrapper-id <wrapper_id> --strategy-file <activation_strategy_file> --create-tx-digest <create_tx_digest>` while the wallet-created wrapper is active, then revoke from the browser wallet when the script reaches `awaiting_wallet_revoke` so the pass report is written to `.rescuegrid/demo-execute-report.json`.
- Browser wallet evidence must include a filled `.rescuegrid/wallet-clickthrough-evidence.md` artifact from `npm run wallet:evidence` plus a passing `npm run wallet:evidence:verify -- --input .rescuegrid/wallet-clickthrough-evidence.md --require-worker --execution-report .rescuegrid/demo-execute-report.json`; `npm run wallet:evidence:preflight` should pass before the manual browser run, `npm run wallet:evidence:apply-strategy` can reduce transcription risk after the UI strategy JSON is downloaded, and `npm run wallet:evidence:apply-report` can reduce transcription risk after the wallet strict report is written. The same wrapper must stay active for strict execution evidence before the wallet revoke step with wallet name, `Network: Sui Testnet`, `activation_strategy_file`, readable local screenshot evidence or external audit references, and `strict_execution_report_reference` filled and matching the strict execution report path. The generated blank artifact, apply-strategy/apply-report merge or preflight pass alone is not a passing click-through proof.
- `npm run mission:readiness` must be the final aggregate gate before claiming the PRD complete. `npm run mission:readiness:report` may persist the same blocked/ready JSON to `.rescuegrid/mission-readiness-report.json` for review, but the artifact is not a pass unless `status=ready`. The gate may report `status=blocked` while DBUSDC/DEEP, funding proof, safety-negative report evidence or manual wallet evidence is missing, but it must never report `status=ready` without `.rescuegrid/safety-negative-report.json` proving live Sui Testnet active/expired wrappers plus revoke tx, a verified wallet artifact, funding readiness, `.rescuegrid/funding-proof-report.json` proving provider tx success plus target BalanceManager / agent gas evidence, and `.rescuegrid/demo-execute-report.json` proving strict structured `AgentTradeExecuted` execution for the same wrapper/mandate/tick digest, delegated agent and pool id.
- Revocation is visible both in UI and chain state.
- No step requires exposing a user private key to the Agent.
- The deployed agent address shown in preview matches the agent recorded in the Mandate and Wrapper.

## 9. Post-MVP Local CLI Daemon Tests

These tests are not MVP gates, but they define the composability target.

- `rescuegrid daemon run` loads local agent config and starts periodic ticks.
- `rescuegrid daemon status --json` shows agent address, chain, registered adapters, watched policies, public external signer posture, public `cloud-per-user` posture and best-effort execution readiness using the same funding/signer blocker model as `/api/execution/readiness`.
- `--signer-kind cloud-per-user` must stay unavailable with `PER_USER_CLOUD_SIGNER_NOT_VALIDATED`, must not leak Seal/Walrus env values, and must not pass Mainnet daemon validation until per-user key provisioning is validated.
- WaaP daemon readiness must pass only when `--waap-cli-enabled`, matching `--waap-sui-address`, the local submission runner and funding thresholds are all ready; a matching address without runner stays blocked as `WAAP_RUNNER_MISSING`.
- `rescuegrid daemon policies list --owner <0x...> --json` reads the owner's chain-authoritative policies through the same ChainDataProvider boundary, returns wrapper / mandate / status / budget fields, and marks whether each wrapper is in the daemon watched set.
- `rescuegrid daemon watch list|add|remove|sync` persists the local watched set in daemon config; `watch sync --owner <0x...>` adds only active policies whose Mandate agent matches the deployed RescueGrid agent, skipping revoked/expired or mismatched-agent wrappers.
- daemon uses the same Runtime Core and ExecutorAdapter registry as Cloud Agent.
- daemon refuses to run when the local agent address does not match the Policy Mandate agent.
- daemon writes local activity logs and can recover after restart without double-submitting an already confirmed action.
- daemon supports external signer mode before any Mainnet policy is accepted.

## 10. Open Test Decisions

Before implementation starts, resolve and update `docs/03-technical-spec.md` if needed:

- Exact Sui Testnet pool id and coin decimals.
- Live Enoki OAuth click-through evidence for the configured Google zkLogin provider.
- Exact Deepbook call shape for the selected pool.
- Exact adapter package boundary between Worker and future CLI daemon.
