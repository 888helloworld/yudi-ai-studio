const express = require('express');
const router = express.Router();
const { getAllUsers, deleteUser, rechargePoints, getAllHistory, deleteHistoryAdmin, getStats, getDailyStats, getAllPointLogs, adminResetPassword, generateCdkeys, getAllCdkeys, getCdkeyStats, getAllPaymentOrders, getPaymentStats } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

function parsePositiveInt(value, fallback, max) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

// 所有路由需要管理员权限
router.use(authMiddleware, adminMiddleware);

// 获取统计数据
router.get('/stats', (req, res) => {
  const stats = getStats();
  res.json(stats);
});

// 获取所有用户
router.get('/users', (req, res) => {
  const users = getAllUsers();
  res.json({ users });
});

// 充值积分
router.post('/users/recharge', (req, res) => {
  const { userId, amount, description } = req.body;
  
  if (!userId || !amount) {
    return res.status(400).json({ error: '参数错误' });
  }
  
  const numAmount = parseInt(amount);
  if (numAmount <= 0) {
    return res.status(400).json({ error: '充值金额必须大于0' });
  }
  
  const MAX_RECHARGE = 100000;
  if (numAmount > MAX_RECHARGE) {
    return res.status(400).json({ error: `单次充值不能超过${MAX_RECHARGE}` });
  }
  
  const result = rechargePoints(parseInt(userId), numAmount, description || '管理员充值');
  
  if (!result) {
    return res.status(400).json({ error: '用户不存在' });
  }
  
  res.json({ success: true, balance: result.balance });
});

// 删除用户
router.delete('/users/:id', (req, res) => {
  const { id } = req.params;
  
  // 不能删除自己
  if (parseInt(id) === req.userId) {
    return res.status(400).json({ error: '不能删除自己' });
  }
  
  try {
    const deleted = deleteUser(parseInt(id));
    if (!deleted) return res.status(404).json({ error: '用户不存在' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message || '删除用户失败' });
  }
});

// 获取所有历史记录
router.get('/history', (req, res) => {
  const { type, keyword } = req.query;
  const page = parsePositiveInt(req.query.page, 1, 100000);
  const limit = parsePositiveInt(req.query.limit, 50, 200);
  
  const offset = (page - 1) * limit;
  const history = getAllHistory({
    type,
    keyword,
    limit,
    offset
  });
  
  res.json({ history });
});

// 删除历史记录
router.delete('/history/:id', (req, res) => {
  const { id } = req.params;
  deleteHistoryAdmin(parseInt(id));
  res.json({ success: true });
});

// 管理员重置用户密码
router.post('/users/reset-password', (req, res) => {
  const { userId, newPassword } = req.body;
  
  if (!userId || !newPassword) {
    return res.status(400).json({ error: '参数不完整' });
  }
  
  const result = adminResetPassword(parseInt(userId), newPassword);
  
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  
  res.json({ success: true });
});

// 获取每日统计（图表用）
router.get('/daily-stats', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const stats = getDailyStats(days);
  res.json({ stats });
});

// 获取积分流水
router.get('/point-logs', (req, res) => {
  const page = parsePositiveInt(req.query.page, 1, 100000);
  const limit = parsePositiveInt(req.query.limit, 50, 200);
  const offset = (page - 1) * limit;
  const logs = getAllPointLogs(limit, offset);
  res.json({ logs });
});

// =============================================
// 卡密管理
// =============================================

// 生成卡密
router.post('/cdkeys/generate', (req, res) => {
  const { count, points } = req.body;
  const numCount = parseInt(count) || 1;
  const numPoints = parseInt(points) || 0;
  
  if (numCount < 1 || numCount > 100) return res.status(400).json({ error: '生成数量1-100' });
  if (numPoints < 10 || numPoints > 100000) return res.status(400).json({ error: '积分值10-100000' });
  
  const keys = generateCdkeys(numCount, numPoints, req.userId);
  const stats = getCdkeyStats();
  res.json({ success: true, keys, stats });
});

// 获取卡密列表
router.get('/cdkeys', (req, res) => {
  const { used, page, limit } = req.query;
  const result = getAllCdkeys({
    used,
    page: parsePositiveInt(page, 1, 100000),
    limit: parsePositiveInt(limit, 50, 200)
  });
  res.json(result);
});

// 获取卡密统计
router.get('/cdkeys/stats', (req, res) => {
  const stats = getCdkeyStats();
  res.json(stats);
});

// =============================================
// 支付订单管理
// =============================================

// 获取支付订单列表
router.get('/payment-orders', (req, res) => {
  const { page, limit } = req.query;
  const result = getAllPaymentOrders({
    page: parsePositiveInt(page, 1, 100000),
    limit: parsePositiveInt(limit, 50, 200)
  });
  res.json({ ...result, orders: result.list });
});

// 获取支付统计
router.get('/payment-orders/stats', (req, res) => {
  const stats = getPaymentStats();
  res.json(stats);
});

module.exports = router;
