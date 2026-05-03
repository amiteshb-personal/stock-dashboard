import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
  dangerouslyAllowBrowser: true,
})

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY
const CACHE_KEY   = 'daily_picks_v14'
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
// Candles were silently returning empty arrays for all tickers, making every
// momentum signal null. We now use a simple quote call for the current price.
//
// Scoring factors (all from verified-reliable Finnhub endpoints):
//   Analyst upside    (0–35 pts) — price target vs current price   [/stock/price-target + /quote]
//   Analyst consensus (0–20 pts) — % Buy/Strong Buy ratings        [/stock/recommendation]
//   Revenue growth    (0–25 pts) — YoY revenue growth when valid   [/stock/metric]
//   Gross margin      (0–12 pts) — pricing power / scalability     [/stock/metric]
//   ROE               (0–8 pts)  — capital efficiency              [/stock/metric]
//
// Total max: 100 pts (all factors firing).

function scoreStock({ metrics: m, currentPrice, priceTarget, rec }) {
  const signals = []
  let score = 0

  // ── Factor 1: Analyst price target upside (0–35 pts) ──────────────────────
  if (priceTarget?.targetMean && currentPrice && currentPrice > 0) {
    const upside = (priceTarget.targetMean - currentPrice) / currentPrice * 100
    if      (upside > 40) { score += 35; signals.push(`Analyst mean target +${upside.toFixed(0)}% upside`) }
    else if (upside > 25) { score += 28; signals.push(`Analyst mean target +${upside.toFixed(0)}% upside`) }
    else if (upside > 15) { score += 18; signals.push(`Analyst mean target +${upside.toFixed(0)}% upside`) }
    else if (upside > 5)  { score += 8  }
    else if (upside < 0)  { score -= 8; signals.push('Analyst target below current price') }
  }

  // ── Factor 2: Analyst buy consensus (0–20 pts) ────────────────────────────
  if (rec?.strongBuy != null) {
    const total   = (rec.strongBuy||0) + (rec.buy||0) + (rec.hold||0) + (rec.sell||0) + (rec.strongSell||0)
    const bullish = total > 0 ? ((rec.strongBuy||0) + (rec.buy||0)) / total : 0
    if      (bullish > 0.80) { score += 20; signals.push(`${(bullish*100).toFixed(0)}% of analysts rate Buy/Strong Buy`) }
    else if (bullish > 0.65) { score += 14; signals.push(`${(bullish*100).toFixed(0)}% of analysts rate Buy/Strong Buy`) }
    else if (bullish > 0.50) { score += 7  }
    else if (bullish < 0.30) { score -= 5; signals.push('Weak analyst consensus — <30% Buy ratings') }
  }

  // ── Factor 3: Revenue growth (0–25 pts) ───────────────────────────────────
  const revG = sanitiseGrowth(m.revenueGrowthTTMYoy ?? null, m.revenueGrowth3Y ?? null, { epsCap: 1.5 })
  if (revG != null) {
    const pct = revG * 100
    if      (pct > 40) { score += 25; signals.push(`Revenue growth ${pct.toFixed(1)}% YoY — hypergrowth`) }
    else if (pct > 25) { score += 20; signals.push(`Revenue growth ${pct.toFixed(1)}% YoY`) }
    else if (pct > 15) { score += 14; signals.push(`Revenue growth ${pct.toFixed(1)}% YoY`) }
    else if (pct > 7)  { score += 8  }
    else if (pct > 2)  { score += 3  }
    else if (pct < -5) { score -= 5  }
  }

  // ── Factor 4: Gross margin — pricing power & scalability (0–12 pts) ───────
  const margin = m.grossMarginTTM ?? null
  if (margin != null) {
    if      (margin > 70) { score += 12; signals.push(`Gross margin ${margin.toFixed(1)}% — exceptional pricing power`) }
    else if (margin > 55) { score += 9;  signals.push(`Gross margin ${margin.toFixed(1)}%`) }
    else if (margin > 40) { score += 5  }
    else if (margin > 25) { score += 2  }
  }

  // ── Factor 5: ROE — capital efficiency (0–8 pts) ──────────────────────────
  const roe = m.roeAnnual ?? null
  if (roe != null && roe > 0) {
    if      (roe > 25) { score += 8; signals.push(`ROE ${roe.toFixed(1)}% — strong capital returns`) }
    else if (roe > 15) { score += 5 }
    else if (roe > 5)  { score += 2 }
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
  // 4 calls per stock (metrics, quote, priceTarget, rec) in parallel, 4.5s gap.
  // Rate budget: 4 × 22 = 88 calls over 22×4.5s ≈ 99s → ~53 calls/min ✓
  // Quote replaces candles — candles returned empty arrays for all tickers,
  // causing all momentum/price signals to be null.
  const stockData = []
  for (const stock of UNIVERSE) {
    try {
      const [metrics, currentPrice, priceTarget, rec] = await Promise.all([
        fetchMetrics(stock.ticker),
        fetchQuote(stock.ticker),
        fetchPriceTarget(stock.ticker),
        fetchRecommendation(stock.ticker),
      ])
      if (Object.keys(metrics).length > 5 || currentPrice) {
        stockData.push({ ...stock, metrics, currentPrice, priceTarget, rec })
      }
    } catch { /* silently skip */ }
    await sleep(4500)
  }

  if (stockData.length === 0) {
    throw new Error('No data returned from Finnhub. Check your API key or try again shortly.')
  }

  // ── Step 2: Score all stocks ──────────────────────────────────────────────
  const scored = stockData.map(stock => {
    const { score, signals } = scoreStock(stock)
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
    const upside = s.priceTarget?.targetMean && s.currentPrice
      ? ((s.priceTarget.targetMean / s.currentPrice - 1) * 100).toFixed(1) + '%'
      : 'N/A'
    const buyRatio = (() => {
      const r = s.rec
      if (!r?.strongBuy && !r?.buy) return 'N/A'
      const total = (r.strongBuy||0)+(r.buy||0)+(r.hold||0)+(r.sell||0)+(r.strongSell||0)
      return total > 0 ? ((((r.strongBuy||0)+(r.buy||0))/total)*100).toFixed(0)+'%' : 'N/A'
    })()

    return `
${s.ticker} — ${s.name} | Sector: ${s.sector} | Score: ${s.score}/100 | Confidence: ${s.confidence}
Signals: ${s.signals.join(' | ')}
Valuation:  P/E ${pe != null ? pe.toFixed(1)+'x' : 'N/A'} | EV/EBITDA ${evE}x | Current price $${s.currentPrice?.toFixed(2) ?? 'N/A'}
Growth:     Revenue YoY ${revG}% | EPS YoY ${epsG}%
Quality:    Gross margin ${margin}% | ROE ${roe}% | D/E ${de}x
Analysts:   Mean target $${s.priceTarget?.targetMean?.toFixed(2) ?? 'N/A'} | Upside ${upside} | Buy ratio ${buyRatio}`
  }).join('\n\n')

  const prompt = `You are a senior equity research analyst writing a daily quantitative brief. Today is ${today}.

A long-term growth screening model ranked 22 high-growth US stocks on: Analyst Price Target Upside (35 pts), Analyst Buy Consensus (20 pts), Revenue Growth (25 pts), Gross Margin (12 pts), and ROE (8 pts). High P/E is not penalised — the goal is identifying stocks with the best chance of significant long-term appreciation. The top 3 highest-scoring stocks are shown below.

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
  "methodology": "Long-term growth model: Analyst Upside + Buy Consensus + Revenue Growth + Gross Margin + ROE across 22 high-growth US stocks",
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
