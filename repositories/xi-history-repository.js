const { db } = require('../database');

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
    SELECT id, user_id, sub_type, content, prompt, ratio, cost_points, created_at
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
  getRecoverableXiJobHistories,
  updateXiHistoryState,
  updateXiJobHistory
};
