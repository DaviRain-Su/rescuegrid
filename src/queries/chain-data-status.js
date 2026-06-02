import { useQuery } from '@tanstack/react-query'
import { getChainDataStatus, WORKER_CONFIGURED } from '../api.js'

export function useChainDataStatus({ probe = false } = {}) {
  return useQuery({
    queryKey: ['chain-data-status', probe],
    queryFn: () => getChainDataStatus({ probe }),
    enabled: WORKER_CONFIGURED,
    staleTime: probe ? 15_000 : 5_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  })
}
