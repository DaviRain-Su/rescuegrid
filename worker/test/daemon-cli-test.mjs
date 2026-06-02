import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  appendDaemonLog,
  daemonStatus,
  parseDaemonArgs,
  readDaemonLogs,
  resolveDaemonConfig,
  validateDaemonConfig,
} from '../scripts/daemon.mjs'
import { DEPLOYMENT } from '../src/sui-tx.js'

const temp = mkdtempSync(join(tmpdir(), 'rescuegrid-daemon-test-'))
try {
  const configPath = join(temp, 'daemon.json')
  const logPath = join(temp, 'activity.jsonl')
  writeFileSync(configPath, JSON.stringify({
    chain: 'sui:testnet',
    agent_address: DEPLOYMENT.agent.address,
    signer_kind: 'worker-secret',
    tick_interval_ms: 12_345,
    watched_policies: ['0xabc123'],
    log_path: logPath,
  }))

  const parsed = parseDaemonArgs(['status', '--config', configPath, '--json'])
  assert.equal(parsed.command, 'status')
  assert.equal(parsed.flags.get('--config'), configPath)
  assert.equal(parsed.flags.get('--json'), 'true')

  const config = resolveDaemonConfig({ flags: parsed.flags, env: {} })
  assert.equal(config.chain, 'sui:testnet')
  assert.equal(config.agent_address, DEPLOYMENT.agent.address)
  assert.equal(config.signer_kind, 'worker-secret')
  assert.equal(config.tick_interval_ms, 12_345)
  assert.deepEqual(config.watched_policies, ['0xabc123'])
  assert.equal(config.log_path, logPath)

  const status = daemonStatus(config)
  assert.equal(status.status, 'ok')
  assert.equal(status.agent_address, DEPLOYMENT.agent.address)
  assert.deepEqual(status.registered_adapters, ['deepbook'])
  assert.equal(status.known_signer_kinds.includes('waap'), true)

  assert.deepEqual(validateDaemonConfig(config, { requirePolicies: true }), { ok: true })

  const mainnetWorkerSecret = resolveDaemonConfig({
    flags: new Map([
      ['--config', configPath],
      ['--chain', 'sui:mainnet'],
      ['--signer-kind', 'worker-secret'],
    ]),
    env: {},
  })
  assert.equal(validateDaemonConfig(mainnetWorkerSecret).code, 'MAINNET_REQUIRES_EXTERNAL_SIGNER')

  const forceNoDemo = resolveDaemonConfig({
    flags: new Map([
      ['--config', configPath],
      ['--force-trigger', 'true'],
    ]),
    env: {},
  })
  assert.equal(validateDaemonConfig(forceNoDemo).code, 'FORCE_TRIGGER_DISABLED')

  const wrongAgent = resolveDaemonConfig({
    flags: new Map([
      ['--config', configPath],
      ['--agent-address', '0x2222222222222222222222222222222222222222222222222222222222222222'],
    ]),
    env: {},
  })
  const wrongAgentValidation = validateDaemonConfig(wrongAgent)
  assert.equal(wrongAgentValidation.code, 'LOCAL_AGENT_MISMATCH')
  assert.equal(wrongAgentValidation.expected_agent, DEPLOYMENT.agent.address)

  assert.equal(validateDaemonConfig({ ...config, watched_policies: [] }, { requirePolicies: true }).code, 'NO_WATCHED_POLICIES')
  assert.equal(validateDaemonConfig({ ...config, watched_policies: ['not-an-id'] }, { requirePolicies: true }).code, 'BAD_WRAPPER_ID')

  const first = appendDaemonLog(logPath, { wrapper_id: '0xabc123', action: 'executed', tx_digest: '0xdigest' })
  const duplicate = appendDaemonLog(logPath, { wrapper_id: '0xabc123', action: 'executed', tx_digest: '0xdigest' })
  const noDigest = appendDaemonLog(logPath, { wrapper_id: '0xabc123', action: 'blocked', code: 'EXECUTION_DISABLED' })
  assert.equal(first.appended, true)
  assert.equal(duplicate.appended, false)
  assert.equal(duplicate.duplicate_tx_digest, '0xdigest')
  assert.equal(noDigest.appended, true)
  assert.equal(readFileSync(logPath, 'utf8').trim().split('\n').length, 2)
  assert.equal(readDaemonLogs(logPath, 1)[0].action, 'blocked')
} finally {
  rmSync(temp, { recursive: true, force: true })
}

console.log('\nALL DAEMON CLI TESTS PASS')
