import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildFundingProofReport,
  fundingProofOptions,
  parseFundingProofArgs,
  runFundingProof,
  verifyFundingTransaction,
  writeFundingProofArtifact,
} from '../scripts/funding-proof.mjs'
import { DEPLOYMENT } from '../src/sui-tx.js'

const DBUSDC = DEPLOYMENT.deepbook.dbusdc_coin_type
const DEEP = DEPLOYMENT.deepbook.deep_coin_type
const SUI = '0x2::sui::SUI'

function readiness({ executionReady = false } = {}) {
  return {
    status: 'ok',
    chain: 'sui:testnet',
    scope: {
      market_id: 'SUI_DBUSDC',
      pool_id: DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id,
    },
    agent: {
      address: DEPLOYMENT.agent.address,
      passport_id: DEPLOYMENT.agent.passport_id,
      balance_manager_id: DEPLOYMENT.agent.balance_manager_id,
    },
    signer: {
      kind: 'worker-secret',
      address: executionReady ? DEPLOYMENT.agent.address : null,
      expected_address: DEPLOYMENT.agent.address,
      signer_matches_expected: executionReady,
      available: executionReady,
      execution_configured: executionReady,
      execution_enabled: executionReady,
      unavailable_code: executionReady ? null : 'EXECUTION_DISABLED',
    },
    signer_capabilities: [
      {
        kind: 'worker-secret',
        selected: true,
        runtime_scope: 'cloud-worker',
        custody_model: 'worker-held-agent-key',
        available: executionReady,
        execution_enabled: executionReady,
        permission_token: 'super-secret-token',
        session_value: 'super-secret-session',
        raw_runner_output: 'super-secret-runner-output',
      },
    ],
    external_signer: {
      kind: 'waap',
      selected: false,
      status: 'not_selected',
      available: false,
      permission_token_configured: true,
      secrets_returned: false,
      permission_token: 'super-secret-token',
      session_value: 'super-secret-session',
      raw_runner_output: 'super-secret-runner-output',
    },
    cloud_per_user_signer: {
      kind: 'cloud-per-user',
      selected: false,
      status: 'not_selected',
      available: false,
      seal_walrus_required: true,
      per_user_agent_required: true,
      secrets_returned: false,
      seal_access_token: 'super-secret-seal-token',
      walrus_access_token: 'super-secret-walrus-token',
    },
    execution_ready: executionReady,
    funding_ready: executionReady,
    blocker_codes: executionReady ? [] : ['EXECUTION_DISABLED', 'INSUFFICIENT_DBUSDC', 'INSUFFICIENT_DEEP'],
    blocker_labels: executionReady ? [] : ['Execution disabled'],
    balance_manager: { id: DEPLOYMENT.agent.balance_manager_id },
    funding: {
      criteria: [
        {
          holder: DEPLOYMENT.agent.balance_manager_id,
          asset: 'DBUSDC',
          threshold: '100',
          observed_balance: executionReady ? '100' : '0',
          usable: executionReady,
          blocker_code: 'INSUFFICIENT_DBUSDC',
          source_of_truth: 'test BM DBUSDC read',
        },
        {
          holder: DEPLOYMENT.agent.balance_manager_id,
          asset: 'DEEP',
          threshold: '1',
          observed_balance: executionReady ? '1' : '0',
          usable: executionReady,
          blocker_code: 'INSUFFICIENT_DEEP',
          source_of_truth: 'test BM DEEP read',
        },
        {
          holder: DEPLOYMENT.agent.address,
          asset: 'SUI_MIST',
          threshold: '1',
          observed_balance: '1000',
          usable: true,
          blocker_code: 'INSUFFICIENT_GAS',
          source_of_truth: 'test gas read',
        },
      ],
    },
    source_of_truth: ['test runtime', 'test chain'],
  }
}

