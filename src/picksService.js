import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
  dangerouslyAllowBrowser: true,
})

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY
const NEWSAPI_KEY = import.meta.env.VITE_NEWSAPI_KEY
const CACHE_KEY      = 'daily_picks_v5'
const CACHE_TTL      = 24 * 60 * 60 * 1000  // 24 hours
const MAX_PER_SOURCE = 2  // cap per outlet so no single source dominates
const YAHOO_CAP      = 1  // Yahoo Finance specifically — hard cap at 1 article

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

// ── Finnhub general market news ───────────────────────────────────────────────
async function fetchFinnhubNews() {
  try {
    const url  = `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`
    const res  = await fetch(url)
    const data = await res.json()
    if (!Array.isArray(data)) return []
    return data.slice(0, 100).map(item => ({
      headline: item.headline,
      source:   item.source || 'Finnhub',
      summary:  item.summary ? item.summary.slice(0, 180) : '',
      related:  item.related || '',
    }))
  } catch {
    return []
  }
}

// ── NewsAPI business headlines ─────────────────────────────────────────────────
async function fetchNewsApiArticles() {
  if (!NEWSAPI_KEY) return []
  try {
    // Top business headlines — broad and diverse
    const url = `https://newsapi.org/v2/top-headlines?category=business&language=en&pageSize=50&apiKey=${NEWSAPI_KEY}`
    const res  = await fetch(url)
    const data = await res.json()
    if (data.status !== 'ok' || !Array.isArray(data.articles)) return []
    return data.articles.map(a => ({
      headline: a.title,
      source:   a.source?.name || 'NewsAPI',
      summary:  a.description ? a.description.slice(0, 180) : '',
      related:  '',
    }))
  } catch {
    return []
  }
}

// ── Merge, deduplicate, cap per source ────────────────────────────────────────
function mergeAndDiversify(finnhubItems, newsApiItems) {
  // Interleave so both sources are represented (Finnhub first, then NewsAPI)
  const combined = []
  const maxLen   = Math.max(finnhubItems.length, newsApiItems.length)
  for (let i = 0; i < maxLen; i++) {
    if (i < finnhubItems.length) combined.push(finnhubItems[i])
    if (i < newsApiItems.length) combined.push(newsApiItems[i])
  }

  // Cap MAX_PER_SOURCE articles per outlet and collect up to 60 diverse items
  const sourceCounts = {}
  const seen         = new Set()
  const items        = []

  for (const item of combined) {
    const src = item.source || 'Unknown'
    // Skip near-duplicate headlines
    const key = item.headline.slice(0, 60).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const isYahoo = src.toLowerCase().includes('yahoo')
    const cap     = isYahoo ? YAHOO_CAP : MAX_PER_SOURCE
    if ((sourceCounts[src] || 0) >= cap) continue
    sourceCounts[src] = (sourceCounts[src] || 0) + 1
    items.push(item)
    if (items.length >= 60) break
  }

  const sources = [...new Set(items.map(i => i.source).filter(Boolean))].sort()
  return { items, sources }
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function getDailyPicks(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = loadPicksFromCache()
    if (cached) return { ...cached, fromCache: true }
  }

  // Fetch both sources in parallel
  const [finnhubItems, newsApiItems] = await Promise.all([
    fetchFinnhubNews(),
    fetchNewsApiArticles(),
  ])

  const { items: news, sources } = mergeAndDiversify(finnhubItems, newsApiItems)

  if (news.length === 0) throw new Error('Could not load any news. Check your API keys.')

  const headlineText = news.map((n, i) =>
    `${i + 1}. [${n.source}] ${n.headline}` +
    (n.related ? ` (${n.related})` : '') +
    (n.summary ? ` — ${n.summary}` : '')
  ).join('\n')

  const today = new Date().toISOString().split('T')[0]

  const prompt = `You are a senior equity research analyst. Today is ${today}.

Analyze the following recent financial headlines from multiple news sources and identify exactly 3 publicly traded US stocks receiving notably positive coverage with genuine fundamental support.

The stocks do NOT need to be from any particular list — pick the most compelling ones regardless of size.

HEADLINES:
${headlineText}

For each stock provide honest probability scores 0–100:
- "gain20in1yr": probability of gaining 20%+ in the next 12 months
- "return10in5yr": probability of 10%+ annualized return over 5 years

Scoring calibration: 50 = coin flip. Most scores 30–65. Only exceed 70 if evidence is genuinely exceptional. Be conservative.

Respond with raw JSON only (no markdown, no code fences):
{
  "date": "${today}",
  "sourceSummary": "One sentence on today's overall market mood",
  "newsCount": ${news.length},
  "picks": [
    {
      "ticker": "TICKER",
      "name": "Full Company Name",
      "whyNow": "2-3 sentences on why this stock stands out today",
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

  const raw    = message.content[0].text.trim()
  const json   = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '')
  const result = { ...JSON.parse(json), sources }

  savePicksToCache(result)
  return { ...result, fromCache: false }
}
