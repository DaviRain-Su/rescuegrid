import { execFile } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 180_000
const DEFAULT_MAX_BUFFER = 1024 * 1024

export function waapSendTxArgs({ txJson, chain, rpc, permissionToken } = {}) {
  if (!txJson || typeof txJson !== 'string') throw new Error('waap txJson is required')
  const args = ['send-tx', '--tx-json', txJson, '--chain', chain || 'sui:testnet', '--json']
  if (rpc) args.push('--rpc', String(rpc))
  if (permissionToken) args.push('--permission-token', String(permissionToken))
  return args
}

export function runWaapCliSendTx(request = {}) {
  const cliPath = request.cliPath || 'waap-cli'
  const args = waapSendTxArgs(request)
  const timeout = Number(request.timeoutMs || DEFAULT_TIMEOUT_MS)
  return new Promise((resolve, reject) => {
    execFile(cliPath, args, { encoding: 'utf8', timeout, maxBuffer: DEFAULT_MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        const safe = new Error('waap-cli send-tx failed')
        safe.code = 'WAAP_CLI_FAILED'
        safe.exit_code = error.code ?? null
        safe.timed_out = error.killed === true
        reject(safe)
        return
      }
      resolve({
        stdout: stdout || '{}',
        stderr: stderr ? '[redacted]' : '',
        status: 'ok',
      })
    })
  })
}