function txFixture({
  digest = 'fundingDigest',
  status = 'success',
  objectChanges = [{ type: 'mutated', objectId: DEPLOYMENT.agent.balance_manager_id }],
  transaction = null,
  balanceChanges = [
    { coinType: DBUSDC, amount: '-100', owner: { AddressOwner: '0xprovider' } },
    { coinType: DEEP, amount: '-1', owner: { AddressOwner: '0xprovider' } },
    { coinType: SUI, amount: '-1000', owner: { AddressOwner: '0xprovider' } },
  ],
} = {}) {
  return {
    digest,
    checkpoint: '42',
    timestampMs: '1760000000000',
    effects: { status: { status } },
    transaction: transaction || {
      data: {
        sender: '0xprovider',
        transaction: {
          transactions: [
            {
              MoveCall: {
                package: DEPLOYMENT.deepbook.package_id,
                module: 'balance_manager',
                function: 'deposit',
                type_arguments: [DBUSDC],
                arguments: [],
              },
            },
            {
              MoveCall: {
                package: DEPLOYMENT.deepbook.package_id,
                module: 'balance_manager',
                function: 'deposit',
                type_arguments: [DEEP],
                arguments: [],
              },
            },
          ],
        },
      },
    },
    balanceChanges,
    objectChanges,
    events: [
      { type: `${DEPLOYMENT.deepbook.package_id}::balance_manager::Deposit` },
    ],
  }
}

function unrelatedTargetTxFixture({ digest = 'unrelatedDigest' } = {}) {
  return txFixture({
    digest,
    objectChanges: [{ type: 'mutated', objectId: '0xunrelatedBalanceManager' }],
  })
}

function nonDepositBalanceManagerCallFixture({ digest = 'nonDepositDigest' } = {}) {
  return txFixture({
    digest,
    objectChanges: [{ type: 'mutated', objectId: DEPLOYMENT.agent.balance_manager_id }],
    transaction: {
      data: {
        sender: '0xprovider',
        transaction: {
          transactions: [
            {
              MoveCall: {
                package: DEPLOYMENT.deepbook.package_id,
                module: 'balance_manager',
                function: 'withdraw',
                type_arguments: [DBUSDC],
                arguments: [],
              },
            },
            {
              MoveCall: {
                package: DEPLOYMENT.deepbook.package_id,
                module: 'balance_manager',
                function: 'withdraw',
                type_arguments: [DEEP],
                arguments: [],
              },
            },
          ],
        },
      },
    },
  })
}

function singleAssetTargetTxFixture({ digest = 'singleAssetDigest', asset = 'DEEP' } = {}) {
  const coinType = asset === 'DBUSDC' ? DBUSDC : asset === 'DEEP' ? DEEP : SUI
  return txFixture({
    digest,
    objectChanges: asset === 'SUI_MIST' ? [] : [{ type: 'mutated', objectId: DEPLOYMENT.agent.balance_manager_id }],
    balanceChanges: asset === 'SUI_MIST'
      ? [
        { coinType: SUI, amount: '1000000000', owner: { AddressOwner: DEPLOYMENT.agent.address } },
        { coinType: SUI, amount: '-1000000000', owner: { AddressOwner: '0xprovider' } },
      ]
      : [
        { coinType, amount: '-100', owner: { AddressOwner: '0xprovider' } },
      ],
    transaction: asset === 'SUI_MIST'
      ? { data: { sender: '0xprovider', transaction: { transactions: [] } } }
      : {
        data: {
          sender: '0xprovider',
          transaction: {
            transactions: [
              {
                MoveCall: {
                  package: DEPLOYMENT.deepbook.package_id,
                  module: 'balance_manager',
                  function: 'deposit',
                  type_arguments: [coinType],
                  arguments: [],
                },
              },
            ],
          },
        },
      },
  })
}

function assertNoSecrets(value) {
  const json = JSON.stringify(value)
  assert.equal(json.includes('super-secret-token'), false)
  assert.equal(json.includes('super-secret-session'), false)
  assert.equal(json.includes('super-secret-runner-output'), false)
  assert.equal(json.includes('super-secret-seal-token'), false)
  assert.equal(json.includes('super-secret-walrus-token'), false)
  assert.equal(json.includes('"permission_token":'), false)
  assert.equal(json.includes('"session_value":'), false)
  assert.equal(json.includes('"raw_runner_output":'), false)
  assert.equal(json.includes('"seal_access_token":'), false)
  assert.equal(json.includes('"walrus_access_token":'), false)
}

