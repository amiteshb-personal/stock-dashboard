import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

// Custom tooltip that appears when you hover over the chart
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null

  return (
    <div className="chart-tooltip">
      <p className="tooltip-date">{label}</p>
      <p className="tooltip-price">${payload[0].value.toFixed(2)}</p>
    </div>
  )
}

// StockChart renders a 30-day area chart for one stock
function StockChart({ data, isPositive }) {
  // Pick green or red as the chart color based on whether the stock is up/down
  const color = isPositive ? '#00a86b' : '#e53e3e'
  const gradientId = isPositive ? 'gradientGreen' : 'gradientRed'

  if (!data || data.length === 0) {
    return <p className="chart-empty">No chart data available.</p>
  }

  // Calculate the min/max price to set a tight Y axis range
  const prices = data.map(d => d.price)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const padding = (maxPrice - minPrice) * 0.1  // 10% padding above and below

  return (
    <div className="chart-wrapper">
      {/* ResponsiveContainer makes the chart fill whatever width its parent has */}
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>

          {/* Define the gradient fill under the line */}
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* Subtle grid lines */}
          <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />

          {/* X axis: the dates */}
          <XAxis
            dataKey="date"
            tick={{ fill: '#aaaaaa', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />

          {/* Y axis: prices, tucked tight to the data range */}
          <YAxis
            domain={[minPrice - padding, maxPrice + padding]}
            tick={{ fill: '#aaaaaa', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
            width={55}
          />

          <Tooltip content={<CustomTooltip />} />

          {/* The actual line + filled area */}
          <Area
            type="monotone"
            dataKey="price"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, fill: color }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export default StockChart
