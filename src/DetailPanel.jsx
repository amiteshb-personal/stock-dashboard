import StockChart from './StockChart'
import NewsPanel from './NewsPanel'
import AIAnalysis from './AIAnalysis'

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
            {chartLoading && (
              <div className="news-loading">
                <div className="news-spinner"></div>
                <span>Loading 30-day chart...</span>
              </div>
            )}
            {chartError && <p className="news-error">{chartError}</p>}
            {!chartLoading && !chartError && (
              <StockChart data={chartData} isPositive={isPositive} />
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