{
  const parsed = parseFundingProofArgs(['--tx', 'digestA', '--dbusdc-tx=digestB', '--out', '.rescuegrid/funding-proof-report.json'])
  const opts = fundingProofOptions(parsed)
  assert.equal(opts.txDigests.length, 2)
  assert.deepEqual(opts.txDigests.map((row) => row.role), ['provider_funding_tx', 'dbusdc_funding_tx'])
  assert.deepEqual(opts.txDigests.map((row) => row.digest), ['digestA', 'digestB'])
  assert.equal(opts.outPath, '.rescuegrid/funding-proof-report.json')
}

{
  const proof = await verifyFundingTransaction({
    digest: 'fundingDigest',
    role: 'dbusdc_funding_tx',
    client: {
      async getTransactionBlock({ digest, options }) {
        assert.equal(digest, 'fundingDigest')
        assert.equal(options.showBalanceChanges, true)
        assert.equal(options.showInput, true)
        return txFixture({ digest })
      },
    },
  })
  assert.equal(proof.status, 'passed')
  assert.equal(proof.effect_status, 'success')
  assert.equal(proof.sender, '0xprovider')
  assert.equal(proof.move_call_targets.some((target) => target.endsWith('::balance_manager::deposit')), true)
  assert.equal(proof.funding_asset_hits.some((row) => row.asset === 'DBUSDC'), true)
  assert.equal(proof.funding_asset_hits.some((row) => row.asset === 'DEEP'), true)
  assert.equal(proof.funding_asset_hits.some((row) => row.asset === 'SUI_MIST'), true)
  assert.equal(proof.target_evidence.target_evidence_passed, true)
  assert.equal(proof.target_evidence.balance_manager_object_touched, true)
  assert.equal(proof.target_evidence.asset_target_hits.some((row) => row.asset === 'DBUSDC'), true)
  assert.equal(proof.target_evidence.asset_target_hits.some((row) => row.asset === 'DEEP'), true)
  assert.equal(proof.target_evidence.asset_target_hits.some((row) => row.asset === 'SUI_MIST'), false)
}

{
  const proof = await verifyFundingTransaction({
    digest: 'gasDigest',
    role: 'sui_gas_funding_tx',
    client: {
      async getTransactionBlock({ digest }) {
        return txFixture({
          digest,
          objectChanges: [],
          balanceChanges: [
            { coinType: SUI, amount: '1000000000', owner: { AddressOwner: DEPLOYMENT.agent.address } },
            { coinType: SUI, amount: '-1000000000', owner: { AddressOwner: '0xprovider' } },
          ],
        })
      },
    },
  })
  assert.equal(proof.status, 'passed')
  assert.equal(proof.target_evidence.target_evidence_passed, true)
  assert.equal(proof.target_evidence.balance_manager_object_touched, false)
  assert.equal(proof.target_evidence.agent_gas_address_touched, true)
  assert.deepEqual(proof.target_evidence.asset_target_hits.map((row) => row.asset), ['SUI_MIST'])
}

{
  const proof = await verifyFundingTransaction({
    digest: 'failedDigest',
    client: {
      async getTransactionBlock() {
        return txFixture({ digest: 'failedDigest', status: 'failure' })
      },
    },
  })
  assert.equal(proof.status, 'failed')
  assert.equal(proof.code, 'FUNDING_TX_NOT_SUCCESSFUL')
}

