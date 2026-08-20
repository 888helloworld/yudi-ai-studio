const { db } = require('../database');

function addAdminAuditLog({ adminUserId, action, targetType = '', targetId = '', details = {}, ipAddress = '', userAgent = '' }) {
  db.prepare(`
    INSERT INTO admin_audit_logs
      (admin_user_id, action, target_type, target_id, details, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    adminUserId,
    String(action || '').slice(0, 80),
    String(targetType || '').slice(0, 50),
    String(targetId || '').slice(0, 120),
    JSON.stringify(details || {}).slice(0, 5000),
    String(ipAddress || '').slice(0, 100),
    String(userAgent || '').slice(0, 500)
  );
}

function getAdminAuditLogs({ limit = 50, offset = 0 } = {}) {
  return db.prepare(`
    SELECT l.*, u.username AS admin_username
    FROM admin_audit_logs l
    LEFT JOIN users u ON u.id = l.admin_user_id
    ORDER BY l.id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

function getAdminAuditLogCount() {
  return db.prepare('SELECT COUNT(*) AS total FROM admin_audit_logs').get().total;
}

module.exports = { addAdminAuditLog, getAdminAuditLogs, getAdminAuditLogCount };
