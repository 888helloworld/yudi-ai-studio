const crypto = require('crypto');
const { db } = require('../database');
const { rechargePoints } = require('./point-repository');

function generateCdkeys(count, points, createdBy) {
  const stmt = db.prepare('INSERT INTO cdkeys (code, points, created_by) VALUES (?, ?, ?)');
  const keys = [];
  const transaction = db.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const code = `XHS${crypto.randomBytes(4).toString('hex').toUpperCase()}${Date.now().toString(36).toUpperCase().slice(-4)}`;
      stmt.run(code, points, createdBy);
      keys.push(code);
    }
  });
  transaction();
  return keys;
}

function generateUserInviteCode(userId) {
  const configuredPoints = Number(process.env.USER_INVITE_POINTS || 0);
  const points = Number.isFinite(configuredPoints) && configuredPoints > 0 ? Math.floor(configuredPoints) : 0;
  const code = `INV${crypto.randomBytes(5).toString('hex').toUpperCase()}${Date.now().toString(36).toUpperCase().slice(-4)}`;
  db.prepare('INSERT INTO cdkeys (code, points, created_by) VALUES (?, ?, ?)').run(code, points, userId);
  return db.prepare(`
    SELECT c.*, u.username as used_by_name
    FROM cdkeys c
    LEFT JOIN users u ON c.used_by = u.id
    WHERE c.code = ?
  `).get(code);
}

function getUserInviteCodes(userId, options = {}) {
  const { limit = 50 } = options;
  return db.prepare(`
    SELECT c.id, c.code, c.points, c.used, c.used_at, c.created_at, u.username as used_by_name
    FROM cdkeys c
    LEFT JOIN users u ON c.used_by = u.id
    WHERE c.created_by = ? AND c.code LIKE 'INV%'
    ORDER BY c.created_at DESC
    LIMIT ?
  `).all(userId, limit);
}

function getUserUnusedInviteCount(userId) {
  return db.prepare("SELECT COUNT(*) as count FROM cdkeys WHERE created_by = ? AND used = 0 AND code LIKE 'INV%'")
    .get(userId).count;
}

function getAllCdkeys(options = {}) {
  const { used, page = 1, limit = 50 } = options;
  let sql = 'SELECT c.*, u.username as used_by_name, cr.username as created_by_name FROM cdkeys c LEFT JOIN users u ON c.used_by = u.id LEFT JOIN users cr ON c.created_by = cr.id WHERE 1=1';
  const params = [];
  if (used === '0' || used === 0) sql += ' AND c.used = 0';
  if (used === '1' || used === 1) sql += ' AND c.used = 1';

  const countSql = sql.replace('SELECT c.*, u.username as used_by_name, cr.username as created_by_name', 'SELECT COUNT(*) as total');
  const total = db.prepare(countSql).get(...params).total;
  sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, (page - 1) * limit);
  return { list: db.prepare(sql).all(...params), total };
}

function redeemCdkey(code, userId) {
  const cdkey = db.prepare('SELECT * FROM cdkeys WHERE code = ?').get(code);
  if (!cdkey) return { success: false, error: '卡密不存在' };
  if (cdkey.used === 1) return { success: false, error: '卡密已被使用' };

  const transaction = db.transaction(() => {
    const claim = db.prepare('UPDATE cdkeys SET used = 1, used_by = ?, used_at = CURRENT_TIMESTAMP WHERE id = ? AND used = 0')
      .run(userId, cdkey.id);
    if (claim.changes === 0) throw new Error('卡密已被使用');
    return rechargePoints(userId, cdkey.points, `卡密兑换 ${code}`);
  });

  try {
    const result = transaction();
    return { success: true, points: cdkey.points, balance: result.balance };
  } catch (error) {
    if (error.message === '卡密已被使用') return { success: false, error: '卡密已被使用' };
    throw error;
  }
}

function useCdkey(code) {
  const cdkey = db.prepare('SELECT * FROM cdkeys WHERE code = ?').get(code);
  if (!cdkey) return { success: false, error: '邀请码无效' };
  if (cdkey.used === 1) return { success: false, error: '邀请码已被使用' };
  return { success: true, points: cdkey.points };
}

function getCdkeyStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM cdkeys').get().count;
  const used = db.prepare('SELECT COUNT(*) as count FROM cdkeys WHERE used = 1').get().count;
  const totalPoints = db.prepare('SELECT COALESCE(SUM(points), 0) as sum FROM cdkeys').get().sum;
  const usedPoints = db.prepare('SELECT COALESCE(SUM(points), 0) as sum FROM cdkeys WHERE used = 1').get().sum;
  return { total, used, unused: total - used, totalPoints, usedPoints };
}

module.exports = {
  generateCdkeys,
  generateUserInviteCode,
  getAllCdkeys,
  getCdkeyStats,
  getUserInviteCodes,
  getUserUnusedInviteCount,
  redeemCdkey,
  useCdkey
};
