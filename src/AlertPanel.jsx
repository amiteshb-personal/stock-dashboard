import { useState } from 'react'

// One row in the "Add a rule" form
function RuleForm({ onAdd, watchlist }) {
  const [ticker, setTicker]       = useState('ANY')
  const [condition, setCondition] = useState('drops_below')
  const [value, setValue]         = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    const num = parseFloat(value)
    if (isNaN(num) || num <= 0) return
    onAdd({ ticker, condition, value: num })
    setValue('')
  }

  // What unit/label to show next to the number field
  const isPercent = condition === 'change_pct'

  return (
    <form className="rule-form" onSubmit={handleSubmit}>
      {/* Ticker */}
      <select
        className="rule-select"
        value={ticker}
        onChange={e => setTicker(e.target.value)}
      >
        <option value="ANY">Any stock</option>
        {watchlist.map(s => (
          <option key={s.ticker} value={s.ticker}>{s.ticker}</option>
        ))}
      </select>

      {/* Condition */}
      <select
        className="rule-select"
        value={condition}
        onChange={e => setCondition(e.target.value)}
      >
        <option value="drops_below">drops below $</option>
        <option value="rises_above">rises above $</option>
        <option value="change_pct">moves more than %</option>
      </select>

      {/* Value */}
      <div className="rule-input-wrap">
        {!isPercent && <span className="rule-prefix">$</span>}
        <input
          className="rule-input"
          type="number"
          min="0"
          step="any"
          placeholder={isPercent ? '3.0' : '160.00'}
          value={value}
          onChange={e => setValue(e.target.value)}
          required
        />
        {isPercent && <span className="rule-suffix">%</span>}
      </div>

      <button className="rule-add-btn" type="submit">+ Add</button>
    </form>
  )
}

// The full panel rendered below the header when the bell is clicked
function AlertPanel({ rules, history, onAddRule, onDeleteRule, onClearHistory, watchlist }) {
  function describeRule(rule) {
    const ticker = rule.ticker === 'ANY' ? 'Any stock' : rule.ticker
    if (rule.condition === 'drops_below') return `${ticker} drops below $${rule.value}`
    if (rule.condition === 'rises_above') return `${ticker} rises above $${rule.value}`
    if (rule.condition === 'change_pct')  return `${ticker} moves more than ${rule.value}%`
    return ''
  }

  function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000)
    if (diff < 60)   return 'Just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    return `${Math.floor(diff / 3600)}h ago`
  }

  return (
    <div className="alert-panel">
      {/* ── Rules section ── */}
      <div className="alert-section">
        <h3 className="alert-section-title">Alert Rules</h3>
        <RuleForm onAdd={onAddRule} watchlist={watchlist} />

        {rules.length === 0 ? (
          <p className="alert-empty">No rules yet. Add one above.</p>
        ) : (
          <ul className="rule-list">
            {rules.map(rule => (
              <li key={rule.id} className="rule-item">
                <span className="rule-dot">◆</span>
                <span className="rule-desc">{describeRule(rule)}</span>
                <button
                  className="rule-delete"
                  onClick={() => onDeleteRule(rule.id)}
                  title="Delete rule"
                >✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── History section ── */}
      <div className="alert-section">
        <div className="alert-section-header">
          <h3 className="alert-section-title">Alert History</h3>
          {history.length > 0 && (
            <button className="clear-btn" onClick={onClearHistory}>Clear</button>
          )}
        </div>

        {history.length === 0 ? (
          <p className="alert-empty">No alerts fired yet.</p>
        ) : (
          <ul className="history-list">
            {history.map(item => (
              <li key={item.id} className={`history-item ${item.read ? '' : 'unread'}`}>
                <div className="history-msg">{item.message}</div>
                <div className="history-time">{timeAgo(item.firedAt)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default AlertPanel
