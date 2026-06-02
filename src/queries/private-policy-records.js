import { useQuery } from '@tanstack/react-query'
import { getPrivatePolicyRecordContract, WORKER_CONFIGURED } from '../api.js'

export function usePrivatePolicyRecordContract({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['private-policy-record-contract'],
    queryFn: getPrivatePolicyRecordContract,
    enabled: Boolean(enabled && WORKER_CONFIGURED),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

export function okPrivatePolicyRecordContract(query) {
  return query?.data?.status === 'ok' ? query.data : null
}
