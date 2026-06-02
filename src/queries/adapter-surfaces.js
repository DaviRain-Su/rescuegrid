import { useQuery } from '@tanstack/react-query'
import {
  WORKER_CONFIGURED,
  getDexReadAdapters,
  getLendingReadAdapters,
} from '../api.js'

const ADAPTER_SURFACE_STALE_TIME = 60_000

function adapterSurfaceQueryOptions(resource, queryFn, enabled) {
  const active = Boolean(enabled && WORKER_CONFIGURED)
  return {
    queryKey: ['adapter-surfaces', resource],
    queryFn,
    enabled: active,
    staleTime: ADAPTER_SURFACE_STALE_TIME,
    refetchOnWindowFocus: false,
    retry: 1,
  }
}

export function useDexReadAdapters({ enabled = true } = {}) {
  return useQuery(adapterSurfaceQueryOptions('dex-reads', getDexReadAdapters, enabled))
}

export function useLendingReadAdapters({ enabled = true } = {}) {
  return useQuery(adapterSurfaceQueryOptions('lending-reads', getLendingReadAdapters, enabled))
}

export function okAdapterSurface(query) {
  return query?.data?.status === 'ok' ? query.data : null
}

export function adapterSurfaceUnavailable(query) {
  if (!WORKER_CONFIGURED) return 'Worker URL not configured'
  if (query?.data?.status === 'error') return query.data.code || 'WORKER_READ_FAILED'
  if (query?.isError) return query.error?.message || String(query.error)
  return null
}

export { WORKER_CONFIGURED as ADAPTER_SURFACE_WORKER_CONFIGURED }
