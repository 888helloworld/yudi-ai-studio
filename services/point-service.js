const db = require('../db');
const crypto = require('node:crypto');
const context = require('./operation-context');
const operations = require('../repositories/operation-repository');

function chargePoints(userId, amount, description, referenceKey = null) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw Object.assign(new Error('积分数量无效'), { statusCode: 400 });
  const state = context.getStore();
  if (state) {
    // 升级前已扣过的旧业务号继续去重，不因账本迁移再次扣费。
    if (referenceKey && require('../database').db.prepare('SELECT id FROM point_logs WHERE reference_key = ? AND user_id = ?').get(referenceKey, userId)) return { alreadyApplied: true, balance: db.getUserPoints(userId) };
    const req = state.req;
    const clientId = String(req.body?.clientTaskId || req.body?.clientRequestId || crypto.randomUUID());
    if (!/^[\w-]{1,160}$/.test(clientId)) throw Object.assign(new Error('任务号格式不正确'), { statusCode: 400 });
    const result = operations.beginOperation(userId, clientId, req.path, state.requestFingerprint(req), amount, description);
    state.operation = result.operation;
    state.duplicate = result.alreadyApplied;
    return result;
  }
  const result = db.deductPoints(userId, amount, description, referenceKey);
  if (!result.success) {
    const error = new Error('积分不足，请充值');
    error.statusCode = 400;
    throw error;
  }
  return result;
}

function refundPoints(userId, amount, description, referenceKey = null) {
  const state = context.getStore();
  if (state?.operation) {
    if (!state.duplicate) operations.refundOperation(state.operation.id, amount, description);
    return db.getUserPoints(userId);
  }
  if (amount > 0) db.rechargePoints(userId, amount, description, referenceKey, 'refund');
  return db.getUserPoints(userId);
}

module.exports = {
  chargePoints,
  refundPoints
};
