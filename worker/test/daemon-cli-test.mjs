import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  appendDaemonLog,
  daemonExecutionReadiness,
  daemonPolicyList,
  daemonStatus,
  daemonWatchAdd,
  daemonWatchList,
  daemonWatchRemove,
  daemonWatchSync,
  parseDaemonArgs,
  readDaemonLogs,
  resolveDaemonConfig,
  validateDaemonConfig,
} from '../scripts/daemon.mjs'
import { waapSendTxArgs } from '../scripts/waap-cli-runner.mjs'
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
    owner_address: DEPLOYMENT.agent.address,
  }))

  const parsed = parseDaemonArgs(['status', '--config', configPath, '--json'])
  assert.equal(parsed.command, 'status')
  assert.equal(parsed.flags.get('--config'), configPath)
  assert.equal(parsed.flags.get('--json'), 'true')
  assert.deepEqual(waapSendTxArgs({
    txJson: '{"version":1}',
    chain: 'sui:testnet',
    rpc: 'https://sui-testnet.example',
    permissionToken: 'permission-secret',
  }), [
    'send-tx',
    '--tx-json',
    '{"version":1}',
    '--chain',
    'sui:testnet',
    '--json',
    '--rpc',
    'https://sui-testnet.example',
    '--permission-token',
    'permission-secret',
  ])

  const config = resolveDaemonConfig({ flags: parsed.flags, env: {} })
  assert.equal(config.chain, 'sui:testnet')
  assert.equal(config.owner_address, DEPLOYMENT.agent.address)
  assert.equal(config.agent_address, DEPLOYMENT.agent.address)
  assert.equal(config.signer_kind, 'worker-secret')
  assert.equal(config.tick_interval_ms, 12_345)
  assert.deepEqual(config.watched_policies, ['0xabc123'])
  assert.equal(config.log_path, logPath)

  const status = daemonStatus(config)
  assert.equal(status.status, 'ok')
  assert.equal(status.owner_address, DEPLOYMENT.agent.address)
  assert.equal(status.agent_address, DEPLOYMENT.agent.address)
  assert.deepEqual(status.registered_adapters, ['deepbook'])
  assert.equal(Object.hasOwn(status.runtime_core.boundaries, 'policy_reader'), true)
  assert.equal(status.runtime_core.registered_adapters[0].kind, 'deepbook')
  assert.equal(status.known_signer_kinds.includes('waap'), true)
  assert.equal(status.external_signer.waap_cli_enabled, false)
  assert.equal(status.external_signer.permission_token_configured, false)

  const executionReadiness = await daemonExecutionReadiness({ ...config, signer_kind: 'waap', execution_enabled: true }, {
    chainData: {
      async readBalanceManagerBalance(coinType) {
        if (coinType === DEPLOYMENT.deepbook.dbusdc_coin_type) return 1000n
        if (coinType === DEPLOYMENT.deepbook.deep_coin_type) return 10n
        throw new Error(`unexpected coin type ${coinType}`)
      },
      async getAgentSuiGasBalance(owner) {
        assert.equal(owner, DEPLOYMENT.agent.address)
        return { totalBalance: '1000000' }
      },
    },
  })
  assert.equal(executionReadiness.funding_ready, true)
  assert.equal(executionReadiness.execution_ready, false)
  assert.deepEqual(executionReadiness.blocker_codes, ['UNSUPPORTED_SIGNER'])
  const statusWithReadiness = daemonStatus(config, { executionReadiness })
  assert.equal(statusWithReadiness.execution_readiness.signer.kind, 'waap')
  assert.equal(statusWithReadiness.execution_readiness.execution_claimed, false)

  const waapConfig = resolveDaemonConfig({
    flags: new Map([
      ['--config', configPath],
      ['--signer-kind', 'waap'],
      ['--waap-cli-enabled', 'true'],
      ['--waap-sui-address', DEPLOYMENT.agent.address],
      ['--waap-cli-path', '/usr/local/bin/waap-cli'],
      ['--waap-chain', 'sui:testnet'],
      ['--waap-rpc', 'https://sui-testnet.example'],
    ]),
    env: { RESCUEGRID_WAAP_PERMISSION_TOKEN: 'permission-secret' },
  })
  assert.equal(waapConfig.signer_kind, 'waap')
  assert.equal(waapConfig.waap_cli_enabled, true)
  assert.equal(waapConfig.waap_sui_address, DEPLOYMENT.agent.address)
  assert.equal(validateDaemonConfig(waapConfig).ok, true)
  const waapStatus = daemonStatus(waapConfig)
  assert.equal(waapStatus.external_signer.waap_cli_enabled, true)
  assert.equal(waapStatus.external_signer.waap_sui_address, DEPLOYMENT.agent.address)
  assert.equal(waapStatus.external_signer.waap_rpc_configured, true)
  assert.equal(waapStatus.external_signer.permission_token_configured, true)
  assert.equal(JSON.stringify(waapStatus).includes('permission-secret'), false)
  const waapReady = await daemonExecutionReadiness({ ...waapConfig, execution_enabled: true }, {
    chainData: {
      async readBalanceManagerBalance(coinType) {
        if (coinType === DEPLOYMENT.deepbook.dbusdc_coin_type) return 1000n
        if (coinType === DEPLOYMENT.deepbook.deep_coin_type) return 10n
        throw new Error(`unexpected coin type ${coinType}`)
      },
      async getAgentSuiGasBalance(owner) {
        assert.equal(owner, DEPLOYMENT.agent.address)
        return { totalBalance: '1000000' }
      },
    },
  })
  assert.equal(waapReady.signer.kind, 'waap')
  assert.equal(waapReady.signer.available, true)
  assert.equal(waapReady.execution_ready, true)
  assert.equal(waapReady.execution_claimed, false)

  const policyList = await daemonPolicyList(config, {
    chainData: {
      async listPoliciesByOwner(owner) {
        assert.equal(owner, DEPLOYMENT.agent.address)
        return [
          {
            wrapper_id: '0xabc123',
            mandate_id: '0xmandate',
            owner,
            agent: DEPLOYMENT.agent.address,
            status: 'active',
            runtime_state: 'Monitoring',
            runtime_state_stale: false,
            pool_id: DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id,
            budget_coin_type: DEPLOYMENT.deepbook.dbusdc_coin_type,
            budget_ceiling: '50000000',
            spent_amount: '0',
            expires_at_ms: '1770000000000',
            strategy_hash: '0xhash',
          },
        ]
      },
    },
  })
  assert.equal(policyList.status, 'ok')
  assert.equal(policyList.owner, DEPLOYMENT.agent.address)
  assert.equal(policyList.count, 1)
  assert.equal(policyList.watched_count, 1)
  assert.equal(policyList.policies[0].watched, true)
  assert.equal(policyList.policies[0].agent_matches, true)
  assert.equal(policyList.policies[0].budget_ceiling, '50000000')

  await assert.rejects(
    () => daemonPolicyList({ ...config, owner_address: '' }, { chainData: { async listPoliciesByOwner() { return [] } } }),
    /requires --owner/,
  )

  const watchList = daemonWatchList(config)
  assert.equal(watchList.count, 1)
  assert.deepEqual(watchList.watched_policies, ['0xabc123'])

  const watchAdded = daemonWatchAdd(config, ['0xdef456', '0xabc123'])
  assert.deepEqual(watchAdded.added, ['0xdef456'])
  assert.deepEqual(watchAdded.watched_policies, ['0xabc123', '0xdef456'])
  const addedConfig = resolveDaemonConfig({ flags: new Map([['--config', configPath]]), env: {} })
  assert.deepEqual(addedConfig.watched_policies, ['0xabc123', '0xdef456'])

  const watchRemoved = daemonWatchRemove(addedConfig, ['0xabc123'])
  assert.deepEqual(watchRemoved.removed, ['0xabc123'])
  assert.deepEqual(watchRemoved.watched_policies, ['0xdef456'])
  const removedConfig = resolveDaemonConfig({ flags: new Map([['--config', configPath]]), env: {} })
  assert.deepEqual(removedConfig.watched_policies, ['0xdef456'])

  const watchSynced = await daemonWatchSync(removedConfig, {
    chainData: {
      async listPoliciesByOwner(owner) {
        assert.equal(owner, DEPLOYMENT.agent.address)
        return [
          {
            wrapper_id: '0xaaa111',
            mandate_id: '0xmandate1',
            owner,
            agent: DEPLOYMENT.agent.address,
            status: 'active',
          },
          {
            wrapper_id: '0xbbb222',
            mandate_id: '0xmandate2',
            owner,
            agent: DEPLOYMENT.agent.address,
            status: 'revoked',
          },
          {
            wrapper_id: '0xccc333',
            mandate_id: '0xmandate3',
            owner,
            agent: '0x2222222222222222222222222222222222222222222222222222222222222222',
            status: 'active',
          },
        ]
      },
    },
  })
  assert.deepEqual(watchSynced.added, ['0xaaa111'])
  assert.equal(watchSynced.synced_count, 1)
  assert.equal(watchSynced.skipped_count, 2)
  assert.deepEqual(watchSynced.watched_policies, ['0xdef456', '0xaaa111'])
  const syncedConfig = resolveDaemonConfig({ flags: new Map([['--config', configPath]]), env: {} })
  assert.deepEqual(syncedConfig.watched_policies, ['0xdef456', '0xaaa111'])

  assert.throws(
    () => daemonWatchAdd(config, []),
    /requires --wrapper-id/,
  )

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

  const badWaapAddress = resolveDaemonConfig({
    flags: new Map([
      ['--config', configPath],
      ['--signer-kind', 'waap'],
      ['--waap-cli-enabled', 'true'],
      ['--waap-sui-address', 'not-an-address'],
    ]),
    env: {},
  })
  assert.equal(validateDaemonConfig(badWaapAddress).code, 'BAD_WAAP_ADDRESS')

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
