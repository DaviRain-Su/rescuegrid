import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const help = spawnSync(process.execPath, ['scripts/validate-policy-loop.mjs', '--help'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})

assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /--pause-before-revoke-ms <ms>/)
assert.match(help.stdout, /--active-checkpoint-only/)
assert.match(help.stdout, /secret-safe/i)
assert.equal(help.stdout.includes('AGENT_KEY='), false, 'help output must not print secret values')

const safetyHelp = spawnSync(process.execPath, ['scripts/validate-safety-negative-paths.mjs', '--help'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})

assert.equal(safetyHelp.status, 0, safetyHelp.stderr)
assert.match(safetyHelp.stdout, /npm run safety:negative/)
assert.match(safetyHelp.stdout, /over-budget/i)
assert.match(safetyHelp.stdout, /mandate-wrapper mismatch/i)
assert.match(safetyHelp.stdout, /revokes the active policy/i)
assert.match(safetyHelp.stdout, /--out <path>/)
assert.match(safetyHelp.stdout, /no raw secrets/i)
assert.equal(safetyHelp.stdout.includes('AGENT_KEY='), false, 'safety help output must not print secret values')

const demoHelp = spawnSync(process.execPath, ['scripts/validate-demo-loop.mjs', '--help'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})

assert.equal(demoHelp.status, 0, demoHelp.stderr)
assert.match(demoHelp.stdout, /create -> activate\/monitor -> force tick -> revoke -> post-revoke tick/i)
assert.match(demoHelp.stdout, /documented DBUSDC\/DEEP funding/i)
assert.match(demoHelp.stdout, /--require-execution/)
assert.match(demoHelp.stdout, /structured\s+AgentTradeExecuted/i)
assert.match(demoHelp.stdout, /AgentTradeExecuted/i)
assert.match(demoHelp.stdout, /preflights signer/i)
assert.match(demoHelp.stdout, /before policy\s+creation/i)
assert.match(demoHelp.stdout, /--out <path>/)
assert.match(demoHelp.stdout, /no raw secrets/i)
assert.equal(demoHelp.stdout.includes('AGENT_KEY='), false, 'demo help output must not print agent key values')
assert.equal(demoHelp.stdout.includes('INTERNAL_AGENT_TICK_TOKEN='), false, 'demo help output must not print tick token values')

const walletDemoHelp = spawnSync(process.execPath, ['scripts/validate-wallet-policy-execution.mjs', '--help'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})

assert.equal(walletDemoHelp.status, 0, walletDemoHelp.stderr)
assert.match(walletDemoHelp.stdout, /browser-wallet-created policy/i)
assert.match(walletDemoHelp.stdout, /--wrapper-id <0x\.\.\.>/)
assert.match(walletDemoHelp.stdout, /--strategy-file <path>/)
assert.match(walletDemoHelp.stdout, /--create-tx-digest <digest>/)
assert.match(walletDemoHelp.stdout, /awaiting_wallet_revoke/)
assert.match(walletDemoHelp.stdout, /does not\s+create a policy or sign revoke/i)
assert.match(walletDemoHelp.stdout, /same-wrapper wallet path/i)
assert.match(walletDemoHelp.stdout, /AgentTradeExecuted/)
assert.equal(walletDemoHelp.stdout.includes('AGENT_KEY='), false, 'wallet demo help output must not print agent key values')
assert.equal(walletDemoHelp.stdout.includes('INTERNAL_AGENT_TICK_TOKEN='), false, 'wallet demo help output must not print tick token values')

console.log('\nALL POLICY LOOP CLI TESTS PASS')
