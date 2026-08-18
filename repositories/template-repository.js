const { db } = require('../database');

function saveTemplate(userId, { name, type, content }) {
  db.prepare(`
    INSERT INTO templates (user_id, name, type, content)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, name, type) DO UPDATE SET
      content = excluded.content,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, name, type, content);

  return db.prepare(`
    SELECT id, name, type, content, created_at AS createdAt, updated_at AS updatedAt
    FROM templates
    WHERE user_id = ? AND name = ? AND type = ?
  `).get(userId, name, type);
}

function getTemplates(userId, type = '') {
  if (type) {
    return db.prepare(`
      SELECT id, name, type, content, created_at AS createdAt, updated_at AS updatedAt
      FROM templates
      WHERE user_id = ? AND type = ?
      ORDER BY updated_at DESC, id DESC
    `).all(userId, type);
  }
  return db.prepare(`
    SELECT id, name, type, content, created_at AS createdAt, updated_at AS updatedAt
    FROM templates
    WHERE user_id = ?
    ORDER BY updated_at DESC, id DESC
  `).all(userId);
}

function deleteTemplate(userId, templateId) {
  return db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?')
    .run(templateId, userId).changes > 0;
}

module.exports = {
  deleteTemplate,
  getTemplates,
  saveTemplate
};
