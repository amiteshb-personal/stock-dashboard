import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
  dangerouslyAllowBrowser: true,
})

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY
const CACHE_KEY   = 'daily_picks_v1'
const CACHE_TTL   = 24 * 60 * 60 * 1000  // 24 hours

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

async function fetchMarketNews() {
  const url = `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`
  const res  = await fetch(url)
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error('Could not load market news from Finnhub.')
  // Take the 50 most recent headlines with short summaries
  return data.slice(0, 50).map(item => ({
    headline: item.headline,
    source:   item.source,
    summary:  item.summary ? item.summary.slice(0, 180) : '',
    related:  item.related,
  }))
}

export async function getDailyPicks(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = loadPicksFromCache()
    if (cached) return { ...cached, fromCache: true }
  }

  const news = await fetchMarketNews()

  const headlineText = news.map((n, i) =>
    `${i + 1}. [${n.source}] ${n.headline}` +
    (n.related ? ` (${n.related})` : '') +
    (n.summary ? ` — ${n.summary}` : '')
  ).join('\n')

  const today = new Date().toISOString().split('T')[0]

  const prompt = `You are a senior equity research analyst. Today is ${today}.

Analyze the following recent financial headlines and identify exactly 3 publicly traded US stocks receiving notably positive news coverage AND showing genuine fundamental support.

The 3 stocks do NOT need to be from any particular list — pick the most compelling ones regardless of size. Smaller high-momentum companies are fine.

HEADLINES:
${headlineText}

For each stock provide honest probability scores 0–100:
- "gain20in1yr": probability of gaining 20%+ in the next 12 months
- "return10in5yr": probability of 10%+ annualized return over 5 years

Scoring calibration: 50 = coin flip. Most scores should land 30–65. Only go above 70 if the evidence is genuinely exceptional. Be conservative — overconfident scores are worse than honest uncertain ones.

Respond with raw JSON only (no markdown, no code fences):
{
  "date": "${today}",
  "sourceSummary": "One sentence describing today's overall market mood from these headlines",
  "newsCount": ${news.length},
  "picks": [
    {
      "ticker": "TICKER",
      "name": "Full Company Name",
      "whyNow": "2-3 sentences explaining why this stock stands out in today's news",
      "gain20in1yr": 52,
      "return10in5yr": 61,
      "pros": ["pro 1", "pro 2", "pro 3"],
      "cons": ["con 1", "con 2"],
      "confidence": "low"
    }
  ]
}

confidence must be exactly one of: "low", "medium", "high"`

  const message = await anthropic.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 1400,
    messages:   [{ role: 'user', content: prompt }],
  })

  const raw  = message.content[0].text.trim()
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '')
  const result = JSON.parse(json)

  savePicksToCache(result)
  return { ...result, fromCache: false }
}
