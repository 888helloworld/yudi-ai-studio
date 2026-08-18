const express = require('express');
const db = require('../db');
const { getUserPaymentOrder } = require('../repositories/payment-repository');

function createPaymentRouter({ authMiddleware, safeCompareSecret }) {
  const router = express.Router();

  router.post('/api/payment/create', authMiddleware, async (req, res) => {
    res.status(503).json({ error: '在线充值暂未开放，请使用卡密兑换' });
  });

  router.post('/api/payment/callback', authMiddleware, async (req, res) => {
    const mockPaymentEnabled = process.env.ENABLE_MOCK_PAYMENT === 'true';
    const mockPaymentToken = process.env.MOCK_PAYMENT_TOKEN;
    if (!mockPaymentEnabled) {
      return res.status(403).json({ error: '模拟支付回调已禁用，请接入真实支付平台回调和验签' });
    }
    if (!mockPaymentToken) {
      return res.status(500).json({ error: '模拟支付回调缺少服务端保护令牌配置' });
    }
    const providedToken = req.get('X-Mock-Payment-Token') || req.body.mockPaymentToken;
    if (!safeCompareSecret(providedToken, mockPaymentToken)) {
      return res.status(403).json({ error: '模拟支付回调令牌无效' });
    }

    const { orderNo, tradeNo } = req.body;
    if (!orderNo) return res.status(400).json({ error: '参数不完整' });
    const order = getUserPaymentOrder(req.userId, orderNo);
    if (!order) return res.status(404).json({ error: '订单不存在' });

    const result = db.paySuccess(orderNo, tradeNo || `MOCK${Date.now()}`);
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true, balance: result.balance });
  });

  router.post('/api/payment/alipay/notify', async (req, res) => {
    console.warn('收到支付宝回调，但真实支付验签尚未接入。');
    res.status(501).json({ error: '支付宝回调验签尚未接入，请在管理后台人工核对订单后确认到账' });
  });

  router.post('/api/payment/wxpay/notify', async (req, res) => {
    console.warn('收到微信支付回调，但真实支付验签尚未接入。');
    res.status(501).json({ error: '微信支付回调验签尚未接入，请在管理后台人工核对订单后确认到账' });
  });

  router.get('/api/payment/status/:orderNo', authMiddleware, (req, res) => {
    const order = getUserPaymentOrder(req.userId, req.params.orderNo);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    res.json({ order, balance: db.getUserPoints(req.userId) });
  });

  router.get('/api/payment/orders', authMiddleware, (req, res) => {
    res.json({ orders: db.getUserPaymentOrders(req.userId) });
  });

  router.post('/api/cdkey/redeem', authMiddleware, (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: '请输入卡密' });
    const result = db.redeemCdkey(code.trim().toUpperCase(), req.userId);
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true, points: result.points, balance: result.balance });
  });

  return router;
}

module.exports = {
  createPaymentRouter
};
