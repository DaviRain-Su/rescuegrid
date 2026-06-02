import { useQuery } from '@tanstack/react-query'
import { getArchivalReplayContract, WORKER_CONFIGURED } from '../api.js'

export function useArchivalReplayContract({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['archival-replay-contract'],
    queryFn: getArchivalReplayContract,
    enabled: Boolean(enabled && WORKER_CONFIGURED),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

export function okArchivalReplayContract(query) {
  return query?.data?.status === 'ok' ? query.data : null
}
