const { db } = require('../database');

// 固定 SQL，所有筛选值均通过参数绑定；历史记录已有 operation_id 时不重复计数。
const taskQuery = `WITH tasks AS (
  SELECT 'operation:' || o.id task_key, o.user_id, o.client_id task_id, o.endpoint kind,
    o.status, o.charged, o.refunded, o.created_at, o.finished_at,
    substr(COALESCE(json_extract(CASE WHEN json_valid(o.result) THEN o.result ELSE '{}' END, '$.error'), ''),1,1500) error,
    'operation:' || o.id || ':refund:' refund_prefix, NULL refund_key
  FROM operations o
  UNION ALL
  SELECT 'history:' || h.id, h.user_id, COALESCE(h.client_task_id, 'history:' || h.id), COALESCE(h.sub_type,h.type),
    CASE WHEN json_extract(CASE WHEN json_valid(h.content) THEN h.content ELSE '{}' END, '$.status')='done' AND COALESCE(json_extract(CASE WHEN json_valid(h.content) THEN h.content ELSE '{}' END, '$.refunded_points'),0)>0 THEN 'partial' ELSE COALESCE(json_extract(CASE WHEN json_valid(h.content) THEN h.content ELSE '{}' END, '$.status'), 'unknown') END,
    COALESCE(h.cost_points,0) + COALESCE(json_extract(CASE WHEN json_valid(h.content) THEN h.content ELSE '{}' END, '$.refunded_points'),0),
    COALESCE(json_extract(CASE WHEN json_valid(h.content) THEN h.content ELSE '{}' END, '$.refunded_points'),0), h.created_at, NULL,
    substr(COALESCE(json_extract(CASE WHEN json_valid(h.content) THEN h.content ELSE '{}' END, '$.error'), ''),1,1500),
    NULL, 'xi-job-settlement:' || h.id
  FROM history h WHERE h.operation_id IS NULL AND h.sub_type IN ('xi-generate','xi-edit')
), filtered AS (
  SELECT t.*, u.username FROM tasks t LEFT JOIN users u ON u.id=t.user_id
  WHERE (@userId = 0 OR t.user_id=@userId)
    AND (@status='' OR t.status=@status)
    AND (@keyword='' OR instr(COALESCE(u.username,''),@keyword)>0 OR instr(t.task_id,@keyword)>0)
)`;

function getAdminTasks({ userId = 0, status = '', keyword = '', page = 1, limit = 20 } = {}) {
  const params = { userId, status, keyword, limit, offset: (page-1)*limit };
  const total = db.prepare(taskQuery + ' SELECT COUNT(*) total FROM filtered').get(params).total;
  const rows = db.prepare(taskQuery + ' SELECT * FROM filtered ORDER BY created_at DESC, task_key DESC LIMIT @limit OFFSET @offset').all(params);
  const refundQuery = db.prepare(`SELECT id, amount, balance, created_at, description FROM point_logs
    WHERE user_id=@userId AND amount>0 AND ((@prefix IS NOT NULL AND substr(reference_key,1,length(@prefix))=@prefix)
      OR (@key IS NOT NULL AND reference_key IN (@key, @legacyFailure, @legacyRecovery, @legacyPartial))) ORDER BY id DESC`);
  const items = rows.map(row => {
    const historyId = row.task_key.startsWith('history:') ? row.task_key.slice(8) : '';
    const refunds = refundQuery.all({ userId: row.user_id, prefix: row.refund_prefix, key: row.refund_key,
      legacyFailure: 'xi-job-failure:'+historyId, legacyRecovery: 'xi-job-recovery-failure:'+historyId, legacyPartial: 'xi-job-partial:'+historyId });
    const { refund_prefix, refund_key, ...task } = row;
    return { ...task, actualCost: Math.max(0, Number(row.charged)-Number(row.refunded)), refunds };
  });
  return { items, total, page, limit, totalPages: Math.ceil(total/limit) };
}

function getAdminUserDetail(userId, section = 'logs', page = 1, limit = 20) {
  const user = db.prepare(`SELECT id, username, points, role, status, status_reason, status_until, created_at, deleted_at
    FROM users WHERE id=?`).get(userId);
  if (!user) return null;
  const summary = {
    orders: db.prepare('SELECT COUNT(*) total FROM payment_orders WHERE user_id=?').get(userId).total,
    paidAmount: db.prepare("SELECT COALESCE(SUM(amount),0) total FROM payment_orders WHERE user_id=? AND status='paid'").get(userId).total,
    history: db.prepare('SELECT COUNT(*) total FROM history WHERE user_id=?').get(userId).total
  };
  const queries = {
    logs: ['SELECT id,type,amount,balance,description,created_at FROM point_logs WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?', 'SELECT COUNT(*) total FROM point_logs WHERE user_id=?'],
    orders: ['SELECT order_no,amount,points,channel,status,created_at,paid_at FROM payment_orders WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?', 'SELECT COUNT(*) total FROM payment_orders WHERE user_id=?'],
    history: ['SELECT id,type,sub_type,substr(prompt,1,1000) prompt,cost_points,created_at FROM history WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?', 'SELECT COUNT(*) total FROM history WHERE user_id=?']
  };
  if (section === 'tasks') return { user, summary, ...getAdminTasks({ userId, page, limit }) };
  const query = queries[section];
  if (!query) throw Object.assign(new Error('无效的明细类型'), { statusCode: 400 });
  const items = db.prepare(query[0]).all(userId,limit,(page-1)*limit);
  const total = db.prepare(query[1]).get(userId).total;
  return { user, summary, items, total, page, limit, totalPages: Math.ceil(total/limit) };
}
module.exports = { getAdminTasks, getAdminUserDetail };
