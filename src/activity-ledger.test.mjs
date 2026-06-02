import assert from 'node:assert/strict'
import {
  approvalOfActivity,
  evidenceRowsFor,
  makeLedgerRow,
  policyLookup,
  signerBlockerCodesFor,
  signerEvidenceRowsFor,
} from './activity-ledger.js'

const waapPending = {
  kind: 'guardian',
  policy: 'SUI rescue',
  title: 'Execution blocked',
  detail: 'Execution blocked by waap: waiting for owner approval',
  t: '10:00',
  blocker_codes: ['WAAP_APPROVAL_PENDING'],
  blocker_labels: ['WaaP approval pending'],
  signer_kind: 'waap',
  approval_state: 'pending',
}

assert.deepEqual(signerBlockerCodesFor(waapPending), ['WAAP_APPROVAL_PENDING'])
assert.deepEqual(
  signerEvidenceRowsFor(waapPending).map((row) => [row.label, row.value]),
  [
    ['Signer', 'waap'],
    ['Approval state', 'pending'],
    ['Signer code', 'WAAP_APPROVAL_PENDING'],
  ],
)
assert.equal(approvalOfActivity(waapPending), 'required')

const waapRow = makeLedgerRow(waapPending, 0, policyLookup([]))
assert.equal(waapRow.outcome, 'blocked')
assert.equal(waapRow.status.id, 'blocked')
assert.equal(waapRow.hasGuardianBlock, true)
assert.equal(waapRow.hasSignerBlock, true)
assert.equal(waapRow.approval, 'required')

const signerMismatch = {
  kind: 'guardian',
  title: 'Execution disabled',
  detail: 'Signer address mismatch',
  blocker_codes: ['SIGNER_ADDRESS_MISMATCH'],
  signer_kind: 'local-daemon',
}
assert.deepEqual(signerBlockerCodesFor(signerMismatch), ['SIGNER_ADDRESS_MISMATCH'])
assert.equal(makeLedgerRow(signerMismatch, 1, policyLookup([])).hasSignerBlock, true)

const fundingBlock = {
  kind: 'guardian',
  title: 'Funding gate',
  detail: 'BalanceManager is not funded',
  blocker_codes: ['INSUFFICIENT_DBUSDC'],
  blocker_labels: ['DBUSDC balance too low'],
}
assert.deepEqual(signerBlockerCodesFor(fundingBlock), [])
assert.equal(makeLedgerRow(fundingBlock, 2, policyLookup([])).hasSignerBlock, false)
assert.deepEqual(evidenceRowsFor(fundingBlock), [{
  code: 'INSUFFICIENT_DBUSDC',
  label: 'DBUSDC balance too low',
  observed: null,
  required: null,
}])

const lookup = policyLookup([{ _wrapperId: '0xwrap', strategy: 'lending' }])
const policyMatched = makeLedgerRow({ wrapper_id: '0xwrap', title: 'Policy activity' }, 3, lookup)
assert.equal(policyMatched.strategy.id, 'lending')
assert.equal(policyMatched.strategy.label, 'Yield Router')

console.log('activity ledger tests passed')
