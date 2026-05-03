import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
  dangerouslyAllowBrowser: true,
})

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY
const CACHE_KEY   = 'daily_picks_v13'
const CACHE_TTL   = 24 * 60 * 60 * 1000  // 24 hours

// ── Universe: 22 hand-picked growth stocks ───────────────────────────────────
// Deliberately small — every stock here is chosen because it has a credible
// long-term growth thesis, solid Finnhub data coverage, and strong analyst
// following. Smaller universe = faster fetches, better data reliability.
const UNIVERSE = [
  { ticker: 'NVDA',  name: 'NVIDIA Corp.',             sector: 'Technology'  },
  { ticker: 'MSFT',  name: 'Microsoft Corp.',          sector: 'Technology'  },
  { ticker: 'META',  name: 'Meta Platforms',           sector: 'Technology'  },
  { ticker: 'GOOGL', name: 'Alphabet Inc.',            sector: 'Technology'  },
  { ticker: 'AMZN',  name: 'Amazon.com Inc.',          sector: 'Consumer'    },
  { ticker: 'CRWD',  name: 'CrowdStrike Holdings',     sector: 'Technology'  },
  { ticker: 'PLTR',  name: 'Palantir Technologies',    sector: 'Technology'  },
  { ticker: 'ARM',   name: 'Arm Holdings',             sector: 'Technology'  },
  { ticker: 'DDOG',  name: 'Datadog Inc.',             sector: 'Technology'  },
  { ticker: 'NET',   name: 'Cloudflare Inc.',          sector: 'Technology'  },
  { ticker: 'NFLX',  name: 'Netflix Inc.',             sector: 'Media'       },
  { ticker: 'SPOT',  name: 'Spotify Technology',       sector: 'Media'       },
  { ticker: 'LLY',   name: 'Eli Lilly & Co.',          sector: 'Healthcare'  },
  { ticker: 'ISRG',  name: 'Intuitive Surgical',       sector: 'Healthcare'  },
  { ticker: 'COIN',  name: 'Coinbase Global',          sector: 'Finance'     },
  { ticker: 'SHOP',  name: 'Shopify Inc.',             sector: 'Consumer'    },
  { ticker: 'MELI',  name: 'MercadoLibre Inc.',        sector: 'Consumer'    },
  { ticker: 'TSLA',  name: 'Tesla Inc.',               sector: 'Consumer'    },
  { ticker: 'AXON',  name: 'Axon Enterprise',          sector: 'Industrial'  },
  { ticker: 'DUOL',  name: 'Duolingo Inc.',            sector: 'Consumer'    },
  { ticker: 'TTD',   name: 'The Trade Desk',           sector: 'Technology'  },
  { ticker: 'SNOW',  name: 'Snowflake Inc.',           sector: 'Technology'  },
]

// Sector-typical P/E medians used for relative valuation scoring
const SECTOR_PE = {
  Technology:  35,
  Finance:     18,
  Healthcare:  28,
  Consumer:    30,
  Energy:      14,
  Industrial:  22,
  Media:       30,
}

// ── Cache helpers ─────────────────────────────────────────────────────────────
export function loadPicksFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { data, savedAt } = JSON.parse(raw)
    if (Date.now() - savedAt > CACHE_TTL) return null
    return data
  } catch {
    return null
  }
}

function savePicksToCache(data) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() }))
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── Finnhub data fetchers ─────────────────────────────────────────────────────
async function fetchMetrics(ticker) {
  try {
    const url  = `https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB_KEY}`
    const res  = await fetch(url)
    const data = await res.json()
    return data.metric || {}
  } catch {
    return {}
  }
}

// Returns array of closing prices (up to ~150 trading days).
// Finnhub returns no_data when `to` falls on a weekend, so we roll back to Friday.
async function fetchCandles(ticker) {
  const now = new Date()
  const day = now.getDay()
  if (day === 0) now.setDate(now.getDate() - 2)       // Sunday  → Friday
  else if (day === 6) now.setDate(now.getDate() - 1)  // Saturday → Friday
  const to   = Math.floor(now.getTime() / 1000)
  const from = to - 220 * 24 * 60 * 60  // 220 calendar days ≈ 150 trading days
  try {
    const url  = `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`
    const res  = await fetch(url)
    const data = await res.json()
    if (data.s !== 'ok' || !Array.isArray(data.c) || data.c.length < 14) return []
    return data.c  // array of daily close prices
  } catch {
    return []
  }
}

