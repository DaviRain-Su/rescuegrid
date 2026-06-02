# RescueGrid Technical Spec v1.0

状态：Draft
日期：2026-06-01
定位：RescueGrid：自主 DeFi 风险响应 Agent
适用范围：Hackathon MVP technical contract

## 1. Constants

所有实现必须集中定义以下常量，不允许在业务逻辑里散落 magic numbers。

| Name | Value | Notes |
| --- | --- | --- |
| `BPS_DENOMINATOR` | `10_000` | basis points denominator |
| `DEFAULT_MAX_SLIPPAGE_BPS` | `100` | 1.00% default preview value |
| `MAX_ALLOWED_SLIPPAGE_BPS` | `500` | 5.00% hard MVP ceiling |
| `DEFAULT_TICK_INTERVAL_SECONDS` | `60` | Cloud Agent tick interval |
| `MAX_POLICY_LIFETIME_SECONDS` | `604800` | 7 days |
| `MIN_POLICY_BUDGET` | implementation coin unit dependent | must be non-zero |
| `SUPPORTED_CHAIN` | `sui:testnet` | MVP only |
| `EXECUTOR_KIND_DEEPBOOK` | `deepbook` | only registered MVP executor adapter |
| `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` | `10` | MVP concurrency cap |
| `RESCUEGRID_PROTOCOL_ADDRESS` | published RescueGrid package address | protocol address passed to MoveGate |
| `ACTION_DEEPBOOK_RESCUE` | `1` | MoveGate action type for rescue trades |
| `REVOKE_REASON_OWNER` | `1` | owner-requested revocation reason |
| `MOVEGATE_DEFAULT_CREATION_FEE_MIST` | `10_000_000` | MoveGate source default, 0.01 SUI |
| `INTERNAL_AGENT_TICK_HEADER` | `Authorization: Bearer <INTERNAL_AGENT_TICK_TOKEN>` | required for internal tick endpoint |

Enforcement notes:

- `DEFAULT_MAX_SLIPPAGE_BPS` is the default value inserted into new strategy previews.
- `MAX_ALLOWED_SLIPPAGE_BPS` is the chain-level creation cap. Runtime Guardian checks use each policy's `max_slippage_bps`, not the global default.
- `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` is enforced only by Worker/API state. The Move package does not enforce a global deployment count, so direct chain calls can create more policies; this cap is an MVP operational limit, not a security invariant.
- `EXECUTOR_KIND_DEEPBOOK` is part of the confirmed strategy hash. Future adapters must introduce explicit executor kinds and tests before they can be accepted.

## 2. Deployment Agent

MVP uses one team-controlled Testnet agent wallet per deployment.

- The public address is configured as `RESCUEGRID_AGENT_ADDRESS`.
- The signing credential is stored as a Cloudflare secret or equivalent local dev secret, never in frontend code.
- Users cannot choose or override `agent` in MVP.
- `/api/intents/parse` inserts this address into the structured strategy and PTB preview.
- `/api/policies` must verify the submitted strategy agent equals `RESCUEGRID_AGENT_ADDRESS`.
- Agent key rotation affects only new policies. Existing policies name the old agent until owner revokes and recreates them.

## 3. Composable Runtime Contract

Runtime Core is shared by Cloud Agent and the future Local CLI daemon. It owns policy loading, adapter selection, Guardian evaluation and activity logging. Protocol-specific behavior lives behind ExecutorAdapter.

```ts
type ExecutorKind = 'deepbook';

type ExecutionPlan = {
  executor_kind: ExecutorKind;
  target_id: string;
  target_supported: boolean;
  action_type: number;
  quote_amount: string;
  estimated_slippage_bps: number;
  preview: string[];
};

interface ExecutorAdapter {
  kind: ExecutorKind;
  supportsTarget(target_id: string): boolean;
  readMarket(policy: PolicySnapshot): Promise<MarketSnapshot>;
  liquidityGate(policy: PolicySnapshot, market: MarketSnapshot): AdapterGate;
  volumeGate(policy: PolicySnapshot, market: MarketSnapshot): AdapterGate;
  planExecution(policy: PolicySnapshot, strategy: StructuredStrategy, market: MarketSnapshot): Promise<ExecutionPlan>;
  preview(plan: ExecutionPlan): string[];
  buildPtb(plan: ExecutionPlan, auth: MoveGateAuthContext): Promise<Transaction>;
  parseExecutionResult(result: SuiTransactionResult): Promise<ActivityEvent>;
}
```

Rules:

- MVP registers only `deepbook`.
- `/api/intents/parse` must reject unknown `executor_kind` with `UNSUPPORTED_EXECUTOR`.
- `/api/policies` and `/api/execution/validate-plan` must reject or block any target that is not supported by the selected adapter with `UNSUPPORTED_EXECUTOR_TARGET` before producing a signable transaction.
- The adapter must return an `ExecutionPlan` before any PTB is signed.
- Guardian checks run against the `ExecutionPlan`; an adapter cannot submit directly.
- `quote_amount`, `estimated_slippage_bps`, `target_id`, and `action_type` must match the values encoded in the PTB.
- Runtime Core must use the same adapter interface in Worker/Durable Object and future CLI daemon code.

H7 adapter SDK status:

- `worker/src/executor-adapter-sdk.js` owns `EXECUTOR_ADAPTER_SDK_VERSION`, required interface methods, liquidity/volume gate methods, conformance requirements, `createAdapterGate`, registry construction and stable unsupported-executor error helpers.
- `worker/src/deepbook-adapter.js` is the first adapter plugin. It contains DeepBook target support, market read passthrough, liquidity/volume gate metadata, plan/preview, unsigned PTB build and execution-result parsing.
- `worker/src/executor-adapters.js` is now the registered-adapter assembly point. It still registers only `deepbook`, but future adapters must pass `assertExecutorAdapterConformance` before entering the registry.
- `worker/test/executor-adapter-sdk-test.mjs` covers the SDK contract, gate shape, duplicate kind rejection and missing-method rejection. `worker/test/executor-adapters-test.mjs` covers the registered DeepBook plugin and target-gated unsigned PTB build.

Liquid Sui DEX read adapter status:

- `/api/adapters/dex-reads` is the authoritative Worker read surface for liquid Sui DEX quote/depth/spread metadata. It covers DeepBook, Cetus, Turbos, Momentum and Bluefin Spot.
- `worker/src/sui-dex-read-adapters.js` defines one order-book read model, three CLMM read models and one route-aggregator read model. The spread matrix contains 10 SUI/USD-stable pair rows, but rows are schema-only and do not claim live arbitrage.
- Every DEX read adapter keeps `execution_enabled=false` and `autonomous_execution_allowed=false`. DeepBook is the only row with an existing execution adapter, and it remains `FUNDING_GATED`; Cetus, Turbos, Momentum and Bluefin Spot are `READ_ONLY_ADAPTER`.
- DEX read adapters must expose `no_execution_authority_requested` in their read preflight gates. A read adapter cannot become executable without a registered ExecutorAdapter, wrapper target fields and Guardian-readable liquidity/volume/price-impact checks.

Sui lending read adapter status:

- `/api/adapters/lending-reads` is the authoritative Worker read surface for Sui lending reserve and obligation health metadata. It covers NAVI, Suilend, Scallop and AlphaLend.
- `worker/src/sui-lending-read-adapters.js` defines reserve fields, obligation fields, health-guard fields and a 4-row borrow-health matrix. The rows are schema-only and do not claim live rates, live obligations or repay automation.
- Every lending read adapter keeps `registered_executor=false`, `execution_enabled=false` and `autonomous_execution_allowed=false`. Suilend and Scallop are `READ_ONLY_LENDING_ADAPTER`; NAVI and AlphaLend are `RESEARCH_PENDING_READ_ONLY`.
- Lending read adapters must expose `no_execution_authority_requested` plus reserve freshness, obligation freshness, oracle freshness, withdrawal-liquidity and owner-cap/key checks before any future repay, withdraw or borrow PTB can be considered.

