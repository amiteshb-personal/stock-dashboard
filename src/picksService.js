import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
  dangerouslyAllowBrowser: true,
})

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY
const CACHE_KEY   = 'daily_picks_v15'
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

// Returns the current price from Finnhub's real-time quote endpoint.
// This replaces the candle fetch — candles were unreliable on the free tier
// (returning no_data for major tickers), causing all momentum signals to be null.
async function fetchQuote(ticker) {
  try {
    const url  = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`
    const res  = await fetch(url)
    const data = await res.json()
    return (data.c && data.c > 0) ? data.c : null  // c = current price
  } catch {
    return null
  }
}

// Returns last 4 quarterly earnings (actual vs estimate) for beat-rate scoring.
// This is a genuine forward-looking quality signal — consistent earners beat shorts.
async function fetchEarnings(ticker) {
  try {
    const url  = `https://finnhub.io/api/v1/stock/earnings?symbol=${ticker}&token=${FINNHUB_KEY}`
    const res  = await fetch(url)
    const data = await res.json()
    return Array.isArray(data) ? data.slice(0, 4) : []
  } catch {
    return []
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

// ── Scoring: built only on data Finnhub free tier reliably returns ────────────
//
// v15 scoring — replaced dead price-target factor (targetMean always null on
// free tier) with two reliable signals:
//   52-week range position  (0-25 pts) — trend/momentum via existing quote+metric data
//   Earnings beat rate      (0-20 pts) — execution quality, last 4 quarters
//
// Final factor weights:
//   52-week range position  (0–25 pts) — momentum / trend strength      [/quote + /metric]
//   Analyst consensus       (0–25 pts) — % Buy/Strong Buy ratings       [/stock/recommendation]
//   Earnings beat rate      (0–20 pts) — beat estimate last 4 quarters  [/stock/earnings]
//   Revenue growth          (0–18 pts) — YoY revenue growth when valid  [/stock/metric]
//   Gross margin            (0–12 pts) — pricing power / scalability    [/stock/metric]
//
// Total max: 100 pts.  Stocks with strong momentum + analyst backing + earnings
// execution should reach 65-80 pts and qualify for "high" confidence.

function scoreStock({ metrics: m, currentPrice, earnings, rec }) {
  const signals = []
  let score = 0

  // ── Factor 1: 52-week range position (0–25 pts) ───────────────────────────
  // Where the stock sits in its 52-week hi/lo range is a clean momentum signal.
  // High position = institutional accumulation + trend intact.
  // No extra API calls — 52WeekHigh / 52WeekLow come from /stock/metric.
  const hi52 = m['52WeekHigh'] ?? null
  const lo52 = m['52WeekLow']  ?? null
  if (hi52 && lo52 && currentPrice && hi52 > lo52) {
    const rangePos = (currentPrice - lo52) / (hi52 - lo52)  // 0 = at lows, 1 = at highs
    if      (rangePos >= 0.80) { score += 25; signals.push(`Trading near 52-week high (${(rangePos*100).toFixed(0)}% of range) — strong uptrend`) }
    else if (rangePos >= 0.60) { score += 18; signals.push(`Strong momentum — ${(rangePos*100).toFixed(0)}% of 52-week range`) }
    else if (rangePos >= 0.45) { score += 10 }
    else if (rangePos >= 0.25) { score += 3  }
    else                       { score -= 3; signals.push('Near 52-week lows — weak price action') }
  }

  // ── Factor 2: Analyst buy consensus (0–25 pts) ────────────────────────────
  // More granular tiers vs v14 to better distinguish 95% vs 75% buy ratios.
  if (rec?.strongBuy != null) {
    const total   = (rec.strongBuy||0) + (rec.buy||0) + (rec.hold||0) + (rec.sell||0) + (rec.strongSell||0)
    const bullish = total > 0 ? ((rec.strongBuy||0) + (rec.buy||0)) / total : 0
    if      (bullish >= 0.90) { score += 25; signals.push(`${(bullish*100).toFixed(0)}% of analysts rate Buy/Strong Buy`) }
    else if (bullish >= 0.80) { score += 20; signals.push(`${(bullish*100).toFixed(0)}% of analysts rate Buy/Strong Buy`) }
    else if (bullish >= 0.70) { score += 14; signals.push(`${(bullish*100).toFixed(0)}% of analysts rate Buy/Strong Buy`) }
    else if (bullish >= 0.55) { score += 7  }
    else if (bullish < 0.30)  { score -= 5; signals.push('Weak analyst consensus — <30% Buy ratings') }
  }

  // ── Factor 3: Earnings beat rate (0–20 pts) ───────────────────────────────
  // Companies that consistently beat expectations demonstrate execution quality.
  // Last 4 quarters: actual > estimate = beat.
  if (earnings && earnings.length > 0) {
    const valid = earnings.filter(e => e.actual != null && e.estimate != null)
    if (valid.length >= 2) {
      const beats = valid.filter(e => e.actual > e.estimate).length
      const rate  = beats / valid.length
      if      (rate === 1.0 && valid.length >= 3) { score += 20; signals.push(`Beat earnings estimates ${beats}/${valid.length} quarters`) }
      else if (rate >= 0.75)                       { score += 14; signals.push(`Beat earnings estimates ${beats}/${valid.length} quarters`) }
      else if (rate >= 0.50)                       { score += 7  }
      else if (rate < 0.25 && valid.length >= 3)  { score -= 5; signals.push(`Missed earnings estimates ${valid.length - beats}/${valid.length} quarters`) }
    }
  }

  // ── Factor 4: Revenue growth (0–18 pts) ───────────────────────────────────
  const revG = sanitiseGrowth(m.revenueGrowthTTMYoy ?? null, m.revenueGrowth3Y ?? null, { epsCap: 1.5 })
  if (revG != null) {
    const pct = revG * 100
    if      (pct > 40) { score += 18; signals.push(`Revenue growth ${pct.toFixed(1)}% YoY — hypergrowth`) }
    else if (pct > 25) { score += 14; signals.push(`Revenue growth ${pct.toFixed(1)}% YoY`) }
    else if (pct > 15) { score += 10; signals.push(`Revenue growth ${pct.toFixed(1)}% YoY`) }
    else if (pct > 7)  { score += 5  }
    else if (pct > 2)  { score += 2  }
    else if (pct < -5) { score -= 5  }
  }

  // ── Factor 5: Gross margin — pricing power & scalability (0–12 pts) ───────
  const margin = m.grossMarginTTM ?? null
  if (margin != null) {
    if      (margin > 70) { score += 12; signals.push(`Gross margin ${margin.toFixed(1)}% — exceptional pricing power`) }
    else if (margin > 55) { score += 9;  signals.push(`Gross margin ${margin.toFixed(1)}%`) }
    else if (margin > 40) { score += 5  }
    else if (margin > 25) { score += 2  }
  }

  return { score: Math.round(Math.max(0, score)), signals }
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

  // ── Step 1: Fetch all data per stock in one sequential loop ──────────────────
  // 5 calls per stock (metrics, quote, earnings, rec + spare) in parallel, 5.5s gap.
  // Rate budget: 5 × 22 = 110 calls over 22×5.5s = 121s → ~54 calls/min ✓ (limit: 60/min)
  // priceTarget dropped — targetMean always null on Finnhub free tier.
  // earnings added — consistent earnings beats are a reliable execution signal.
  const stockData = []
  for (const stock of UNIVERSE) {
    try {
      const [metrics, currentPrice, earnings, rec] = await Promise.all([
        fetchMetrics(stock.ticker),
        fetchQuote(stock.ticker),
        fetchEarnings(stock.ticker),
        fetchRecommendation(stock.ticker),
      ])
      if (Object.keys(metrics).length > 5 || currentPrice) {
        stockData.push({ ...stock, metrics, currentPrice, earnings, rec })
      }
    } catch { /* silently skip */ }
    await sleep(5500)
  }

  if (stockData.length === 0) {
    throw new Error('No data returned from Finnhub. Check your API key or try again shortly.')
  }

  // ── Step 2: Score all stocks ──────────────────────────────────────────────
  const scored = stockData.map(stock => {
    const { score, signals } = scoreStock({ metrics: stock.metrics, currentPrice: stock.currentPrice, earnings: stock.earnings, rec: stock.rec })
    const confidence = deriveConfidence(score, signals.length)
    console.log(`[picks] ${stock.ticker}: score=${score} signals=${signals.join(' | ')}`)
    return { ...stock, score, signals, confidence }
  })
  scored.sort((a, b) => b.score - a.score)
  console.log('[picks] ranking:', scored.map(s => `${s.ticker}:${s.score}`).join(' '))
  const top3 = scored.slice(0, 3)

  // ── Step 5: Build data snapshot for Claude's narrative pass ───────────────
  const today = new Date().toISOString().split('T')[0]

  const stockSummaries = top3.map(s => {
    const m    = s.metrics
    const pe   = (m.peBasicExclExtraTTM ?? m.peTTM ?? null)
    const _revG = sanitiseGrowth(m.revenueGrowthTTMYoy ?? null, m.revenueGrowth3Y ?? null, { epsCap: 1.5 })
    const _epsG = sanitiseGrowth(m.epsGrowthTTMYoy ?? null, m.epsGrowthTTMYoy3Y ?? m.epsGrowth3Y ?? null, { epsCap: 3.0 })
    const revG  = _revG != null ? (_revG * 100).toFixed(1) : 'N/A'
    const epsG  = _epsG != null ? (_epsG * 100).toFixed(1) : 'N/A'
    const margin = m.grossMarginTTM          != null ? m.grossMarginTTM.toFixed(1)          : 'N/A'
    const roe    = m.roeAnnual               != null ? m.roeAnnual.toFixed(1)               : 'N/A'
    const de     = m.totalDebtToEquityAnnual != null ? m.totalDebtToEquityAnnual.toFixed(2) : 'N/A'
    const evE    = m.evEbitdaTTM             != null ? m.evEbitdaTTM.toFixed(1)             : 'N/A'
    const buyRatio = (() => {
      const r = s.rec
      if (!r?.strongBuy && !r?.buy) return 'N/A'
      const total = (r.strongBuy||0)+(r.buy||0)+(r.hold||0)+(r.sell||0)+(r.strongSell||0)
      return total > 0 ? ((((r.strongBuy||0)+(r.buy||0))/total)*100).toFixed(0)+'%' : 'N/A'
    })()
    const hi52 = s.metrics['52WeekHigh']
    const lo52 = s.metrics['52WeekLow']
    const rangePos = (hi52 && lo52 && s.currentPrice && hi52 > lo52)
      ? ((s.currentPrice - lo52) / (hi52 - lo52) * 100).toFixed(0) + '%'
      : 'N/A'
    const earningsBeat = (() => {
      const e = (s.earnings || []).filter(q => q.actual != null && q.estimate != null)
      if (e.length < 2) return 'N/A'
      const beats = e.filter(q => q.actual > q.estimate).length
      return `${beats}/${e.length} beats`
    })()

    return `
${s.ticker} — ${s.name} | Sector: ${s.sector} | Score: ${s.score}/100 | Confidence: ${s.confidence}
Signals: ${s.signals.join(' | ')}
Valuation:  P/E ${pe != null ? pe.toFixed(1)+'x' : 'N/A'} | EV/EBITDA ${evE}x | Current price $${s.currentPrice?.toFixed(2) ?? 'N/A'}
Growth:     Revenue YoY ${revG}% | EPS YoY ${epsG}%
Quality:    Gross margin ${margin}% | ROE ${roe}% | D/E ${de}x
Momentum:   52-week range position ${rangePos} | Earnings beats ${earningsBeat}
Analysts:   Buy ratio ${buyRatio}`
  }).join('\n\n')

  const prompt = `You are a senior equity research analyst writing a daily quantitative brief. Today is ${today}.

A long-term growth screening model ranked 22 high-growth US stocks on: 52-Week Range Position (25 pts, measures trend/momentum), Analyst Buy Consensus (25 pts), Earnings Beat Rate (20 pts, execution quality), Revenue Growth (18 pts), and Gross Margin (12 pts). High P/E is not penalised — the goal is identifying stocks with the best chance of significant long-term appreciation. The top 3 highest-scoring stocks are shown below.

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
  "methodology": "Long-term growth model: 52-Week Momentum + Analyst Consensus + Earnings Beat Rate + Revenue Growth + Gross Margin across 22 high-growth US stocks",
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
        "rsi":            null,
        "analystUpside":  null
      }
    }
  ]
}

Rules:
- confidence must be one of: "low", "medium", "high"
- gain20in1yr and return10in5yr: 50 = coin flip; scores above 70 require multiple strong signals; be conservative
- keyMetrics: pe is the P/E ratio, evEbitda is EV/EBITDA, revenueGrowth/epsGrowth/grossMargin/roe are in %, debtEquity is the ratio, rsi and analystUpside are not available from this data source so set both to null. Use null for any metric that was N/A in the data.`

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
