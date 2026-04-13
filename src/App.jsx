import React, { useState, useEffect, useRef } from 'react'
import StockCard from './StockCard'
import DetailPanel from './DetailPanel'
import AlertPanel from './AlertPanel'
import AboutModal from './AboutModal'
import DailyPicks from './DailyPicks'
import { getDailyPicks, loadPicksFromCache } from './picksService'
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

// Always use daily resolution — free tier doesn't support W/M.
// maxPoints controls how many data points end up in the chart (downsampled client-side).
const TIMEFRAMES = {
  '1M':  { days: 42,   maxPoints: 31  },
  '3M':  { days: 100,  maxPoints: 65  },
  '1Y':  { days: 370,  maxPoints: 52  },
  '5Y':  { days: 1830, maxPoints: 60  },
  '10Y': { days: 3660, maxPoints: 60  },
}

function getGridCols() {
  const w = window.innerWidth
  if (w <= 460) return 1
  if (w <= 680) return 2
  if (w <= 900) return 3
  return 4
}

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY
const GNEWS_KEY   = import.meta.env.VITE_GNEWS_KEY

const DEFAULT_WATCHLIST = [
  { ticker: 'AAPL', name: 'Apple Inc.' },
  { ticker: 'TSLA', name: 'Tesla, Inc.' },
  { ticker: 'MSFT', name: 'Microsoft Corp.' },
  { ticker: 'GOOGL', name: 'Alphabet Inc.' },
  { ticker: 'AMZN', name: 'Amazon.com, Inc.' },
]

function loadWatchlist() {
  try {
    const saved = localStorage.getItem('watchlist')
    return saved ? JSON.parse(saved) : DEFAULT_WATCHLIST
  } catch { return DEFAULT_WATCHLIST }
}

function saveWatchlist(list) {
  localStorage.setItem('watchlist', JSON.stringify(list))
}

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

