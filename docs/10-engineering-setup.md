# RescueGrid Engineering Setup

Status: Active setup note
Date: 2026-06-03
Scope: RescueGrid Sui-first implementation sessions

This file turns the Sui Agent Skills assessment into a concrete engineering
workflow. These skills are developer/coding accelerators only. They are not
RescueGrid runtime dependencies, they do not change the MVP security model, and
they must not be used as evidence that a feature is implemented.

## Baseline Orientation

Before changing code, identify the phase and boundary from the project docs:

- Product target: [`docs/01-prd.md`](01-prd.md)
- Runtime and adapter boundaries: [`docs/02-architecture.md`](02-architecture.md)
- API, state machine and security contract: [`docs/03-technical-spec.md`](03-technical-spec.md)
- Current task phase: [`docs/04-task-breakdown.md`](04-task-breakdown.md)
- Test expectations: [`docs/05-test-spec.md`](05-test-spec.md)
- Current status and known blockers: [`docs/STATUS.md`](STATUS.md)

Keep the hackathon branch Sui-only. Post-MVP multivenue work belongs in
[`docs/06-post-mvp-multivenue-roadmap.md`](06-post-mvp-multivenue-roadmap.md)
unless the task explicitly changes the hackathon scope.

## Sui Agent Skills Routing

Use the Sui Agent Skills listed in the Sui docs as task-specific references for
implementation sessions. The repo should still be read first; the skill output
must be reconciled with RescueGrid's MoveGate + `RescuePolicyWrapper` contract.

| Work area | Recommended skill(s) | RescueGrid use | Required validation |
| --- | --- | --- | --- |
| Chain reads, GraphQL, gRPC, indexing, Walrus data | `accessing-data` | `ChainDataProvider`, policy list/activity reads, future Archival Store replay, Walrus blobs | `npm run chain-data:status -- --json`, `npm run chain-data:status -- --probe --json`, `npm --prefix worker run test:chain-data` |
| Programmable Transaction Blocks | `ptbs`, `object-model` | create/revoke policy PTBs, DeepBook execution PTB, MoveGate AuthToken + ActionReceipt composition | `npm --prefix worker test`, `cd move/rescuegrid && sui move test` |
| Sui object and shared-object modeling | `object-model` | `RescuePolicyWrapper`, MoveGate Mandate references, future `PolicyPrivateRecord` access object | `cd move/rescuegrid && sui move build`, `cd move/rescuegrid && sui move test` |
| Move build and unit tests | `sui-build-test`, `move-unit-testing` | wrapper invariants, event schema, abort-code behavior, publish readiness | `cd move/rescuegrid && sui move test` |
| Publish and upgrade workflow | `sui-publish` | Testnet publish, package id updates, deployment config refresh | `npm run config`, follow publish checklist in status docs |
| Frontend wallet and transaction UX | `frontend-apps` | dApp Kit wallet connect, wallet-signed create/revoke flows, zkLogin optional path | `npm run build`, `npm run test:auth-wallets`, `npm run test:wallet-flow`, `npm run test:live-config`, `npm run test:signer-health` |
| Walrus Sites deployment | `walrus-sites`, `walrus-sites-publishing` | Future decentralized frontend hosting only | `npm run build` plus a separate deployment verification note |

## Guardrails

- Do not route production reads directly from the frontend to GraphQL. Worker
  API semantics remain the shared contract for frontend, cloud agent and local
  daemon.
- Do not store `AGENT_KEY`, owner wallet keys, WaaP session files, permission
  tokens or signing secrets in Seal, Walrus, docs, logs or generated reports.
- Do not claim non-DeepBook execution until the adapter has a registered
  `ExecutorAdapter`, wrapper target constraints, Guardian preflight and tests.
- Do not claim live DeepBook execution until DBUSDC/DEEP funding exists and
  `npm run demo:execute` proves `AgentTradeExecuted`, `execution_claimed=true`
  and on-chain spend increase.
- Do not treat Sui Agent Skills as a substitute for repo evidence. The current
  source tree, current docs and current command output remain authoritative.

## Session Checklist

For implementation sessions:

1. Read the relevant docs and current source before using a skill.
2. Pick only the skill(s) that match the concrete change.
3. Keep Worker-first and Sui-only boundaries unless the task explicitly says
   post-MVP or multivenue.
4. Update docs when behavior, architecture, setup or security boundaries change.
5. Run the narrow tests for the touched surface, then broader checks if shared
   runtime, adapter, signer or frontend behavior changed.
6. Commit small checkpoints after substantial task slices.

Recommended broad checks:

```bash
npm --prefix worker test
npm --prefix worker run typecheck
npm run build
npm run chain-data:status -- --json
git diff --check
```

Move changes also require:

```bash
cd move/rescuegrid && sui move build
cd move/rescuegrid && sui move test
```

Live-demo or funding-gate work also requires:

```bash
npm run funding:request
npm run demo:loop
# After external DBUSDC/DEEP funding only:
npm run demo:execute
```
