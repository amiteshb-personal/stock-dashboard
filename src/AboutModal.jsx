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
              Every day the app runs a quantitative multi-factor screening model across a
              fixed universe of 30 large-cap US stocks spanning seven sectors. The model
              fetches live fundamental data and price history from Finnhub, computes
              technical indicators, and scores each stock 0–100 across four equal-weight
              factors:
            </p>
            <ul className="about-source-item about-picks-list">
              <li>
                <span className="about-source-name">Valuation</span>
                <span className="about-source-desc">
                  P/E ratio relative to the sector median, EV/EBITDA, and position
                  within the 52-week price range. Stocks trading at a meaningful discount
                  to their sector score higher.
                </span>
              </li>
              <li>
                <span className="about-source-name">Growth</span>
                <span className="about-source-desc">
                  Trailing 12-month revenue growth (YoY) and EPS growth (YoY), both
                  sourced directly from Finnhub fundamentals. Accelerating growth
                  scores higher; shrinking revenues are penalised.
                </span>
              </li>
              <li>
                <span className="about-source-name">Technical Momentum</span>
                <span className="about-source-desc">
                  RSI(14) — rewarding the healthy 50–65 zone and penalising overbought
                  (&gt;72) or oversold (&lt;25) extremes. MACD(12,26) positive reading
                  and zero-line crossover. Price position relative to the 50-day SMA.
                </span>
              </li>
              <li>
                <span className="about-source-name">Quality</span>
                <span className="about-source-desc">
                  Gross margin (TTM), return on equity (annual), and debt/equity ratio.
                  High-margin, capital-efficient businesses with low leverage score higher.
                </span>
              </li>
            </ul>
            <p className="about-text">
              The top 5 candidates then receive an analyst overlay: mean analyst price
              target upside and buy/sell rating distribution from Finnhub. The final top 3
              are passed to Claude, which writes a narrative grounded exclusively in
              the quantitative data — not headlines or speculation.
              Results are cached for 24 hours.
            </p>
          </section>

          {/* Confidence score explained */}
          <section className="about-section">
            <h3 className="about-heading">Composite score and confidence</h3>
            <p className="about-text">
              Each pick displays a <strong>composite score out of 100</strong> — the raw
              output of the four-factor model plus the analyst bonus (up to +10). Each
              factor contributes up to 25 points; scores above 65 with four or more active
              signals earn a <strong>high</strong> confidence badge.
            </p>
            <ul className="about-confidence-list">
              <li className="about-confidence-item">
                <span className="about-confidence-label about-confidence-high">High</span>
                <span className="about-source-desc">
                  Score ≥ 65 and four or more active model signals (e.g. favourable
                  P/E, strong revenue growth, healthy RSI, above 50-day SMA, analyst
                  upside). Multiple independent quantitative factors are aligned.
                </span>
              </li>
              <li className="about-confidence-item">
                <span className="about-confidence-label about-confidence-medium">Medium</span>
                <span className="about-source-desc">
                  Score ≥ 45 with at least two active signals. Some factors are
                  positive but others are neutral or missing data.
                </span>
              </li>
              <li className="about-confidence-item">
                <span className="about-confidence-label about-confidence-low">Low</span>
                <span className="about-source-desc">
                  Score below 45 or fewer than two signals. The stock ranked in the top 3
                  by relative scoring but the absolute signal strength is weak.
                  This often happens when the broader market lacks stand-out opportunities.
                </span>
              </li>
            </ul>
          </section>

          {/* Score calibration */}
          <section className="about-section">
            <h3 className="about-heading">Score calibration</h3>
            <p className="about-text">
              The probability bars (<em>20% gain in 1 year</em> and <em>10%/yr over
              5 years</em>) are intentionally conservative. <strong>50 means a coin
              flip.</strong> Scores above 70 require multiple strong signals aligning
              simultaneously. Claude is instructed to cite specific numbers and be honest
              about weaknesses — not to write promotional copy.
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
                <span className="about-source-name">Claude AI (Anthropic)</span>
                <span className="about-source-desc">
                  Powers both the per-stock AI Analysis tab (sentiment, signal, key
                  points) and the Daily Picks narrative. The model receives structured
                  quantitative data and writes analysis grounded in the numbers — it
                  does not select stocks or invent information. Uses Claude Haiku for
                  speed and cost efficiency.
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
