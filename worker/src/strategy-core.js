// RescueGrid — canonical strategy JSON + strategy_hash (blake2b-256).
// Shared by the Worker (TS imports this .js) and the vector test, so there is
// exactly one canonicalization/hash implementation. See docs/03-technical-spec.md §5.
import { blake2b } from '@noble/hashes/blake2b'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'

/**
 * Canonical JSON per spec: UTF-8, lexicographically sorted keys at every level,
 * no insignificant whitespace, decimal strings preserved exactly (numbers stay
 * numbers, strings stay strings — we never reformat them).
 */
export function canonicalize(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']'
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}'
  }
  // strings, numbers, booleans, null — JSON.stringify gives the canonical token
  return JSON.stringify(value)
}

/** blake2b-256 of a UTF-8 string or bytes, as a 0x-prefixed hex string. */
export function blake2b256Hex(input) {
  const bytes = typeof input === 'string' ? utf8ToBytes(input) : input
  return '0x' + bytesToHex(blake2b(bytes, { dkLen: 32 }))
}

/** strategy_hash = blake2b-256(canonical_strategy_json_utf8). */
export function strategyHash(strategy) {
  return blake2b256Hex(canonicalize(strategy))
}
