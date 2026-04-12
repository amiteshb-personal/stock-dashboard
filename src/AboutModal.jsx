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
              view 30-day price charts, read the latest company news, and get AI-powered
              market analysis — all in one place. You can add any stock ticker to your
              watchlist and set price alerts that notify you in your browser.
            </p>
          </section>

          {/* Data sources */}
          <section className="about-section">
            <h3 className="about-heading">Data sources</h3>
            <ul className="about-sources">
              <li className="about-source-item">
                <span className="about-source-name">Finnhub</span>
                <span className="about-source-desc">
                  Real-time stock quotes, 30-day price history, and company news headlines.
                  Data refreshes every 5 minutes automatically.
                </span>
              </li>
              <li className="about-source-item">
                <span className="about-source-name">Claude AI</span>
                <span className="about-source-desc">
                  AI-generated market analysis combining price trends and recent headlines
                  into a sentiment signal and plain-English summary. Powered by Anthropic's
                  Claude model.
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
              educational purposes only. Stock prices, charts, and AI analysis shown here
              should not be used as the basis for any investment decision. Always consult
              a qualified financial adviser before buying or selling securities.
            </p>
          </section>

        </div>
      </div>
    </div>
  )
}

export default AboutModal
