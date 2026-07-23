const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const {
  getUserPoints,
  getPointLogs,
  getPointLogsCount,
  getUserHistory,
  getUserHistoryCount,
  deleteHistory,
  getUserStats,
  changePassword,
  getUserById,
  generateUserInviteCode,
  getUserInviteCodes,
  getUserUnusedInviteCount
} = require('../db');
const { authMiddleware } = require('../middleware/auth');

function parsePositiveInt(value, fallback, max) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

// 获取积分余额
router.get('/points', authMiddleware, (req, res) => {
  const points = getUserPoints(req.userId);
  res.json({ points });
});

// 获取积分记录
router.get('/points/logs', authMiddleware, (req, res) => {
  const page = parsePositiveInt(req.query.page, 1, 100000);
  const limit = parsePositiveInt(req.query.limit, 10, 100);
  const offset = (page - 1) * limit;
  const logs = getPointLogs(req.userId, limit, offset);
  const total = getPointLogsCount(req.userId);
  res.json({
    logs,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  });
});

// 获取历史记录
router.get('/history', authMiddleware, (req, res) => {
  const { type, keyword } = req.query;
  const page = parsePositiveInt(req.query.page, 1, 100000);
  const limit = parsePositiveInt(req.query.limit, 20, 1000);
  
  const offset = (page - 1) * limit;
  const history = getUserHistory(req.userId, {
    type,
    keyword,
    limit,
    offset
  });
  
  const total = getUserHistoryCount(req.userId, { type, keyword });
  
  res.json({
    history,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  });
});

// 删除单条历史
router.delete('/history/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  deleteHistory(parseInt(id), req.userId);
  res.json({ success: true });
});

// 获取当前用户信息
router.get('/me', authMiddleware, (req, res) => {
  const user = getUserById(req.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json(user);
});

// 获取用户统计
router.get('/stats', authMiddleware, (req, res) => {
  const stats = getUserStats(req.userId);
  res.json(stats);
});

// 获取我的邀请码
router.get('/invites', authMiddleware, (req, res) => {
  const invites = getUserInviteCodes(req.userId, { limit: 100 });
  const unusedCount = invites.filter(invite => invite.used === 0).length;
  res.json({ invites, unusedCount });
});

// 生成我的邀请码
router.post('/invites/generate', authMiddleware, (req, res) => {
  const maxUnused = Number(process.env.USER_INVITE_MAX_UNUSED || 10);
  const unusedCount = getUserUnusedInviteCount(req.userId);
  if (unusedCount >= maxUnused) {
    return res.status(400).json({ error: `未使用的邀请码最多保留 ${maxUnused} 个` });
  }

  const invite = generateUserInviteCode(req.userId);
  res.json({ success: true, invite });
});

// 修改密码
router.post('/change-password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '请填写旧密码和新密码' });

  const result = changePassword(req.userId, oldPassword, newPassword);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

module.exports = router;
