// ── Browser notification helpers ──────────────────────────────────────────

// Ask the user for permission to show desktop notifications.
// Returns true if granted.
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

// Send a desktop notification (only if permission was granted).
export function sendBrowserNotification(title, body) {
  if (Notification.permission !== 'granted') return
  new Notification(title, {
    body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
  })
}

// ── Alert rule checker ────────────────────────────────────────────────────

// Check whether a single stock triggers any of the user's alert rules.
// Returns an array of human-readable messages for each rule that fired.
export function checkRulesForStock(stock, rules) {
  const triggered = []
  const price     = parseFloat(stock.price)
  const changePct = Math.abs(parseFloat(stock.changePercent))

  for (const rule of rules) {
    // Skip rules that target a different ticker
    if (rule.ticker !== 'ANY' && rule.ticker !== stock.ticker) continue

    if (rule.condition === 'drops_below' && price < rule.value) {
      triggered.push(
        `${stock.ticker} dropped below $${rule.value} — now $${stock.price}`
      )
    } else if (rule.condition === 'rises_above' && price > rule.value) {
      triggered.push(
        `${stock.ticker} rose above $${rule.value} — now $${stock.price}`
      )
    } else if (rule.condition === 'change_pct' && changePct > rule.value) {
      const dir = parseFloat(stock.changePercent) >= 0 ? '▲' : '▼'
      triggered.push(
        `${stock.ticker} moved ${dir}${changePct.toFixed(2)}% today (threshold: ${rule.value}%)`
      )
    }
  }

  return triggered
}

// Check all stocks against all rules.
// Returns an array of alert history items ready to store.
export function checkAllAlerts(stocks, rules) {
  const fired = []

  for (const stock of stocks) {
    const messages = checkRulesForStock(stock, rules)
    for (const message of messages) {
      fired.push({
        id:      crypto.randomUUID(),
        ticker:  stock.ticker,
        message,
        firedAt: Date.now(),
        read:    false,
      })
    }
  }

  return fired
}

// ── localStorage helpers for rules & history ─────────────────────────────

export function loadRules() {
  try {
    return JSON.parse(localStorage.getItem('alertRules') || '[]')
  } catch { return [] }
}

export function saveRules(rules) {
  localStorage.setItem('alertRules', JSON.stringify(rules))
}

export function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem('alertHistory') || '[]')
  } catch { return [] }
}

export function saveHistory(history) {
  // Keep only the 50 most recent items so localStorage doesn't grow forever
  localStorage.setItem('alertHistory', JSON.stringify(history.slice(0, 50)))
}
