import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildWalletEvidence,
  collectWorkerPublicState,
  parseWalletEvidenceArtifact,
  parseArgs,
  serializeWalletEvidence,
  verifyWalletEvidenceArtifact,
  writeWalletEvidenceArtifact,
} from './wallet-clickthrough-evidence.mjs'
import deployment from '../core/deployment.js'

assert.equal(parseArgs(['--format', 'markdown']).get('--format'), 'markdown')
assert.equal(parseArgs(['--owner=0xabc']).get('--owner'), '0xabc')

const workerState = await collectWorkerPublicState('http://worker.test', {
  fetchImpl: async (url) => {
    if (url.endsWith('/api/runtime/status')) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: 'ok',
            chain: 'sui:testnet',
            agent: { address: deployment.agent.address },
            signer: {
              kind: 'worker-secret',
              available: true,
              expected_address: deployment.agent.address,
              signer_matches_expected: true,
            },
            execution: { enabled: false, blocker_code: 'EXECUTION_DISABLED' },
            chain_data_provider: { kind: 'json-rpc' },
            monitoring_provider: { kind: 'timer-polling' },
          })
        },
      }
    }
    if (url.endsWith('/api/execution/readiness')) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: 'ok',
            chain: 'sui:testnet',
            scope: { executor_kind: 'deepbook', market_id: 'SUI_DBUSDC' },
            execution_ready: false,
            funding_ready: false,
            execution_claimed: false,
            blocker_codes: ['EXECUTION_DISABLED'],
            funding_blocker_codes: ['INSUFFICIENT_DBUSDC', 'INSUFFICIENT_DEEP'],
            agent: { balance_manager_id: deployment.agent.balance_manager_id },
            balance_manager: { balances: { DBUSDC: '0', DEEP: '0' } },
          })
        },
      }
    }
    if (url.endsWith('/api/chain-data/status')) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: 'ok',
            chain: 'sui:testnet',
            provider_kind: 'json-rpc',
            provider_status: 'ready',
            worker_first: true,
            probe: { status: 'skipped' },
          })
        },
      }
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ service: 'rescuegrid-worker', chain: 'sui:testnet', agent: deployment.agent.address })
      },
    }
  },
})

assert.equal(workerState.root.status, 'ok')
assert.equal(workerState.runtime_status.signer_kind, 'worker-secret')
assert.deepEqual(workerState.execution_readiness.funding_blocker_codes, ['INSUFFICIENT_DBUSDC', 'INSUFFICIENT_DEEP'])
assert.equal(workerState.chain_data_status.worker_first, true)

const evidence = buildWalletEvidence({
  generatedAt: '2026-06-03T00:00:00.000Z',
  frontendUrl: 'http://localhost:5175/',
  workerUrl: 'http://localhost:8787/',
  ownerAddress: '0x1111111111111111111111111111111111111111111111111111111111111111',
  workerState,
})
assert.equal(evidence.status, 'ok')
assert.equal(evidence.purpose, 'browser_wallet_clickthrough_evidence')
assert.equal(evidence.read_only, true)
assert.equal(evidence.actual_clickthrough_completed, false)
assert.equal(evidence.execution_claimed, false)
assert.equal(evidence.frontend.url, 'http://localhost:5175')
assert.equal(evidence.worker.url, 'http://localhost:8787')
assert.equal(evidence.worker.public_state_available, true)
assert.equal(evidence.deployment.agent_address, deployment.agent.address)
assert.equal(evidence.pass_conditions.some((row) => /Worker-built tx_json/.test(row)), true)
assert.equal(evidence.pass_conditions.some((row) => /DeepBook execution/.test(row)), true)

const json = serializeWalletEvidence(evidence, 'json')
assert.match(json, /browser_wallet_clickthrough_evidence/)
assert.equal(json.includes('permission-secret'), false)
assert.equal(json.includes('AGENT_KEY='), false)
assert.equal(json.includes('INTERNAL_AGENT_TICK_TOKEN='), false)

const markdown = serializeWalletEvidence(evidence, 'markdown')
assert.match(markdown, /RescueGrid Wallet Click-Through Evidence/)
assert.match(markdown, /Slush/)
assert.match(markdown, /Sui Testnet/)
assert.match(markdown, /owner_address:/)
assert.match(markdown, /create_tx_digest: TODO/)
assert.match(markdown, /wrapper_id: TODO/)
assert.match(markdown, /Execution claimed: false/)
assert.equal(markdown.includes('permission-secret'), false)
assert.equal(markdown.includes('AGENT_KEY='), false)
assert.equal(markdown.includes('INTERNAL_AGENT_TICK_TOKEN='), false)

const artifactDir = mkdtempSync(join(tmpdir(), 'rescuegrid-wallet-evidence-'))
try {
  const artifactPath = join(artifactDir, 'wallet-clickthrough-evidence.md')
  const artifact = writeWalletEvidenceArtifact(evidence, { outPath: artifactPath, format: 'markdown' })
  assert.equal(artifact.path, artifactPath)
  assert.equal(artifact.format, 'markdown')
  assert(artifact.bytes > 100)
  const artifactBody = readFileSync(artifactPath, 'utf8')
  assert.match(artifactBody, /Wallet Click-Through/)
  assert.match(artifactBody, /Actual click-through completed: false/)
  assert.equal(artifactBody.includes('permission-secret'), false)
} finally {
  rmSync(artifactDir, { recursive: true, force: true })
}

