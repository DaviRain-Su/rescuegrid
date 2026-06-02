import assert from 'node:assert/strict'
import {
  LIVE_REFETCH_INTERVAL,
  LIVE_STALE_TIME,
  liveDashboardOwnerKey,
  liveDashboardQueryKey,
  liveDashboardQueryOptions,
  liveDashboardResourceKey,
} from './live-config.js'

const owner = '0x1111111111111111111111111111111111111111111111111111111111111111'
const mode = 'cloud'
const resources = ['policies', 'activity', 'summary', 'market', 'balances', 'runtime-status', 'execution-readiness']

assert.equal(LIVE_REFETCH_INTERVAL, 5_000)
assert.equal(LIVE_STALE_TIME, 5_000)
assert.deepEqual(liveDashboardQueryKey(owner, mode), ['live-dashboard', owner, mode])
assert.deepEqual(liveDashboardOwnerKey(owner), ['live-dashboard', owner])

for (const resource of resources) {
  const queryFn = async () => null
  const options = liveDashboardQueryOptions({ owner, mode, resource, queryFn, enabled: true })
  assert.deepEqual(options.queryKey, liveDashboardResourceKey(owner, mode, resource))
  assert.equal(options.queryFn, queryFn)
  assert.equal(options.enabled, true)
  assert.equal(options.staleTime, 5_000)
  assert.equal(options.refetchInterval, 5_000)
  assert.equal(options.refetchOnWindowFocus, false)
}

const disabled = liveDashboardQueryOptions({
  owner: '',
  mode,
  resource: 'activity',
  queryFn: async () => null,
  enabled: true,
})

assert.equal(disabled.enabled, false)
assert.equal(disabled.refetchInterval, false)

console.log('ALL LIVE QUERY CONFIG TESTS PASS')
