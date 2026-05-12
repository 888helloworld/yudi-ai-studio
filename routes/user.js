const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const {
  getUserPoints,
  getPointLogs,
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

// 获取积分余额
router.get('/points', authMiddleware, (req, res) => {
  const points = getUserPoints(req.userId);
  res.json({ points });
});

// 获取积分记录
router.get('/points/logs', authMiddleware, (req, res) => {
  const logs = getPointLogs(req.userId);
  res.json({ logs });
});

// 获取历史记录
router.get('/history', authMiddleware, (req, res) => {
  const { type, keyword, page = 1, limit = 20 } = req.query;
  
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const history = getUserHistory(req.userId, {
    type,
    keyword,
    limit: parseInt(limit),
    offset
  });
  
  const total = getUserHistoryCount(req.userId, { type, keyword });
  
  res.json({
    history,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    totalPages: Math.ceil(total / parseInt(limit))
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
  if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6个字符' });

  const result = changePassword(req.userId, oldPassword, newPassword);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

module.exports = router;
