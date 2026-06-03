export function dashboardCrashState({ live = false, crashState = 'idle' } = {}) {
  return live ? 'idle' : (crashState || 'idle')
}

function numericPrice(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function usableSeries(values) {
  return Array.isArray(values) && values.length >= 2 ? values : null
}

export function dashboardChartSeries({
  live = false,
  liveSpark = null,
  priceHistory = null,
  livePrice = null,
  demoSpark = null,
} = {}) {
  if (!live) return usableSeries(demoSpark) || []
  const liveSeries = usableSeries(liveSpark)
  if (liveSeries) return liveSeries
  const historySeries = usableSeries(priceHistory)
  if (historySeries) return historySeries
  const price = numericPrice(livePrice)
  return [price, price]
}

export function dashboardActivityFeed({ live = false, liveActivity = [], demoActivity = [] } = {}) {
  return live ? (Array.isArray(liveActivity) ? liveActivity : []) : (Array.isArray(demoActivity) ? demoActivity : [])
}
