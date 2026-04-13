import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
  dangerouslyAllowBrowser: true,
})

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY
const CACHE_KEY   = 'daily_picks_v6'
const CACHE_TTL   = 24 * 60 * 60 * 1000  // 24 hours

// ── Universe: 30 large-cap US stocks across 7 sectors ────────────────────────
const UNIVERSE = [
  { ticker: 'AAPL',  name: 'Apple Inc.',              sector: 'Technology'  },
  { ticker: 'MSFT',  name: 'Microsoft Corp.',          sector: 'Technology'  },
  { ticker: 'GOOGL', name: 'Alphabet Inc.',            sector: 'Technology'  },
  { ticker: 'META',  name: 'Meta Platforms',           sector: 'Technology'  },
  { ticker: 'NVDA',  name: 'NVIDIA Corp.',             sector: 'Technology'  },
  { ticker: 'AMD',   name: 'Advanced Micro Devices',   sector: 'Technology'  },
  { ticker: 'ORCL',  name: 'Oracle Corp.',             sector: 'Technology'  },
  { ticker: 'CRM',   name: 'Salesforce Inc.',          sector: 'Technology'  },
  { ticker: 'JPM',   name: 'JPMorgan Chase',           sector: 'Finance'     },
  { ticker: 'BAC',   name: 'Bank of America',          sector: 'Finance'     },
  { ticker: 'GS',    name: 'Goldman Sachs',            sector: 'Finance'     },
  { ticker: 'V',     name: 'Visa Inc.',                sector: 'Finance'     },
  { ticker: 'MA',    name: 'Mastercard Inc.',          sector: 'Finance'     },
  { ticker: 'UNH',   name: 'UnitedHealth Group',       sector: 'Healthcare'  },
  { ticker: 'LLY',   name: 'Eli Lilly & Co.',          sector: 'Healthcare'  },
  { ticker: 'ABBV',  name: 'AbbVie Inc.',              sector: 'Healthcare'  },
  { ticker: 'MRK',   name: 'Merck & Co.',              sector: 'Healthcare'  },
  { ticker: 'TMO',   name: 'Thermo Fisher Scientific', sector: 'Healthcare'  },
  { ticker: 'JNJ',   name: 'Johnson & Johnson',        sector: 'Healthcare'  },
  { ticker: 'WMT',   name: 'Walmart Inc.',             sector: 'Consumer'    },
  { ticker: 'COST',  name: 'Costco Wholesale',         sector: 'Consumer'    },
  { ticker: 'HD',    name: 'Home Depot Inc.',          sector: 'Consumer'    },
  { ticker: 'KO',    name: 'Coca-Cola Co.',            sector: 'Consumer'    },
  { ticker: 'PG',    name: 'Procter & Gamble',         sector: 'Consumer'    },
  { ticker: 'XOM',   name: 'ExxonMobil Corp.',         sector: 'Energy'      },
  { ticker: 'CVX',   name: 'Chevron Corp.',            sector: 'Energy'      },
  { ticker: 'COP',   name: 'ConocoPhillips',           sector: 'Energy'      },
  { ticker: 'CAT',   name: 'Caterpillar Inc.',         sector: 'Industrial'  },
  { ticker: 'HON',   name: 'Honeywell International',  sector: 'Industrial'  },
  { ticker: 'NFLX',  name: 'Netflix Inc.',             sector: 'Media'       },
]