Post-MVP adapter candidates:

Adapter inclusion gates:

- Monitoring coverage tracks the DefiLlama Sui non-CEX Top 25/26, plus explicit volume exceptions.
- Execution adapters require sustained liquidity/volume, stable read APIs, explicit target ids, deterministic plan previews and Guardian-readable risk fields.
- CEX entries, RWA issuer products and perps venues are excluded from autonomous execution until their custody, settlement, margin and liquidation semantics are specified.
- H4/H5 candidate metadata is exposed at `/api/adapters/candidates`. This is a design/constraint registry, not an executor registry: every row must remain `registered_executor=false`, `execution_enabled=false` and `autonomous_execution_allowed=false` until a real adapter has conformance tests, target gates and wrapper-level fields.

Candidate adapter classes:

- `sui-lending`: NAVI, Suilend, Scallop and AlphaLend supply, redeem, unwind and health-risk-reduction flows. Current stays watch-first until liquidity and market constraints justify execution.
- `sui-clmm`: Cetus first; Bluefin Spot, Turbos and Momentum as later liquid DEX candidates after quote/depth/position constraints are stable. Magma, STEAMM and other long-tail DEXs stay watch-only unless they repeatedly clear the volume threshold.
- `sui-cdp-watch`: Bucket collateral, debt, peg-risk and repay/deleverage monitoring. Execution waits for target id, repay sizing and stale-state constraints.
- `sui-vault-lst-watch`: SpringSui, Haedal, Volo, AlphaFi, Kai, Mole and Ember supply/redeem or watchtower flows. Execution waits for position/vault id constraints and redemption/liquidity checks.
- `sui-rwa-watch`: Ondo, KAIO and MatrixDock watch-only RWA yield and liquidity/settlement risk surfaces before any execution authority.
- `sui-perps-watch`: Bluefin Pro, Sudo Perps and DipCoin Perps funding, liquidation and venue-risk monitoring before any tiny/paper execution.

These adapters are not allowed to reuse the Deepbook-specific `pool_id` constraint unless their target semantics are equivalent. If they need position ids, vault ids, lending market ids or bin ranges, add adapter-specific wrapper fields or a new wrapper version.

Current target schema findings:

- CLMM adapters (`cetus-clmm`, `turbos`, `momentum`) require `clmm_pool_id`, coin types, tick spacing, fee tier, optional tick range and optional LP `position_id`. Guardian must be able to read quoted output, price impact, pool liquidity, tick range, position ownership and sustained volume before any PTB is built.
- Bluefin Spot is represented as a `sui-spot-aggregator` candidate. Aggregator routes are not acceptable as broad signing authority; the route must be decomposed into allowed Sui venues and concrete target ids before execution can be considered.
- Lending adapters require lending market id/type, reserve id or reserve coin type, obligation id, and owner proof (`obligation_owner_cap_id` for Suilend-like flows or `obligation_key_id` for Scallop-like flows). Guardian must read fresh reserve and obligation state, health factor, LTV, withdrawal liquidity and oracle freshness before any repay/withdraw/borrow PTB is built.
- NAVI and AlphaLend remain research-pending in code until package addresses, SDK APIs and position semantics are verified.

H6 watch-only boundary findings:

- `/api/protocols/watch-boundaries` is the authoritative Worker read surface for watch-only protocols. It must include Bucket, Current, SpringSui, Haedal, Volo, AlphaFi, Kai, Mole, Ondo, KAIO, MatrixDock, Ember, Bluefin Pro, Sudo and DipCoin.
- Every watch-only boundary must expose readable state, risk domains, required future target fields and explicit no-execution reasons. Every row must remain `registered_executor=false`, `execution_enabled=false`, `autonomous_execution_allowed=false` and `execution_blocker_code=WATCH_ONLY_BOUNDARY`.
- Bucket/Current rows focus on CDP, peg, borrow health, liquidation and liquidity state. LST/vault rows focus on exchange rate, redemption liquidity, withdrawal delay, vault NAV, strategy weights and drawdown. RWA rows focus on issuer, redemption, settlement and secondary liquidity. Perps rows focus on funding, mark/index, open interest, margin requirement and liquidation buffer.
- DipCoin is allowed only as `registry_status=roadmap_only` until it enters the current Sui coverage baseline or an official read API is verified.

## 4. Move Package Surface

### 架构：MoveGate + RescuePolicyWrapper

RescueGrid 复用 MoveGate 的 Mandate（Agent 授权、撤销、过期）和 AuthToken（hot-potato 同一 PTB 强制消费），在此之上搭建 RescuePolicyWrapper 覆盖 DeFi 风险响应特有约束（pool_id、递减预算、滑点、strategy_hash）。

MoveGate Testnet 部署：
- Package ID：`0xec91e604714e263ad43723d43470f236607bd0b13f64731aad36b00a61cf884a`
- Published-at：`0x1e7fbc6ee51094c3df050fade2e37455adfef7de4d9b79c84a168910067c9f46`
- AgentRegistry：`0xb2fadc7ccf9c7b578ba3b1adb8ebfd73191563e536b6b2cc18aa14dac6c7ba46`
- MandateRegistry：`0x26a66d91fef324b833d07d134e5ab6e796e0dfd77f670c27da099479d939b0d3`
- FeeConfig：`0x5c92c420f4b3801eb4126fcab6cb4b98212b31f591b4b3d0a025b4e4957120f3`
- ProtocolTreasury：`0xf0714bd816e595cacfc9e5921d1754cca0205f6b65867eab6183d0b0a98fc82c`

Integration constraints:

- The deployment agent must register its MoveGate `AgentPassport` once before any user creates a policy.
- Worker must either build MoveGate calls directly in the PTB or call a thin RescueGrid Move helper that wraps MoveGate creation. In both routes, the MoveGate SDK is only a transaction-building convenience; chain enforcement comes from MoveGate + RescuePolicyWrapper code.
- A created Mandate must be accessible to later agent-signed PTBs. Preferred route: the owner creation PTB creates the Mandate and makes it shared before activation. Phase B0 must compile-prove this with MoveGate's current package. If the Mandate cannot be shared or otherwise accessed by the agent without owner signing, MoveGate integration is invalid for MVP and the project must fall back to an independent shared `RescuePolicy` route.
- MoveGate authorizes the RescueGrid wrapper protocol, not Deepbook directly. RescueGrid enforces the Deepbook `pool_id`, budget and slippage constraints.
- MoveGate Mandate data must be read through public accessors such as `mandate_owner`, `mandate_agent`, `mandate_expires_at_ms`, `mandate_revoked`, `mandate_spent_this_epoch`, and `mandate_total_actions`; RescueGrid must not assume private field access.
- MoveGate source default creation fee is `10_000_000` MIST. Phase B0 must read the live `FeeConfig` via `movegate::treasury::creation_fee` or an equivalent chain read before submitting creation transactions, because the deployed fee can be changed by MoveGate admin.

### RescuePolicyWrapper object

The MVP Move package must expose one shared policy wrapper object that references a MoveGate Mandate.

