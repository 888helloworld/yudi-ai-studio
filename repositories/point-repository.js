const { db } = require('../database');

function addPointLog(userId, type, amount, balance, description, referenceKey = null) {
  db.prepare('INSERT INTO point_logs (user_id, type, amount, balance, description, reference_key) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, type, amount, balance, description, referenceKey || null);
}

function deductPoints(userId, amount, description, referenceKey = null) {
  if (amount <= 0) {
    return { success: false, message: '无效的扣减数量' };
  }

  const transaction = db.transaction(() => {
    if (referenceKey) {
      const existing = db.prepare('SELECT id, user_id, amount FROM point_logs WHERE reference_key = ?').get(referenceKey);
      if (existing) {
        if (Number(existing.user_id) !== Number(userId) || Number(existing.amount) !== -Number(amount)) {
          throw new Error('积分业务号冲突');
        }
        const current = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
        return current ? { success: true, balance: current.points, alreadyApplied: true } : { success: false, message: '用户不存在' };
      }
    }
    const result = db.prepare('UPDATE users SET points = points - ? WHERE id = ? AND points >= ?')
      .run(amount, userId, amount);
    if (result.changes === 0) return { success: false, message: '积分不足' };

    const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
    addPointLog(userId, 'consume', -amount, user.points, description, referenceKey);
    return { success: true, balance: user.points, alreadyApplied: false };
  });
  return transaction.immediate();
}

function rechargePoints(userId, amount, description = '管理员充值', referenceKey = null, logType = 'recharge') {
  if (amount <= 0) return null;

  const transaction = db.transaction(() => {
    if (referenceKey) {
      const existing = db.prepare('SELECT id, user_id, amount FROM point_logs WHERE reference_key = ?').get(referenceKey);
      if (existing) {
        if (Number(existing.user_id) !== Number(userId) || Number(existing.amount) !== Number(amount)) {
          throw new Error('积分业务号冲突');
        }
        const current = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
        return current ? { balance: current.points, alreadyApplied: true } : null;
      }
    }
    const result = db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(amount, userId);
    if (result.changes === 0) return null;
    const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
    addPointLog(userId, logType, amount, user.points, description, referenceKey);
    return { balance: user.points, alreadyApplied: false };
  });
  return transaction.immediate();
}

function getPointLogs(userId, limit = 50, offset = 0) {
  return db.prepare('SELECT * FROM point_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(userId, limit, offset);
}

function getPointLogsCount(userId) {
  return db.prepare('SELECT COUNT(*) as total FROM point_logs WHERE user_id = ?').get(userId).total;
}

function getUserPoints(userId) {
  const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
  return user ? user.points : 0;
}

function getAllPointLogs(limit = 100, offset = 0) {
  return db.prepare(`
    SELECT pl.*, u.username FROM point_logs pl
    LEFT JOIN users u ON pl.user_id = u.id
    ORDER BY pl.created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
}

function getAllPointLogsCount() {
  return db.prepare('SELECT COUNT(*) as total FROM point_logs').get().total;
}

module.exports = {
  addPointLog,
  deductPoints,
  getAllPointLogs,
  getAllPointLogsCount,
  getPointLogs,
  getPointLogsCount,
  getUserPoints,
  rechargePoints
};
