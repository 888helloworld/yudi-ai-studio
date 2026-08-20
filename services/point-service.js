const db = require('../db');

function chargePoints(userId, amount, description) {
  const result = db.deductPoints(userId, amount, description);
  if (!result.success) {
    const error = new Error('积分不足，请充值');
    error.statusCode = 400;
    throw error;
  }
  return result.balance;
}

function refundPoints(userId, amount, description, referenceKey = null) {
  if (amount > 0) db.rechargePoints(userId, amount, description, referenceKey);
  return db.getUserPoints(userId);
}

module.exports = {
  chargePoints,
  refundPoints
};