async function fetchPriceTarget(ticker) {
  try {
    const url  = `https://finnhub.io/api/v1/stock/price-target?symbol=${ticker}&token=${FINNHUB_KEY}`
    const res  = await fetch(url)
    return await res.json()
  } catch {
    return {}
  }
}

async function fetchRecommendation(ticker) {
  try {
    const url  = `https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${FINNHUB_KEY}`
    const res  = await fetch(url)
    const data = await res.json()
    return Array.isArray(data) && data.length > 0 ? data[0] : {}
  } catch {
    return {}
  }
}

// ── Technical indicator calculations ─────────────────────────────────────────

function calcSMA(prices, period) {
  if (!prices || prices.length < period) return null
  const slice = prices.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

function calcEMASeries(prices, period) {
  if (!prices || prices.length < period) return []
  const k = 2 / (period + 1)
  const seed = prices.slice(0, period).reduce((a, b) => a + b, 0) / period
  const result = [seed]
  for (let i = period; i < prices.length; i++) {
    result.push(prices[i] * k + result[result.length - 1] * (1 - k))
  }
  return result
}

// RSI(14) using Wilder's smoothed moving average
function calcRSI(prices, period = 14) {
  if (!prices || prices.length < period + 2) return null
  const changes = prices.slice(1).map((p, i) => p - prices[i])
  let avgGain = 0, avgLoss = 0
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i]
    else avgLoss += Math.abs(changes[i])
  }
  avgGain /= period
  avgLoss /= period
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(changes[i], 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.abs(Math.min(changes[i], 0))) / period
  }
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}

// MACD(12, 26): returns { macd, crossedAboveZero } at the last bar
function calcMACD(prices) {
  if (!prices || prices.length < 26) return { macd: null, crossedAboveZero: false }
  const fast = calcEMASeries(prices, 12)   // length = prices.length - 11
  const slow = calcEMASeries(prices, 26)   // length = prices.length - 25
  const offset = fast.length - slow.length
  const macdLine = slow.map((s, i) => fast[i + offset] - s)
  const last  = macdLine[macdLine.length - 1]
  const prev  = macdLine.length >= 2 ? macdLine[macdLine.length - 2] : last
  return {
    macd: last,
    crossedAboveZero: prev <= 0 && last > 0,  // bullish zero-line crossover
  }
}

// Cross-validate TTM growth against 3Y rate when available; otherwise apply
// absolute caps — no real large/mid-cap has >200% revenue or >500% EPS growth.
function sanitiseGrowth(ttm, threeY, { revCap = 2.0, epsCap = 5.0 } = {}) {
  if (ttm == null) return null
  if (threeY != null && Math.abs(ttm) > Math.abs(threeY) * 3 && Math.abs(ttm) > 1.5) {
    return threeY
  }
  const cap = epsCap  // caller passes correct cap per metric type
  if (Math.abs(ttm) > cap) return null  // implausible — discard rather than mislead
  return ttm
}

// ── Long-term growth scoring (max ~100 pts + analyst bonus) ──────────────────
//
// Philosophy: find stocks with the best chance of significant long-term appreciation.
// High P/E is not a disqualifier — a company growing 40% a year is cheap at 80x.
// Scoring rewards: fast revenue growth, expanding margins, strong price momentum,
// high gross margins (pricing power / scalability), and ROE (capital efficiency).
// It does NOT penalise high P/E or reward near-52-week-lows (mean-reversion is not
// the same as long-term growth).
//
// Finnhub metric field conventions:
//   revenueGrowthTTMYoy     → Revenue growth YoY (decimal: 0.15 = 15%)
//   epsGrowthTTMYoy         → EPS growth YoY (decimal)
//   grossMarginTTM          → Gross margin % (e.g. 65 for 65%)
//   roeAnnual               → Return on equity %
//   totalDebtToEquityAnnual → D/E ratio
//   52WeekHigh / 52WeekLow  → price range

