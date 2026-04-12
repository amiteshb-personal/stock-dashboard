import { useState, useEffect, useRef } from 'react'
import StockCard from './StockCard'
import DetailPanel from './DetailPanel'
import AlertPanel from './AlertPanel'
import { analyzeStock } from './AIAnalysis'
import {
  requestNotificationPermission,
  sendBrowserNotification,
  checkAllAlerts,
  loadRules, saveRules,
  loadHistory, saveHistory,
} from './alerts.js'
import './App.css'

const POLL_INTERVAL_MS = 5 * 60 * 1000   // re-fetch prices every 5 minutes

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY

const WATCHLIST = [
  { ticker: 'AAPL', name: 'Apple Inc.' },
  { ticker: 'TSLA', name: 'Tesla, Inc.' },
  { ticker: 'MSFT', name: 'Microsoft Corp.' },
  { ticker: 'GOOGL', name: 'Alphabet Inc.' },
  { ticker: 'AMZN', name: 'Amazon.com, Inc.' },
]

// Shown when the API is rate-limited and there's no cache yet.
// Prices are approximate — just enough to make the UI usable during development.
const DEMO_STOCKS = [
  { ticker: 'AAPL', name: 'Apple Inc.',        price: '169.00', change: '-1.23', changePercent: '-0.72' },
  { ticker: 'TSLA', name: 'Tesla, Inc.',        price: '177.50', change: '3.40',  changePercent: '1.95'  },
  { ticker: 'MSFT', name: 'Microsoft Corp.',    price: '378.90', change: '-2.10', changePercent: '-0.55' },
  { ticker: 'GOOGL', name: 'Alphabet Inc.',     price: '163.40', change: '0.85',  changePercent: '0.52'  },
  { ticker: 'AMZN', name: 'Amazon.com, Inc.',   price: '182.20', change: '1.60',  changePercent: '0.89'  },
]

// 30 days of fake-but-realistic price points per stock for the chart
function generateDemoChart(startPrice, volatility) {
  const points = []
  let price = startPrice
  const now = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    // Skip weekends
    if (d.getDay() === 0 || d.getDay() === 6) continue
    price = price + (Math.random() - 0.48) * volatility
    points.push({
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      price: parseFloat(price.toFixed(2)),
    })
  }
  return points
}

const DEMO_CHARTS = {
  AAPL:  generateDemoChart(172, 2.5),
  TSLA:  generateDemoChart(172, 6.0),
  MSFT:  generateDemoChart(382, 3.5),
  GOOGL: generateDemoChart(161, 3.0),
  AMZN:  generateDemoChart(179, 3.5),
}

// How long cached data is considered fresh before we go back to the API
const PRICE_CACHE_TTL_MS = 30 * 60 * 1000   // 30 minutes
const CHART_CACHE_TTL_MS = 24 * 60 * 60 * 1000  // 24 hours

// ── Cache helpers ─────────────────────────────────────────────────────────────
// These read/write from localStorage — the browser's built-in key-value store.
// Data survives page reloads but is only stored locally on your machine.

function saveToCache(key, data) {
  localStorage.setItem(key, JSON.stringify({ data, savedAt: Date.now() }))
}

function loadFromCache(key, ttlMs) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { data, savedAt } = JSON.parse(raw)
    // If the cache is older than the TTL, treat it as expired
    if (Date.now() - savedAt > ttlMs) return null
    return data
  } catch {
    return null
  }
}
// ─────────────────────────────────────────────────────────────────────────────

