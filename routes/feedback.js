const express = require('express');
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const { db } = require('../database');
const { optionalAuth, authMiddleware, adminMiddleware } = require('../middleware/auth');
const { addAdminAuditLog } = require('../repositories/admin-audit-repository');
const router = express.Router();
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const limiter = rateLimit({ windowMs: 3600000, limit: 10, message: { error: '反馈过于频繁，请稍后再试' } });

router.post('/api/feedback', limiter, optionalAuth, (req, res) => {
  const { message, category = 'other', taskId = '', contact = '' } = req.body;
  if (typeof message !== 'string' || message.trim().length < 5 || message.length > 2000
    || !['account', 'billing', 'quality', 'other'].includes(category)
    || typeof taskId !== 'string' || taskId.length > 160 || typeof contact !== 'string' || contact.length > 200) {
    return res.status(400).json({ error: '请填写5至2000字的问题说明，并检查任务号和联系方式' });
  }
  const accessCode = crypto.randomBytes(24).toString('hex');
  const result = db.prepare('INSERT INTO feedback (user_id, category, task_id, message, contact, access_hash) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.userId || null, category, taskId, message.trim(), contact, digest(accessCode));
  res.json({ id: result.lastInsertRowid, accessCode });
});
router.get('/api/feedback/:id', rateLimit({windowMs:900000,limit:60,message:{error:'查询过于频繁，请稍后再试'}}), optionalAuth, (req, res) => {
  const item = db.prepare('SELECT * FROM feedback WHERE id = ?').get(req.params.id);
  const code = String(req.get('X-Feedback-Code') || '').slice(0, 100);
  if (!item || !((req.userId && req.userId === item.user_id) || (code && digest(code) === item.access_hash))) return res.status(404).json({ error: '反馈不存在或查询码不正确' });
  res.json({ id: item.id, status: item.status, reply: item.reply, createdAt: item.created_at });
});
router.get('/api/admin/feedback', authMiddleware, adminMiddleware, (req, res) => {
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page) || 1));
  res.json({ page, total: db.prepare('SELECT COUNT(*) total FROM feedback').get().total,
    items: db.prepare('SELECT id, user_id, category, task_id, message, contact, status, reply, created_at FROM feedback ORDER BY id DESC LIMIT 20 OFFSET ?').all((page - 1) * 20) });
});
router.post('/api/admin/feedback/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { reply, status } = req.body;
  if (typeof reply !== 'string' || reply.trim().length < 1 || reply.length > 2000 || !['open', 'resolved'].includes(status)) return res.status(400).json({ error: '请填写回复并选择有效状态' });
  const result = db.transaction(() => {
    const changed = db.prepare('UPDATE feedback SET reply = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(reply.trim(), status, req.params.id);
    if (changed.changes) addAdminAuditLog({ adminUserId: req.userId, action: 'feedback.reply', targetType: 'feedback', targetId: req.params.id, details: { status }, ipAddress: req.ip });
    return changed;
  })();
  if (!result.changes) return res.status(404).json({ error: '反馈不存在' });
  res.json({ success: true });
});
module.exports = router;