// Sector-typical P/E medians used for relative valuation scoring
const SECTOR_PE = {
  Technology:  28,
  Finance:     14,
  Healthcare:  22,
  Consumer:    24,
  Energy:      12,
  Industrial:  20,
  Media:       25,
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

// Returns array of closing prices (up to 150 trading days)
async function fetchCandles(ticker) {
  const to   = Math.floor(Date.now() / 1000)
  const from = to - 220 * 24 * 60 * 60  // 220 calendar days ≈ 150 trading days
  try {
    const url  = `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`
    const res  = await fetch(url)
    const data = await res.json()
    if (data.s !== 'ok' || !Array.isArray(data.c) || data.c.length < 26) return []
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

// ── Multi-factor scoring (0–100) ──────────────────────────────────────────────
// Four equal factors of 25 pts each:
//   Valuation   — P/E vs sector, EV/EBITDA, 52-week position
//   Growth      — revenue YoY, EPS YoY
//   Momentum    — RSI zone, MACD, price vs SMA50
//   Quality     — gross margin, ROE, leverage
//
// Finnhub metric field conventions:
//   peBasicExclExtraTTM  → P/E (trailing 12 months)
//   evEbitdaTTM          → EV/EBITDA
//   revenueGrowthTTMYoy  → Revenue growth YoY (decimal: 0.15 = 15%)
//   epsGrowthTTMYoy      → EPS growth YoY (decimal)
//   grossMarginTTM       → Gross margin (percentage: 45 = 45%)
//   roeAnnual            → Return on equity (percentage)
//   totalDebtToEquityAnnual → D/E ratio
//   52WeekHigh / 52WeekLow  → 52-week price range

function scoreStock({ ticker, sector, metrics: m, closes }) {
  const signals = []
  let score = 0

  const currentPrice = closes.length > 0 ? closes[closes.length - 1] : null

  // ── Factor 1: Valuation (0–25 pts) ───────────────────────────────────────
  let val = 0
  const pe       = m.peBasicExclExtraTTM ?? m.peTTM ?? null
  const evEbitda = m.evEbitdaTTM ?? null
  const high52   = m['52WeekHigh'] ?? null
  const low52    = m['52WeekLow']  ?? null

  if (pe != null && pe > 0) {
    const sectorMedian = SECTOR_PE[sector] ?? 22
    const relDiscount = (sectorMedian - pe) / sectorMedian
    if      (relDiscount > 0.25) { val += 12; signals.push(`P/E ${pe.toFixed(1)}x — >25% below sector median`) }
    else if (relDiscount > 0.10) { val += 9  }
    else if (relDiscount > 0)    { val += 6  }
    else if (relDiscount > -0.20){ val += 3  }
    // > 20% premium: 0 pts
  }
  if (evEbitda != null && evEbitda > 0) {
    if      (evEbitda < 10)  { val += 8; signals.push(`EV/EBITDA ${evEbitda.toFixed(1)}x — deep value`) }
    else if (evEbitda < 18)  { val += 5 }
    else if (evEbitda < 25)  { val += 2 }
  }
  if (currentPrice && high52 && low52 && high52 > low52) {
    const position = (currentPrice - low52) / (high52 - low52)
    if      (position < 0.25) { val += 5; signals.push(`Price near 52-week low — potential mean-reversion setup`) }
    else if (position < 0.45) { val += 3 }
    else if (position > 0.90) { val -= 2 }  // near 52-week high is slightly negative for valuation
  }
  score += Math.max(0, Math.min(val, 25))

  // ── Factor 2: Growth (0–25 pts) ───────────────────────────────────────────
  let growth = 0
  const revG = m.revenueGrowthTTMYoy ?? null  // decimal: 0.15 = 15%
  const epsG = m.epsGrowthTTMYoy ?? null

  if (revG != null) {
    const pct = revG * 100
    if      (pct > 25) { growth += 12; signals.push(`Revenue growth ${pct.toFixed(1)}% YoY`) }
    else if (pct > 15) { growth += 9  }
    else if (pct > 7)  { growth += 6  }
    else if (pct > 2)  { growth += 3  }
    else if (pct < -5) { growth -= 3  }  // shrinking revenue is negative
  }
  if (epsG != null) {
    const pct = epsG * 100
    if      (pct > 30) { growth += 13; signals.push(`EPS growth ${pct.toFixed(1)}% YoY`) }
    else if (pct > 20) { growth += 9  }
    else if (pct > 10) { growth += 6  }
    else if (pct > 3)  { growth += 3  }
    else if (pct < -10){ growth -= 3  }
  }
  score += Math.max(0, Math.min(growth, 25))

  // ── Factor 3: Momentum (0–25 pts) ─────────────────────────────────────────
  let mom = 0
  const rsi   = calcRSI(closes)
  const { macd, crossedAboveZero } = calcMACD(closes)
  const sma50 = calcSMA(closes, 50)

  if (rsi != null) {
    if      (rsi >= 50 && rsi <= 65)  { mom += 10; signals.push(`RSI ${rsi.toFixed(1)} — healthy upward momentum`) }
    else if (rsi >= 40 && rsi <  50)  { mom += 7  }
    else if (rsi >= 30 && rsi <  40)  { mom += 4  }
    else if (rsi >= 65 && rsi <= 72)  { mom += 5  }
    else if (rsi  > 25 && rsi <  30)  { mom += 3; signals.push(`RSI ${rsi.toFixed(1)} — oversold, bounce potential`) }
    // RSI > 72 (overbought) or < 25 (potential breakdown): 0 pts
  }
  if (crossedAboveZero)              { mom += 8; signals.push('MACD bullish zero-line crossover') }
  else if (macd != null && macd > 0) { mom += 4; signals.push('MACD positive') }
  if (currentPrice && sma50 != null) {
    if (currentPrice > sma50 * 1.02)       { mom += 7; signals.push(`Price ${((currentPrice/sma50 - 1)*100).toFixed(1)}% above 50-day SMA`) }
    else if (currentPrice > sma50 * 0.99)  { mom += 3 }
    // below SMA50: 0 pts
  }
  score += Math.max(0, Math.min(mom, 25))

  // ── Factor 4: Quality (0–25 pts) ──────────────────────────────────────────
  let qual = 0
  const margin = m.grossMarginTTM ?? null          // percentage (e.g. 45 for 45%)
  const roe    = m.roeAnnual ?? null               // percentage
  const de     = m.totalDebtToEquityAnnual ?? null // ratio

  if (margin != null) {
    if      (margin > 55) { qual += 10; signals.push(`Gross margin ${margin.toFixed(1)}%`) }
    else if (margin > 40) { qual += 7  }
    else if (margin > 25) { qual += 4  }
    else if (margin > 10) { qual += 2  }
  }
  if (roe != null && roe > 0) {
    if      (roe > 25) { qual += 10; signals.push(`ROE ${roe.toFixed(1)}%`) }
    else if (roe > 15) { qual += 7  }
    else if (roe > 8)  { qual += 4  }
    else if (roe > 3)  { qual += 2  }
  }
  if (de != null) {
    if      (de < 0.3) { qual += 5; signals.push('Low financial leverage (D/E < 0.3x)') }
    else if (de < 0.8) { qual += 3 }
    else if (de < 1.5) { qual += 1 }
    else if (de > 3.0) { qual -= 2 }  // high leverage is a risk flag
  }
  score += Math.max(0, Math.min(qual, 25))

  return { score: Math.round(Math.max(0, Math.min(score, 100))), signals, currentPrice }
}

// ── Analyst overlay (up to +10 pts bonus) ─────────────────────────────────────
function analystBonus(priceTarget, rec, currentPrice) {
  let bonus = 0
  const bonusSignals = []

  if (priceTarget?.targetMean && currentPrice && currentPrice > 0) {
    const upside = (priceTarget.targetMean - currentPrice) / currentPrice
    if      (upside > 0.25) { bonus += 5; bonusSignals.push(`Analyst mean target +${(upside * 100).toFixed(0)}% upside`) }
    else if (upside > 0.12) { bonus += 3 }
    else if (upside > 0.03) { bonus += 1 }
  }
  if (rec?.strongBuy != null) {
    const total   = (rec.strongBuy || 0) + (rec.buy || 0) + (rec.hold || 0) + (rec.sell || 0) + (rec.strongSell || 0)
    const bullish = total > 0 ? ((rec.strongBuy || 0) + (rec.buy || 0)) / total : 0
    if      (bullish > 0.75) { bonus += 5; bonusSignals.push(`${(bullish * 100).toFixed(0)}% of analysts rate Buy/Strong Buy`) }
    else if (bullish > 0.55) { bonus += 3 }
    else if (bullish > 0.40) { bonus += 1 }
  }

  return { bonus: Math.min(bonus, 10), bonusSignals }
}

// ── Confidence: how much data-driven signal is behind the score ───────────────
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

  // ── Step 1: Fetch metrics + candles for all 30 stocks ─────────────────────
  // Finnhub free tier: 60 calls/min.
  // We fetch 2 calls per stock (metrics + candles) sequentially,
  // with a 2.1-second gap between stocks → ~57 calls/min, safely within limit.
  const stockData = []
  for (const stock of UNIVERSE) {
    try {
      const [metrics, closes] = await Promise.all([
        fetchMetrics(stock.ticker),
        fetchCandles(stock.ticker),
      ])
      if (closes.length >= 26) {   // need at least 26 closes for MACD
        stockData.push({ ...stock, metrics, closes })
      }
    } catch {
      // silently skip stocks that fail
    }
    await sleep(2100)
  }

  if (stockData.length < 3) {
    throw new Error('Insufficient data from Finnhub. Check your API key or try again shortly.')
  }

  // ── Step 2: Score every stock ──────────────────────────────────────────────
  const scored = stockData.map(stock => {
    const { score, signals, currentPrice } = scoreStock(stock)
    return { ...stock, score, signals, currentPrice }
  })
  scored.sort((a, b) => b.score - a.score)
  const top5 = scored.slice(0, 5)

  // ── Step 3: Fetch analyst data for top 5 only (10 calls, fast) ────────────
  const analystData = await Promise.allSettled(top5.map(async stock => {
    const [priceTarget, rec] = await Promise.all([
      fetchPriceTarget(stock.ticker),
      fetchRecommendation(stock.ticker),
    ])
    return { ticker: stock.ticker, priceTarget, rec }
  }))
  const analystMap = {}
  analystData.forEach(r => {
    if (r.status === 'fulfilled') analystMap[r.value.ticker] = r.value
  })

  // ── Step 4: Re-score top 5 with analyst bonus, select top 3 ───────────────
  const finalTop5 = top5.map(stock => {
    const a = analystMap[stock.ticker] ?? {}
    const { bonus, bonusSignals } = analystBonus(a.priceTarget, a.rec, stock.currentPrice)
    const totalScore = Math.min(stock.score + bonus, 100)
    const allSignals = [...stock.signals, ...bonusSignals]
    const confidence = deriveConfidence(totalScore, allSignals.length)
    return {
      ...stock,
      score:      totalScore,
      signals:    allSignals,
      confidence,
      priceTarget: a.priceTarget ?? {},
      rec:         a.rec ?? {},
    }
  })
  finalTop5.sort((a, b) => b.score - a.score)
  const top3 = finalTop5.slice(0, 3)

  // ── Step 5: Build data snapshot for Claude's narrative pass ───────────────
  const today = new Date().toISOString().split('T')[0]

  const stockSummaries = top3.map(s => {
    const m      = s.metrics
    const pe     = (m.peBasicExclExtraTTM ?? m.peTTM ?? null)
    const revG   = m.revenueGrowthTTMYoy != null ? (m.revenueGrowthTTMYoy * 100).toFixed(1) : 'N/A'
    const epsG   = m.epsGrowthTTMYoy     != null ? (m.epsGrowthTTMYoy     * 100).toFixed(1) : 'N/A'
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

A multi-factor screening model scored 30 large-cap US stocks across Valuation (P/E vs sector median, EV/EBITDA), Growth (revenue & EPS momentum), Technical Momentum (RSI, MACD, SMA relationship), and Quality (margins, ROE, leverage). The top 3 highest-scoring stocks are shown below.

YOUR TASK: Write a grounded analytical narrative for each stock. You MUST:
- Cite specific numbers from the data (do not round aggressively — keep one decimal)
- Reference only what the quantitative data shows — no invented events, no news, no speculation beyond what the numbers imply
- Be honest about weaknesses even when the score is high
- Keep each whyNow to 2-3 sentences

DATA:
${stockSummaries}

Return raw JSON only (no markdown, no code fences):
{
  "date": "${today}",
  "methodology": "Quantitative multi-factor model: Valuation + Growth + Momentum + Quality across 30 US large-caps",
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