{
  const report = buildFundingProofReport({
    readiness: readiness({ executionReady: true }),
    transactionProofs: [],
    generatedAt: '2026-06-03T00:00:00.000Z',
  })
  assert.equal(report.status, 'blocked')
  assert.equal(report.funding_proven, false)
  assert.equal(report.ready_for_strict_execution, false)
  assert.equal(report.blocker_codes.includes('FUNDING_TX_DIGEST_MISSING'), true)
  assert.equal(report.blocker_codes.includes('FUNDING_TX_REQUIRED_TARGET_ASSET_NOT_PROVEN'), false)
  assert.equal(report.transaction_evidence.required, true)
  assert.equal(report.transaction_evidence.required_target_asset_evidence_passed, false)
  assert.deepEqual(report.transaction_evidence.required_target_assets, ['DBUSDC', 'DEEP'])
}

{
  const report = buildFundingProofReport({
    readiness: readiness({ executionReady: false }),
    transactionProofs: [
      await verifyFundingTransaction({
        digest: 'fundingDigest',
        client: { async getTransactionBlock() { return txFixture() } },
      }),
    ],
    generatedAt: '2026-06-03T00:00:00.000Z',
  })
  assert.equal(report.status, 'blocked')
  assert.equal(report.transaction_evidence.tx_evidence_passed, true)
  assert.equal(report.transaction_evidence.target_evidence_passed, true)
  assert.equal(report.transaction_evidence.role_asset_evidence_passed, true)
  assert.equal(report.transaction_evidence.required_target_asset_evidence_passed, true)
  assert.equal(report.funding_proven, false)
  assert.equal(report.blocker_codes.includes('INSUFFICIENT_DBUSDC'), true)
  assert.equal(report.policy_creation_allowed, false)
  assert.equal(report.cloud_per_user_signer.kind, 'cloud-per-user')
  assert.equal(report.cloud_per_user_signer.secrets_returned, false)
  assertNoSecrets(report)
}

{
  const report = buildFundingProofReport({
    readiness: readiness({ executionReady: true }),
    transactionProofs: [
      await verifyFundingTransaction({
        digest: 'fundingDigest',
        client: { async getTransactionBlock() { return txFixture() } },
      }),
    ],
    generatedAt: '2026-06-03T00:00:00.000Z',
  })
  assert.equal(report.status, 'ready')
  assert.equal(report.funding_proven, true)
  assert.equal(report.ready_for_strict_execution, true)
  assert.equal(report.policy_creation_allowed, true)
  assert.equal(report.execution_claimed, false)
  assert.equal(report.execution_gate.readiness_only, true)
  assert.equal(report.execution_gate.strict_execution_report_required, true)
  assert.deepEqual(report.funding_routing.balance_manager_assets.required_assets, ['DBUSDC', 'DEEP'])
  assert.equal(report.funding_routing.balance_manager_assets.target, DEPLOYMENT.agent.balance_manager_id)
  assert.equal(report.funding_routing.balance_manager_assets.accepted_action, 'deepbook_balance_manager_deposit')
  assert.equal(report.funding_routing.balance_manager_assets.rejected_action, 'direct_dbusdc_or_deep_transfer_to_agent_wallet')
  assert.equal(report.funding_routing.balance_manager_assets.direct_wallet_transfer_accepted, false)
  assert.equal(report.funding_routing.agent_gas.target, DEPLOYMENT.agent.address)
  assert.equal(report.funding_routing.agent_gas.accepted_action, 'sui_gas_transfer')
  assert.equal(report.funding_routing.agent_gas.direct_wallet_transfer_accepted, true)
  assert.equal(report.transaction_evidence.asset_hits.includes('DBUSDC'), true)
  assert.equal(report.transaction_evidence.asset_hits.includes('DEEP'), true)
  assert.equal(report.transaction_evidence.target_evidence_passed, true)
  assert.equal(report.transaction_evidence.role_asset_evidence_passed, true)
  assert.equal(report.transaction_evidence.required_target_asset_evidence_passed, true)
  assert.equal(report.transaction_evidence.target_asset_hits.includes('DBUSDC'), true)
  assert.equal(report.transaction_evidence.target_asset_hits.includes('DEEP'), true)
  assert.equal(report.cloud_per_user_signer.kind, 'cloud-per-user')
  assert.equal(report.cloud_per_user_signer.seal_walrus_required, true)
  assertNoSecrets(report)
}

