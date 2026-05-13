const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const dbPath = path.join(__dirname, 'data.db');
const db = new Database(dbPath);
const NEW_USER_BONUS_POINTS = Number(process.env.NEW_USER_BONUS_POINTS || 1000);

// 初始化数据库
function initDatabase() {
  // 用户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      points INTEGER DEFAULT 1000,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 积分记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      balance INTEGER NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 历史记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      sub_type TEXT,
      content TEXT,
      image_url TEXT,
      prompt TEXT,
      ratio TEXT,
      cost_points INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 卡密表
  db.exec(`
    CREATE TABLE IF NOT EXISTS cdkeys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      points INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      used_by INTEGER,
      used_at DATETIME,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (used_by) REFERENCES users(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  // 支付订单表
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      points INTEGER NOT NULL,
      channel TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      trade_no TEXT,
      paid_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 索引
  db.exec(`CREATE INDEX IF NOT EXISTS idx_history_user_id ON history(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_point_logs_user_id ON point_logs(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cdkeys_code ON cdkeys(code)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status)`);

  // 检查是否需要创建邀请码
  const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!adminExists) {
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomUUID();
    const hash = bcrypt.hashSync(adminPassword, 10);
    db.prepare('INSERT INTO users (username, password_hash, points, role) VALUES (?, ?, ?, ?)').run(adminUsername, hash, 99999, 'admin');
    console.log('Initial administrator account created.');
    if (!process.env.ADMIN_PASSWORD) {
      console.log('Set ADMIN_PASSWORD in .env before first launch to choose the initial password.');
    }
  }

  console.log('数据库初始化完成');
}

// =============================================
// 用户操作
// =============================================

// 注册用户
function createUser(username, password) {
  const hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare('INSERT INTO users (username, password_hash, points) VALUES (?, ?, ?)');
  try {
    const result = stmt.run(username, hash, NEW_USER_BONUS_POINTS);
    
    // 记录积分日志
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    addPointLog(user.id, 'recharge', NEW_USER_BONUS_POINTS, user.points, '新用户注册赠送');
    
    return user;
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      throw new Error('用户名已存在');
    }
    throw e;
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
    } catch (e) {
      if (e.message.includes('UNIQUE')) throw new Error('用户名已存在');
      throw e;
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

// 用户登录验证
function verifyUser(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  return user;
}

// 获取用户信息
function getUserById(id) {
  return db.prepare('SELECT id, username, points, role, created_at FROM users WHERE id = ?').get(id);
}

// 获取所有用户（管理员用）
function getAllUsers() {
  return db.prepare('SELECT id, username, points, role, created_at FROM users ORDER BY created_at DESC').all();
}

// 删除用户
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
    db.prepare('DELETE FROM point_logs WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM history WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return true;
  });
  return transaction(id);
}

// =============================================
// 积分操作
// =============================================

// 扣减积分（原子操作，防并发刷分）
function deductPoints(userId, amount, description) {
  if (amount <= 0) {
    return { success: false, message: '无效的扣减数量' };
  }
  
  // 原子操作：points >= amount 时才扣减，防止并发竞态
  const result = db.prepare('UPDATE users SET points = points - ? WHERE id = ? AND points >= ?').run(amount, userId, amount);
  
  if (result.changes === 0) {
    return { success: false, message: '积分不足' };
  }
  
  const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
  addPointLog(userId, 'consume', -amount, user.points, description);
  return { success: true, balance: user.points };
}

// 充值积分
function rechargePoints(userId, amount, description = '管理员充值') {
  if (amount <= 0) return null;
  
  const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  
  const newBalance = user.points + amount;
  
  const transaction = db.transaction(() => {
    db.prepare('UPDATE users SET points = ? WHERE id = ?').run(newBalance, userId);
    addPointLog(userId, 'recharge', amount, newBalance, description);
  });
  
  transaction();
  return { balance: newBalance };
}

// 添加积分记录
function addPointLog(userId, type, amount, balance, description) {
  db.prepare('INSERT INTO point_logs (user_id, type, amount, balance, description) VALUES (?, ?, ?, ?, ?)')
    .run(userId, type, amount, balance, description);
}

// 获取积分记录
function getPointLogs(userId, limit = 50, offset = 0) {
  return db.prepare('SELECT * FROM point_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(userId, limit, offset);
}

function getPointLogsCount(userId) {
  return db.prepare('SELECT COUNT(*) as total FROM point_logs WHERE user_id = ?').get(userId).total;
}

// 获取用户积分
function getUserPoints(userId) {
  const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
  return user ? user.points : 0;
}

// =============================================
// 历史记录操作
// =============================================

// 添加历史记录
function addHistory(userId, type, data) {
  const stmt = db.prepare(`
    INSERT INTO history (user_id, type, sub_type, content, image_url, prompt, ratio, cost_points)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    userId,
    type,
    data.sub_type || null,
    data.content || null,
    data.image_url || null,
    data.prompt || null,
    data.ratio || null,
    data.cost_points ?? null
  );
  
  return result.lastInsertRowid;
}

// 获取用户历史
function getUserHistory(userId, options = {}) {
  const { type, startDate, endDate, keyword, limit = 50, offset = 0 } = options;
  
  let sql = 'SELECT * FROM history WHERE user_id = ?';
  const params = [userId];
  
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  
  if (startDate) {
    sql += ' AND created_at >= ?';
    params.push(startDate);
  }
  
  if (endDate) {
    sql += ' AND created_at <= ?';
    params.push(endDate);
  }
  
  if (keyword) {
    sql += ' AND (content LIKE ? OR prompt LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  return db.prepare(sql).all(...params);
}

// 获取历史总数（用于分页）
function getUserHistoryCount(userId, options = {}) {
  const { type, startDate, endDate, keyword } = options;
  
  let sql = 'SELECT COUNT(*) as total FROM history WHERE user_id = ?';
  const params = [userId];
  
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  
  if (startDate) {
    sql += ' AND created_at >= ?';
    params.push(startDate);
  }
  
  if (endDate) {
    sql += ' AND created_at <= ?';
    params.push(endDate);
  }
  
  if (keyword) {
    sql += ' AND (content LIKE ? OR prompt LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  
  const result = db.prepare(sql).get(...params);
  return result.total;
}

// 删除历史记录
function deleteHistory(id, userId) {
  db.prepare('DELETE FROM history WHERE id = ? AND user_id = ?').run(id, userId);
  return true;
}

// 获取所有历史（管理员用）
function getAllHistory(options = {}) {
  const { type, keyword, limit = 100, offset = 0 } = options;
  
  let sql = 'SELECT h.*, u.username FROM history h LEFT JOIN users u ON h.user_id = u.id WHERE 1=1';
  const params = [];
  
  if (type) {
    sql += ' AND h.type = ?';
    params.push(type);
  }
  
  if (keyword) {
    sql += ' AND (h.content LIKE ? OR h.prompt LIKE ? OR u.username LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  
  sql += ' ORDER BY h.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  return db.prepare(sql).all(...params);
}

function getAllHistoryCount(options = {}) {
  const { type, keyword } = options;
  let sql = 'SELECT COUNT(*) as total FROM history h LEFT JOIN users u ON h.user_id = u.id WHERE 1=1';
  const params = [];

  if (type) {
    sql += ' AND h.type = ?';
    params.push(type);
  }

  if (keyword) {
    sql += ' AND (h.content LIKE ? OR h.prompt LIKE ? OR u.username LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  return db.prepare(sql).get(...params).total;
}

// 删除单条历史（管理员）
function deleteHistoryAdmin(id) {
  db.prepare('DELETE FROM history WHERE id = ?').run(id);
  return true;
}

// =============================================
// 统计数据
// =============================================

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

// 获取用户统计
function countStoredImageUrls(value) {
  if (!value) return 0;
  if (Array.isArray(value)) return value.filter(Boolean).length;

  const text = String(value).trim();
  if (!text) return 0;
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).length;
    } catch (err) {}
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

  const totalRecords = historyRows.length;
  const totalCost = db.prepare("SELECT COALESCE(SUM(cost_points), 0) as sum FROM history WHERE user_id = ?").get(userId).sum;
  const totalRecharge = db.prepare("SELECT COALESCE(SUM(amount), 0) as sum FROM point_logs WHERE user_id = ? AND type = 'recharge'").get(userId).sum;
  const currentPoints = getUserPoints(userId);

  return { currentPoints, totalImages, totalCopies, totalBoth, totalRecords, totalCost, totalRecharge };
}

// 修改密码（用户自己改）
function changePassword(userId, oldPassword, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { success: false, error: '用户不存在' };
  if (!bcrypt.compareSync(oldPassword, user.password_hash)) return { success: false, error: '旧密码不正确' };
  
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, userId);
  return { success: true };
}

// 管理员重置用户密码（无需旧密码）
function adminResetPassword(userId, newPassword) {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return { success: false, error: '用户不存在' };
  
  if (newPassword.length < 8) return { success: false, error: '密码长度至少8位' };
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
    return { success: false, error: '密码需包含大小写字母和数字' };
  }
  
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, userId);
  return { success: true };
}

