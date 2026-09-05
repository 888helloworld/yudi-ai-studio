const { db } = require('../database');
function findXiHistory(userId, clientId) {
  return db.prepare("SELECT * FROM history WHERE user_id = ? AND client_task_id = ? AND sub_type IN ('xi-edit','xi-generate') ORDER BY id DESC LIMIT 1").get(userId, clientId);
}

function createChargedXiJobHistory({ job, content }) {
  const transaction = db.transaction(() => {
    if (job.clientTaskId) {
      const existing = db.prepare(`
        SELECT * FROM history
        WHERE user_id = ? AND client_task_id = ? AND sub_type IN ('xi-edit', 'xi-generate')
        ORDER BY id DESC LIMIT 1
      `).get(job.userId, job.clientTaskId);
      if (existing) {
        let meta = {};
        try { meta = JSON.parse(existing.content || '{}'); } catch {}
        const expectedSubType = job.mode === 'edit' ? 'xi-edit' : 'xi-generate';
        const samePayload = existing.sub_type === expectedSubType
          && String(existing.prompt || '') === String(job.prompt || '')
          && String(existing.ratio || '') === String(job.size || '')
          && Number(meta.count || 1) === Number(job.count || 1)
          && (!meta.source_fingerprint || meta.source_fingerprint === job.sourceFingerprint);
        if (!samePayload) {
          const error = new Error('同一任务号的参数不一致，请新建任务后重试');
          error.statusCode = 409;
          throw error;
        }
        return { historyId: existing.id, alreadyExists: true, row: existing };
      }
    }

    const charge = db.prepare('UPDATE users SET points = points - ? WHERE id = ? AND points >= ?')
      .run(job.costPoints, job.userId, job.costPoints);
    if (charge.changes === 0) {
      const error = new Error('积分不足，请充值');
      error.statusCode = 400;
      throw error;
    }
    const user = db.prepare('SELECT points FROM users WHERE id = ?').get(job.userId);
    const chargeReference = `xi-job-charge:${job.userId}:${job.clientTaskId || job.id}`;
    db.prepare(`
      INSERT INTO point_logs (user_id, type, amount, balance, description, reference_key)
      VALUES (?, 'consume', ?, ?, ?, ?)
    `).run(job.userId, -job.costPoints, user.points, `gpt-image-2 ${job.mode === 'edit' ? '改图' : '生图'} x${job.count}`, chargeReference);
    const result = db.prepare(`
      INSERT INTO history (user_id, type, sub_type, content, image_url, prompt, ratio, cost_points, client_task_id)
      VALUES (?, 'image', ?, ?, NULL, ?, ?, ?, ?)
    `).run(
      job.userId,
      job.mode === 'edit' ? 'xi-edit' : 'xi-generate',
      content,
      job.prompt,
      job.size,
      job.costPoints,
      job.clientTaskId || null
    );
    return { historyId: result.lastInsertRowid, alreadyExists: false, row: null };
  });
  return transaction.immediate();
}

function settleXiJobHistory({ historyId, userId, content, imageUrls, costPoints, refundAmount, refundDescription }) {
  const transaction = db.transaction(() => {
    const history = db.prepare('SELECT id FROM history WHERE id = ? AND user_id = ?').get(historyId, userId);
    if (!history) return { updated: false, refunded: false };

    let refunded = false;
    const normalizedRefund = Math.max(Math.floor(Number(refundAmount) || 0), 0);
    if (normalizedRefund > 0) {
      const referenceKey = `xi-job-settlement:${historyId}`;
      const canonicalApplied = db.prepare('SELECT amount FROM point_logs WHERE reference_key = ?').get(referenceKey);
      const legacyApplied = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS amount FROM point_logs
        WHERE user_id = ? AND amount > 0 AND reference_key IN (?, ?, ?)
      `).get(
        userId,
        `xi-job-recovery-failure:${historyId}`,
        `xi-job-failure:${historyId}`,
        `xi-job-partial:${historyId}`
      ).amount;
      const additionalRefund = canonicalApplied
        ? 0
        : Math.max(normalizedRefund - Number(legacyApplied || 0), 0);
      if (additionalRefund > 0) {
        const changed = db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(additionalRefund, userId);
        if (changed.changes === 0) throw new Error('退款用户不存在');
        const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
        db.prepare(`
          INSERT INTO point_logs (user_id, type, amount, balance, description, reference_key)
          VALUES (?, 'refund', ?, ?, ?, ?)
        `).run(userId, additionalRefund, user.points, refundDescription || 'gpt-image-2 任务退款', referenceKey);
        refunded = true;
      }
    }

    const result = db.prepare(`
      UPDATE history SET content = ?, image_url = ?, cost_points = ? WHERE id = ? AND user_id = ?
    `).run(
      content,
      imageUrls && imageUrls.length ? JSON.stringify(imageUrls) : null,
      costPoints,
      historyId,
      userId
    );
    return { updated: result.changes > 0, refunded };
  });
  return transaction.immediate();
}

function updateXiJobHistory({ historyId, userId, content, imageUrls, costPoints }) {
  return db.prepare(`
    UPDATE history
    SET content = ?, image_url = ?, cost_points = ?
    WHERE id = ? AND user_id = ?
  `).run(
    content,
    imageUrls && imageUrls.length ? JSON.stringify(imageUrls) : null,
    costPoints,
    historyId,
    userId
  );
}

function getRecoverableXiJobHistories(limit = 500) {
  return db.prepare(`
    SELECT id, user_id, sub_type, content, prompt, ratio, cost_points, client_task_id, created_at
    FROM history
    WHERE type = 'image'
      AND sub_type IN ('xi-edit', 'xi-generate')
      AND (image_url IS NULL OR image_url = '')
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}

function updateXiHistoryState(historyId, content, imageUrl = null, costPoints = null) {
  return db.prepare('UPDATE history SET content = ?, image_url = ?, cost_points = COALESCE(?, cost_points) WHERE id = ?')
    .run(content, imageUrl, costPoints, historyId);
}

module.exports = {
  findXiHistory,
  createChargedXiJobHistory,
  getRecoverableXiJobHistories,
  settleXiJobHistory,
  updateXiHistoryState,
  updateXiJobHistory
};
