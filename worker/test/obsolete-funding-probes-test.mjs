import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const workerRoot = new URL('..', import.meta.url)

function runScript(script, args = []) {
  return spawnSync(process.execPath, [`scripts/${script}`, ...args], {
    cwd: workerRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT_KEY: 'super-secret-agent-key',
      RESCUEGRID_RUN_OBSOLETE_FUNDING_PROBE: 'false',
      RESCUEGRID_RUN_OBSOLETE_AGENT_SETUP: 'false',
    },
  })
}

function assertNoSecrets(result) {
  const body = `${result.stdout}\n${result.stderr}`
  assert.equal(body.includes('super-secret-agent-key'), false)
  assert.equal(body.includes('AGENT_KEY='), false)
}

{
  const result = runScript('deep-faucet.mjs')
  assert.equal(result.status, 1, result.stderr)
  const body = JSON.parse(result.stdout)
  assert.equal(body.status, 'blocked')
  assert.equal(body.code, 'OBSOLETE_FUNDING_PROBE')
  assert.match(body.detail, /funding:request/)
  assert.deepEqual(body.commands, [
    'npm run funding:request -- --format markdown --out .rescuegrid/funding-request.md',
    'npm run funding:proof -- --tx <provider_funding_tx_digest> --json',
  ])
  assertNoSecrets(result)
}

{
  const result = runScript('agent-onchain-setup.mjs')
  assert.equal(result.status, 1, result.stderr)
  const body = JSON.parse(result.stdout)
  assert.equal(body.status, 'blocked')
  assert.equal(body.code, 'OBSOLETE_AGENT_SETUP_PROBE')
  assert.match(body.detail, /BalanceManager already exist/)
  assert.deepEqual(body.commands, [
    'npm run funding:request -- --format markdown --out .rescuegrid/funding-request.md',
    'npm run funding:proof -- --tx <provider_funding_tx_digest> --json',
  ])
  assertNoSecrets(result)
}

for (const script of ['deep-faucet.mjs', 'agent-onchain-setup.mjs']) {
  const help = runScript(script, ['--help'])
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /funding:request/)
  assert.match(help.stdout, /funding:proof/)
  assertNoSecrets(help)
}

console.log('\nALL OBSOLETE FUNDING PROBE TESTS PASS')
