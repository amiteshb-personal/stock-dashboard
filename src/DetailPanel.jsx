import StockChart from './StockChart'
import NewsPanel from './NewsPanel'
import AIAnalysis from './AIAnalysis'

const TIMEFRAME_LABELS = ['1M', '3M', '1Y', '5Y', '10Y']

function DetailPanel({
  stock,
  activeTab,
  onTabChange,
  chartData,
  chartLoading,
  chartError,
  news,
  newsLoading,
  newsError,
  analysis,
  analysisLoading,
  analysisError,
  chartTimeframe,
  onTimeframeChange,
}) {
  const isPositive = parseFloat(stock.changePercent) >= 0

  return (
    <div className="detail-panel">
      {/* Tab bar */}
      <div className="tab-bar">
        <button
          className={`tab-btn ${activeTab === 'chart' ? 'tab-active' : ''}`}
          onClick={() => onTabChange('chart')}
        >
          Chart
        </button>
        <button
          className={`tab-btn ${activeTab === 'news' ? 'tab-active' : ''}`}
          onClick={() => onTabChange('news')}
        >
          News
        </button>
        <button
          className={`tab-btn ${activeTab === 'ai' ? 'tab-active' : ''}`}
          onClick={() => onTabChange('ai')}
        >
          ✦ AI Analysis
        </button>
        <span className="tab-stock-label">{stock.ticker}</span>
      </div>

      {/* Tab content */}
      <div className="tab-content">
        {activeTab === 'chart' && (
          <div>
            {/* Timeframe selector */}
            <div className="timeframe-bar">
              {TIMEFRAME_LABELS.map(tf => (
                <button
                  key={tf}
                  className={`timeframe-btn ${chartTimeframe === tf ? 'timeframe-active' : ''}`}
                  onClick={() => onTimeframeChange(tf)}
                  disabled={chartLoading}
                >
                  {tf}
                </button>
              ))}
            </div>
            {chartLoading && (
              <div className="news-loading">
                <div className="news-spinner"></div>
                <span>Loading chart…</span>
              </div>
            )}
            {chartError && <p className="news-error">{chartError}</p>}
            {!chartLoading && !chartError && chartData.length > 0 && (
              <>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-2)', margin: '0 0 0.5rem' }}>
                  {chartData[0].date} – {chartData[chartData.length - 1].date} &nbsp;·&nbsp; {chartData.length} data points
                </p>
                <StockChart key={chartTimeframe} data={chartData} isPositive={isPositive} />
              </>
            )}
          </div>
        )}

        {activeTab === 'news' && (
          <NewsPanel
            ticker={stock.ticker}
            news={news}
            loading={newsLoading}
            error={newsError}
          />
        )}

        {activeTab === 'ai' && (
          <AIAnalysis
            analysis={analysis}
            loading={analysisLoading}
            error={analysisError}
          />
        )}
      </div>
    </div>
  )
}

export default DetailPanel