```move
public struct RescuePolicyWrapper has key, store {
    id: UID,
    owner: address,
    mandate_id: ID,          // reference to MoveGate Mandate
    agent: address,          // cached from mandate for efficiency
    pool_id: ID,             // v1 target constraint: specific Deepbook pool
    budget_coin_type: String,
    budget_ceiling: u64,
    spent_amount: u64,       // cumulative, never resets
    max_slippage_bps: u16,
    strategy_hash: vector<u8>,
}
```

Field rules:

- `owner` is recorded at creation from `tx_context::sender(ctx)`.
- `mandate_id` references the MoveGate Mandate that enforces agent authorization, expiry and revocation.
- `agent` is cached from the Mandate for fast access; must match `movegate::mandate::mandate_agent(mandate)`.
- `pool_id` is the only Deepbook pool this policy may target. In v1 this is a Deepbook-specific target field; future non-Deepbook adapters must add adapter-specific target constraints instead of overloading it.
- `budget_coin_type` is the human-readable coin type used for preview and UI consistency.
- `budget_ceiling` and `spent_amount` use the smallest unit of `budget_coin_type`.
- `max_slippage_bps` must be `<= MAX_ALLOWED_SLIPPAGE_BPS`.
- `strategy_hash` is `blake2b-256(canonical_strategy_json_utf8)`.
- The owner creation PTB must share the returned wrapper before activation.

### Move entry functions and PTB composition

`create_policy` is a Worker-built creation flow. Phase B0 chooses one of two routes:

- Direct PTB route: Worker calls MoveGate `create_mandate`, then RescueGrid `create_policy_wrapper`, then shares the returned objects.
- Thin helper route: Worker calls a RescueGrid Move helper that internally builds `allowed_coin_types`, calls MoveGate `create_mandate`, creates the wrapper, and shares both objects.

Either route must:

1. Use the owner as transaction sender.
2. Call MoveGate `create_mandate` with:
   - `registry: &mut movegate::mandate::MandateRegistry`
   - `agent_registry: &mut movegate::passport::AgentRegistry`
   - `passport: &mut movegate::passport::AgentPassport`
   - `treasury: &mut movegate::treasury::ProtocolTreasury`
   - `fee_config: &movegate::treasury::FeeConfig`
   - `agent = RESCUEGRID_AGENT_ADDRESS`
   - `spend_cap = max_single_trade_amount`
   - `daily_limit = budget_ceiling`
   - `allowed_protocols = [RESCUEGRID_PROTOCOL_ADDRESS]`
   - `allowed_coin_types = [type_name::with_original_ids<BudgetCoin>()]` if the PTB route can construct `TypeName`; otherwise Phase B0 must switch creation to a thin RescueGrid Move helper that builds this vector inside Move.
   - `allowed_actions = [ACTION_DEEPBOOK_RESCUE]`
   - `expires_at_ms` from the confirmed strategy
   - `min_agent_score = option::none()` for MVP
   - `payment: &mut Coin<SUI>` with value at least the live MoveGate creation fee; expected default is `10_000_000` MIST.
   - `clock: &Clock`
   - `ctx: &mut TxContext`
3. Pass the returned Mandate to RescueGrid `create_policy_wrapper`.
4. Make both the Mandate and the wrapper accessible to future agent-signed execution PTBs.

```move
public fun create_policy_wrapper(
    mandate: &movegate::mandate::Mandate,
    pool_id: ID,
    budget_coin_type: String,
    budget_ceiling: u64,
    max_slippage_bps: u16,
    strategy_hash: vector<u8>,
    ctx: &mut TxContext,
): RescuePolicyWrapper
```

Preconditions:

- `tx_context::sender(ctx)` is recorded as `owner`.
- `budget_ceiling > 0`.
- `max_slippage_bps <= MAX_ALLOWED_SLIPPAGE_BPS`.
- `movegate::mandate::mandate_owner(mandate) == tx_context::sender(ctx)`.
- `movegate::mandate::mandate_agent(mandate) == RESCUEGRID_AGENT_ADDRESS`.
- `movegate::mandate::mandate_expires_at_ms(mandate)` satisfies the confirmed strategy expiry.
- `movegate::mandate::mandate_allowed_protocols(mandate)` includes `RESCUEGRID_PROTOCOL_ADDRESS`.

Postconditions:

- Creates one `RescuePolicyWrapper` referencing the mandate.
- Shares or returns the wrapper for sharing in the same PTB.
- Emits `PolicyCreated` with both mandate_id and wrapper_id.

