export const LIVE_STALE_TIME = 5_000
export const LIVE_REFETCH_INTERVAL = 5_000

export const liveDashboardQueryKey = (owner, mode) => ['live-dashboard', owner, mode]
export const liveDashboardOwnerKey = (owner) => ['live-dashboard', owner]
export const liveDashboardResourceKey = (owner, mode, resource) => ['live-dashboard', owner, mode, resource]

export function liveDashboardQueryOptions({ owner, mode, resource, queryFn, enabled }) {
  const active = Boolean(enabled && owner)
  return {
    queryKey: liveDashboardResourceKey(owner, mode, resource),
    queryFn,
    enabled: active,
    staleTime: LIVE_STALE_TIME,
    refetchInterval: active ? LIVE_REFETCH_INTERVAL : false,
    refetchOnWindowFocus: false,
  }
}
