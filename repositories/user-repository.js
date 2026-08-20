const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { addPointLog } = require('./point-repository');

const NEW_USER_BONUS_POINTS = Number(process.env.NEW_USER_BONUS_POINTS || 1000);

function createUser(username, password) {
  const hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare('INSERT INTO users (username, password_hash, points) VALUES (?, ?, ?)');
  try {
    const result = stmt.run(username, hash, NEW_USER_BONUS_POINTS);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    addPointLog(user.id, 'recharge', NEW_USER_BONUS_POINTS, user.points, '新用户注册赠送');
    return user;
  } catch (error) {
    if (error.message.includes('UNIQUE')) throw new Error('用户名已存在');
    throw error;
  }
}

function createUserWithInvite(username, password, inviteCode) {
  const code = String(inviteCode || '').trim().toUpperCase();
  const transaction = db.transaction(() => {
    const cdkey = db.prepare('SELECT * FROM cdkeys WHERE code = ?').get(code);
    if (!cdkey) throw new Error('邀请码无效');
    if (cdkey.used === 1) throw new Error('邀请码已被使用');

    const hash = bcrypt.hashSync(password, 10);
    let result;
    try {
      result = db.prepare('INSERT INTO users (username, password_hash, points) VALUES (?, ?, ?)')
        .run(username, hash, NEW_USER_BONUS_POINTS);
    } catch (error) {
      if (error.message.includes('UNIQUE')) throw new Error('用户名已存在');
      throw error;
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    addPointLog(user.id, 'recharge', NEW_USER_BONUS_POINTS, user.points, '新用户注册赠送');

    const updated = db.prepare('UPDATE cdkeys SET used = 1, used_by = ?, used_at = CURRENT_TIMESTAMP WHERE id = ? AND used = 0')
      .run(user.id, cdkey.id);
    if (updated.changes === 0) throw new Error('邀请码已被使用');

    if (cdkey.points > 0) {
      user.points += cdkey.points;
      db.prepare('UPDATE users SET points = ? WHERE id = ?').run(user.points, user.id);
      addPointLog(user.id, 'recharge', cdkey.points, user.points, '邀请码充值');
    }

    return user;
  });

  return transaction();
}

function verifyUser(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return null;
  return user;
}

function getUserById(id) {
  return db.prepare('SELECT id, username, points, role, created_at FROM users WHERE id = ?').get(id);
}

function getUserAuthById(id) {
  return db.prepare('SELECT id, username, points, role, created_at, token_version FROM users WHERE id = ?').get(id);
}

function getAllUsers() {
  return db.prepare('SELECT id, username, points, role, created_at FROM users ORDER BY created_at DESC').all();
}

function deleteUser(id) {
  const transaction = db.transaction((userId) => {
    const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
    if (!user) return false;
    if (user.role === 'admin') throw new Error('不能删除管理员账号');

    const admin = db.prepare('SELECT id FROM users WHERE role = ? ORDER BY id ASC LIMIT 1').get('admin');
    if (!admin) throw new Error('缺少管理员账号，无法转移邀请码归属');

    db.prepare('UPDATE cdkeys SET used_by = NULL WHERE used_by = ?').run(userId);
    db.prepare('UPDATE cdkeys SET created_by = ? WHERE created_by = ?').run(admin.id, userId);
    db.prepare('DELETE FROM payment_orders WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM templates WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM point_logs WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM history WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return true;
  });
  return transaction(id);
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
  adminResetPassword,
  changePassword,
  createUser,
  createUserWithInvite,
  deleteUser,
  getAllUsers,
  getUserAuthById,
  getUserById,
  revokeUserTokens,
  verifyUser
};
