// ── Score bar ─────────────────────────────────────────────────────────────────
function ScoreBar({ label, score }) {
  const color =
    score >= 60 ? '#00a86b' :
    score >= 40 ? '#d97706' :
    '#e53e3e'

  return (
    <div className="score-bar-wrap">
      <div className="score-bar-label-row">
        <span className="score-bar-label">{label}</span>
        <span className="score-bar-value" style={{ color }}>{score}%</span>
      </div>
      <div className="score-bar-track">
        <div
          className="score-bar-fill"
          style={{ width: `${score}%`, background: color }}
        />
      </div>
    </div>
  )
}

// ── Composite score badge ─────────────────────────────────────────────────────
function ScoreBadge({ score }) {
  const color =
    score >= 65 ? '#00a86b' :
    score >= 45 ? '#d97706' :
    '#e53e3e'
  return (
    <div className="composite-score-badge" style={{ borderColor: color, color }}>
      <span className="composite-score-value">{score}</span>
      <span className="composite-score-denom">/100</span>
    </div>
  )
}

// ── Key metrics strip ─────────────────────────────────────────────────────────
function MetricPill({ label, value, positive }) {
  const color = positive === true ? 'var(--green)' : positive === false ? 'var(--red)' : 'var(--text-2)'
  return (
    <div className="metric-pill">
      <span className="metric-pill-label">{label}</span>
      <span className="metric-pill-value" style={{ color }}>{value}</span>
    </div>
  )
}

function MetricsStrip({ km }) {
  if (!km) return null
  const fmt = (v, decimals = 1) => v != null ? v.toFixed(decimals) : '—'
  return (
    <div className="metrics-strip">
      {km.pe          != null && <MetricPill label="P/E"          value={`${fmt(km.pe)}x`}     />}
      {km.evEbitda    != null && <MetricPill label="EV/EBITDA"    value={`${fmt(km.evEbitda)}x`} />}
      {km.revenueGrowth != null && (
        <MetricPill
          label="Rev growth"
          value={`${fmt(km.revenueGrowth)}%`}
          positive={km.revenueGrowth > 5}
        />
      )}
      {km.epsGrowth   != null && (
        <MetricPill
          label="EPS growth"
          value={`${fmt(km.epsGrowth)}%`}
          positive={km.epsGrowth > 5}
        />
      )}
      {km.grossMargin != null && <MetricPill label="Gross margin" value={`${fmt(km.grossMargin)}%`} positive={km.grossMargin > 30} />}
      {km.roe         != null && <MetricPill label="ROE"          value={`${fmt(km.roe)}%`}      positive={km.roe > 12} />}
      {km.rsi         != null && (
        <MetricPill
          label="RSI"
          value={fmt(km.rsi)}
          positive={km.rsi >= 40 && km.rsi <= 65 ? true : km.rsi > 72 || km.rsi < 30 ? false : null}
        />
      )}
      {km.analystUpside != null && (
        <MetricPill
          label="Analyst upside"
          value={`${fmt(km.analystUpside)}%`}
          positive={km.analystUpside > 10}
        />
      )}
    </div>
  )
}

// ── Quant signals list ────────────────────────────────────────────────────────
function SignalsList({ signals }) {
  if (!signals || signals.length === 0) return null
  return (
    <div className="signals-section">
      <p className="signals-heading">Model signals</p>
      <div className="signals-list">
        {signals.map((s, i) => (
          <span key={i} className="signal-tag">{s}</span>
        ))}
      </div>
    </div>
  )
}

