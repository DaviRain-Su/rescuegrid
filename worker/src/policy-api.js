import { strategyHash } from './strategy-core.js'

export function activationPolicyPreflight({ wrapper, mandate, strategy, nowMs = Date.now() }) {
  if (!wrapper) {
    return {
      ok: false,
      status: 404,
      body: { status: 'error', code: 'NOT_FOUND', message: 'Wrapper not found.' },
    }
  }
  if (!mandate) {
    return {
      ok: false,
      status: 404,
      body: { status: 'error', code: 'MANDATE_NOT_FOUND', message: 'Mandate not found.' },
    }
  }
  if (mandate.revoked) {
    return {
      ok: false,
      status: 409,
      body: {
        status: 'error',
        code: 'POLICY_REVOKED',
        message: 'Policy is revoked and cannot be activated.',
        wrapper_id: wrapper.wrapper_id,
        mandate_id: wrapper.mandate_id,
        runtime_state: 'Revoked',
      },
    }
  }
  if (nowMs >= Number(mandate.expires_at_ms)) {
    return {
      ok: false,
      status: 409,
      body: {
        status: 'error',
        code: 'POLICY_EXPIRED',
        message: 'Policy is expired and cannot be activated.',
        wrapper_id: wrapper.wrapper_id,
        mandate_id: wrapper.mandate_id,
        runtime_state: 'Expired',
      },
    }
  }
  if (strategy) {
    const recomputed = strategyHash(strategy)
    if (recomputed !== wrapper.strategy_hash) {
      return {
        ok: false,
        status: 422,
        body: {
          status: 'error',
          code: 'HASH_MISMATCH',
          message: 'activation strategy does not match the on-chain strategy_hash.',
          wrapper_id: wrapper.wrapper_id,
          mandate_id: wrapper.mandate_id,
          expected_strategy_hash: wrapper.strategy_hash,
          recomputed_strategy_hash: recomputed,
        },
      }
    }
  }
  return { ok: true, status: 200, body: null }
}

export function revokePolicyPreflight({ wrapper, mandate, owner }) {
  if (!wrapper) {
    return {
      ok: false,
      status: 404,
      body: { status: 'error', code: 'NOT_FOUND', message: 'Wrapper not found.' },
    }
  }
  if (owner && wrapper.owner !== owner) {
    return {
      ok: false,
      status: 403,
      body: { status: 'error', code: 'OWNER_MISMATCH', message: 'Only the policy owner can revoke.' },
    }
  }
  if (!mandate) {
    return {
      ok: false,
      status: 404,
      body: { status: 'error', code: 'MANDATE_NOT_FOUND', message: 'Mandate not found.' },
    }
  }
  if (mandate.revoked) {
    return {
      ok: false,
      status: 409,
      body: {
        status: 'error',
        code: 'ALREADY_REVOKED',
        message: 'Policy is already revoked.',
        wrapper_id: wrapper.wrapper_id,
        mandate_id: wrapper.mandate_id,
        runtime_state: 'Revoked',
      },
    }
  }
  return { ok: true, status: 200, body: null }
}
