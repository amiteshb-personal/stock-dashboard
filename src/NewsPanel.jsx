// NewsPanel shows recent headlines for the selected stock
function NewsPanel({ ticker, news, loading, error }) {
  // Format a Unix timestamp into a readable string like "2h ago" or "Apr 10"
  function formatTime(unixTimestamp) {
    const now = Date.now()
    const then = unixTimestamp * 1000
    const diffMs = now - then
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

    if (diffHours < 1) return 'Just now'
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays === 1) return 'Yesterday'
    return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div>
      <h2 className="news-heading">
        Latest News
        <span className="news-ticker-badge">{ticker}</span>
      </h2>

      {loading && (
        <div className="news-loading">
          <div className="news-spinner"></div>
          <span>Loading headlines...</span>
        </div>
      )}

      {error && (
        <p className="news-error">{error}</p>
      )}

      {!loading && !error && news.length === 0 && (
        <p className="news-empty">No recent headlines found for {ticker}.</p>
      )}

      <ul className="news-list">
        {news.map((item, index) => (
          <li key={index} className="news-item">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="news-title"
            >
              {item.headline}
            </a>
            <div className="news-meta">
              <span className="news-source">{item.source}</span>
              <span className="news-dot">·</span>
              <span className="news-time">{formatTime(item.datetime)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default NewsPanel
