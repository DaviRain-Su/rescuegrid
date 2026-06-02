import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildWalletEvidence,
  collectWorkerPublicState,
  parseArgs,
  serializeWalletEvidence,
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

const help = spawnSync(process.execPath, ['scripts/wallet-clickthrough-evidence.mjs', '--help'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})
assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /wallet click-through evidence/i)
assert.match(help.stdout, /--out/)
assert.equal(help.stdout.includes('AGENT_KEY='), false)
assert.equal(help.stdout.includes('INTERNAL_AGENT_TICK_TOKEN='), false)

console.log('\nALL WALLET CLICK-THROUGH EVIDENCE TESTS PASS')
