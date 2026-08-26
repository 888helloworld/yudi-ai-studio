const crypto = require('crypto');
const { db } = require('../database');
const { rechargePoints } = require('./point-repository');

function createPaymentOrder(userId, amount, points, channel) {
  const orderNo = `PAY${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  db.prepare('INSERT INTO payment_orders (order_no, user_id, amount, points, channel) VALUES (?, ?, ?, ?, ?)')
    .run(orderNo, userId, amount, points, channel);
  return db.prepare('SELECT * FROM payment_orders WHERE order_no = ?').get(orderNo);
}

function paySuccess(orderNo, tradeNo) {
  const order = db.prepare('SELECT * FROM payment_orders WHERE order_no = ?').get(orderNo);
  if (!order) return { success: false, error: '订单不存在' };
  if (order.status !== 'pending') return { success: false, error: '订单已处理' };

  const transaction = db.transaction(() => {
    const claim = db.prepare("UPDATE payment_orders SET status = 'paid', trade_no = ?, paid_at = CURRENT_TIMESTAMP WHERE order_no = ? AND status = 'pending'")
      .run(tradeNo, orderNo);
    if (claim.changes === 0) throw new Error('订单已处理');
    return rechargePoints(order.user_id, order.points, `支付充值 ${order.channel} ${orderNo}`);
  });

  try {
    const result = transaction();
    return { success: true, balance: result.balance };
  } catch (error) {
    if (error.message === '订单已处理') return { success: false, error: '订单已处理' };
    throw error;
  }
}

function closePaymentOrder(orderNo) {
  const order = db.prepare('SELECT * FROM payment_orders WHERE order_no = ?').get(orderNo);
  if (!order) return { success: false, error: '订单不存在' };
  if (order.status !== 'pending') return { success: false, error: '只有待支付订单可以关闭' };
  const result = db.prepare("UPDATE payment_orders SET status = 'closed' WHERE order_no = ? AND status = 'pending'")
    .run(orderNo);
  if (result.changes === 0) return { success: false, error: '只有待支付订单可以关闭' };
  return { success: true };
}

function getUserPaymentOrder(userId, orderNo) {
  return db.prepare('SELECT * FROM payment_orders WHERE order_no = ? AND user_id = ?').get(orderNo, userId);
}

function getUserPaymentOrders(userId, limit = 20) {
  return db.prepare('SELECT * FROM payment_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit);
}

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

function getPaymentStats() {
  const totalOrders = db.prepare('SELECT COUNT(*) as count FROM payment_orders').get().count;
  const paidOrders = db.prepare("SELECT COUNT(*) as count FROM payment_orders WHERE status = 'paid'").get().count;
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(amount), 0) as sum FROM payment_orders WHERE status = 'paid'").get().sum;
  const totalPoints = db.prepare("SELECT COALESCE(SUM(points), 0) as sum FROM payment_orders WHERE status = 'paid'").get().sum;
  const todayPaid = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as revenue, COALESCE(SUM(points), 0) as points
    FROM payment_orders
    WHERE status = 'paid' AND date(datetime(paid_at, '+8 hours')) = date('now', '+8 hours')
  `).get();
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

module.exports = {
  closePaymentOrder,
  createPaymentOrder,
  getAllPaymentOrders,
  getPaymentStats,
  getUserPaymentOrder,
  getUserPaymentOrders,
  paySuccess
};
