const { db } = require('../database');

function addAnalyticsEvent({ userId = null, eventName, requestId = '', properties = {} }) {
  const sanitizedProperties = {};
  for (const [key, value] of Object.entries(properties || {}).slice(0, 20)) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) continue;
    if (typeof value === 'string') sanitizedProperties[key] = value.slice(0, 200);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) sanitizedProperties[key] = value;
  }
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM analytics_events WHERE created_at < datetime('now', '-90 days')").run();
    db.prepare(`
      INSERT INTO analytics_events (user_id, event_name, request_id, properties)
      VALUES (?, ?, ?, ?)
    `).run(userId || null, eventName, String(requestId || '').slice(0, 100), JSON.stringify(sanitizedProperties));
  });
  transaction();
}

module.exports = { addAnalyticsEvent };