function scoreStock({ ticker, sector, metrics: m, closes }) {
  const signals = []
  let score = 0

  const currentPrice = closes.length > 0 ? closes[closes.length - 1] : null

  // ── Factor 1: Revenue Growth (0–40 pts) — the #1 predictor of long-term price ──
  const revGttm = m.revenueGrowthTTMYoy ?? null
  const revG3y  = m.revenueGrowth3Y     ?? null
  const revG    = sanitiseGrowth(revGttm, revG3y, { epsCap: 1.5 })

  if (revG != null) {
    const pct = revG * 100
    if      (pct > 40) { score += 40; signals.push(`Revenue growth ${pct.toFixed(1)}% YoY — hypergrowth`) }
    else if (pct > 25) { score += 32; signals.push(`Revenue growth ${pct.toFixed(1)}% YoY`) }
    else if (pct > 15) { score += 23; signals.push(`Revenue growth ${pct.toFixed(1)}% YoY`) }
    else if (pct > 7)  { score += 14 }
    else if (pct > 2)  { score += 6  }
    else if (pct < -5) { score -= 5  }
  }

  // ── Factor 2: Profitability trajectory (0–25 pts) ─────────────────────────
  // EPS growth signals earnings leverage; gross margin signals scalability/moat.
  let prof = 0
  const epsGttm = m.epsGrowthTTMYoy ?? null
  const epsG3y  = m.epsGrowthTTMYoy3Y ?? m.epsGrowth3Y ?? null
  const epsG    = sanitiseGrowth(epsGttm, epsG3y, { epsCap: 3.0 })
  const margin  = m.grossMarginTTM ?? null  // percentage e.g. 65 for 65%

  if (epsG != null) {
    const pct = epsG * 100
    if      (pct > 50) { prof += 14; signals.push(`EPS growth ${pct.toFixed(1)}% YoY — accelerating earnings`) }
    else if (pct > 30) { prof += 10; signals.push(`EPS growth ${pct.toFixed(1)}% YoY`) }
    else if (pct > 15) { prof += 7  }
    else if (pct > 5)  { prof += 4  }
    else if (pct < -15){ prof -= 4  }
  }
  if (margin != null) {
    // High gross margin = pricing power + scalability — hallmarks of compounders
    if      (margin > 70) { prof += 11; signals.push(`Gross margin ${margin.toFixed(1)}% — exceptional pricing power`) }
    else if (margin > 55) { prof += 8;  signals.push(`Gross margin ${margin.toFixed(1)}%`) }
    else if (margin > 40) { prof += 5  }
    else if (margin > 25) { prof += 2  }
    else if (margin < 10) { prof -= 2  }  // thin-margin businesses rarely compound well
  }
  score += Math.max(0, Math.min(prof, 25))

  // ── Factor 3: Price Momentum (0–25 pts) ───────────────────────────────────
  // For long-term growth stocks, strong price momentum = institutional conviction.
  // Near 52-week HIGHS is bullish (trend continuation), not bearish.
  let mom = 0
  const rsi                      = calcRSI(closes)
  const { macd, crossedAboveZero } = calcMACD(closes)
  const sma50                    = calcSMA(closes, 50)
  const high52                   = m['52WeekHigh'] ?? null
  const low52                    = m['52WeekLow']  ?? null

  if (rsi != null) {
    if      (rsi >= 55 && rsi <= 72) { mom += 10; signals.push(`RSI ${rsi.toFixed(1)} — strong uptrend`) }
    else if (rsi >= 50 && rsi <  55) { mom += 7  }
    else if (rsi >= 40 && rsi <  50) { mom += 4  }
    else if (rsi  > 72)              { mom += 5  }  // overbought but trend is intact
    else if (rsi >= 30 && rsi <  40) { mom += 2  }
  }
  if (crossedAboveZero)              { mom += 9; signals.push('MACD bullish zero-line crossover') }
  else if (macd != null && macd > 0) { mom += 4; signals.push('MACD positive') }
  if (currentPrice && sma50 != null) {
    const abv = (currentPrice / sma50 - 1) * 100
    if      (abv > 10) { mom += 6; signals.push(`Price ${abv.toFixed(1)}% above 50-day SMA — strong trend`) }
    else if (abv > 4)  { mom += 4; signals.push(`Price ${abv.toFixed(1)}% above 50-day SMA`) }
    else if (abv > 0)  { mom += 2 }
    else               { mom -= 2 }  // below SMA50 is a mild negative
  }
  // Near 52-week high = trend confirmation for growth stocks (opposite of value logic)
  if (currentPrice && high52 && low52 && high52 > low52) {
    const position = (currentPrice - low52) / (high52 - low52)
    if      (position > 0.85) { mom += 0 }  // neutral — already priced into momentum above
    else if (position < 0.30) { mom -= 3 }  // price collapsing is a red flag
  }
  score += Math.max(0, Math.min(mom, 25))

  // ── Factor 4: Business Quality (0–10 pts) ─────────────────────────────────
  // A light check — great growth in a broken business is unsustainable.
  let qual = 0
  const roe = m.roeAnnual ?? null
  const de  = m.totalDebtToEquityAnnual ?? null

  if (roe != null && roe > 0) {
    if      (roe > 20) { qual += 6; signals.push(`ROE ${roe.toFixed(1)}% — efficient capital deployment`) }
    else if (roe > 10) { qual += 4 }
    else if (roe > 0)  { qual += 2 }
  }
  if (de != null) {
    if      (de < 0.5) { qual += 4 }
    else if (de < 1.5) { qual += 2 }
    else if (de > 4.0) { qual -= 3 }  // dangerously leveraged
  }
  score += Math.max(0, Math.min(qual, 10))

  return { score: Math.round(Math.max(0, score)), signals, currentPrice }
}