function App() {
  const [stocks, setStocks]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  // fromCache = true means the header shows "Using cached data" instead of a time
  const [fromCache, setFromCache]     = useState(false)
  const [fromDemo, setFromDemo]       = useState(false)

  const [selectedTicker, setSelectedTicker] = useState(null)
  const [activeTab, setActiveTab]           = useState('chart')

  const [chartData, setChartData]         = useState([])
  const [chartLoading, setChartLoading]   = useState(false)
  const [chartError, setChartError]       = useState(null)

  const [news, setNews]               = useState([])
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsError, setNewsError]     = useState(null)

  // ── AI Analysis state ─────────────────────────────────────────────────
  const [analysis, setAnalysis]             = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError]   = useState(null)

  // ── Alert state ───────────────────────────────────────────────────────
  const [rules, setRules]           = useState(() => loadRules())
  const [alertHistory, setAlertHistory] = useState(() => loadHistory())
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [notifGranted, setNotifGranted] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  )
  // useRef stores the polling interval ID so we can cancel it on cleanup
  const pollRef = useRef(null)

  // Unread count — alerts that haven't been seen yet
  const unreadCount = alertHistory.filter(h => !h.read).length

  // ── Helpers ───────────────────────────────────────────────────────────

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ── Stock price fetching ──────────────────────────────────────────────

  async function fetchStock(ticker) {
    const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`
    const res = await fetch(url)
    const data = await res.json()
    // Finnhub returns 0s for all fields when the market is closed for an unknown symbol
    if (!data.c) throw new Error(`No data returned for ${ticker}`)
    return {
      ticker,
      name: WATCHLIST.find(s => s.ticker === ticker).name,
      price: data.c.toFixed(2),
      change: data.d.toFixed(2),
      changePercent: data.dp.toFixed(2),
    }
  }

  // forceRefresh = true skips the cache and always calls the API
  async function fetchAllStocks(forceRefresh = false) {
    setLoading(true)
    setError(null)

    // Check cache first (unless the user explicitly hit Refresh)
    if (!forceRefresh) {
      const cached = loadFromCache('stocks', PRICE_CACHE_TTL_MS)
      if (cached) {
        setStocks(cached)
        setFromCache(true)
        setLoading(false)
        return
      }
    }

    // Cache miss — go to the API
    setFromCache(false)
    setFromDemo(false)
    try {
      // Finnhub allows 60 req/min so we can fetch all 5 at the same time
      const results = await Promise.all(WATCHLIST.map(s => fetchStock(s.ticker)))
      setStocks(results)
      saveToCache('stocks', results)
      setLastUpdated(new Date().toLocaleTimeString())
      // Check alert rules against the fresh prices
      runAlertChecks(results)
    } catch (err) {
      // API failed (likely rate limited) — fall back to demo data so the UI still works
      setStocks(DEMO_STOCKS)
      setFromDemo(true)
      setError(null)
    } finally {
      setLoading(false)
    }
  }

  // ── Chart data fetching ───────────────────────────────────────────────

  async function fetchChartData(ticker) {
    setChartLoading(true)
    setChartError(null)
    setChartData([])

    // Each ticker gets its own cache key, e.g. "chart_AAPL"
    const cacheKey = `chart_${ticker}`
    const cached = loadFromCache(cacheKey, CHART_CACHE_TTL_MS)
    if (cached) {
      setChartData(cached)
      setChartLoading(false)
      return
    }

    try {
      // Finnhub candle endpoint — 'D' means daily bars
      const to   = Math.floor(Date.now() / 1000)
      const from = to - 60 * 60 * 24 * 42   // ~6 weeks back to guarantee 30 trading days
      const url  = `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`
      const res  = await fetch(url)
      const data = await res.json()

      if (data.s !== 'ok' || !data.c) throw new Error('No chart data returned.')

      // data.t = array of timestamps, data.c = array of closing prices
      const points = data.t.slice(-30).map((timestamp, i) => {
        const d = new Date(timestamp * 1000)
        return {
          date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          price: data.c[data.c.length - 30 + i],
        }
      })

      saveToCache(cacheKey, points)
      setChartData(points)
    } catch (err) {
      // Any failure — use demo chart rather than showing an error
      setChartData(DEMO_CHARTS[ticker] || [])
    } finally {
      setChartLoading(false)
    }
  }

  // ── News fetching ─────────────────────────────────────────────────────

  async function fetchNews(ticker) {
    setNewsLoading(true)
    setNewsError(null)
    setNews([])
    const today   = new Date()
    const weekAgo = new Date(today)
    weekAgo.setDate(today.getDate() - 7)
    const fmt = d => d.toISOString().split('T')[0]
    try {
      const url = `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${fmt(weekAgo)}&to=${fmt(today)}&token=${FINNHUB_KEY}`
      const res = await fetch(url)
      const data = await res.json()
      if (!Array.isArray(data)) throw new Error('Unexpected response from news API.')
      setNews(data.filter(item => item.headline && item.url).slice(0, 5))
    } catch (err) {
      setNewsError('Could not load news: ' + err.message)
    } finally {
      setNewsLoading(false)
    }
  }

  // ── AI analysis fetching ─────────────────────────────────────────────

  async function fetchAnalysis(ticker) {
    setAnalysisLoading(true)
    setAnalysisError(null)
    setAnalysis(null)
    try {
      const stock     = stocks.find(s => s.ticker === ticker)
      const cached    = loadFromCache(`ai_${ticker}`, 60 * 60 * 1000)  // cache 1 hour
      if (cached) {
        setAnalysis(cached)
        return
      }
      // Wait briefly for news to load if it's still in-flight
      await new Promise(r => setTimeout(r, 600))
      const result = await analyzeStock({
        stock,
        news,          // use whatever headlines are loaded
        chartData,     // use whatever chart data is loaded
      })
      saveToCache(`ai_${ticker}`, result)
      setAnalysis(result)
    } catch (err) {
      setAnalysisError('AI analysis failed: ' + err.message)
    } finally {
      setAnalysisLoading(false)
    }
  }

  // ── Card click handler ────────────────────────────────────────────────

  function handleCardClick(ticker) {
    if (selectedTicker === ticker) {
      setSelectedTicker(null)
      setAnalysis(null)
      return
    }
    setSelectedTicker(ticker)
    setActiveTab('chart')
    fetchChartData(ticker)
    fetchNews(ticker)
    // AI analysis is fetched lazily when the user clicks the AI tab
    setAnalysis(null)
    setAnalysisError(null)
  }

  function handleTabChange(tab) {
    setActiveTab(tab)
    // Fetch AI analysis the first time the user opens that tab
    if (tab === 'ai' && selectedTicker && !analysis && !analysisLoading) {
      fetchAnalysis(selectedTicker)
    }
  }

  // ── Alert helpers ─────────────────────────────────────────────────────

  function runAlertChecks(latestStocks) {
    const currentRules = loadRules()   // always read fresh from storage
    if (currentRules.length === 0) return

    const fired = checkAllAlerts(latestStocks, currentRules)
    if (fired.length === 0) return

    // Add to history and persist
    const updated = [...fired, ...loadHistory()]
    setAlertHistory(updated)
    saveHistory(updated)

    // Fire a desktop notification for each alert
    fired.forEach(item => {
      sendBrowserNotification('Stock Alert', item.message)
    })
  }

  function handleAddRule(rule) {
    const newRule = { ...rule, id: crypto.randomUUID() }
    const updated = [newRule, ...rules]
    setRules(updated)
    saveRules(updated)
  }

  function handleDeleteRule(id) {
    const updated = rules.filter(r => r.id !== id)
    setRules(updated)
    saveRules(updated)
  }

  function handleClearHistory() {
    setAlertHistory([])
    saveHistory([])
  }

  function handleOpenAlerts() {
    setAlertsOpen(prev => !prev)
    // Mark all as read when opening
    const updated = alertHistory.map(h => ({ ...h, read: true }))
    setAlertHistory(updated)
    saveHistory(updated)
  }

  async function handleEnableNotifications() {
    const granted = await requestNotificationPermission()
    setNotifGranted(granted)
  }

  // ── Initial load + polling ────────────────────────────────────────────

  useEffect(() => {
    fetchAllStocks()

    // Poll for fresh prices every 5 minutes to check alerts silently
    pollRef.current = setInterval(() => {
      fetchAllStocks(true)   // forceRefresh = true, bypasses cache
    }, POLL_INTERVAL_MS)

    // Cleanup: cancel the interval when the component is removed from the page
    return () => clearInterval(pollRef.current)
  }, [])

  const selectedStock = stocks.find(s => s.ticker === selectedTicker)

  return (
    <div className="app">
      <header className="header">
        <h1>Stock Watchlist</h1>
        <div className="header-right">
          {fromDemo && (
            <span className="demo-badge" title="API rate limit reached — showing approximate prices">Demo data</span>
          )}
          {fromCache && !fromDemo && (
            <span className="cache-badge">Cached</span>
          )}
          {lastUpdated && !fromCache && !fromDemo && (
            <span className="last-updated">Updated: {lastUpdated}</span>
          )}
          {/* Bell button — opens/closes the alerts panel */}
          <button className="bell-btn" onClick={handleOpenAlerts} title="Alerts">
            🔔
            {unreadCount > 0 && (
              <span className="bell-badge">{unreadCount}</span>
            )}
          </button>
          <button className="refresh-btn" onClick={() => fetchAllStocks(true)} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Alert panel — slides in below the header when bell is clicked */}
      {alertsOpen && (
        <div className="alert-panel-wrap">
          {!notifGranted && (
            <div className="notif-prompt">
              <span>Enable desktop notifications to get alerts even when this tab is in the background.</span>
              <button className="notif-enable-btn" onClick={handleEnableNotifications}>
                Enable Notifications
              </button>
            </div>
          )}
          <AlertPanel
            rules={rules}
            history={alertHistory}
            onAddRule={handleAddRule}
            onDeleteRule={handleDeleteRule}
            onClearHistory={handleClearHistory}
          />
        </div>
      )}

      <main className="main">
        {loading && stocks.length === 0 && (
          <div className="loading">
            <div className="spinner"></div>
            <p>Loading stock prices...</p>
          </div>
        )}

        {error && (
          <div className="error">
            <p>{error}</p>
            <p className="error-hint">Alpha Vantage free tier allows 25 requests/day. Try again tomorrow or click Refresh in 60 seconds.</p>
            <button onClick={() => fetchAllStocks(true)}>Try Again</button>
          </div>
        )}

        {stocks.length > 0 && (
          <>
            <p className="hint">Click any card to see the chart and news</p>
            <div className="grid">
              {stocks.map(stock => (
                <StockCard
                  key={stock.ticker}
                  stock={stock}
                  onClick={() => handleCardClick(stock.ticker)}
                  isSelected={selectedTicker === stock.ticker}
                />
              ))}
            </div>

            {selectedStock && (
              <DetailPanel
                stock={selectedStock}
                activeTab={activeTab}
                onTabChange={handleTabChange}
                chartData={chartData}
                chartLoading={chartLoading}
                chartError={chartError}
                news={news}
                newsLoading={newsLoading}
                newsError={newsError}
                analysis={analysis}
                analysisLoading={analysisLoading}
                analysisError={analysisError}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default App
