const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getAllUsers, deleteUser, rechargePoints, getAllHistory, getAllHistoryCount, deleteHistoryAdmin, getStats, getDailyStats, getAllPointLogs, getAllPointLogsCount, adminResetPassword, generateCdkeys, getAllCdkeys, getCdkeyStats, getAllPaymentOrders, getPaymentStats, paySuccess, closePaymentOrder } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

function parsePositiveInt(value, fallback, max) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

const DEFAULT_POINT_PACKAGES = [
  { points: 100, price: 9.9, label: '100积分' },
  { points: 300, price: 24.9, label: '300积分' },
  { points: 500, price: 39.9, label: '500积分' },
  { points: 1000, price: 69.9, label: '1000积分' },
  { points: 3000, price: 179.9, label: '3000积分' },
  { points: 5000, price: 269.9, label: '5000积分' },
];

function hasEnv(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function getXiXuBaseUrl() {
  return String(process.env.XI_XU_API_BASE_URL || 'https://api.xi-xu.me').replace(/\/+$/, '');
}

function getXiXuDiagnosticHeaders() {
  const headers = {};
  if (hasEnv('XI_XU_API_KEY')) headers.Authorization = `Bearer ${process.env.XI_XU_API_KEY}`;
  if (hasEnv('XI_XU_PROXY_TOKEN')) headers['X-XiXu-Proxy-Token'] = process.env.XI_XU_PROXY_TOKEN;
  return headers;
}

async function checkHttpReachable(url, headers = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers
    });
    return {
      ok: true,
      status: res.status,
      durationMs: Date.now() - startedAt
    };
  } catch (err) {
    return {
      ok: false,
      error: err.code || err.name || 'REQUEST_FAILED',
      message: err.message || String(err),
      durationMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timeout);
  }
}

function checkUploadDirectory() {
  const uploadDir = path.join(__dirname, '..', 'uploads');
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.accessSync(uploadDir, fs.constants.R_OK | fs.constants.W_OK);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err.code || 'UPLOAD_DIR_ERROR',
      message: err.message || String(err)
    };
  }
}

function getPaymentIntegrationStatus(req) {
  const provider = String(process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
  const publicOrigin = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const callbackBase = publicOrigin.replace(/\/+$/, '');
  const channels = [
    {
      key: 'alipay',
      name: '支付宝',
      configured: hasEnv('ALIPAY_APP_ID') && hasEnv('ALIPAY_PRIVATE_KEY') && hasEnv('ALIPAY_PUBLIC_KEY'),
      required: ['ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY'],
      callbackUrl: `${callbackBase}/api/payment/alipay/notify`
    },
    {
      key: 'wxpay',
      name: '微信支付',
      configured: hasEnv('WXPAY_APP_ID') && hasEnv('WXPAY_MCH_ID') && hasEnv('WXPAY_PRIVATE_KEY') && hasEnv('WXPAY_API_V3_KEY'),
      required: ['WXPAY_APP_ID', 'WXPAY_MCH_ID', 'WXPAY_PRIVATE_KEY', 'WXPAY_API_V3_KEY'],
      callbackUrl: `${callbackBase}/api/payment/wxpay/notify`
    }
  ];

  return {
    provider,
    modeLabel: provider === 'mock' ? '模拟/人工确认' : '真实支付待接入',
    mockPaymentEnabled: process.env.ENABLE_MOCK_PAYMENT === 'true',
    mockPaymentTokenConfigured: hasEnv('MOCK_PAYMENT_TOKEN'),
    publicBaseUrlConfigured: hasEnv('PUBLIC_BASE_URL'),
    publicBaseUrl: publicOrigin,
    packages: DEFAULT_POINT_PACKAGES,
    channels
  };
}

// 所有路由需要管理员权限
router.use(authMiddleware, adminMiddleware);

// 获取统计数据
router.get('/stats', (req, res) => {
  const stats = getStats();
  res.json(stats);
});

router.get('/image-service-diagnostics', async (req, res) => {
  const xiXuBaseUrl = getXiXuBaseUrl();
  const apiKeyConfigured = hasEnv('XI_XU_API_KEY');
  const modelsReachability = await checkHttpReachable(`${xiXuBaseUrl}/v1/models`, getXiXuDiagnosticHeaders());

  res.json({
    node: {
      version: process.version,
      fetchAvailable: typeof fetch === 'function',
      formDataAvailable: typeof FormData === 'function',
      blobAvailable: typeof Blob === 'function'
    },
    env: {
      nodeEnv: process.env.NODE_ENV || '',
      port: process.env.PORT || '3001',
      xiXuApiBaseUrl: xiXuBaseUrl,
      xiXuApiKeyConfigured: apiKeyConfigured,
      xiXuImageModel: process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2',
      xiXuVisionModel: process.env.XI_XU_VISION_MODEL || 'gpt-5.5',
      xiXuProxyTokenConfigured: hasEnv('XI_XU_PROXY_TOKEN'),
      xiXuMaxActiveJobs: process.env.XI_XU_MAX_ACTIVE_JOBS || '1',
      xiXuRateLimitPerMin: process.env.XI_XU_IMAGE_RATE_LIMIT_PER_MIN || '30',
      arkFallbackEnabled: /^true$/i.test(process.env.ARK_FALLBACK_ENABLED || ''),
      arkApiKeyConfigured: hasEnv('ARK_API_KEY')
    },
    storage: {
      uploads: checkUploadDirectory()
    },
    upstream: {
      modelsEndpoint: modelsReachability
    }
  });
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
  const total = getAllHistoryCount({ type, keyword });
  
  res.json({
    history,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  });
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
  const total = getAllPointLogsCount();
  res.json({
    logs,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  });
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
  const pageNum = parsePositiveInt(page, 1, 100000);
  const limitNum = parsePositiveInt(limit, 50, 200);
  const result = getAllCdkeys({
    used,
    page: pageNum,
    limit: limitNum
  });
  res.json({
    ...result,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(result.total / limitNum)
  });
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
  const pageNum = parsePositiveInt(page, 1, 100000);
  const limitNum = parsePositiveInt(limit, 50, 200);
  const result = getAllPaymentOrders({
    page: pageNum,
    limit: limitNum
  });
  res.json({
    ...result,
    orders: result.list,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(result.total / limitNum)
  });
});

// 获取支付统计
router.get('/payment-orders/stats', (req, res) => {
  const stats = getPaymentStats();
  res.json(stats);
});

// 获取支付对接状态。只返回配置状态，不返回任何密钥明文。
router.get('/payment-config', (req, res) => {
  res.json(getPaymentIntegrationStatus(req));
});

// 管理员人工确认到账，用于真实支付未完全自动化或线下核对后补单。
router.post('/payment-orders/:orderNo/mark-paid', (req, res) => {
  const { orderNo } = req.params;
  const tradeNo = String(req.body.tradeNo || '').trim() || `ADMIN-${Date.now()}`;
  const result = paySuccess(orderNo, tradeNo);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, balance: result.balance });
});

router.post('/payment-orders/:orderNo/close', (req, res) => {
  const { orderNo } = req.params;
  const result = closePaymentOrder(orderNo);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

module.exports = router;