// 获取每日生成统计（管理员用）
function getDailyStats(days = 7) {
  const stmt = db.prepare(`
    SELECT date(created_at) as day, type, COUNT(*) as count, SUM(cost_points) as cost
    FROM history
    WHERE created_at >= datetime('now', ? || ' days')
    GROUP BY date(created_at), type
    ORDER BY day ASC
  `);
  return stmt.all(`-${days}`);
}

// 获取所有积分流水（管理员用）
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

// =============================================
// 卡密功能
// =============================================

// 生成卡密
function generateCdkeys(count, points, createdBy) {
  const stmt = db.prepare('INSERT INTO cdkeys (code, points, created_by) VALUES (?, ?, ?)');
  const keys = [];
  const transaction = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const code = 'XHS' + crypto.randomBytes(4).toString('hex').toUpperCase() + Date.now().toString(36).toUpperCase().slice(-4);
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
  const code = 'INV' + crypto.randomBytes(5).toString('hex').toUpperCase() + Date.now().toString(36).toUpperCase().slice(-4);
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
  return db.prepare("SELECT COUNT(*) as count FROM cdkeys WHERE created_by = ? AND used = 0 AND code LIKE 'INV%'").get(userId).count;
}

// 获取所有卡密（管理员用）
function getAllCdkeys(options = {}) {
  const { used, page = 1, limit = 50 } = options;
  let sql = 'SELECT c.*, u.username as used_by_name, cr.username as created_by_name FROM cdkeys c LEFT JOIN users u ON c.used_by = u.id LEFT JOIN users cr ON c.created_by = cr.id WHERE 1=1';
  const params = [];
  
  if (used === '0' || used === 0) {
    sql += ' AND c.used = 0';
  } else if (used === '1' || used === 1) {
    sql += ' AND c.used = 1';
  }
  
  const countSql = sql.replace('SELECT c.*, u.username as used_by_name, cr.username as created_by_name', 'SELECT COUNT(*) as total');
  const total = db.prepare(countSql).get(...params).total;
  
  sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
  const offset = (page - 1) * limit;
  params.push(limit, offset);
  
  const list = db.prepare(sql).all(...params);
  return { list, total };
}

