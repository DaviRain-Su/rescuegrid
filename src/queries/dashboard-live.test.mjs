import assert from 'node:assert/strict'
import {
  dashboardActivityFeed,
  dashboardChartSeries,
  dashboardCrashState,
} from './dashboard-live.js'

assert.equal(dashboardCrashState({ live: true, crashState: 'crashing' }), 'idle')
assert.equal(dashboardCrashState({ live: true, crashState: 'rescued' }), 'idle')
assert.equal(dashboardCrashState({ live: false, crashState: 'crashing' }), 'crashing')

assert.deepEqual(dashboardChartSeries({
  live: false,
  demoSpark: [1, 2, 3],
  liveSpark: [9, 9, 9],
}), [1, 2, 3])

assert.deepEqual(dashboardChartSeries({
  live: true,
  demoSpark: [1, 2, 3],
  liveSpark: [9, 10],
  priceHistory: [7, 8],
  livePrice: 6,
}), [9, 10])

assert.deepEqual(dashboardChartSeries({
  live: true,
  demoSpark: [1, 2, 3],
  liveSpark: null,
  priceHistory: [7, 8],
  livePrice: 6,
}), [7, 8])

assert.deepEqual(dashboardChartSeries({
  live: true,
  demoSpark: [1, 2, 3],
  liveSpark: null,
  priceHistory: null,
  livePrice: 6.25,
}), [6.25, 6.25])

assert.deepEqual(dashboardActivityFeed({
  live: true,
  liveActivity: [{ id: 'chain' }],
  demoActivity: [{ id: 'demo' }],
}), [{ id: 'chain' }])

assert.deepEqual(dashboardActivityFeed({
  live: false,
  liveActivity: [{ id: 'chain' }],
  demoActivity: [{ id: 'demo' }],
}), [{ id: 'demo' }])

console.log('ALL DASHBOARD LIVE TESTS PASS')
