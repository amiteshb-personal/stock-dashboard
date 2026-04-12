// StockCard displays a single stock's information.
// onDelete shows a × button on hover so the user can remove it from the watchlist.
function StockCard({ stock, onClick, isSelected, onDelete }) {
  const isPositive = parseFloat(stock.changePercent) >= 0

  return (
    <div
      className={`stock-card ${isPositive ? 'positive' : 'negative'} ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      title="Click to see news"
    >
      {onDelete && (
        <button
          className="card-delete-btn"
          onClick={e => { e.stopPropagation(); onDelete(stock.ticker) }}
          title={`Remove ${stock.ticker}`}
          aria-label={`Remove ${stock.ticker}`}
        >
          ×
        </button>
      )}

      <div className="card-top">
        <span className="ticker">{stock.ticker}</span>
        <span className={`badge ${isPositive ? 'badge-up' : 'badge-down'}`}>
          {isPositive ? '▲' : '▼'}
        </span>
      </div>

      <p className="company-name">{stock.name}</p>

      <div className="card-bottom">
        <span className="price">${stock.price}</span>
        <div className="change-info">
          <span className={`change ${isPositive ? 'text-green' : 'text-red'}`}>
            {isPositive ? '+' : ''}{stock.change}
          </span>
          <span className={`change-percent ${isPositive ? 'text-green' : 'text-red'}`}>
            ({isPositive ? '+' : ''}{stock.changePercent}%)
          </span>
        </div>
      </div>

      {isSelected && <div className="card-arrow">▼ News</div>}
    </div>
  )
}

export default StockCard
