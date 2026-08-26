const { db } = require('../database');

function addHistory(userId, type, data) {
  const result = db.prepare(`
    INSERT INTO history (user_id, type, sub_type, content, image_url, prompt, ratio, cost_points, client_task_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    type,
    data.sub_type || null,
    data.content || null,
    data.image_url || null,
    data.prompt || null,
    data.ratio || null,
    data.cost_points ?? null,
    data.client_task_id || null
  );
  return result.lastInsertRowid;
}

function updateHistory(userId, historyId, data) {
  const current = db.prepare('SELECT * FROM history WHERE id = ? AND user_id = ?').get(historyId, userId);
  if (!current) return false;
  const next = { ...current, ...data };
  const result = db.prepare(`
    UPDATE history
    SET sub_type = ?, content = ?, image_url = ?, prompt = ?, ratio = ?, cost_points = ?, client_task_id = ?
    WHERE id = ? AND user_id = ?
  `).run(
    next.sub_type ?? null,
    next.content ?? null,
    next.image_url ?? null,
    next.prompt ?? null,
    next.ratio ?? null,
    next.cost_points ?? null,
    next.client_task_id ?? null,
    historyId,
    userId
  );
  return result.changes > 0;
}

function appendHistoryFilters(sql, params, options, prefix = '') {
  const { type, startDate, endDate, keyword, excludeSubTypes = [] } = options;
  if (type) {
    sql += ` AND ${prefix}type = ?`;
    params.push(type);
  }
  if (Array.isArray(excludeSubTypes) && excludeSubTypes.length > 0) {
    const placeholders = excludeSubTypes.map(() => '?').join(', ');
    sql += ` AND (${prefix}sub_type IS NULL OR ${prefix}sub_type NOT IN (${placeholders}))`;
    params.push(...excludeSubTypes);
  }
  if (startDate) {
    sql += ` AND ${prefix}created_at >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    sql += ` AND ${prefix}created_at <= ?`;
    params.push(endDate);
  }
  if (keyword) {
    sql += ` AND (${prefix}content LIKE ? OR ${prefix}prompt LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  return sql;
}

function getUserHistory(userId, options = {}) {
  const { limit = 50, offset = 0 } = options;
  const params = [userId];
  let sql = appendHistoryFilters('SELECT * FROM history WHERE user_id = ?', params, options);
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

function getUserHistoryCount(userId, options = {}) {
  const params = [userId];
  const sql = appendHistoryFilters('SELECT COUNT(*) as total FROM history WHERE user_id = ?', params, options);
  return db.prepare(sql).get(...params).total;
}

function deleteHistory(id, userId) {
  const row = db.prepare('SELECT * FROM history WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return { success: false, reason: 'not_found' };
  if (row.sub_type === 'xi-edit' || row.sub_type === 'xi-generate') {
    let meta = {};
    try { meta = JSON.parse(row.content || '{}'); } catch {}
    if (['queued', 'running'].includes(meta.status)) return { success: false, reason: 'active' };
  }
  const result = db.prepare('DELETE FROM history WHERE id = ? AND user_id = ?').run(id, userId);
  return { success: result.changes > 0, row };
}

function appendAdminHistoryFilters(sql, params, options) {
  const { type, keyword } = options;
  if (type) {
    sql += ' AND h.type = ?';
    params.push(type);
  }
  if (keyword) {
    sql += ' AND (h.content LIKE ? OR h.prompt LIKE ? OR u.username LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  return sql;
}

function getAllHistory(options = {}) {
  const { limit = 100, offset = 0 } = options;
  const params = [];
  let sql = appendAdminHistoryFilters(
    'SELECT h.*, u.username FROM history h LEFT JOIN users u ON h.user_id = u.id WHERE 1=1',
    params,
    options
  );
  sql += ' ORDER BY h.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

function getAllHistoryCount(options = {}) {
  const params = [];
  const sql = appendAdminHistoryFilters(
    'SELECT COUNT(*) as total FROM history h LEFT JOIN users u ON h.user_id = u.id WHERE 1=1',
    params,
    options
  );
  return db.prepare(sql).get(...params).total;
}

function deleteHistoryAdmin(id) {
  const row = db.prepare('SELECT * FROM history WHERE id = ?').get(id);
  if (!row) return { success: false, reason: 'not_found' };
  if (row.sub_type === 'xi-edit' || row.sub_type === 'xi-generate') {
    let meta = {};
    try { meta = JSON.parse(row.content || '{}'); } catch {}
    if (['queued', 'running'].includes(meta.status)) return { success: false, reason: 'active' };
  }
  const result = db.prepare('DELETE FROM history WHERE id = ?').run(id);
  return { success: result.changes > 0, row };
}

function userOwnsUpload(userId, filename) {
  const safeFilename = String(filename || '').trim();
  if (!safeFilename || safeFilename.includes('/') || safeFilename.includes('\\')) return false;
  const needle = `%/uploads/${safeFilename}%`;
  const row = db.prepare(`
    SELECT id FROM history
    WHERE user_id = ? AND (image_url LIKE ? OR content LIKE ?)
    LIMIT 1
  `).get(userId, needle, needle);
  return Boolean(row);
}

module.exports = {
  addHistory,
  deleteHistory,
  deleteHistoryAdmin,
  getAllHistory,
  getAllHistoryCount,
  getUserHistory,
  getUserHistoryCount,
  updateHistory,
  userOwnsUpload
};
