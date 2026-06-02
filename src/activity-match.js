export function policyActivityKeys(policy) {
  const keys = [policy?.name, policy?.id, policy?._wrapperId]
  if (policy?._wrapperId && policy._wrapperId.length > 12) {
    keys.push(`${policy._wrapperId.slice(0, 6)}…${policy._wrapperId.slice(-4)}`)
  }
  return new Set(keys.filter(Boolean))
}

export function filterPolicyActivity(activity, policy) {
  const keys = policyActivityKeys(policy)
  return (activity || []).filter((item) => keys.has(item?.policy))
}
