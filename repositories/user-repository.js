const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { addPointLog } = require('./point-repository');
const { deleteUnreferencedUploads, extractUploadFilenames } = require('../utils/upload-cleanup');

const NEW_USER_BONUS_POINTS = Number(process.env.NEW_USER_BONUS_POINTS || 1000);

function createUser(username, password, policy = {}) {
  const hash = bcrypt.hashSync(password, 10);
  const transaction = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, points, policy_version, policy_accepted_at, policy_ip)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      username,
      hash,
      NEW_USER_BONUS_POINTS,
      policy.version || '',
      policy.acceptedAt || null,
      policy.ip || ''
    );
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    addPointLog(user.id, 'signup_bonus', NEW_USER_BONUS_POINTS, user.points, '新用户注册赠送');
    return user;
  });
  try {
    return transaction();
  } catch (error) {
    if (error.message.includes('UNIQUE')) throw new Error('用户名已存在');
    throw error;
  }
}

function createUserWithInvite(username, password, inviteCode, policy = {}) {
  const code = String(inviteCode || '').trim().toUpperCase();
  const transaction = db.transaction(() => {
    const cdkey = db.prepare('SELECT * FROM cdkeys WHERE code = ?').get(code);
    if (!cdkey) throw new Error('邀请码无效');
    if (cdkey.used === 1) throw new Error('邀请码已被使用');

    const hash = bcrypt.hashSync(password, 10);
    let result;
    try {
      result = db.prepare(`
        INSERT INTO users (username, password_hash, points, policy_version, policy_accepted_at, policy_ip)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(username, hash, NEW_USER_BONUS_POINTS, policy.version || '', policy.acceptedAt || null, policy.ip || '');
    } catch (error) {
      if (error.message.includes('UNIQUE')) throw new Error('用户名已存在');
      throw error;
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    addPointLog(user.id, 'signup_bonus', NEW_USER_BONUS_POINTS, user.points, '新用户注册赠送');

    const updated = db.prepare('UPDATE cdkeys SET used = 1, used_by = ?, used_at = CURRENT_TIMESTAMP WHERE id = ? AND used = 0')
      .run(user.id, cdkey.id);
    if (updated.changes === 0) throw new Error('邀请码已被使用');

    if (cdkey.points > 0) {
      user.points += cdkey.points;
      db.prepare('UPDATE users SET points = ? WHERE id = ?').run(user.points, user.id);
      addPointLog(user.id, 'invite_bonus', cdkey.points, user.points, '邀请码赠送');
    }

    return user;
  });

  return transaction();
}

function verifyUser(username, password) {
  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return null;
  user = resolveEffectiveUserStatus(user);
  return user;
}

function resolveEffectiveUserStatus(user) {
  if (!user || user.status !== 'frozen' || !user.status_until) return user;
  const untilText = String(user.status_until);
  const untilMs = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(untilText) ? untilText : `${untilText.replace(' ', 'T')}Z`);
  if (!Number.isFinite(untilMs) || untilMs > Date.now()) return user;
  db.prepare("UPDATE users SET status = 'active', status_reason = '', status_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'frozen'")
    .run(user.id);
  return { ...user, status: 'active', status_reason: '', status_until: null };
}

function getUserById(id) {
  return resolveEffectiveUserStatus(db.prepare('SELECT id, username, points, role, status, status_reason, status_until, created_at FROM users WHERE id = ?').get(id));
}

function getUserAuthById(id) {
  return resolveEffectiveUserStatus(db.prepare('SELECT id, username, points, role, status, status_reason, status_until, created_at, token_version FROM users WHERE id = ?').get(id));
}

function getAllUsers(options = {}) {
  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const params = [];
  let where = 'WHERE 1=1';
  if (options.keyword) {
    where += ' AND username LIKE ?';
    params.push(`%${String(options.keyword).slice(0, 100)}%`);
  }
  if (options.status && ['active', 'frozen', 'banned'].includes(options.status)) {
    where += ' AND status = ?';
    params.push(options.status);
  }
  const total = db.prepare(`SELECT COUNT(*) total FROM users ${where}`).get(...params).total;
  const list = db.prepare(`
    SELECT id, username, points, role, status, status_reason, status_until, created_at
    FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, (page - 1) * limit);
  return { list, total, page, limit };
}

function setUserStatus(userId, status, reason = '', statusUntil = null) {
  if (!['active', 'frozen', 'banned'].includes(status)) return { success: false, error: '无效的账号状态' };
  let normalizedUntil = null;
  if (status === 'frozen' && statusUntil) {
    const untilMs = Date.parse(String(statusUntil));
    if (!Number.isFinite(untilMs) || untilMs <= Date.now()) return { success: false, error: '冻结到期时间必须是未来的有效时间' };
    normalizedUntil = new Date(untilMs).toISOString();
  }
  const result = db.prepare(`
    UPDATE users SET status = ?, status_reason = ?, status_until = ?,
      token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND role != 'admin'
  `).run(status, String(reason || '').slice(0, 500), normalizedUntil, userId);
  return result.changes > 0 ? { success: true } : { success: false, error: '用户不存在或不能修改管理员状态' };
}

function adjustUserPoints(userId, amount, description, referenceKey) {
  const normalized = Math.trunc(Number(amount));
  if (!normalized || Math.abs(normalized) > 100000) return { success: false, error: '积分调整范围无效' };
  const transaction = db.transaction(() => {
    const result = db.prepare('UPDATE users SET points = points + ? WHERE id = ? AND points + ? >= 0')
      .run(normalized, userId, normalized);
    if (result.changes === 0) return { success: false, error: '用户不存在或扣减后余额不足' };
    const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
    addPointLog(userId, 'admin_adjust', normalized, user.points, description || '管理员调整积分', referenceKey || null);
    return { success: true, balance: user.points };
  });
  return transaction();
}

function deleteUser(id) {
  const transaction = db.transaction((userId) => {
    const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
    if (!user) return { deleted: false, uploadValues: [] };
    if (user.role === 'admin') throw new Error('不能删除管理员账号');

    const admin = db.prepare('SELECT id FROM users WHERE role = ? ORDER BY id ASC LIMIT 1').get('admin');
    if (!admin) throw new Error('缺少管理员账号，无法转移邀请码归属');

    const uploadValues = db.prepare('SELECT image_url, content FROM history WHERE user_id = ?').all(userId)
      .flatMap((row) => [row.image_url, row.content]);
    db.prepare('UPDATE cdkeys SET used_by = NULL WHERE used_by = ?').run(userId);
    db.prepare('UPDATE cdkeys SET created_by = ? WHERE created_by = ?').run(admin.id, userId);
    db.prepare('DELETE FROM payment_orders WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM templates WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM analytics_events WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM point_logs WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM history WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return { deleted: true, uploadValues };
  });
  const result = transaction(id);
  if (result.deleted) deleteUnreferencedUploads(extractUploadFilenames(result.uploadValues));
  return result.deleted;
}

function validatePasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < 8) return '密码长度至少8位';
  if (password.length > 128) return '密码长度不能超过128位';
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) return '密码需包含大小写字母和数字';
  return null;
}

function changePassword(userId, oldPassword, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { success: false, error: '用户不存在' };
  if (!bcrypt.compareSync(oldPassword, user.password_hash)) return { success: false, error: '旧密码不正确' };
  const passwordError = validatePasswordPolicy(newPassword);
  if (passwordError) return { success: false, error: passwordError };

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, userId);
  return { success: true };
}

function adminResetPassword(userId, newPassword) {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return { success: false, error: '用户不存在' };
  const passwordError = validatePasswordPolicy(newPassword);
  if (passwordError) return { success: false, error: passwordError };

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, userId);
  return { success: true };
}

function revokeUserTokens(userId) {
  const result = db.prepare('UPDATE users SET token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(userId);
  return result.changes > 0;
}

module.exports = {
  adjustUserPoints,
  adminResetPassword,
  changePassword,
  createUser,
  createUserWithInvite,
  deleteUser,
  getAllUsers,
  getUserAuthById,
  getUserById,
  revokeUserTokens,
  setUserStatus,
  verifyUser
};
