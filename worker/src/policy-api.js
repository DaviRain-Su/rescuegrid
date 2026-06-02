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
