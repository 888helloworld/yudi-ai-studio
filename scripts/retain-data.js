require('dotenv').config();
const { db } = require('../database');
function retainData() {
  const days = Math.min(3650, Math.max(30, Number.parseInt(process.env.FINANCIAL_RETENTION_DAYS) || 1095));
  return db.transaction(() => {
    db.prepare("UPDATE operations SET result=NULL WHERE status != 'running' AND finished_at < datetime('now','-30 days')").run();
    db.prepare("DELETE FROM feedback WHERE updated_at < datetime('now','-180 days')").run();
    db.prepare("DELETE FROM analytics_events WHERE created_at < datetime('now','-90 days')").run();
    const users = db.prepare("SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?) AND role != 'admin'").all(`-${days} days`);
    for (const user of users) {
      db.prepare('DELETE FROM operations WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM payment_orders WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM point_logs WHERE user_id=?').run(user.id);
      db.prepare('UPDATE cdkeys SET used_by=NULL WHERE used_by=?').run(user.id);
      db.prepare('DELETE FROM users WHERE id=? AND deleted_at IS NOT NULL').run(user.id);
    }
    return { purgedClosedAccounts:users.length, financialRetentionDays:days };
  }).immediate();
}
if (require.main === module) {
  try { console.log(JSON.stringify(retainData())); } finally { db.close(); }
}
module.exports = { retainData };