{
  const report = buildFundingProofReport({
    readiness: readiness({ executionReady: true }),
    transactionProofs: [
      await verifyFundingTransaction({
        digest: 'gasOnlyDigest',
        client: { async getTransactionBlock({ digest }) { return singleAssetTargetTxFixture({ digest, asset: 'SUI_MIST' }) } },
      }),
    ],
    generatedAt: '2026-06-03T00:00:00.000Z',
  })
  assert.equal(report.status, 'failed')
  assert.equal(report.transaction_evidence.tx_evidence_passed, true)
  assert.equal(report.transaction_evidence.target_evidence_passed, true)
  assert.equal(report.transaction_evidence.role_asset_evidence_passed, true)
  assert.equal(report.transaction_evidence.required_target_asset_evidence_passed, false)
  assert.deepEqual(report.transaction_evidence.required_target_assets, ['DBUSDC', 'DEEP'])
  assert.deepEqual(report.transaction_evidence.missing_required_target_assets, ['DBUSDC', 'DEEP'])
  assert.deepEqual(report.transaction_evidence.target_asset_hits, ['SUI_MIST'])
  assert.equal(report.blocker_codes.includes('FUNDING_TX_REQUIRED_TARGET_ASSET_NOT_PROVEN'), true)
  assert.equal(report.funding_proven, false)
  assert.equal(report.ready_for_strict_execution, false)
}

{
  const report = buildFundingProofReport({
    readiness: readiness({ executionReady: true }),
    transactionProofs: [
      await verifyFundingTransaction({
        digest: 'deepOnlyDigest',
        role: 'dbusdc_funding_tx',
        client: { async getTransactionBlock({ digest }) { return singleAssetTargetTxFixture({ digest, asset: 'DEEP' }) } },
      }),
    ],
    generatedAt: '2026-06-03T00:00:00.000Z',
  })
  assert.equal(report.status, 'failed')
  assert.equal(report.transaction_evidence.tx_evidence_passed, true)
  assert.equal(report.transaction_evidence.target_evidence_passed, true)
  assert.equal(report.transaction_evidence.role_asset_evidence_passed, false)
  assert.equal(report.transaction_evidence.required_target_asset_evidence_passed, false)
  assert.deepEqual(report.transaction_evidence.missing_required_target_assets, ['DBUSDC'])
  assert.deepEqual(report.transaction_evidence.failed_role_asset_digests, ['deepOnlyDigest'])
  assert.equal(report.transaction_evidence.role_asset_requirements[0].role, 'dbusdc_funding_tx')
  assert.equal(report.transaction_evidence.role_asset_requirements[0].required_asset, 'DBUSDC')
  assert.deepEqual(report.transaction_evidence.role_asset_requirements[0].target_asset_hits, ['DEEP'])
  assert.equal(report.transaction_evidence.role_asset_requirements[0].passed, false)
  assert.equal(report.blocker_codes.includes('FUNDING_TX_ROLE_ASSET_NOT_PROVEN'), true)
  assert.equal(report.blocker_codes.includes('FUNDING_TX_REQUIRED_TARGET_ASSET_NOT_PROVEN'), true)
  assert.equal(report.funding_proven, false)
  assert.equal(report.ready_for_strict_execution, false)
}

{
  const report = buildFundingProofReport({
    readiness: readiness({ executionReady: true }),
    transactionProofs: [
      await verifyFundingTransaction({
        digest: 'unrelatedDigest',
        client: { async getTransactionBlock({ digest }) { return unrelatedTargetTxFixture({ digest }) } },
      }),
    ],
    generatedAt: '2026-06-03T00:00:00.000Z',
  })
  assert.equal(report.status, 'failed')
  assert.equal(report.transaction_evidence.tx_evidence_passed, true)
  assert.equal(report.transaction_evidence.target_evidence_passed, false)
  assert.deepEqual(report.transaction_evidence.failed_target_digests, ['unrelatedDigest'])
  assert.equal(report.blocker_codes.includes('FUNDING_TX_TARGET_NOT_PROVEN'), true)
  assert.equal(report.funding_proven, false)
  assert.equal(report.ready_for_strict_execution, false)
  assert.equal(report.transactions[0].target_evidence.target_evidence_passed, false)
}

