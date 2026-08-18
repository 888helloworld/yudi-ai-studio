const { db } = require('../database');

function getPublicStats() {
  const totalUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const totalRecords = db.prepare('SELECT COUNT(*) AS count FROM history').get().count;
  const totalCopies = db.prepare("SELECT COUNT(*) AS count FROM history WHERE type IN ('copy', 'both') AND content IS NOT NULL AND TRIM(content) <> ''").get().count;
  return { totalUsers, totalRecords, totalCopies };
}

function getStats() {
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalPoints = db.prepare('SELECT SUM(points) as sum FROM users').get().sum || 0;
  const today = new Date().toISOString().split('T')[0];
  const todayHistory = db.prepare(`
    SELECT COUNT(*) as count, SUM(cost_points) as cost
    FROM history WHERE date(created_at) = ?
  `).get(today);
  const todayRecharge = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as points
    FROM point_logs
    WHERE type = 'recharge' AND amount > 0 AND date(created_at) = ?
  `).get(today);
  const todayPaid = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as revenue, COALESCE(SUM(points), 0) as points
    FROM payment_orders
    WHERE status = 'paid' AND date(paid_at) = ?
  `).get(today);
  const totalHistory = db.prepare('SELECT COUNT(*) as count FROM history').get().count;

  return {
    totalUsers,
    totalPoints,
    todayCount: todayHistory.count,
    todayCost: todayHistory.cost || 0,
    todayRecharge: todayRecharge.points || 0,
    todayRechargeCount: todayRecharge.count || 0,
    todayPaidRevenue: todayPaid.revenue || 0,
    todayPaidOrders: todayPaid.count || 0,
    todayPaidPoints: todayPaid.points || 0,
    totalHistory
  };
}

function countStoredImageUrls(value) {
  if (!value) return 0;
  if (Array.isArray(value)) return value.filter(Boolean).length;
  const text = String(value).trim();
  if (!text) return 0;
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).length;
    } catch (error) {
      // 旧数据可能不是合法 JSON，按单张图片统计。
    }
  }
  return 1;
}

function getUserStats(userId) {
  const historyRows = db.prepare('SELECT type, image_url, content FROM history WHERE user_id = ?').all(userId);
  let totalImages = 0;
  let totalCopies = 0;
  let totalBoth = 0;

  historyRows.forEach((row) => {
    if (row.type === 'image') {
      totalImages += countStoredImageUrls(row.image_url);
    } else if (row.type === 'copy') {
      totalCopies += 1;
    } else if (row.type === 'both') {
      totalBoth += 1;
      totalImages += countStoredImageUrls(row.image_url);
      if (row.content && String(row.content).trim()) totalCopies += 1;
    }
  });

  const totalCost = db.prepare('SELECT COALESCE(SUM(cost_points), 0) as sum FROM history WHERE user_id = ?').get(userId).sum;
  const totalRecharge = db.prepare("SELECT COALESCE(SUM(amount), 0) as sum FROM point_logs WHERE user_id = ? AND type = 'recharge'").get(userId).sum;
  const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
  return {
    currentPoints: user ? user.points : 0,
    totalImages,
    totalCopies,
    totalBoth,
    totalRecords: historyRows.length,
    totalCost,
    totalRecharge
  };
}

function getDailyStats(days = 7) {
  return db.prepare(`
    SELECT date(created_at) as day, type, COUNT(*) as count, SUM(cost_points) as cost
    FROM history
    WHERE created_at >= datetime('now', ? || ' days')
    GROUP BY date(created_at), type
    ORDER BY day ASC
  `).all(`-${days}`);
}

module.exports = {
  countStoredImageUrls,
  getDailyStats,
  getPublicStats,
  getStats,
  getUserStats
};