// ── Individual pick card ───────────────────────────────────────────────────────
function PickCard({ pick, isInWatchlist, onAdd }) {
  const confidenceColor = {
    high:   '#00a86b',
    medium: '#d97706',
    low:    '#e53e3e',
  }[pick.confidence] ?? '#aaaaaa'

  return (
    <div className="pick-card">
      {/* Header: ticker + score + confidence */}
      <div className="pick-card-top">
        <div className="pick-card-top-left">
          <span className="pick-ticker">{pick.ticker}</span>
          <span
            className="pick-confidence"
            style={{ color: confidenceColor, borderColor: confidenceColor, background: `${confidenceColor}12` }}
          >
            {pick.confidence} confidence
          </span>
        </div>
        <ScoreBadge score={pick.score} />
      </div>

      <p className="pick-name">{pick.name}</p>

      {/* Quantitative metrics strip */}
      <MetricsStrip km={pick.keyMetrics} />

      {/* Analyst narrative */}
      <p className="pick-why-now">{pick.whyNow}</p>

      {/* Model signals */}
      <SignalsList signals={pick.signals} />

      {/* Score bars */}
      <div className="pick-scores">
        <ScoreBar label="20% gain in 1 year" score={pick.gain20in1yr} />
        <ScoreBar label="10%/yr over 5 years" score={pick.return10in5yr} />
      </div>

      {/* Pros */}
      <div className="pick-pros-cons">
        <p className="pick-pros-cons-heading pick-pros-heading">Strengths</p>
        <ul className="pick-pros-cons-list">
          {pick.pros.map((p, i) => (
            <li key={i} className="pick-pro-item">
              <span className="pick-pro-icon">+</span>{p}
            </li>
          ))}
        </ul>
      </div>

      {/* Cons */}
      <div className="pick-pros-cons">
        <p className="pick-pros-cons-heading pick-cons-heading">Risks</p>
        <ul className="pick-pros-cons-list">
          {pick.cons.map((c, i) => (
            <li key={i} className="pick-con-item">
              <span className="pick-con-icon">−</span>{c}
            </li>
          ))}
        </ul>
      </div>

      {/* Add to watchlist */}
      <button
        className={`pick-add-btn ${isInWatchlist ? 'pick-add-btn-added' : ''}`}
        onClick={() => !isInWatchlist && onAdd(pick.ticker, pick.name)}
        disabled={isInWatchlist}
      >
        {isInWatchlist ? '✓ In your watchlist' : '+ Add to watchlist'}
      </button>
    </div>
  )
}

// ── Main DailyPicks component ─────────────────────────────────────────────────
function DailyPicks({ picks, loading, error, fromCache, onRefresh, watchlist, onAddToWatchlist }) {
  function formatDate(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  }

  return (
    <section className="daily-picks-section">

      {/* Section header */}
      <div className="daily-picks-header">
        <div className="daily-picks-title-group">
          <h2 className="daily-picks-title">
            <span className="daily-picks-title-accent">■</span> AI Daily Picks
          </h2>
          {picks && (
            <span className="daily-picks-date">{formatDate(picks.date)}</span>
          )}
        </div>
        <div className="daily-picks-header-right">
          {fromCache && <span className="cache-badge">Cached</span>}
          <button
            className="refresh-btn"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? 'Analyzing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Methodology banner */}
      <div className="picks-methodology-banner">
        <span className="picks-methodology-icon">◆</span>
        <span>
          <strong>Quantitative model.</strong> Stocks are scored across four equal-weight factors:
          Valuation (P/E vs sector, EV/EBITDA), Growth (revenue &amp; EPS momentum),
          Technical Momentum (RSI, MACD, SMA), and Quality (margins, ROE, leverage).
          Picks are stable for 24 hours — the model re-runs once per day.
        </span>
      </div>

      {/* Disclaimer */}
      <div className="picks-disclaimer-banner">
        <span className="picks-disclaimer-icon">⚠</span>
        <span>
          <strong>Not financial advice.</strong> Scores are generated by an automated model and
          reviewed by AI. They reflect quantitative signals only, not forward-looking research
          or insider knowledge. Always do your own due diligence before investing.
        </span>
      </div>

      {/* Loading */}
      {loading && (
        <div className="picks-loading">
          <div className="news-spinner" />
          <span>Running quantitative model across 30 large-caps… (~60-90 seconds)</span>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="picks-error">
          <p>{error}</p>
          <button onClick={onRefresh}>Try again</button>
        </div>
      )}

      {/* Picks grid */}
      {picks && !loading && (
        <>
          <div className="picks-grid">
            {picks.picks.map(pick => (
              <PickCard
                key={pick.ticker}
                pick={pick}
                isInWatchlist={watchlist.some(s => s.ticker === pick.ticker)}
                onAdd={onAddToWatchlist}
              />
            ))}
          </div>

          {/* Footer */}
          {picks.methodology && (
            <div className="picks-footer">
              <p className="picks-mood">
                <strong>Method:</strong> {picks.methodology}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default DailyPicks