```move
public entry fun revoke_policy(
    wrapper: &mut RescuePolicyWrapper,
    mandate: &mut movegate::mandate::Mandate,
    mandate_registry: &mut movegate::mandate::MandateRegistry,
    passport: &mut movegate::passport::AgentPassport,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

Preconditions:

- `tx_context::sender(ctx) == wrapper.owner` and `wrapper.owner == movegate::mandate::mandate_owner(mandate)`.
- `!movegate::mandate::mandate_revoked(mandate)`.
- `object::id(mandate) == wrapper.mandate_id`.

Postconditions:

- Calls MoveGate `revoke_mandate(mandate, mandate_registry, passport, REVOKE_REASON_OWNER, clock, ctx)`.
- Emits `PolicyRevoked`.

```move
public fun assert_policy_valid(
    wrapper: &RescuePolicyWrapper,
    agent: address,
    pool_id: ID,
    amount: u64,
    slippage_bps: u16
)
```

Preconditions (RescueGrid-specific checks, MoveGate auth handled by `authorize_action`):

- `pool_id == wrapper.pool_id`.
- `wrapper.spent_amount + amount <= wrapper.budget_ceiling`.
- `slippage_bps <= wrapper.max_slippage_bps`.
- `agent == wrapper.agent`.

Postconditions:

- No state mutation. Abort on any violation.
- Note: Mandate-level checks (revoked, expired) are enforced by MoveGate's `authorize_action` which runs earlier in the PTB.

```move
public fun record_agent_trade(
    wrapper: &mut RescuePolicyWrapper,
    mandate: &mut movegate::mandate::Mandate,
    passport: &mut movegate::passport::AgentPassport,
    agent_registry: &mut movegate::passport::AgentRegistry,
    pool_id: ID,
    quote_amount_spent: u64,
    base_amount_received: u64,
    slippage_bps: u16,
    client_order_id: vector<u8>,
    auth_token: movegate::mandate::AuthToken,  // consumed here
    clock: &Clock,
    ctx: &mut TxContext,
)
```

Preconditions:

- `tx_context::sender(ctx) == wrapper.agent`.
- `object::id(mandate) == wrapper.mandate_id`.
- `pool_id == wrapper.pool_id`.
- `wrapper.spent_amount + quote_amount_spent <= wrapper.budget_ceiling`.
- `slippage_bps <= wrapper.max_slippage_bps`.
- `quote_amount_spent > 0`.
- `movegate::mandate::auth_token_mandate_id(&auth_token) == wrapper.mandate_id`.
- `movegate::mandate::auth_token_agent(&auth_token) == wrapper.agent`.
- `movegate::mandate::auth_token_protocol(&auth_token) == RESCUEGRID_PROTOCOL_ADDRESS`.
- `movegate::mandate::auth_token_amount(&auth_token) == quote_amount_spent`.

Postconditions:

- Runs all wrapper-specific asserts before consuming the AuthToken.
- Calls `movegate::receipt::create_success_receipt(auth_token, mandate, passport, agent_registry, wrapper.owner, RESCUEGRID_PROTOCOL_ADDRESS, quote_amount_spent, 0, option::none(), clock, ctx)`.
- Consumes the AuthToken exactly once through MoveGate receipt creation.
- Increments `wrapper.spent_amount` by `quote_amount_spent`.
- Emits `AgentTradeExecuted`.

## 5. RescueGrid Events

RescueGrid 自身发出以下事件。MoveGate 的 ActionReceipt 提供额外的不可变审计轨迹（`freeze_object`）。

```move
public struct PolicyCreated has copy, drop {
    mandate_id: ID,            // MoveGate Mandate ID
    wrapper_id: ID,            // RescuePolicyWrapper ID
    owner: address,
    agent: address,
    pool_id: ID,
    budget_ceiling: u64,
    max_slippage_bps: u16,
    expires_at_ms: u64,
    strategy_hash: vector<u8>,
}
```

```move
public struct PolicyRevoked has copy, drop {
    mandate_id: ID,
    wrapper_id: ID,
    owner: address,
    revoked_at_ms: u64,
}
```

```move
public struct AgentTradeExecuted has copy, drop {
    mandate_id: ID,
    wrapper_id: ID,
    agent: address,
    pool_id: ID,
    quote_amount_spent: u64,
    base_amount_received: u64,
    spent_amount_after: u64,
    budget_ceiling: u64,
    slippage_bps: u16,
    client_order_id: vector<u8>,
    executed_at_ms: u64,
}
```

The transaction digest is not stored inside the Move event because it is not available inside the transaction before execution completes. Indexers and the dashboard must read it from event metadata. MoveGate's ActionReceipt（`freeze_object`）provides a second, immutable audit source.

Guardian blocks are runtime activity records in MVP, not Move events. This avoids paying gas for no-op safety decisions and avoids emitting block events after a Mandate has been revoked or expired.

Guardian reason codes:

- `1`: slippage exceeds max.
- `2`: budget would exceed ceiling.
- `3`: mandate expired.
- `4`: mandate revoked.
- `5`: pool mismatch.
- `6`: concentration risk warning.
- `7`: mandate and wrapper mismatch.

## 6. Structured Strategy

Natural language must parse into this JSON shape before confirmation:

```json
{
  "version": "1",
  "strategy_type": "risk_response",
  "owner": "0x...",
  "agent": "0x...",
  "chain": "sui:testnet",
  "executor_kind": "deepbook",
  "pool_id": "0x...",
  "budget_coin_type": "0x...::coin::USDC",
  "budget_ceiling": "500000000",
  "trigger": {
    "metric": "price_drop_pct",
    "asset": "SUI",
    "threshold_pct": "8"
  },
  "execution": {
    "order_type": "market_or_ioc",
    "max_slippage_bps": 100,
    "max_single_trade_amount": "100000000"
  },
  "expires_at_ms": 1780000000000
}
```

Rules:

- `strategy_type` MVP supports only `risk_response`.
- `executor_kind` MVP supports only `deepbook`.
- `agent` must equal deployment config `RESCUEGRID_AGENT_ADDRESS`.
- `chain` must equal `sui:testnet`.
- `budget_ceiling` and `max_single_trade_amount` are decimal strings to avoid JavaScript integer loss.
- `max_single_trade_amount <= budget_ceiling`.
- `expires_at_ms` must satisfy the Move lifetime rules.
- `strategy_hash` is computed from canonical JSON: UTF-8, lexicographically sorted keys, no insignificant whitespace, decimal strings preserved exactly, then `blake2b-256`.
- Worker owns the canonicalization implementation and exposes the resulting `strategy_hash`; Dashboard may display the hash but must not be the authority for acceptance. Tests must use the vectors below to prevent JavaScript key-ordering, float serialization or Unicode handling drift.

Test vector:

Canonical JSON:

```json
{"agent":"0x2222222222222222222222222222222222222222222222222222222222222222","budget_ceiling":"500000000","budget_coin_type":"0x3333333333333333333333333333333333333333333333333333333333333333::usdc::USDC","chain":"sui:testnet","execution":{"max_single_trade_amount":"100000000","max_slippage_bps":100,"order_type":"market_or_ioc"},"executor_kind":"deepbook","expires_at_ms":1780000000000,"owner":"0x1111111111111111111111111111111111111111111111111111111111111111","pool_id":"0x4444444444444444444444444444444444444444444444444444444444444444","strategy_type":"risk_response","trigger":{"asset":"SUI","metric":"price_drop_pct","threshold_pct":"8"},"version":"1"}
```

Expected `blake2b-256`:

```text
0xa6554d4c4ea6f63d5cbc05e60fe917043fad64a8a7eb09acec89124e94721f5c
```

Additional hash conformance vectors:

| Canonical UTF-8 input | Expected `blake2b-256` |
| --- | --- |
| empty string | `0x0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8` |
| `{"text":"当 SUI 下跌超过 8% 时启动 500 USDC 风险响应策略。"}` | `0x041503ce868c54347445d99743f185ba13ece965d179e0f40c36e22083c3e80f` |
| `{"amount":"1000000000000000000000000","threshold_pct":"8.0"}` | `0x93bc4163c34e49983b49c47cc70821f1c6b236ba418cf02cbe88adf653db03fa` |

## 7. PTB Construction

An execution PTB is valid only if it binds MoveGate authorization, adapter action, MoveGate receipt creation and RescuePolicyWrapper recording into one transaction intent. The MVP Deepbook command sequence is:

1. MoveGate `authorize_action<BudgetCoin>(mandate, passport, RESCUEGRID_PROTOCOL_ADDRESS, quote_amount, ACTION_DEEPBOOK_RESCUE, clock, ctx)` returns AuthToken.
2. Deepbook adapter emits swap/order call for the allowed `pool_id` with computed `min_out` from slippage.
3. RescuePolicyWrapper `record_agent_trade(wrapper, mandate, passport, agent_registry, pool_id, quote_amount, base_amount, slippage_bps, client_order_id, auth_token, clock, ctx)`.
4. `record_agent_trade` verifies wrapper constraints, calls MoveGate `create_success_receipt` to consume the AuthToken and freeze an ActionReceipt, then increments `spent_amount` and emits `AgentTradeExecuted`.

The Move compiler enforces that the AuthToken is consumed in the same PTB — this is a structural guarantee, not a runtime check.

If Deepbook or a future adapter requires a command order that prevents the wrapper record from sharing the same PTB, Phase B or the adapter feasibility phase must stop and redesign the execution path before implementation continues.

### AuthToken 消费说明

`record_agent_trade` 接受 `auth_token: movegate::mandate::AuthToken`，但不直接调用 `consume_auth_token`。它把 token 交给 `movegate::receipt::create_success_receipt`，由 MoveGate 消费 token 并冻结 ActionReceipt。因为 AuthToken 是 zero-ability struct（no `store`, `copy`, `drop`），Move 编译器在编译时强制它必须在获得它的 PTB 内被消费。这消除了"AuthToken 被存储、复制或逃逸"的可能性，同时保留 MoveGate 的审计轨迹。

## 8. HTTP API Contract

### `POST /api/intents/parse`

Request:

```json
{
  "owner": "0x...",
  "text": "当 SUI 下跌超过 8% 时启动 500 USDC 风险响应策略。",
  "defaults": {
    "chain": "sui:testnet",
    "executor_kind": "deepbook",
    "pool_id": "0x...",
    "max_slippage_bps": 100,
    "expires_in_seconds": 86400
  }
}
```

Response:

```json
{
  "status": "ok",
  "strategy": {},
  "strategy_hash": "0x...",
  "agent_address": "0x...",
  "guardian_warnings": [],
  "ptb_preview": [
    "Create MoveGate Mandate and RescuePolicyWrapper for owner 0x...",
    "Use deepbook executor adapter",
    "Allow agent 0x... to trade only pool 0x...",
    "Set budget ceiling to 500 USDC",
    "Set max slippage to 1.00%",
    "Expire policy at 2026-06-02T12:00:00.000Z"
  ]
}
```

Error response:

```json
{
  "status": "error",
  "code": "INTENT_AMBIGUOUS",
  "message": "Budget or trigger threshold is missing."
}
```

Unknown executor response:

```json
{
  "status": "error",
  "code": "UNSUPPORTED_EXECUTOR",
  "message": "Executor adapter is not registered."
}
```

### `POST /api/policies`

Builds the unsigned owner-signed `create_policy` transaction after explicit user confirmation. The Worker does not hold the owner key, does not submit this transaction, and does not activate the Durable Object runtime until the client proves the transaction completed by reading the `PolicyCreated` event and calling `/api/policies/:wrapper_id/activate`.

Request:

```json
{
  "owner": "0x...",
  "strategy": {},
  "strategy_hash": "0x...",
  "confirmed": true
}
```

Response:

```json
{
  "status": "ok",
  "tx_json": "...",
  "strategy_hash": "0x...",
  "agent_address": "0x...",
  "active_policy_count": 3,
  "max_active_policies": 10,
  "sign_with": "owner signer (frontend wallet or scripted Testnet validation key); read PolicyCreated for wrapper_id"
}
```

Validation:

- `confirmed` must be true.
- `strategy.owner` must equal request `owner`.
- `strategy.agent` must equal `RESCUEGRID_AGENT_ADDRESS`.
- `strategy.executor_kind` must be registered in the ExecutorAdapter registry.
- `strategy_hash` must equal the server recomputed hash.
- The deployment must have fewer than `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` active policies, otherwise return `ACTIVE_POLICY_LIMIT_REACHED`.
- The client must sign and execute `tx_json` with the owner wallet, then read the `PolicyCreated` event for `wrapper_id` and `mandate_id`.

### `POST /api/policies/:wrapper_id/activate`

Registers a successfully created on-chain Policy with the Durable Object runtime. This endpoint is called only after the owner-signed creation transaction is finalized.

Request:

```json
{
  "strategy": {}
}
```

Response:

```json
{
  "status": "ok",
  "wrapper_id": "0x...",
  "runtime_state": "Monitoring"
}
```

Validation:

- `wrapper_id` must exist on-chain.
- Linked Mandate must exist, not be revoked and not be expired.
- If `strategy` is supplied, its recomputed hash must equal the wrapper `strategy_hash`.
- Activation must not submit chain transactions; it only registers Durable Object state and schedules ticks.

### `GET /api/policies?owner=0x...`

Returns owner-scoped Policy rows from chain events, enriched by live wrapper/mandate reads and Durable Object runtime state.

Rules:

- The list response must not include demo or local fixture rows.
- Chain state is authoritative for `status`, `revoked`, `expires_at_ms`, budget and wrapper fields.
- Durable Object runtime state may update `runtime_state` when it does not conflict with terminal chain state.
- If chain state and runtime state conflict, chain state wins and the row returns `runtime_state_stale=true`.

### `POST /api/policies/:wrapper_id/revoke`

Request:

```json
{
  "owner": "0x...",
  "confirmed": true
}
```

Response:

```json
{
  "status": "ok",
  "tx_json": "...",
  "wrapper_id": "0x...",
  "mandate_id": "0x...",
  "sign_with": "owner signer (frontend wallet or scripted Testnet validation key)"
}
```

The client signs and executes `tx_json` with the owner wallet. After the transaction finalizes, list/activity reads must show the chain-authoritative revoked state. If the Mandate is already revoked, the API must not return another signable revoke transaction. It returns:

```json
{
  "status": "error",
  "code": "ALREADY_REVOKED",
  "message": "Policy is already revoked."
}
```

### `GET /api/policies/:wrapper_id/activity`

Response:

```json
{
  "status": "ok",
  "policy": {
    "policy_id": "0x...",
    "mandate_id": "0x...",
    "wrapper_id": "0x...",
    "runtime_state": "Monitoring",
    "runtime_state_stale": false,
    "budget_ceiling": "500000000",
    "spent_amount": "100000000",
    "revoked": false,
    "expires_at_ms": 1780000000000
  },
  "events": [],
  "chain_activity": [],
  "runtime_activity": [],
  "activity": []
}
```

Data source rules:

- `revoked` and `expires_at_ms` come from the MoveGate Mandate.
- `spent_amount`, `budget_ceiling`, `pool_id`, `max_slippage_bps`, and `strategy_hash` come from the RescuePolicyWrapper.
- `events` come from chain event queries and include transaction digest from event metadata.
- `chain_activity` maps those chain events into the dashboard feed format.
- `runtime_activity` contains Durable Object runtime events.
- `activity` is the timestamp-sorted merge of `chain_activity` and runtime feed items.
- `activity` must de-duplicate items with the same transaction digest. When a runtime execution item and a chain event refer to the same digest, the chain event wins because it is the authoritative success evidence.
- Durable Object runtime activity must be idempotent for transaction-bearing events: replaying the same digest must not create duplicate success rows. A later event with stronger success evidence may replace an earlier unresolved/error row for the same digest.
- `runtime_state` comes from Durable Object state.
- If chain state conflicts with runtime state, chain state wins and `runtime_state_stale` is true.

### `GET /api/runtime/status`

Returns non-secret Worker runtime posture for the frontend Profile / Accounts surface. This endpoint is read-only and must not reveal private keys, WaaP session files, permission tokens or Worker secrets.

Response:

```json
{
  "status": "ok",
  "chain": "sui:testnet",
  "agent": {
    "address": "0x...",
    "balance_manager_id": "0x...",
    "passport_id": "0x..."
  },
  "signer": {
    "kind": "worker-secret",
    "address": null,
    "expected_address": "0x...",
    "signer_matches_expected": false,
    "available": false,
    "execution_configured": false,
    "execution_enabled": false,
    "unavailable_code": "EXECUTION_DISABLED",
    "unavailable_detail": "worker AGENT_KEY is unavailable",
    "known_signer_kinds": ["worker-secret", "local-daemon", "waap", "hardware", "remote-signer"]
  },
  "execution": {
    "configured": false,
    "enabled": false,
    "mode": "worker-secret",
    "blocker_code": "EXECUTION_DISABLED"
  },
  "chain_data_provider": {
    "kind": "json-rpc",
    "graphql_configured": false,
    "worker_first": true
  },
  "monitoring_provider": {
    "kind": "timer-polling",
    "known_provider_kinds": ["timer-polling", "grpc"],
    "provider_status": "active",
    "worker_first": true,
    "tick_driver": "durable-object-alarm",
    "trigger_source": "timer",
    "grpc_configured": false,
    "hot_path": "runtime-core-tick",
    "execution_hot_path_unchanged": true,
    "migration_ready": false,
    "blocker_code": null
  },
  "runtime": {
    "cloud_worker": true,
    "local_daemon_supported": true,
    "mainnet_requires_external_signer": true
  }
}
```

Rules:

- `signer.kind` is selected from `SIGNER_KIND` / `RESCUEGRID_SIGNER_KIND`, defaulting to `worker-secret`.
- `signer.address` is the public address derived from the configured secret, or `null` when the secret is missing/invalid; `signer.expected_address` is the deployed RescueGrid agent address.
- `worker-secret` is allowed only for Testnet Worker validation and is execution-ready only when `EXECUTION_ENABLED=true`, `AGENT_KEY` is present, the secret is a valid Sui private key, and the derived public address equals `expected_address`.
- `local-daemon` is available only when `RESCUEGRID_DAEMON_MODE=true`, a local `AGENT_KEY` is present, the secret is valid, and the derived public address equals `expected_address`.
- Invalid secrets return `INVALID_SIGNER_SECRET`; valid secrets for the wrong address return `SIGNER_ADDRESS_MISMATCH`. Both keep `execution.enabled=false`.
- `waap` is disabled by default and must return `UNSUPPORTED_SIGNER` unless the runtime is a local daemon with `RESCUEGRID_DAEMON_MODE=true`, `RESCUEGRID_WAAP_CLI_ENABLED=true`, and `RESCUEGRID_WAAP_SUI_ADDRESS` matching `expected_address`.
- `waap` status may expose only public signer metadata: address, chain, CLI enabled flag and whether a permission token is configured. It must never expose a WaaP session file, permission token value or raw CLI stderr/stdout.
- `waap` signing uses a local daemon injected runner that calls `waap-cli send-tx --tx-json <serialized RescueGrid PTB> --chain sui:testnet --json`; the Cloud Worker runtime must not shell out to `waap-cli`.
- `hardware` and `remote-signer` are explicit external signer modes but must return `UNSUPPORTED_SIGNER` until their adapter spike is validated.
- Production Mainnet must not use `worker-secret`; it must use an external/user-controlled signer mode.
- The frontend must treat this endpoint as status evidence only. It cannot infer that execution is allowed unless `execution.enabled=true`.
- `monitoring_provider.kind=timer-polling` is the default and remains the active MVP tick driver through Durable Object alarms.
- `MONITORING_PROVIDER=grpc` may report `grpc_configured=true`, but it must keep `provider_status=unavailable`, `blocker_code=GRPC_MONITORING_NOT_IMPLEMENTED` and `execution_hot_path_unchanged=true` until Runtime Core, Durable Object scheduling and replay semantics are explicitly wired and tested.
- `monitoring_provider` must never expose gRPC endpoint URLs or access tokens.

### `GET /api/chain-data/status`

Returns non-secret ChainDataProvider posture for Data Sources, smoke tests and GraphQL migration checks. The endpoint is read-only and must not reveal GraphQL endpoint URLs, Worker secrets or signer secrets.

Response:

```json
{
  "status": "ok",
  "chain": "sui:testnet",
  "provider_kind": "json-rpc",
  "known_provider_kinds": ["json-rpc", "graphql"],
  "provider_status": "configured",
  "available": true,
  "configured": true,
  "endpoint_configured": false,
  "graphql_configured": false,
  "worker_first": true,
  "transport": "sui-json-rpc",
  "read_model": {
    "policy_objects": "json-rpc",
    "policy_events": "json-rpc",
    "owner_policy_list": "json-rpc",
    "balances": "json-rpc",
    "market": "json-rpc"
  },
  "probe": { "status": "skipped", "reason": "probe=false" }
}
```

Rules:

- Default response must not run a live probe. It only reports selected provider, transport class and read model.
- `?probe=true` may perform a bounded read probe. For `json-rpc`, this reads the Sui clock object. For `graphql`, it runs a basic schema probe, clock object read and 1-row policy event query.
- GraphQL mode without `SUI_GRAPHQL_URL`, `SUI_GRAPHQL_ENDPOINT`, `GRAPHQL_URL` or injected transport returns `provider_status=unavailable` and `error.code=GRAPHQL_ENDPOINT_REQUIRED`.
- A failed GraphQL schema/read probe returns `provider_status=probe_failed` and a sanitized `probe` error; the endpoint URL and secret values must not be included.
- GraphQL remains Worker-first and read-only. Balance, gas and DeepBook market reads may still use the JSON-RPC fallback until their GraphQL query shapes are validated.

### `GET /api/archival/replay-contract`

Returns the Worker-first contract for future Archival Store-backed replay. This endpoint is read-only and does not replace current activity reads.

Response:

```json
{
  "status": "ok",
  "chain": "sui:testnet",
  "provider": {
    "kind": "none",
    "known_provider_kinds": ["none", "archival-store"],
    "provider_status": "disabled",
    "endpoint_configured": false,
    "worker_first": true,
    "replay_only": true,
    "execution_hot_path_unchanged": true,
    "activity_hot_path_unchanged": true,
    "migration_ready": false,
    "blocker_code": "ARCHIVAL_REPLAY_DISABLED"
  },
  "query_contracts": [
    { "id": "historical_activity" },
    { "id": "performance_replay" },
    { "id": "judge_demo_replay" }
  ]
}
```

Rules:

- Default provider is `none`; it must return `provider_status=disabled` and `blocker_code=ARCHIVAL_REPLAY_DISABLED`.
- `ARCHIVAL_REPLAY_PROVIDER=archival-store` without an endpoint returns `provider_status=unavailable` and `ARCHIVAL_REPLAY_ENDPOINT_REQUIRED`.
- `ARCHIVAL_REPLAY_PROVIDER=archival-store` with `SUI_ARCHIVAL_STORE_URL`, `SUI_ARCHIVAL_URL` or `ARCHIVAL_STORE_URL` returns `provider_status=not_validated`, not ready. Endpoint configured is a posture bit, not live replay proof.
- The endpoint must define exactly three initial query contracts: `historical_activity`, `performance_replay` and `judge_demo_replay`.
- Replay contracts are advisory/read-only and must keep `execution_hot_path_unchanged=true` and `activity_hot_path_unchanged=true` until an archival provider is implemented and validated.
- Output must not include Archival Store endpoint URLs, access tokens, `AGENT_KEY`, owner keys, WaaP tokens or Worker secrets.
- Chain events and object snapshots remain authoritative. Durable Object runtime rows can annotate replay output but cannot override terminal chain state or claim execution success.

### `GET /api/private-records/contract`

Returns the Worker-first private policy record contract for a future Seal + Walrus storage layer. This endpoint is read-only; it defines schemas, access anchors and blockers, but does not upload to Walrus, create a Seal policy, mutate Sui objects or decrypt payloads.

Response:

```json
{
  "status": "ok",
  "chain": "sui:testnet",
  "provider": {
    "kind": "none",
    "known_provider_kinds": ["none", "seal-walrus"],
    "provider_status": "disabled",
    "seal_configured": false,
    "walrus_configured": false,
    "worker_first": true,
    "read_only_contract": true,
    "client_side_encryption_required": true,
    "signing_secret_allowed": false,
    "storage_hot_path_unchanged": true,
    "execution_hot_path_unchanged": true,
    "migration_ready": false,
    "blocker_code": "PRIVATE_RECORDS_DISABLED"
  },
  "access_model": {
    "pattern": "Sui access object + Seal policy + Walrus blob id",
    "agent_can_decrypt_by_default": false,
    "worker_can_decrypt_by_default": false,
    "on_chain_payload_policy": "hashes_and_blob_ids_only"
  },
  "record_contracts": [
    { "id": "strategy_snapshot" },
    { "id": "backtest_report" },
    { "id": "agent_reasoning_trace" },
    { "id": "incident_report" }
  ]
}
```

Rules:

- Default provider is `none`; it must return `provider_status=disabled` and `blocker_code=PRIVATE_RECORDS_DISABLED`.
- `PRIVATE_RECORD_PROVIDER=seal-walrus` without both Seal and Walrus posture configured returns `provider_status=unavailable` and `PRIVATE_RECORDS_CONFIG_REQUIRED`.
- `PRIVATE_RECORD_PROVIDER=seal-walrus` with Seal and Walrus posture configured returns `provider_status=not_validated`, not ready. Configured posture is not encrypted storage proof.
- The endpoint must define exactly four initial record contracts: `strategy_snapshot`, `backtest_report`, `agent_reasoning_trace` and `incident_report`.
- Every record contract must require client-side encryption and set `signing_secret_allowed=false`.
- Chain anchors may store wrapper id, mandate id, owner, `strategy_hash`, Seal access object id, Walrus blob id, content hash and version. On-chain payloads must be hashes and blob ids only.
- The agent and Worker cannot decrypt private records by default. Owner-delegated readers must be explicit.
- Output must not include Seal/Walrus endpoint URLs, access-token values, owner key values, WaaP session values, permission-token values, raw hidden model reasoning text or Worker secret values. Secret key names such as `AGENT_KEY` may appear only as disallowed schema metadata.
- Private record storage cannot submit transactions or relax Guardian, MoveGate or `RescuePolicyWrapper` checks.

### `npm run chain-data:status`

Runs the same ChainDataProvider status logic from a local CLI so cloud Worker and local daemon migrations can be validated before changing production reads.

Usage:

```bash
npm run chain-data:status -- --json
npm run chain-data:status -- --probe --json
npm run chain-data:status -- --provider graphql --endpoint <url> --probe --json
npm run chain-data:status -- --provider graphql --owner <0x...> --wrapper-id <0x...> --json
```

Rules:

- The script is read-only. It must not create policies, submit PTBs, mutate daemon watch config or write activity logs.
- Without `--probe`, it reports selected provider kind, transport, read model and endpoint-configured boolean only.
- With `--probe`, it uses the same bounded provider probe as `/api/chain-data/status?probe=true`.
- With `--owner` or `--wrapper-id`, a non-JSON-RPC selected provider must compare owner policy lists and wrapper activity against a JSON-RPC baseline.
- `--provider graphql` without a configured endpoint exits non-zero. A probe failure or provider-vs-JSON-RPC mismatch also exits non-zero.
- Human and JSON output must redact endpoint URLs, `AGENT_KEY`, owner keys, WaaP permission tokens and internal tick tokens.

### `GET /api/execution/readiness`

Returns the combined execution preflight for cloud agent, local daemon and UI surfaces. This endpoint is read-only and must not submit a transaction or claim execution success.

Response:

```json
{
  "status": "ok",
  "chain": "sui:testnet",
  "scope": {
    "executor_kind": "deepbook",
    "market_id": "SUI_DBUSDC",
    "pool_id": "0x...",
    "budget_coin_type": "0x...::DBUSDC::DBUSDC"
  },
  "agent": {
    "address": "0x...",
    "balance_manager_id": "0x...",
    "passport_id": "0x..."
  },
  "signer": { "kind": "worker-secret", "available": false },
  "execution": { "configured": false, "enabled": false, "blocker_code": "EXECUTION_DISABLED" },
  "funding": {
    "funding_ready": false,
    "execution_ready": false,
    "balances": { "DBUSDC": "0", "DEEP": "0", "SUI_MIST": "0" },
    "execution_blocker_codes": ["EXECUTION_DISABLED", "INSUFFICIENT_DBUSDC", "INSUFFICIENT_DEEP"]
  },
  "ready": false,
  "execution_ready": false,
  "execution_claimed": false
}
```

Rules:

- `ready` / `execution_ready` are true only when signer execution is enabled and DBUSDC, DEEP and SUI gas thresholds are satisfied.
- Query parameters `dbusdc_threshold`, `deep_threshold` and `sui_gas_threshold` may raise the required threshold for a strict demo or future policy, but they cannot weaken configured minimums.
- `/api/balances` may include the same `funding` and `execution_readiness` object for Profile compatibility, but callers that need execution preflight should prefer this endpoint.
- `execution_claimed` is always false here; only a real tick result with `AgentTradeExecuted` and spend increase can claim execution.
- The response must not include `AGENT_KEY`, owner key, WaaP session file, permission token or secret values.

### `npm run funding:request`

Builds a read-only external funding handoff from the same execution readiness contract. It does not submit a transaction, does not create a policy, and does not claim execution.

Output:

```json
{
  "status": "ok",
  "purpose": "external_deepbook_testnet_funding_request",
  "chain": "sui:testnet",
  "ready_for_strict_execution": false,
  "agent": {
    "address": "0x...",
    "passport_id": "0x...",
    "balance_manager_id": "0x..."
  },
  "deepbook": {
    "market_id": "SUI_DBUSDC",
    "pool_id": "0x...",
    "dbusdc_coin_type": "0x...::DBUSDC::DBUSDC",
    "deep_coin_type": "0x...::deep::DEEP"
  },
  "funding_targets": {
    "balance_manager": {
      "id": "0x...",
      "required_assets": [
        { "asset": "DBUSDC", "observed": "0", "required": "1", "missing": "1" },
        { "asset": "DEEP", "observed": "0", "required": "1", "missing": "1" }
      ]
    },
    "agent_gas": {
      "address": "0x...",
      "required_assets": [
        { "asset": "SUI_MIST", "observed": "0", "required": "1", "missing": "1" }
      ]
    }
  },
  "next_verification": {
    "readiness_command": "npm run daemon -- status --json",
    "strict_execution_command": "npm run demo:execute"
  },
  "execution_claimed": false
}
```

Rules:

- `funding:request` must reuse `buildExecutionReadiness`; it cannot maintain a second funding/signer readiness model.
- DBUSDC and DEEP targets are the DeepBook BalanceManager balances, not plain wallet balances. Direct wallet transfer is insufficient unless the BalanceManager read reflects the balance.
- SUI gas target is the agent address.
- Output may include public addresses and coin types, but must not include `AGENT_KEY`, owner key, internal tick token, WaaP session file, permission token or secret values.
- `ready_for_strict_execution=true` is only a preflight state; successful execution still requires `npm run demo:execute` to prove `AgentTradeExecuted`, `execution_claimed=true` and spend increase.

### `GET /api/risk/controls`

Returns Worker-persisted owner runtime risk controls. When `owner` is provided, the Durable Object response is filtered to that owner; unfiltered reads are used only by the internal tick path and runtime core still matches controls against the wrapper owner before blocking.

Response:

```json
{
  "status": "ok",
  "owner": "0x...",
  "global_stopped": true,
  "global_stop": {
    "action": "set_global_stop",
    "scope": "global",
    "target_key": "global",
    "stopped": true,
    "owner": "0x...",
    "updated_ms": 1780480000000,
    "issued_at_ms": 1780480000000
  },
  "global_stops": [
    {
      "action": "set_global_stop",
      "scope": "global",
      "target_key": "global",
      "stopped": true,
      "owner": "0x...",
      "updated_ms": 1780480000000,
      "issued_at_ms": 1780480000000
    }
  ],
  "strategy_stops": ["0x...wrapper"],
  "strategy_stop_records": [
    {
      "action": "set_strategy_stop",
      "scope": "strategy",
      "target_key": "0x...wrapper",
      "wrapper_id": "0x...wrapper",
      "stopped": true,
      "owner": "0x...",
      "updated_ms": 1780480000000,
      "issued_at_ms": 1780480000000
    }
  ],
  "venue_stops": ["DeepBook"],
  "venue_stop_records": [
    {
      "action": "set_venue_stop",
      "scope": "venue",
      "venue": "DeepBook",
      "venue_key": "deepbook",
      "stopped": true,
      "owner": "0x...",
      "updated_ms": 1780480000000,
      "issued_at_ms": 1780480000000
    }
  ]
}
```

### `POST /api/risk/controls`

Persists an owner-signed runtime global, strategy or venue stop/resume control. The Worker must verify a Sui personal-message signature from the owner before mutating Durable Object state.

Request:

```json
{
  "owner": "0x...",
  "message": "{\"app\":\"RescueGrid\",\"version\":1,\"chain\":\"sui:testnet\",\"action\":\"set_strategy_stop\",...}",
  "signature": "base64..."
}
```

Rules:

- `message` domain must be `RescueGrid`, `version=1`, `chain=sui:testnet`.
- Supported actions are `set_global_stop`, `set_strategy_stop` and `set_venue_stop`.
- `message.owner` must match the request owner and the verified Sui signature address.
- `set_global_stop` must include `stopped`, `nonce` and `issued_at_ms`.
- `set_strategy_stop` must include `wrapper_id`, `stopped`, `nonce` and `issued_at_ms`; the Worker reads the wrapper from chain and rejects the control unless `wrapper.owner` equals the signed owner.
- `set_venue_stop` must include `venue`, `venue_key`, `stopped`, `nonce` and `issued_at_ms`.
- The control expires after 10 minutes and used nonces are rejected.
- Successful writes update the runtime control plane only. They do not revoke the MoveGate Mandate or alter the `RescuePolicyWrapper`.

### `GET/POST /api/risk/venue-stops`

Compatibility view for venue-only controls. GET returns `venue_stops` and `venue_stop_records` from the same Durable Object state. POST still verifies a Sui personal-message signature, but rejects any action other than `set_venue_stop`. New UI and tests should prefer `/api/risk/controls`.

### `POST /api/agent/tick`

Internal endpoint called by scheduler or Durable Object alarm. This endpoint is not exposed to Dashboard and must reject public traffic; local development may call it only with an internal dev token.

Authentication:

- Every request must include `Authorization: Bearer <INTERNAL_AGENT_TICK_TOKEN>`.
- The token is stored as a Worker secret and a local `.dev.vars` secret; it must not be bundled into Dashboard code.
- Production deployments must reject missing, invalid or demo-mode-only tokens with `401` or `403`.
- `force_trigger=true` is accepted only when both the internal token is valid and `RESCUEGRID_DEMO_MODE=true`.

Request:

```json
{
  "policy_id": "0x...",
  "mandate_id": "0x...",
  "wrapper_id": "0x...",
  "source": "durable_object_alarm",
  "force_trigger": false
}
```

`force_trigger=true` is allowed only in local tests or controlled demo mode. Production Worker deployments must reject it.

Response:

```json
{
  "status": "ok",
  "policy_id": "0x...",
  "mandate_id": "0x...",
  "wrapper_id": "0x...",
  "action": "executed",
  "tx_digest": "0x..."
}
```

Allowed `action` values:

- `no_op`
- `blocked`
- `executed`
- `stopped_revoked`
- `stopped_expired`
- `error`

Runtime risk controls:

- Before submitting an execution PTB, tick must read Worker runtime risk controls.
- If the owner's global stop is active and the trigger condition is met, tick returns `action=blocked`, `code=GLOBAL_STOPPED`, and does not submit a transaction.
- If the wrapper's strategy stop is active and the trigger condition is met, tick returns `action=blocked`, `code=STRATEGY_STOPPED`, and does not submit a transaction.
- If the target venue is stopped for the owner and the trigger condition is met, tick returns `action=blocked`, `code=VENUE_STOPPED`, and does not submit a transaction.
- If risk controls cannot be read when a triggered execution is being evaluated, tick returns `RISK_CONTROLS_UNAVAILABLE` and does not submit.

## 9. Agent State Machine

| Current | Trigger | Condition | Next | Side effect |
| --- | --- | --- | --- | --- |
| `DraftIntent` | parse ok | preview generated | `AwaitingConfirm` | return PTB preview |
| `DraftIntent` | parse error | missing fields | `DraftIntent` | return error |
| `AwaitingConfirm` | user confirms | tx succeeds | `PolicyActive` | create policy |
| `PolicyActive` | runtime registered | mandate and wrapper readable | `Monitoring` | schedule tick |
| `Monitoring` | tick | trigger false | `Monitoring` | no-op log |
| `Monitoring` | tick | guardian blocks | `Paused` or `Monitoring` | runtime block log |
| `Monitoring` | tick | checks pass | `Executing` | submit PTB |
| `Executing` | tx success | event confirmed | `Monitoring` | update spent |
| `Executing` | tx fail | recoverable | `Monitoring` | record error |
| any active | owner revoke | chain confirms | `Revoked` | stop alarms |
| any active | expiry reached | now >= expires | `Expired` | stop execution |

`Paused` is reserved for repeated Guardian or execution failures. MVP may keep blocked policies in `Monitoring` if failures are transient, but must never execute while a blocking condition remains true.

## 10. Guardian Algorithm

Every tick must read both the MoveGate Mandate and RescuePolicyWrapper, then run checks in this order:

1. Chain and adapter target match.
2. Mandate and wrapper exist and `wrapper.mandate_id == mandate.id`.
3. Mandate is not revoked.
4. Mandate is not expired.
5. Wrapper remaining budget is positive.
6. Proposed trade amount is `<= remaining_budget`.
7. Estimated slippage is `<= wrapper.max_slippage_bps`.
8. Concentration score is computed for UI.

Expiry decisions must be derived from the latest MoveGate Mandate and Sui `Clock` semantics. Budget decisions must be derived from the latest RescuePolicyWrapper. Worker system time may be used only for scheduling and optimistic UI labels; it must not be the final authority for expiry.

Pseudocode:

```text
remaining = wrapper.budget_ceiling - wrapper.spent_amount
if wrapper.mandate_id != mandate.id: block(MANDATE_MISMATCH)
if mandate.revoked: block(REVOKED)
if now_ms >= mandate.expires_at_ms: block(EXPIRED)
if proposed_amount > remaining: block(BUDGET)
if estimated_slippage_bps > wrapper.max_slippage_bps: block(SLIPPAGE)
if plan.target_id != wrapper.pool_id: block(POOL_MISMATCH) // v1 Deepbook target
return allow
```

Block logging policy:

- No-op ticks are runtime log only.
- Static parse-time warnings are API response only.
- Hard blocks after a trigger condition is met are runtime log by default.
- MVP does not emit on-chain `GuardianBlocked`. Public no-trade proof is deferred until a post-MVP design can bind block events to a valid Mandate without creating gas spam or post-revocation noise.

## 11. Edge Cases

- Natural language does not include budget.
- Natural language includes unsupported asset.
- Natural language selects an unsupported executor.
- User changes wallet after preview before confirm.
- Mandate + Wrapper creation transaction succeeds but Worker response times out.
- Durable Object activates before chain event query returns the creation event.
- Agent tick reads stale market price.
- Adapter produces an ExecutionPlan from stale protocol state.
- Deepbook pool has insufficient liquidity.
- Estimated slippage passes but submitted transaction fails.
- `spent_amount + amount` would overflow `u64`.
- Mandate is revoked while Agent is constructing PTB.
- Mandate expires between preview and transaction submission.
- Agent key is rotated but old Mandate still names old agent.
- Dashboard shows runtime state different from chain state.
- User tries to revoke an already revoked Policy.
- Deployment already has `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` active policies.

## 12. Implementation Rule

When implementation begins, tests must be written from `docs/05-test-spec.md` before production code. Any code behavior that differs from this technical spec must update this document first.
