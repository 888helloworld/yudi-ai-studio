const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { addAdminAuditLog } = require('../repositories/admin-audit-repository');
const { productionChecks } = require('../services/production-checks');
const router = express.Router();
router.use('/api/admin/operations', authMiddleware, adminMiddleware);
router.get('/api/admin/operations', (req, res) => {
  const jobs = db.prepare(`SELECT status, COUNT(*) count, COALESCE(AVG((julianday(finished_at)-julianday(created_at))*86400),0) seconds
    FROM operations WHERE created_at >= datetime('now', '-30 days') GROUP BY status`).all();
  const xi = db.prepare(`SELECT COALESCE(json_extract(CASE WHEN json_valid(content) THEN content ELSE '{}' END, '$.status'), 'done') status,
    COUNT(*) count, AVG(COALESCE(json_extract(CASE WHEN json_valid(content) THEN content ELSE '{}' END, '$.duration_ms'),0))/1000 seconds
    FROM history WHERE operation_id IS NULL AND sub_type IN ('xi-generate','xi-edit') AND created_at >= datetime('now','-30 days') GROUP BY status`).all();
  const refunds = db.prepare("SELECT COALESCE(SUM(amount),0) total FROM point_logs WHERE type = 'refund' AND created_at >= datetime('now','-30 days')").get().total;
  const events = db.prepare("SELECT event_name, COUNT(*) count FROM analytics_events WHERE created_at >= datetime('now','-30 days') GROUP BY event_name").all();
  const costs = db.prepare("SELECT currency, SUM(amount) amount FROM provider_costs WHERE day >= date('now','-30 days') GROUP BY currency").all();
  const quality = db.prepare("SELECT status, COUNT(*) count FROM feedback WHERE category = 'quality' AND created_at >= datetime('now','-30 days') GROUP BY status").all();
  const directory = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
  let backup = null;
  try { backup = JSON.parse(fs.readFileSync(path.join(directory, 'latest-status.json'), 'utf8')); } catch {}
  const storage = fs.statfsSync(path.join(__dirname, '..'));
  res.json({ jobs, xi, refunds, events, costs, quality, backup, checks: productionChecks(),
    freeDiskGb: Number(storage.bavail) * Number(storage.bsize) / 1024 ** 3,
    openFeedback: db.prepare("SELECT COUNT(*) count FROM feedback WHERE status = 'open'").get().count });
});
router.post('/api/admin/operations/cost', (req, res) => {
  const { day, currency, amount, note = '' } = req.body;
  const numeric = Number(amount);
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10) !== day
    || !['CNY','USD'].includes(currency) || !Number.isFinite(numeric) || numeric < 0 || numeric > 1000000 || typeof note !== 'string' || note.length > 200) return res.status(400).json({ error: '请填写有效日期、币种和金额（0至100万）' });
  db.transaction(() => {
    db.prepare(`INSERT INTO provider_costs (day,currency,amount,note,updated_by) VALUES (?,?,?,?,?)
      ON CONFLICT(day,currency) DO UPDATE SET amount=excluded.amount,note=excluded.note,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).run(day,currency,numeric,note,req.userId);
    addAdminAuditLog({ adminUserId: req.userId, action: 'provider_cost.set', targetType: 'cost', targetId: day, details: { currency, amount: numeric, note }, ipAddress: req.ip });
  }).immediate();
  res.json({ success: true });
});
module.exports = router;
