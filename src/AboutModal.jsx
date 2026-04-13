function AboutModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>

        <div className="modal-header">
          <h2 className="modal-title">
            <span className="modal-title-accent">■</span> About this app
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">

          {/* What it does */}
          <section className="about-section">
            <h3 className="about-heading">What it does</h3>
            <p className="about-text">
              A personal stock watchlist dashboard that lets you track real-time prices,
              view price charts across five timeframes (1 month to 10 years), read the
              latest company news, and get AI-powered market analysis — all in one place.
              Click any stock tile and the chart panel opens inline, right below it.
              You can add any ticker to your watchlist, set price alerts that notify you
              in your browser, and get a daily AI shortlist of 3 stocks worth watching
              based on that day's headlines.
            </p>
          </section>

          {/* Daily picks */}
          <section className="about-section">
            <h3 className="about-heading">AI Daily Picks — how it works</h3>
            <p className="about-text">
              Every day the app pulls up to 60 recent headlines from two independent
              news feeds — Finnhub (Reuters, MarketWatch, Seeking Alpha, and many others)
              and GNews (top business headlines + stock market search). Those headlines
              are sent to Claude, which identifies the 3 stocks receiving the most
              compelling positive coverage and scores them on two dimensions:
            </p>
            <ul className="about-source-item about-picks-list">
              <li>
                <span className="about-source-name">20% gain in 1 year</span>
                <span className="about-source-desc">
                  Probability (0–100%) that short-term news momentum, product launches,
                  earnings surprises, or sector tailwinds could drive a 20%+ price gain
                  within 12 months.
                </span>
              </li>
              <li>
                <span className="about-source-name">10%/yr over 5 years</span>
                <span className="about-source-desc">
                  Probability (0–100%) that the company's fundamentals, competitive
                  position, and long-term narrative mentioned in today's coverage could
                  sustain 10% annualised returns over 5 years.
                </span>
              </li>
            </ul>
            <p className="about-text">
              Results are cached for 24 hours. Hit Refresh to re-run the analysis
              against the latest headlines at any time.
            </p>
          </section>

          {/* Confidence score explained */}
          <section className="about-section">
            <h3 className="about-heading">How the confidence level is calculated</h3>
            <p className="about-text">
              Each pick carries a <strong>low / medium / high</strong> confidence badge.
              This is Claude's self-assessment of how much signal is in the news — not
              a prediction of whether the stock will go up. Specifically it reflects:
            </p>
            <ul className="about-confidence-list">
              <li className="about-confidence-item">
                <span className="about-confidence-label about-confidence-high">High</span>
                <span className="about-source-desc">
                  Multiple independent sources covering the same story, clear and specific
                  positive catalysts (e.g. a major contract win, strong earnings beat, FDA
                  approval), and consistent tone across headlines. The AI has a clear
                  picture of why the stock is in the news.
                </span>
              </li>
              <li className="about-confidence-item">
                <span className="about-confidence-label about-confidence-medium">Medium</span>
                <span className="about-source-desc">
                  Some positive coverage but mixed signals, a single source, or a catalyst
                  that is promising but uncertain (e.g. a partnership rumour, analyst
                  upgrade without a clear reason, or sector rotation talk).
                </span>
              </li>
              <li className="about-confidence-item">
                <span className="about-confidence-label about-confidence-low">Low</span>
                <span className="about-source-desc">
                  Thin coverage, speculative headlines, contradictory signals, or a stock
                  that appears in the news for reasons unrelated to its core business.
                  The AI is flagging it as interesting but with limited conviction.
                </span>
              </li>
            </ul>
            <p className="about-text" style={{ marginTop: '0.5rem' }}>
              Important: <strong>high confidence does not mean the stock will perform
              well</strong> — it means the news signal is clear. A stock can have clear
              bad news (high confidence it will drop) just as easily. Always read the
              pros and cons before acting on any pick.
            </p>
          </section>

          {/* Score calibration */}
          <section className="about-section">
            <h3 className="about-heading">Score calibration</h3>
            <p className="about-text">
              Scores are intentionally conservative. <strong>50 means a coin flip</strong> —
              the AI sees roughly equal reasons for and against. Scores above 70 are rare
              and reserved for cases where multiple strong independent signals align.
              The goal is honest uncertainty, not optimistic hype. If every stock scored
              80+, the scores would be meaningless.
            </p>
          </section>

          {/* Charts */}
          <section className="about-section">
            <h3 className="about-heading">Price charts</h3>
            <p className="about-text">
              Charts are powered by Finnhub's daily candle data. Five timeframes are
              available — <strong>1M, 3M, 1Y, 5Y, 10Y</strong> — each fetched and
              cached independently for 24 hours. Longer timeframes are downsampled
              client-side to keep the chart readable. If live data is unavailable
              (e.g. outside market hours or API rate limits), the chart falls back to
              a simulated price series based on the stock's last known price.
            </p>
          </section>

          {/* Data sources */}
          <section className="about-section">
            <h3 className="about-heading">Data sources</h3>
            <ul className="about-sources">
              <li className="about-source-item">
                <span className="about-source-name">Finnhub</span>
                <span className="about-source-desc">
                  Real-time stock quotes, price history (daily candles), company-specific
                  news, and the broad market headline feed used for daily picks.
                  Prices refresh automatically every 5 minutes.
                </span>
              </li>
              <li className="about-source-item">
                <span className="about-source-name">GNews</span>
                <span className="about-source-desc">
                  Supplements the daily picks with top business headlines and targeted
                  stock market search results, helping diversify beyond any single outlet.
                </span>
              </li>
              <li className="about-source-item">
                <span className="about-source-name">Claude AI (Anthropic)</span>
                <span className="about-source-desc">
                  Powers both the per-stock AI Analysis tab (sentiment, signal, key
                  points) and the Daily Picks feature (stock selection, scoring,
                  pros/cons). Uses the Claude Haiku model for speed and cost efficiency.
                </span>
              </li>
            </ul>
          </section>

          {/* Built by */}
          <section className="about-section">
            <h3 className="about-heading">Built by</h3>
            <p className="about-text">
              <strong>Amit Bhushan</strong>
              {' — '}
              <a
                className="about-link"
                href="mailto:amiteshb@gmail.com"
                target="_blank"
                rel="noreferrer"
              >
                amiteshb@gmail.com
              </a>
            </p>
          </section>

          {/* Disclaimer */}
          <section className="about-section about-disclaimer-section">
            <p className="about-disclaimer">
              <strong>Not financial advice.</strong> This app is for informational and
              educational purposes only. Stock prices, charts, AI analysis, daily picks,
              and all scores shown here are generated from news headlines and should not
              be used as the basis for any investment decision. Past news sentiment does
              not predict future stock performance. Always consult a qualified financial
              adviser before buying or selling any securities.
            </p>
          </section>

        </div>
      </div>
    </div>
  )
}

export default AboutModal
