require('./database');
const userRepository = require('./repositories/user-repository');
const pointRepository = require('./repositories/point-repository');
const historyRepository = require('./repositories/history-repository');
const statsRepository = require('./repositories/stats-repository');
const cdkeyRepository = require('./repositories/cdkey-repository');
const paymentRepository = require('./repositories/payment-repository');

module.exports = {
  ...userRepository,
  ...pointRepository,
  ...historyRepository,
  getStats: statsRepository.getStats,
  getUserStats: statsRepository.getUserStats,
  getDailyStats: statsRepository.getDailyStats,
  ...cdkeyRepository,
  ...paymentRepository
};
