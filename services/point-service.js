const db = require('../db');

function chargePoints(userId, amount, description, referenceKey = null) {
  const result = db.deductPoints(userId, amount, description, referenceKey);
  if (!result.success) {
    const error = new Error('积分不足，请充值');
    error.statusCode = 400;
    throw error;
  }
  return result;
}

function refundPoints(userId, amount, description, referenceKey = null) {
  if (amount > 0) db.rechargePoints(userId, amount, description, referenceKey, 'refund');
  return db.getUserPoints(userId);
}

module.exports = {
  chargePoints,
  refundPoints
};