const unavailable = await collectWorkerPublicState('http://worker.test', {
  fetchImpl: async () => {
    throw new Error('offline')
  },
  timeoutMs: 1,
})
assert.equal(unavailable.root.status, 'unavailable')
assert.equal(buildWalletEvidence({ workerState: unavailable }).worker.public_state_available, false)

const filledArtifact = `# RescueGrid Wallet Click-Through Evidence

Generated: 2026-06-03T00:00:00.000Z
Chain: sui:testnet
Frontend: http://localhost:5175
Worker: http://worker.test

## Wallet

Wallet: Slush
Network: Sui Testnet
Owner address: 0x1111111111111111111111111111111111111111111111111111111111111111

## Evidence Fields

- owner_address: 0x1111111111111111111111111111111111111111111111111111111111111111
- create_tx_digest: create-digest
- wrapper_id: 0x2222222222222222222222222222222222222222222222222222222222222222
- mandate_id: 0x3333333333333333333333333333333333333333333333333333333333333333
- strategy_hash: 0xabc123
- revoke_tx_digest: revoke-digest
`

const parsedArtifact = parseWalletEvidenceArtifact(filledArtifact)
assert.equal(parsedArtifact.status, 'ok')
assert.equal(parsedArtifact.format, 'markdown')
assert.equal(parsedArtifact.metadata.worker_url, 'http://worker.test')
assert.equal(parsedArtifact.fields.wrapper_id, '0x2222222222222222222222222222222222222222222222222222222222222222')

let chainReads = 0
const fakeSuiClient = {
  async getTransactionBlock({ digest, options }) {
    chainReads += 1
    assert.equal(options.showEvents, true)
    if (digest === 'create-digest') {
      return {
        digest,
        checkpoint: '1',
        timestampMs: '1000',
        effects: { status: { status: 'success' } },
        events: [{
          type: `${deployment.rescuegrid.package_id}::policy::PolicyCreated`,
          parsedJson: {
            owner: '0x1111111111111111111111111111111111111111111111111111111111111111',
            wrapper_id: '0x2222222222222222222222222222222222222222222222222222222222222222',
            mandate_id: '0x3333333333333333333333333333333333333333333333333333333333333333',
            strategy_hash: '0xabc123',
          },
        }],
      }
    }
    if (digest === 'revoke-digest') {
      return {
        digest,
        checkpoint: '2',
        timestampMs: '2000',
        effects: { status: { status: 'success' } },
        events: [{
          type: `${deployment.rescuegrid.package_id}::policy::PolicyRevoked`,
          parsedJson: {
            owner: '0x1111111111111111111111111111111111111111111111111111111111111111',
            wrapper_id: '0x2222222222222222222222222222222222222222222222222222222222222222',
            mandate_id: '0x3333333333333333333333333333333333333333333333333333333333333333',
          },
        }],
      }
    }
    throw new Error(`unexpected digest ${digest}`)
  },
}
const fakeWorkerFetch = async (url) => {
  assert.equal(String(url), 'http://worker.test/api/policies/0x2222222222222222222222222222222222222222222222222222222222222222/activity')
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        status: 'ok',
        policy: {
          wrapper_id: '0x2222222222222222222222222222222222222222222222222222222222222222',
          revoked: true,
          runtime_state: 'Revoked',
        },
        activity: [{ type: 'PolicyRevoked', tx: 'revoke-digest' }],
      })
    },
  }
}
const verifiedReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact,
  suiClient: fakeSuiClient,
  fetchImpl: fakeWorkerFetch,
})
assert.equal(verifiedReport.status, 'ok')
assert.equal(verifiedReport.verified, true)
assert.equal(verifiedReport.execution_claimed, false)
assert.equal(verifiedReport.checks.every((check) => check.status === 'passed'), true)
assert.equal(chainReads, 2)

const optionalWorkerReport = await verifyWalletEvidenceArtifact({
  artifactText: filledArtifact.replace('http://worker.test', 'http://worker-offline.test'),
  suiClient: fakeSuiClient,
  fetchImpl: async () => { throw new Error('offline') },
})
assert.equal(optionalWorkerReport.verified, true)
assert.equal(optionalWorkerReport.checks.some((check) => check.id === 'worker:detail' && check.status === 'skipped'), true)

const incompleteReport = await verifyWalletEvidenceArtifact({
  artifactText: markdown,
  suiClient: {
    async getTransactionBlock() {
      throw new Error('should not read chain when required fields are missing')
    },
  },
})
assert.equal(incompleteReport.status, 'error')
assert.equal(incompleteReport.code, 'EVIDENCE_FIELDS_INCOMPLETE')
assert(incompleteReport.missing_fields.includes('create_tx_digest'))

const help = spawnSync(process.execPath, ['scripts/wallet-clickthrough-evidence.mjs', '--help'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})
assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /wallet click-through evidence/i)
assert.match(help.stdout, /--verify/)
assert.match(help.stdout, /--out/)
assert.equal(help.stdout.includes('AGENT_KEY='), false)
assert.equal(help.stdout.includes('INTERNAL_AGENT_TICK_TOKEN='), false)

console.log('\nALL WALLET CLICK-THROUGH EVIDENCE TESTS PASS')