// 兑换卡密
function redeemCdkey(code, userId) {
  const cdkey = db.prepare('SELECT * FROM cdkeys WHERE code = ?').get(code);
  if (!cdkey) return { success: false, error: '卡密不存在' };
  if (cdkey.used === 1) return { success: false, error: '卡密已被使用' };
  
  const transaction = db.transaction(() => {
    db.prepare('UPDATE cdkeys SET used = 1, used_by = ?, used_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId, cdkey.id);
    const result = rechargePoints(userId, cdkey.points, `卡密兑换 ${code}`);
    return result;
  });
  
  const result = transaction();
  return { success: true, points: cdkey.points, balance: result.balance };
}

// 验证邀请码（注册用，只检查不绑定用户）
function useCdkey(code) {
  const cdkey = db.prepare('SELECT * FROM cdkeys WHERE code = ?').get(code);
  if (!cdkey) return { success: false, error: '邀请码无效' };
  if (cdkey.used === 1) return { success: false, error: '邀请码已被使用' };
  return { success: true, points: cdkey.points };
}

// 获取卡密统计
function getCdkeyStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM cdkeys').get().count;
  const used = db.prepare('SELECT COUNT(*) as count FROM cdkeys WHERE used = 1').get().count;
  const totalPoints = db.prepare('SELECT COALESCE(SUM(points), 0) as sum FROM cdkeys').get().sum;
  const usedPoints = db.prepare('SELECT COALESCE(SUM(points), 0) as sum FROM cdkeys WHERE used = 1').get().sum;
  return { total, used, unused: total - used, totalPoints, usedPoints };
}