// ── Analyst overlay (up to +30 pts) ───────────────────────────────────────────
// Analyst consensus is the best forward-looking signal available from Finnhub.
// Price targets embed 12-month earnings estimates; buy ratios reflect conviction.
// Weighted heavily so stocks with strong professional consensus can outrank
// backwards-looking quant scores — this is the "forward-looking" layer.
function analystBonus(priceTarget, rec, currentPrice) {
  let bonus = 0
  const bonusSignals = []

  // Price target upside — up to 18 pts
  if (priceTarget?.targetMean && currentPrice && currentPrice > 0) {
    const upside = (priceTarget.targetMean - currentPrice) / currentPrice
    if      (upside > 0.40) { bonus += 18; bonusSignals.push(`Analyst consensus: +${(upside * 100).toFixed(0)}% upside to mean target`) }
    else if (upside > 0.25) { bonus += 14; bonusSignals.push(`Analyst consensus: +${(upside * 100).toFixed(0)}% upside to mean target`) }
    else if (upside > 0.15) { bonus += 9;  bonusSignals.push(`Analyst mean target +${(upside * 100).toFixed(0)}% upside`) }
    else if (upside > 0.05) { bonus += 4  }
    else if (upside < 0)    { bonus -= 5; bonusSignals.push(`Analyst mean target below current price`) }
  }

  // Buy/Strong Buy ratio — up to 12 pts
  if (rec?.strongBuy != null) {
    const total   = (rec.strongBuy || 0) + (rec.buy || 0) + (rec.hold || 0) + (rec.sell || 0) + (rec.strongSell || 0)
    const bullish = total > 0 ? ((rec.strongBuy || 0) + (rec.buy || 0)) / total : 0
    if      (bullish > 0.80) { bonus += 12; bonusSignals.push(`${(bullish * 100).toFixed(0)}% of analysts rate Buy/Strong Buy`) }
    else if (bullish > 0.65) { bonus += 8;  bonusSignals.push(`${(bullish * 100).toFixed(0)}% of analysts rate Buy/Strong Buy`) }
    else if (bullish > 0.50) { bonus += 4  }
    else if (bullish < 0.30) { bonus -= 4; bonusSignals.push(`Analyst consensus weak — <30% Buy ratings`) }
  }

  return { bonus: Math.min(bonus, 30), bonusSignals }
}

