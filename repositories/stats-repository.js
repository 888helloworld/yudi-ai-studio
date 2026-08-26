const { db } = require('../database');

function getPublicStats() {
  const totalUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const totalRecords = db.prepare(`
    SELECT COUNT(*) AS count FROM history
    WHERE (sub_type NOT IN ('xi-edit', 'xi-generate') OR sub_type IS NULL)
       OR (image_url IS NOT NULL AND TRIM(image_url) != '')
  `).get().count;
  const totalCopies = db.prepare("SELECT COUNT(*) AS count FROM history WHERE type IN ('copy', 'both') AND content IS NOT NULL AND TRIM(content) <> ''").get().count;
  return { totalUsers, totalRecords, totalCopies };
}

function getStats() {
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalPoints = db.prepare('SELECT SUM(points) as sum FROM users').get().sum || 0;
  const todayHistory = db.prepare(`
    SELECT COUNT(*) as count, SUM(cost_points) as cost
    FROM history
    WHERE date(datetime(created_at, '+8 hours')) = date('now', '+8 hours')
      AND (
        (type = 'image' AND image_url IS NOT NULL AND TRIM(image_url) != '')
        OR (type = 'copy' AND content IS NOT NULL AND TRIM(content) != '')
        OR (type = 'both' AND ((image_url IS NOT NULL AND TRIM(image_url) != '') OR (content IS NOT NULL AND TRIM(content) != '')))
        OR (type = 'reverse' AND json_valid(content) AND json_extract(content, '$.status') = 'done')
      )
  `).get();
  const todayPointChanges = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'refund' OR (type = 'recharge' AND description LIKE '%退款%') THEN amount ELSE 0 END), 0) AS refunds,
      COALESCE(SUM(CASE WHEN type IN ('signup_bonus', 'invite_bonus') THEN amount ELSE 0 END), 0) AS bonuses,
      COALESCE(SUM(CASE WHEN type = 'admin_adjust' THEN amount ELSE 0 END), 0) AS admin_adjustments
    FROM point_logs WHERE date(datetime(created_at, '+8 hours')) = date('now', '+8 hours')
  `).get();
  const todayPaid = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as revenue, COALESCE(SUM(points), 0) as points
    FROM payment_orders
    WHERE status = 'paid' AND date(datetime(paid_at, '+8 hours')) = date('now', '+8 hours')
  `).get();
  const totalHistory = db.prepare('SELECT COUNT(*) as count FROM history').get().count;

  return {
    totalUsers,
    totalPoints,
    todayCount: todayHistory.count,
    todayCost: todayHistory.cost || 0,
    todayRecharge: todayPaid.points || 0,
    todayRechargeCount: todayPaid.count || 0,
    todayRefundPoints: todayPointChanges.refunds || 0,
    todayBonusPoints: todayPointChanges.bonuses || 0,
    todayAdminAdjustments: todayPointChanges.admin_adjustments || 0,
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
  let successfulRecords = 0;

  historyRows.forEach((row) => {
    if (row.type === 'image') {
      const imageCount = countStoredImageUrls(row.image_url);
      totalImages += imageCount;
      if (imageCount > 0) successfulRecords += 1;
    } else if (row.type === 'copy') {
      if (row.content && String(row.content).trim()) {
        totalCopies += 1;
        successfulRecords += 1;
      }
    } else if (row.type === 'both') {
      totalBoth += 1;
      totalImages += countStoredImageUrls(row.image_url);
      if (row.content && String(row.content).trim()) totalCopies += 1;
      if (countStoredImageUrls(row.image_url) > 0 || (row.content && String(row.content).trim())) successfulRecords += 1;
    } else if (row.type === 'reverse') {
      try { if (JSON.parse(row.content || '{}').status === 'done') successfulRecords += 1; } catch {}
    }
  });

  const totalCost = db.prepare('SELECT COALESCE(SUM(cost_points), 0) as sum FROM history WHERE user_id = ?').get(userId).sum;
  const totalRecharge = db.prepare("SELECT COALESCE(SUM(points), 0) as sum FROM payment_orders WHERE user_id = ? AND status = 'paid'").get(userId).sum;
  const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
  return {
    currentPoints: user ? user.points : 0,
    totalImages,
    totalCopies,
    totalBoth,
    totalRecords: successfulRecords,
    totalSubmittedRecords: historyRows.length,
    totalCost,
    totalRecharge
  };
}

function getDailyStats(days = 7) {
  return db.prepare(`
    SELECT date(datetime(created_at, '+8 hours')) as day, type, COUNT(*) as count, SUM(cost_points) as cost
    FROM history
    WHERE created_at >= datetime('now', ? || ' days')
    GROUP BY date(datetime(created_at, '+8 hours')), type
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