{
  const proof = await verifyFundingTransaction({
    digest: 'nonDepositDigest',
    client: { async getTransactionBlock({ digest }) { return nonDepositBalanceManagerCallFixture({ digest }) } },
  })
  assert.equal(proof.status, 'passed')
  assert.equal(proof.funding_asset_hits.some((row) => row.asset === 'DBUSDC'), true)
  assert.equal(proof.funding_asset_hits.some((row) => row.asset === 'DEEP'), true)
  assert.equal(proof.target_evidence.balance_manager_object_touched, true)
  assert.equal(proof.target_evidence.target_evidence_passed, false)
  assert.deepEqual(proof.target_evidence.asset_target_hits, [])

  const report = buildFundingProofReport({
    readiness: readiness({ executionReady: true }),
    transactionProofs: [proof],
    generatedAt: '2026-06-03T00:00:00.000Z',
  })
  assert.equal(report.status, 'failed')
  assert.equal(report.transaction_evidence.tx_evidence_passed, true)
  assert.equal(report.transaction_evidence.target_evidence_passed, false)
  assert.equal(report.transaction_evidence.required_target_asset_evidence_passed, false)
  assert.deepEqual(report.transaction_evidence.missing_required_target_assets, ['DBUSDC', 'DEEP'])
  assert.equal(report.blocker_codes.includes('FUNDING_TX_TARGET_NOT_PROVEN'), true)
  assert.equal(report.blocker_codes.includes('FUNDING_TX_REQUIRED_TARGET_ASSET_NOT_PROVEN'), true)
  assert.equal(report.funding_proven, false)
}

{
  const report = buildFundingProofReport({
    readiness: readiness({ executionReady: true }),
    transactionProofs: [
      await verifyFundingTransaction({
        digest: 'failedDigest',
        client: { async getTransactionBlock() { return txFixture({ status: 'failure' }) } },
      }),
    ],
    generatedAt: '2026-06-03T00:00:00.000Z',
  })
  assert.equal(report.status, 'failed')
  assert.equal(report.blocker_codes.includes('FUNDING_TX_NOT_PROVEN'), true)
  assert.equal(report.funding_proven, false)
}

{
  const tempDir = mkdtempSync(join(tmpdir(), 'rescuegrid-funding-proof-'))
  try {
    const reportPath = join(tempDir, 'nested', 'funding-proof-report.json')
    const report = buildFundingProofReport({
      readiness: readiness({ executionReady: false }),
      transactionProofs: [],
      generatedAt: '2026-06-03T00:00:00.000Z',
    })
    const artifact = writeFundingProofArtifact(report, { outPath: reportPath })
    assert.equal(artifact.path, reportPath)
    assert.equal(artifact.format, 'json')
    const written = JSON.parse(readFileSync(reportPath, 'utf8'))
    assert.equal(written.purpose, 'rescuegrid_external_funding_proof')
    assert.equal(written.status, 'blocked')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

{
  const outputs = []
  const code = await runFundingProof({
    options: fundingProofOptions(parseFundingProofArgs(['--tx', 'fundingDigest'])),
    client: { async getTransactionBlock() { return txFixture() } },
    loadReadiness: async () => readiness({ executionReady: true }),
    generatedAt: () => '2026-06-03T00:00:00.000Z',
    print: (report) => outputs.push(report),
  })
  assert.equal(code, 0)
  assert.equal(outputs[0].status, 'ready')
  assert.equal(outputs[0].ready_for_strict_execution, true)
}

const help = spawnSync(process.execPath, ['scripts/funding-proof.mjs', '--help'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})
assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /external funding proof/i)
assert.match(help.stdout, /--tx/)
assert.match(help.stdout, /funding_proven/)
assert.equal(help.stdout.includes('AGENT_KEY='), false, 'help must not print secret assignment examples')

console.log('\nALL FUNDING PROOF TESTS PASS')