// =============================================
// 支付功能
// =============================================

// 创建支付订单
function createPaymentOrder(userId, amount, points, channel) {
  const orderNo = 'PAY' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
  db.prepare('INSERT INTO payment_orders (order_no, user_id, amount, points, channel) VALUES (?, ?, ?, ?, ?)')
    .run(orderNo, userId, amount, points, channel);
  return db.prepare('SELECT * FROM payment_orders WHERE order_no = ?').get(orderNo);
}

// 支付成功回调
function paySuccess(orderNo, tradeNo) {
  const order = db.prepare('SELECT * FROM payment_orders WHERE order_no = ?').get(orderNo);
  if (!order) return { success: false, error: '订单不存在' };
  if (order.status !== 'pending') return { success: false, error: '订单已处理' };
  
  const transaction = db.transaction(() => {
    db.prepare('UPDATE payment_orders SET status = ?, trade_no = ?, paid_at = CURRENT_TIMESTAMP WHERE order_no = ?')
      .run('paid', tradeNo, orderNo);
    const result = rechargePoints(order.user_id, order.points, `支付充值 ${order.channel} ${orderNo}`);
    return result;
  });
  
  const result = transaction();
  return { success: true, balance: result.balance };
}

function closePaymentOrder(orderNo) {
  const order = db.prepare('SELECT * FROM payment_orders WHERE order_no = ?').get(orderNo);
  if (!order) return { success: false, error: '订单不存在' };
  if (order.status !== 'pending') return { success: false, error: '只有待支付订单可以关闭' };
  db.prepare("UPDATE payment_orders SET status = 'closed' WHERE order_no = ?").run(orderNo);
  return { success: true };
}

// 获取用户支付订单
function getUserPaymentOrders(userId, limit = 20) {
  return db.prepare('SELECT * FROM payment_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit);
}

// 获取所有支付订单（管理员用）
function getAllPaymentOrders(options = {}) {
  const { page = 1, limit = 50 } = options;
  const offset = (page - 1) * limit;
  const list = db.prepare(`
    SELECT po.*, u.username FROM payment_orders po 
    LEFT JOIN users u ON po.user_id = u.id 
    ORDER BY po.created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as total FROM payment_orders').get().total;
  return { list, total };
}

// 获取支付统计
function getPaymentStats() {
  const totalOrders = db.prepare('SELECT COUNT(*) as count FROM payment_orders').get().count;
  const paidOrders = db.prepare("SELECT COUNT(*) as count FROM payment_orders WHERE status = 'paid'").get().count;
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(amount), 0) as sum FROM payment_orders WHERE status = 'paid'").get().sum;
  const totalPoints = db.prepare("SELECT COALESCE(SUM(points), 0) as sum FROM payment_orders WHERE status = 'paid'").get().sum;
  const today = new Date().toISOString().split('T')[0];
  const todayPaid = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as revenue, COALESCE(SUM(points), 0) as points
    FROM payment_orders
    WHERE status = 'paid' AND date(paid_at) = ?
  `).get(today);
  return {
    totalOrders,
    paidOrders,
    totalRevenue,
    totalPoints,
    todayPaidOrders: todayPaid.count || 0,
    todayPaidRevenue: todayPaid.revenue || 0,
    todayPaidPoints: todayPaid.points || 0
  };
}

// 初始化数据库
initDatabase();

module.exports = {
  db,
  createUser,
  createUserWithInvite,
  verifyUser,
  getUserById,
  getAllUsers,
  deleteUser,
  deductPoints,
  rechargePoints,
  getPointLogs,
  getPointLogsCount,
  getUserPoints,
  addHistory,
  getUserHistory,
  getUserHistoryCount,
  deleteHistory,
  getAllHistory,
  getAllHistoryCount,
  deleteHistoryAdmin,
  getStats,
  getUserStats,
  changePassword,
  adminResetPassword,
  getDailyStats,
  getAllPointLogs,
  getAllPointLogsCount,
  // 卡密
  generateCdkeys,
  generateUserInviteCode,
  getUserInviteCodes,
  getUserUnusedInviteCount,
  getAllCdkeys,
  redeemCdkey,
  useCdkey,
  getCdkeyStats,
  // 支付
  createPaymentOrder,
  paySuccess,
  closePaymentOrder,
  getUserPaymentOrders,
  getAllPaymentOrders,
  getPaymentStats
};
