import Anthropic from '@anthropic-ai/sdk'

// ── Anthropic client ───────────────────────────────────────────────────────
// dangerouslyAllowBrowser is required when calling the API from a browser.
// Fine for local development — in a production app you'd call a backend proxy
// instead of putting the API key in the browser bundle.
const anthropic = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
  dangerouslyAllowBrowser: true,
})

// ── Helper: call Claude and return structured analysis ─────────────────────
export async function analyzeStock({ stock, news, chartData }) {
  // Build a 30-day trend summary from chart data
  let trendText = 'No chart data available.'
  if (chartData && chartData.length >= 2) {
    const first = chartData[0].price
    const last  = chartData[chartData.length - 1].price
    const pct   = (((last - first) / first) * 100).toFixed(1)
    const dir   = last >= first ? 'up' : 'down'
    trendText   = `Price moved ${dir} ${Math.abs(pct)}% over the past 30 days ($${first.toFixed(2)} → $${last.toFixed(2)})`
  }

  // Format headlines for the prompt (skip if none loaded yet)
  const headlineText = news.length > 0
    ? news.map((n, i) => `${i + 1}. ${n.headline} (${n.source})`).join('\n')
    : 'No recent headlines available.'

  const prompt = `You are a financial data analyst providing brief, factual stock analysis for educational purposes.

Stock: ${stock.ticker} — ${stock.name}
Current Price: $${stock.price}
Today: ${stock.change >= 0 ? '+' : ''}${stock.change} (${stock.changePercent >= 0 ? '+' : ''}${stock.changePercent}%)
30-day trend: ${trendText}

Recent headlines:
${headlineText}

Respond with a JSON object only — no markdown, no code fences, just raw JSON:
{
  "sentiment": "Bullish" or "Bearish" or "Neutral",
  "signal": "Buy" or "Sell" or "Hold",
  "summary": "2-3 sentences combining the price action and news sentiment",
  "keyPoints": ["point 1", "point 2", "point 3"]
}`

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  })

  // Parse the JSON Claude returns.
  // Strip markdown code fences (```json ... ```) in case the model adds them anyway.
  const raw = message.content[0].text.trim()
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '')
  return JSON.parse(json)
}

// ── AIAnalysis display component ───────────────────────────────────────────
function AIAnalysis({ analysis, loading, error }) {
  if (loading) {
    return (
      <div className="news-loading" style={{ padding: '1rem 0' }}>
        <div className="news-spinner"></div>
        <span>Analyzing with Claude...</span>
      </div>
    )
  }

  if (error) {
    return <p className="news-error">{error}</p>
  }

  if (!analysis) {
    return <p className="news-empty">Click the AI tab to run analysis.</p>
  }

  const sentimentColor = {
    Bullish: '#22c55e',
    Bearish: '#ef4444',
    Neutral: '#94a3b8',
  }[analysis.sentiment] ?? '#94a3b8'

  const signalColor = {
    Buy:  '#22c55e',
    Sell: '#ef4444',
    Hold: '#f59e0b',
  }[analysis.signal] ?? '#94a3b8'

  return (
    <div className="ai-analysis">
      {/* Badges row */}
      <div className="ai-badges">
        <span className="ai-badge" style={{ color: sentimentColor, borderColor: sentimentColor, background: `${sentimentColor}18` }}>
          {analysis.sentiment}
        </span>
        <span className="ai-badge" style={{ color: signalColor, borderColor: signalColor, background: `${signalColor}18` }}>
          {analysis.signal}
        </span>
      </div>

      {/* Summary */}
      <p className="ai-summary">{analysis.summary}</p>

      {/* Key points */}
      <ul className="ai-key-points">
        {analysis.keyPoints.map((point, i) => (
          <li key={i} className="ai-point">
            <span className="ai-bullet">→</span>
            {point}
          </li>
        ))}
      </ul>

      {/* Disclaimer */}
      <p className="ai-disclaimer">
        AI-generated analysis for educational purposes only. Not financial advice.
        Powered by Claude (Haiku 4.5).
      </p>
    </div>
  )
}

export default AIAnalysis
