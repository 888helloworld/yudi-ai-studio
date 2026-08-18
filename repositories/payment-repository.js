const { db } = require('../database/connection');

function getUserPaymentOrder(userId, orderNo) {
  return db.prepare('SELECT * FROM payment_orders WHERE order_no = ? AND user_id = ?')
    .get(orderNo, userId);
}

module.exports = {
  getUserPaymentOrder
};
