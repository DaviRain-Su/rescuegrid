# RescueGrid — Build Status

日期：2026-06-02 · 环境：Sui Testnet

A running snapshot of what is built and how it was verified. Demo-facing summary for judges / handoff.

## What ships

| Layer | Status | Verified by |
| --- | --- | --- |
| **Web dashboard** (Vite + React) | ✅ | `npm run build` (562 modules); landing → zkLogin → dashboard, flash-crash demo |
| **Move package** `rescuegrid::policy` | ✅ deployed | `sui move test` 8/8; published `0x92f6e3…bb78` |
| **Worker API** (Cloudflare + Hono) | ✅ all endpoints | 23 unit checks + `wrangler dev` smoke + on-chain dry-run |
| **Real zkLogin** (Enoki + dapp-kit) | ✅ coded | builds; needs operator OAuth creds to run (see README) |
| **Live execution** (Deepbook order) | 🟡 gated | builders + dry-run; blocked on testnet DBUSDC funding |

## On-chain (testnet)

- rescuegrid package: `0x92f6e3218151e4d16fa51fd49df974a84ea744510f5e5a8ff79a01aacf27bb78`
- agent: `0x9eeed099…2ee43` · passport `0x0e7421…f8e6b` · BalanceManager `0x2e2e818f…aec2` (unfunded)
- reuses deployed MoveGate `0xec91e6…cf884a` · Deepbook `SUI_DBUSDC` pool `0x1c1936…7163a5`
- See `deployment.testnet.json` (`npm run config`).

## Phase ledger

- **B** feasibility — ✅ GO (`docs/B-feasibility-findings.md`): MoveGate Mandate shareable w/o owner co-sign, AuthToken hot-potato, Deepbook pools live.
- **C** Move — ✅ C1–C7. RescuePolicyWrapper + create/revoke/assert/record; thin helper builds `vector<TypeName>`; AuthToken consumed via MoveGate receipt; published.
- **E** Worker — ✅ E1–E8. parse (strategy_hash matches all 4 spec vectors) · create_policy PTB (zkLogin-signed, dry-run success) · activity (chain-authoritative) · Guardian (11 tests) · tick state machine (7 tests) · Durable Object (alarm) · state sync.
- **F** Deepbook — 🟡 F1/F3 builders structurally verified (serialize + dry-run of create). Agent + BalanceManager provisioned on-chain. **Blocked:** DBUSDC mint is permissioned and the SUI_DBUSDC pool is illiquid, so the BM can't be self-funded → live execution dry-run pending an external DBUSDC source. `EXECUTION_ENABLED=false` until then.
- **D** dashboard wiring — ✅ real zkLogin sign-in; live create-policy (parse → build → sign → activate); live policy list + on-chain revoke. (Create/list/revoke need no DBUSDC.) Live PTB *preview* still uses the demo shape; real parse runs at deploy.
- **G** packaging — ✅ G1 `npm run config`; G3 README quickstart; this status doc. G2 execute-leg of the demo script is gated with F.

## Known gaps / next

1. **DBUSDC funding** — unblock live Deepbook execution (operator-provided DBUSDC or a working faucet), then flip `EXECUTION_ENABLED=true` and dry-run/replay the execution PTB (`worker/test/verify-create-policy.mjs` pattern).
2. **zkLogin live test** — provide Enoki + Google creds, then exercise sign-in + create/revoke end-to-end.
3. **Live PTB preview (D3)** — render the Worker's parse output in the Review step (currently demo-shaped).