// No static demo charts — always generate dynamically so timeframe changes work correctly

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
  const [watchlist, setWatchlist]     = useState(() => loadWatchlist())
  const watchlistRef = useRef(null)
  watchlistRef.current = watchlist   // always current, even inside async functions

  const [stocks, setStocks]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [fromCache, setFromCache]     = useState(false)
  const [fromDemo, setFromDemo]       = useState(false)

  // ── Add stock form state ──────────────────────────────────────────────
  const [addInput, setAddInput]       = useState('')
  const [addLoading, setAddLoading]   = useState(false)
  const [addError, setAddError]       = useState(null)

  const [selectedTicker, setSelectedTicker] = useState(null)
  const [activeTab, setActiveTab]           = useState('chart')
  const [chartTimeframe, setChartTimeframe] = useState('1M')
  const [gridCols, setGridCols]             = useState(() => getGridCols())

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
  const [aboutOpen, setAboutOpen]   = useState(false)

  // ── Daily picks state ─────────────────────────────────────────────────
  const [picks, setPicks]             = useState(() => loadPicksFromCache())
  const [picksLoading, setPicksLoading] = useState(false)
  const [picksError, setPicksError]   = useState(null)
  const [picksFromCache, setPicksFromCache] = useState(false)
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
      name: (watchlistRef.current.find(s => s.ticker === ticker) || {}).name || ticker,
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
      const results = await Promise.all(watchlistRef.current.map(s => fetchStock(s.ticker)))
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

  async function fetchChartData(ticker, timeframe = '1M') {
    setChartLoading(true)
    setChartError(null)
    setChartData([])

    // Cache key includes timeframe so each range is stored independently
    const cacheKey = `chart_v2_${ticker}_${timeframe}`
    const cached = loadFromCache(cacheKey, CHART_CACHE_TTL_MS)
    if (cached) {
      setChartData(cached)
      setChartLoading(false)
      return
    }

    const { days, maxPoints } = TIMEFRAMES[timeframe]

    try {
      const to   = Math.floor(Date.now() / 1000)
      const from = to - 60 * 60 * 24 * days
      // Always use daily ('D') — free tier doesn't support W or M resolution
      const url  = `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`
      const res  = await fetch(url)
      const data = await res.json()

      if (data.s !== 'ok' || !data.c) throw new Error('No chart data returned.')

      // Build full daily series first
      const allPoints = data.t.map((timestamp, i) => {
        const d = new Date(timestamp * 1000)
        // Use progressively coarser labels for longer timeframes
        let date
        if (days <= 100) {
          // 1M / 3M: "Apr 1"
          date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        } else if (days <= 400) {
          // 1Y: "Apr '25"
          date = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
        } else {
          // 5Y / 10Y: "2023"
          date = d.getFullYear().toString()
        }
        return { date, price: data.c[i] }
      })

      // Downsample so the chart doesn't get crowded for longer ranges
      let points = allPoints
      if (allPoints.length > maxPoints) {
        const step = Math.ceil(allPoints.length / maxPoints)
        points = allPoints.filter((_, i) => i % step === 0)
        // Always include the most recent point
        if (points[points.length - 1] !== allPoints[allPoints.length - 1]) {
          points.push(allPoints[allPoints.length - 1])
        }
      }

      saveToCache(cacheKey, points)
      setChartData(points)
    } catch (err) {
      const stock = stocks.find(s => s.ticker === ticker)
      const startPrice = stock ? parseFloat(stock.price) : 100
      setChartData(generateDemoChart(startPrice, startPrice * 0.018))
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

    // Fetch Finnhub company news and GNews in parallel
    const [finnhubData, gNewsData] = await Promise.allSettled([
      fetch(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${fmt(weekAgo)}&to=${fmt(today)}&token=${FINNHUB_KEY}`)
        .then(r => r.json()),
      GNEWS_KEY
        ? fetch(`https://gnews.io/api/v4/search?q=${ticker}+stock&lang=en&max=5&token=${GNEWS_KEY}`)
            .then(r => r.json())
        : Promise.resolve(null),
    ])

    try {
      // Normalise Finnhub articles — fetch up to 30, then diversify by source
      const rawFinnhub = (finnhubData.status === 'fulfilled' && Array.isArray(finnhubData.value))
        ? finnhubData.value.filter(i => i.headline && i.url).slice(0, 30)
        : []

      // Cap at 2 per source so Yahoo doesn't fill all slots
      const sourceCounts = {}
      const finnhubItems = []
      for (const item of rawFinnhub) {
        const src = item.source || 'Unknown'
        const isYahoo = src.toLowerCase().includes('yahoo')
        const cap = isYahoo ? 1 : 2
        if ((sourceCounts[src] || 0) >= cap) continue
        sourceCounts[src] = (sourceCounts[src] || 0) + 1
        finnhubItems.push(item)
        if (finnhubItems.length >= 8) break
      }

      // Normalise GNews articles to the same shape
      const gNewsItems = (gNewsData.status === 'fulfilled' && gNewsData.value?.articles)
        ? gNewsData.value.articles
            .filter(a => a.title && a.url)
            .map(a => ({
              headline: a.title,
              url:      a.url,
              source:   a.source?.name || 'GNews',
              datetime: Math.floor(new Date(a.publishedAt).getTime() / 1000),
            }))
        : []

      if (finnhubItems.length === 0 && gNewsItems.length === 0) {
        throw new Error('No headlines found.')
      }

      // Merge, deduplicate by headline prefix, sort newest first
      const seen   = new Set()
      const merged = [...finnhubItems, ...gNewsItems]
        .filter(item => {
          const key = item.headline.slice(0, 60).toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .sort((a, b) => b.datetime - a.datetime)
        .slice(0, 8)

      setNews(merged)
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
    setChartTimeframe('1M')
    fetchChartData(ticker, '1M')
    fetchNews(ticker)
    // AI analysis is fetched lazily when the user clicks the AI tab
    setAnalysis(null)
    setAnalysisError(null)
  }

  function handleTimeframeChange(timeframe) {
    setChartTimeframe(timeframe)
    fetchChartData(selectedTicker, timeframe)
  }

  function handleTabChange(tab) {
    setActiveTab(tab)
    // Fetch AI analysis the first time the user opens that tab
    if (tab === 'ai' && selectedTicker && !analysis && !analysisLoading) {
      fetchAnalysis(selectedTicker)
    }
  }

  // ── Daily picks ───────────────────────────────────────────────────────────

  async function fetchPicks(forceRefresh = false) {
    setPicksLoading(true)
    setPicksError(null)
    try {
      const result = await getDailyPicks(forceRefresh)
      setPicks(result)
      setPicksFromCache(!!result.fromCache)
    } catch (err) {
      setPicksError('Could not generate picks: ' + err.message)
    } finally {
      setPicksLoading(false)
    }
  }

  // Add a stock directly from a daily pick (ticker + name already known)
  async function handleAddFromPick(ticker, name) {
    if (watchlistRef.current.find(s => s.ticker === ticker)) return
    try {
      const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`
      const quoteRes = await fetch(quoteUrl)
      const quote    = await quoteRes.json()

      const newEntry = { ticker, name }
      const newList  = [...watchlistRef.current, newEntry]
      setWatchlist(newList)
      saveWatchlist(newList)

      if (quote && quote.c) {
        setStocks(prev => [...prev, {
          ticker,
          name,
          price:         quote.c.toFixed(2),
          change:        (quote.d  || 0).toFixed(2),
          changePercent: (quote.dp || 0).toFixed(2),
        }])
      }
    } catch {
      // silently fail — stock just won't appear until next refresh
    }
  }

  // ── Add / delete stocks ───────────────────────────────────────────────────

  async function handleAddStock() {
    const ticker = addInput.trim().toUpperCase()
    if (!ticker) return
    if (watchlistRef.current.find(s => s.ticker === ticker)) {
      setAddError(`${ticker} is already in your watchlist.`)
      return
    }
    setAddLoading(true)
    setAddError(null)
    try {
      // Validate the ticker exists by hitting the Finnhub profile endpoint
      const profileUrl = `https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_KEY}`
      const profileRes = await fetch(profileUrl)
      const profile    = await profileRes.json()
      if (!profile || !profile.name) {
        throw new Error(`Could not find a stock with ticker "${ticker}". Check the symbol and try again.`)
      }

      // Fetch the current quote so the card shows real data immediately
      const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`
      const quoteRes = await fetch(quoteUrl)
      const quote    = await quoteRes.json()

      // Persist the new watchlist entry
      const newEntry = { ticker, name: profile.name }
      const newList  = [...watchlistRef.current, newEntry]
      setWatchlist(newList)
      saveWatchlist(newList)

      // Add the stock card with live price (or a placeholder if market is closed)
      if (quote && quote.c) {
        setStocks(prev => [...prev, {
          ticker,
          name:          profile.name,
          price:         quote.c.toFixed(2),
          change:        (quote.d || 0).toFixed(2),
          changePercent: (quote.dp || 0).toFixed(2),
        }])
      }

      setAddInput('')
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAddLoading(false)
    }
  }

  function handleDeleteStock(ticker) {
    const newList = watchlistRef.current.filter(s => s.ticker !== ticker)
    setWatchlist(newList)
    saveWatchlist(newList)
    setStocks(prev => prev.filter(s => s.ticker !== ticker))
    if (selectedTicker === ticker) {
      setSelectedTicker(null)
      setAnalysis(null)
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
    fetchPicks()   // load daily picks on startup (uses cache if fresh)

    // Poll for fresh prices every 5 minutes to check alerts silently
    pollRef.current = setInterval(() => {
      fetchAllStocks(true)   // forceRefresh = true, bypasses cache
    }, POLL_INTERVAL_MS)

    // Track window width so we know how many grid columns are showing
    function handleResize() { setGridCols(getGridCols()) }
    window.addEventListener('resize', handleResize)

    return () => {
      clearInterval(pollRef.current)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  const selectedStock = stocks.find(s => s.ticker === selectedTicker)

  return (
    <div className="app">
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
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
          <button className="about-btn" onClick={() => setAboutOpen(true)}>About</button>
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
            watchlist={watchlist}
          />
        </div>
      )}

      <DailyPicks
        picks={picks}
        loading={picksLoading}
        error={picksError}
        fromCache={picksFromCache}
        onRefresh={() => fetchPicks(true)}
        watchlist={watchlist}
        onAddToWatchlist={handleAddFromPick}
      />

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

            {/* ── Add stock form ── */}
            <form
              className="add-stock-form"
              onSubmit={e => { e.preventDefault(); handleAddStock() }}
            >
              <input
                className="add-stock-input"
                type="text"
                placeholder="Add ticker, e.g. NVDA"
                value={addInput}
                onChange={e => { setAddInput(e.target.value.toUpperCase()); setAddError(null) }}
                disabled={addLoading}
                maxLength={10}
              />
              <button
                className="add-stock-btn"
                type="submit"
                disabled={addLoading || !addInput.trim()}
              >
                {addLoading ? 'Adding…' : '+ Add'}
              </button>
            </form>
            {addError && <p className="add-stock-error">{addError}</p>}

            <div className="grid">
              {(() => {
                const selectedIndex = stocks.findIndex(s => s.ticker === selectedTicker)
                // Index of the last card in the same row as the selected card
                const insertAfterIndex = selectedIndex >= 0
                  ? Math.min(
                      Math.ceil((selectedIndex + 1) / gridCols) * gridCols - 1,
                      stocks.length - 1
                    )
                  : -1

                return stocks.map((stock, i) => (
                  <React.Fragment key={stock.ticker}>
                    <StockCard
                      stock={stock}
                      onClick={() => handleCardClick(stock.ticker)}
                      isSelected={selectedTicker === stock.ticker}
                      onDelete={handleDeleteStock}
                    />
                    {i === insertAfterIndex && selectedStock && (
                      <div className="grid-detail-slot">
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
                          chartTimeframe={chartTimeframe}
                          onTimeframeChange={handleTimeframeChange}
                        />
                      </div>
                    )}
                  </React.Fragment>
                ))
              })()}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default App