// ── Confidence: quant score + analyst agreement must both be present ──────────
// "High" requires strong model signals AND analyst consensus pointing the same way.
// signalCount includes analyst signals (pushed by analystBonus), so a stock with
// good momentum + strong analyst upside + high buy ratio will naturally have 4-5 signals.
function deriveConfidence(totalScore, signalCount) {
  if (totalScore >= 65 && signalCount >= 4) return 'high'
  if (totalScore >= 45 && signalCount >= 2) return 'medium'
  return 'low'
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function getDailyPicks(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = loadPicksFromCache()
    if (cached) return { ...cached, fromCache: true }
  }

  // ── Step 1: Fetch all data per stock in a single sequential loop ─────────────
  // All 4 calls (metrics, candles, priceTarget, rec) fire in parallel per stock,
  // then we sleep 4.5s before the next stock.
  // Rate budget: 4 calls × 22 stocks = 88 calls over 22×4.5s ≈ 99s → ~53 calls/min ✓
  // This avoids the burst-rate problem of firing 44 analyst calls all at once after
  // the initial loop, which was silently rate-limiting all the analyst responses.
  const stockData = []
  for (const stock of UNIVERSE) {
    try {
      const [metrics, closes, priceTarget, rec] = await Promise.all([
        fetchMetrics(stock.ticker),
        fetchCandles(stock.ticker),
        fetchPriceTarget(stock.ticker),
        fetchRecommendation(stock.ticker),
      ])
      if (closes.length >= 14 || Object.keys(metrics).length > 5) {
        stockData.push({ ...stock, metrics, closes, priceTarget, rec })
      }
    } catch { /* silently skip */ }
    await sleep(4500)
  }

  if (stockData.length === 0) {
    throw new Error('No data returned from Finnhub. Check your API key or try again shortly.')
  }

  // ── Step 2: Score all stocks — quant + analyst in one pass ────────────────
  const scored = stockData.map(stock => {
    const { score, signals, currentPrice } = scoreStock(stock)
    const { bonus, bonusSignals } = analystBonus(stock.priceTarget, stock.rec, currentPrice)
    const totalScore = score + bonus
    const allSignals = [...signals, ...bonusSignals]
    const confidence = deriveConfidence(totalScore, allSignals.length)
    console.log(`[picks] ${stock.ticker}: base=${score} analyst=${bonus} total=${totalScore} signals=${allSignals.length}`)
    return {
      ...stock,
      score: totalScore,
      signals: allSignals,
      confidence,
      currentPrice,
    }
  })
  scored.sort((a, b) => b.score - a.score)
  console.log('[picks] ranking:', scored.map(s => `${s.ticker}:${s.score}`).join(' '))
  const top3 = scored.slice(0, 3)

  // ── Step 5: Build data snapshot for Claude's narrative pass ───────────────
  const today = new Date().toISOString().split('T')[0]

  const stockSummaries = top3.map(s => {
    const m      = s.metrics
    const pe      = (m.peBasicExclExtraTTM ?? m.peTTM ?? null)
    const _revG   = sanitiseGrowth(m.revenueGrowthTTMYoy ?? null, m.revenueGrowth3Y ?? null, { epsCap: 1.5 })
    const _epsG   = sanitiseGrowth(m.epsGrowthTTMYoy ?? null, m.epsGrowthTTMYoy3Y ?? m.epsGrowth3Y ?? null, { epsCap: 3.0 })
    const revG    = _revG != null ? (_revG * 100).toFixed(1) : 'N/A'
    const epsG    = _epsG != null ? (_epsG * 100).toFixed(1) : 'N/A'
    const margin = m.grossMarginTTM      != null ? m.grossMarginTTM.toFixed(1)  : 'N/A'
    const roe    = m.roeAnnual           != null ? m.roeAnnual.toFixed(1)       : 'N/A'
    const de     = m.totalDebtToEquityAnnual != null ? m.totalDebtToEquityAnnual.toFixed(2) : 'N/A'
    const evE    = m.evEbitdaTTM         != null ? m.evEbitdaTTM.toFixed(1)     : 'N/A'
    const rsi    = calcRSI(s.closes)
    const { macd } = calcMACD(s.closes)
    const sma50  = calcSMA(s.closes, 50)
    const abvSMA = s.currentPrice && sma50 != null
      ? (s.currentPrice > sma50 ? `${((s.currentPrice / sma50 - 1) * 100).toFixed(1)}% above` : `${((1 - s.currentPrice / sma50) * 100).toFixed(1)}% below`)
      : 'N/A'
    const upside = s.priceTarget?.targetMean && s.currentPrice
      ? ((s.priceTarget.targetMean / s.currentPrice - 1) * 100).toFixed(1) + '%'
      : 'N/A'

    return `
${s.ticker} — ${s.name} | Sector: ${s.sector} | Composite score: ${s.score}/100 | Confidence: ${s.confidence}
Active signals: ${s.signals.join(' | ')}
Valuation: P/E ${pe != null ? pe.toFixed(1) + 'x' : 'N/A'} (sector median ${SECTOR_PE[s.sector]}x) | EV/EBITDA ${evE}x
Growth:    Revenue YoY ${revG}% | EPS YoY ${epsG}%
Quality:   Gross margin ${margin}% | ROE ${roe}% | D/E ${de}x
Technicals: RSI ${rsi != null ? rsi.toFixed(1) : 'N/A'} | MACD ${macd != null ? macd.toFixed(3) : 'N/A'} | Price ${abvSMA} 50-day SMA
Analysts:  Mean price target ${s.priceTarget?.targetMean ? '$' + s.priceTarget.targetMean.toFixed(2) : 'N/A'} | Upside ${upside}`
  }).join('\n\n')

  const prompt = `You are a senior equity research analyst writing a daily quantitative brief. Today is ${today}.

A long-term growth screening model ranked 22 high-growth US stocks across Revenue Growth (primary driver — 40 pts), Profitability Trajectory (EPS growth + gross margin expansion — 25 pts), Price Momentum (RSI, MACD, SMA — 25 pts), Business Quality (ROE, leverage — 10 pts), and Analyst Consensus (price target upside + buy ratings — up to 30 pts bonus). High P/E is not penalised — a company growing 40% annually at 80x earnings is cheap relative to its growth. The goal is to identify stocks with the best chance of significant long-term appreciation. The top 3 highest-scoring stocks are shown below.

YOUR TASK: Write a grounded analytical narrative for each stock focused on long-term growth potential. You MUST:
- Cite specific numbers from the data (do not round aggressively — keep one decimal)
- Reference only what the quantitative data shows — no invented events, no news, no speculation beyond what the numbers imply
- Frame the thesis around long-term compounding potential, not near-term catalysts
- Be honest about risks even when the score is high
- Keep each whyNow to 2-3 sentences

DATA:
${stockSummaries}

Return raw JSON only (no markdown, no code fences):
{
  "date": "${today}",
  "methodology": "Long-term growth model: Revenue Growth + Profitability Trajectory + Momentum + Quality across 45 US stocks",
  "picks": [
    {
      "ticker": "TICKER",
      "name": "Full Company Name",
      "score": 72,
      "confidence": "medium",
      "whyNow": "2-3 sentences grounded in the actual numbers above.",
      "gain20in1yr": 48,
      "return10in5yr": 55,
      "pros": [
        "Specific metric-backed positive 1",
        "Specific metric-backed positive 2",
        "Specific metric-backed positive 3"
      ],
      "cons": [
        "Specific risk or weakness visible in the data",
        "A second risk or weakness"
      ],
      "keyMetrics": {
        "pe":             24.5,
        "evEbitda":       14.2,
        "revenueGrowth":  15.2,
        "epsGrowth":      18.4,
        "grossMargin":    45.1,
        "roe":            22.3,
        "debtEquity":      0.4,
        "rsi":            54.2,
        "analystUpside":  12.5
      }
    }
  ]
}

Rules:
- confidence must be one of: "low", "medium", "high"
- gain20in1yr and return10in5yr: 50 = coin flip; scores above 70 require multiple strong signals; be conservative
- keyMetrics: pe is the P/E ratio, evEbitda is EV/EBITDA, revenueGrowth/epsGrowth/grossMargin/roe are in %, debtEquity is the ratio, rsi is the RSI value, analystUpside is % upside to analyst mean target. Use null for any metric that was N/A in the data.`

  const message = await anthropic.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 2200,
    messages:   [{ role: 'user', content: prompt }],
  })

  const rawText = message.content[0].text.trim()
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '')
  const result  = JSON.parse(cleaned)

  // Attach quantitative signals from the scoring model to each pick
  result.picks = result.picks.map(pick => {
    const quant = top3.find(s => s.ticker === pick.ticker)
    return {
      ...pick,
      score:      quant?.score      ?? pick.score,
      confidence: quant?.confidence ?? pick.confidence,
      signals:    quant?.signals    ?? [],
    }
  })

  savePicksToCache(result)
  return { ...result, fromCache: false }
}
