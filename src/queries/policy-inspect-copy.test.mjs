import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  forbiddenPolicyInspectTerms,
  isLiveInspectSource,
  policyInspectCopy,
  policyInspectCopyText,
} from './policy-inspect-copy.js'

const here = dirname(fileURLToPath(import.meta.url))

const liveCopy = policyInspectCopy({ kind: 'live-worker' })
assert.equal(isLiveInspectSource({ kind: 'live-worker' }), true)
assert.equal(liveCopy.objectLabel, 'MoveGate Mandate + RescuePolicyWrapper')
assert.match(liveCopy.structLabel, /RescuePolicyWrapper/)
assert.match(liveCopy.capabilityCopy, /MoveGate/)
assert.match(liveCopy.capabilityCopy, /linked mandate/)
assert.match(liveCopy.ownerSigningCopy, /tx_json/)
assert.deepEqual(forbiddenPolicyInspectTerms(policyInspectCopyText(liveCopy)), [])

const demoCopy = policyInspectCopy({ kind: 'demo' })
assert.equal(isLiveInspectSource({ kind: 'demo' }), false)
assert.equal(demoCopy.objectLabel, 'Demo policy-shaped object')
assert.match(demoCopy.budgetCopy, /real RescuePolicyWrapper/)
assert.deepEqual(forbiddenPolicyInspectTerms(policyInspectCopyText(demoCopy)), [])

assert.deepEqual(forbiddenPolicyInspectTerms('AgentPolicy AgentCap sponsored gas'), [
  '\\bAgentPolicy\\b',
  '\\bAgentCap\\b',
  '\\bsponsored[-\\s]?gas\\b',
])

const detailSource = readFileSync(join(here, '../components/Detail.jsx'), 'utf8')
assert.match(detailSource, /MoveGate Mandate \+ RescuePolicyWrapper|inspectCopy\.objectLabel/)
assert.equal(forbiddenPolicyInspectTerms(detailSource).length, 0)

console.log('ALL POLICY INSPECT COPY TESTS PASS')
