const express = require('express');
const router = express.Router();
const { parsePositiveInt } = require('../utils/pagination');
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
const { deleteUnreferencedUploads, extractUploadFilenames } = require('../utils/upload-cleanup');

function readBoundedEnvInteger(name, fallback, minimum, maximum) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), minimum), maximum);
}

function isInviteGenerationEnabled() {
  const configured = String(process.env.USER_INVITE_ENABLED || '').trim();
  if (/^true$/i.test(configured)) return true;
  if (/^false$/i.test(configured)) return false;
  return process.env.NODE_ENV !== 'production';
}

function getInviteGenerationPolicy(user, invites) {
  if (!isInviteGenerationEnabled()) return { allowed: false, error: '邀请码生成功能暂未开放' };

  const dailyLimit = readBoundedEnvInteger('USER_INVITE_DAILY_LIMIT', 3, 0, 100);
  const lifetimeLimit = readBoundedEnvInteger('USER_INVITE_LIFETIME_LIMIT', 20, 0, 1000);
  const minimumAgeDays = readBoundedEnvInteger('USER_INVITE_MIN_ACCOUNT_AGE_DAYS', 1, 0, 3650);
  const minimumPoints = readBoundedEnvInteger('USER_INVITE_MIN_POINTS_BALANCE', 0, 0, 100000000);
  if (dailyLimit === 0 || lifetimeLimit === 0) return { allowed: false, error: '邀请码生成功能暂未开放' };

  const createdAtMs = Date.parse(`${String(user?.created_at || '').replace(' ', 'T')}Z`);
  if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs < minimumAgeDays * 86400000) {
    return { allowed: false, error: `账号注册满 ${minimumAgeDays} 天后才能生成邀请码` };
  }
  if (Number(user?.points || 0) < minimumPoints) {
    return { allowed: false, error: `积分余额达到 ${minimumPoints} 后才能生成邀请码` };
  }
  if (invites.length >= lifetimeLimit) return { allowed: false, error: `每个账号最多生成 ${lifetimeLimit} 个邀请码` };

  const beijingToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const generatedToday = invites.filter((invite) => {
    const parsed = Date.parse(`${String(invite.created_at || '').replace(' ', 'T')}Z`);
    return Number.isFinite(parsed)
      && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(parsed)) === beijingToday;
  }).length;
  if (generatedToday >= dailyLimit) return { allowed: false, error: `每天最多生成 ${dailyLimit} 个邀请码` };
  return { allowed: true };
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
  const excludeSubTypes = String(req.query.excludeSubTypes || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 20);
  const page = parsePositiveInt(req.query.page, 1, 100000);
  const limit = parsePositiveInt(req.query.limit, 20, 1000);
  
  const offset = (page - 1) * limit;
  const history = getUserHistory(req.userId, {
    type,
    keyword,
    excludeSubTypes,
    limit,
    offset
  });
  
  const total = getUserHistoryCount(req.userId, { type, keyword, excludeSubTypes });
  
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
  const result = deleteHistory(parseInt(id), req.userId);
  if (!result.success && result.reason === 'active') return res.status(409).json({ error: '任务仍在生成中，完成或失败后才能删除' });
  if (!result.success) return res.status(404).json({ error: '记录不存在' });
  deleteUnreferencedUploads(extractUploadFilenames(result.row.image_url, result.row.content));
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
  const maxUnused = readBoundedEnvInteger('USER_INVITE_MAX_UNUSED', 5, 1, 100);
  const unusedCount = getUserUnusedInviteCount(req.userId);
  if (unusedCount >= maxUnused) {
    return res.status(400).json({ error: `未使用的邀请码最多保留 ${maxUnused} 个` });
  }

  const lifetimeLimit = readBoundedEnvInteger('USER_INVITE_LIFETIME_LIMIT', 20, 0, 1000);
  const invites = getUserInviteCodes(req.userId, { limit: Math.max(lifetimeLimit + 1, 100) });
  const policy = getInviteGenerationPolicy(req.user, invites);
  if (!policy.allowed) return res.status(403).json({ error: policy.error });

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
module.exports.getInviteGenerationPolicy = getInviteGenerationPolicy;
module.exports.isInviteGenerationEnabled = isInviteGenerationEnabled;
