const { db } = require('../database/connection');

function getPublicStats() {
  const totalUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const totalRecords = db.prepare('SELECT COUNT(*) AS count FROM history').get().count;
  const totalCopies = db.prepare("SELECT COUNT(*) AS count FROM history WHERE type IN ('copy', 'both') AND content IS NOT NULL AND TRIM(content) <> ''").get().count;
  return { totalUsers, totalRecords, totalCopies };
}

module.exports = {
  getPublicStats
};
