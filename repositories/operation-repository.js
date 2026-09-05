const crypto = require('node:crypto');
const { db } = require('../database');
const points = require('./point-repository');

function beginOperation(userId, clientId, endpoint, fingerprint, amount, description) {
  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM operations WHERE user_id = ? AND client_id = ?').get(userId, clientId);
    if (existing) {
      if (existing.endpoint !== endpoint || existing.fingerprint !== fingerprint || existing.charged !== amount) {
        throw Object.assign(new Error('同一任务号的内容不一致，请新建任务'), { statusCode: 409 });
      }
      return { operation: existing, alreadyApplied: true };
    }
    const id = crypto.randomUUID();
    const active = db.prepare("SELECT COUNT(*) total, COALESCE(SUM(user_id = ?),0) own FROM operations WHERE status = 'running'").get(userId);
    if (active.total >= 4 || active.own >= 2) throw Object.assign(new Error('正在处理的任务较多，请等待已有任务完成'), { statusCode: 429 });
    const charge = points.deductPoints(userId, amount, description, `operation:${id}:charge`);
    if (!charge.success) throw Object.assign(new Error('积分不足，请使用卡密兑换'), { statusCode: 400 });
    db.prepare(`INSERT INTO operations (id, user_id, client_id, endpoint, fingerprint, charged)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, userId, clientId, endpoint, fingerprint, amount);
    return { operation: getOperation(id), alreadyApplied: false, balance: charge.balance };
  }).immediate();
}

function getOperation(id) { return db.prepare('SELECT * FROM operations WHERE id = ?').get(id); }
function getUserOperation(userId, clientId) {
  return db.prepare('SELECT * FROM operations WHERE user_id = ? AND (client_id = ? OR id = ?)').get(userId, clientId, clientId);
}

function deliveredCost(id) {
  // 运行中占位记录不能算已交付；历史记录和业务号在同一条 INSERT 中落盘。
  return db.prepare(`SELECT COALESCE(SUM(COALESCE(cost_points, 0)), 0) total FROM history
    WHERE operation_id = ? AND COALESCE(json_extract(CASE WHEN json_valid(content) THEN content ELSE '{}' END, '$.status'), 'done') NOT IN ('running', 'queued', 'failed')`).get(id).total;
}

function refundOperation(id, amount, description) {
  return db.transaction(() => {
    const op = getOperation(id);
    if (!op || op.status !== 'running') return op;
    const refund = Math.max(0, Math.min(amount, op.charged - op.refunded - deliveredCost(id)));
    if (refund > 0) {
      points.rechargePoints(op.user_id, refund, description, `operation:${id}:refund:${op.refunded + refund}`, 'refund');
      db.prepare('UPDATE operations SET refunded = refunded + ? WHERE id = ?').run(refund, id);
    }
    return getOperation(id);
  }).immediate();
}

function settleOperation(id, result, successful) {
  return db.transaction(() => {
    let op = getOperation(id);
    if (!op || op.status !== 'running') return op;
    if (!successful) op = refundOperation(id, op.charged - op.refunded, '任务未完成部分自动退款');
    const actual = op.charged - op.refunded;
    const status = successful ? (op.refunded ? 'partial' : 'done') : (actual > 0 ? 'partial' : 'failed');
    const billing = { chargedPoints: op.charged, refundedPoints: op.refunded, actualCost: actual };
    const payload = { ...result, taskId: op.client_id, taskStatus: status, ...billing, remainingPoints: points.getUserPoints(op.user_id) };
    db.prepare("UPDATE operations SET status = ?, result = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'running'")
      .run(status, JSON.stringify(payload), id);
    return getOperation(id);
  }).immediate();
}

function recoverOperations() {
  const pending = db.prepare("SELECT * FROM operations WHERE status = 'running'").all();
  for (const op of pending) {
    db.transaction(() => {
      db.prepare(`UPDATE history SET content = ?, cost_points = 0 WHERE operation_id = ?
        AND json_valid(content) AND json_extract(CASE WHEN json_valid(content) THEN content ELSE '{}' END, '$.status') IN ('running','queued')`)
        .run(JSON.stringify({ status: 'failed', error: '服务重启，未完成部分已退款' }), op.id);
      settleOperation(op.id, { error: '服务重启，已保存的结果可在历史查看，未完成部分已退款' }, false);
    }).immediate();
  }
  return pending.length;
}

function serializeOperation(op) {
  if (!op) return null;
  return { id: op.client_id, status: op.status, chargedPoints: op.charged, refundedPoints: op.refunded,
    actualCost: op.charged - op.refunded, createdAt: op.created_at,
    result: op.result ? JSON.parse(op.result) : null };
}

module.exports = { beginOperation, getOperation, getUserOperation, refundOperation, settleOperation, recoverOperations, serializeOperation };
