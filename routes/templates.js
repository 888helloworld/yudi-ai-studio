const express = require('express');

function createTemplateRouter({ authMiddleware }) {
  const router = express.Router();
  const templates = {};

  router.post('/api/templates', authMiddleware, (req, res) => {
    const { name, type, content } = req.body;
    if (!name || !type || !content) return res.status(400).json({ error: '参数不完整' });
    if (name.length > 50) return res.status(400).json({ error: '模板名称太长' });

    if (!templates[req.userId]) templates[req.userId] = [];
    const existing = templates[req.userId].findIndex((template) => template.name === name && template.type === type);
    if (existing >= 0) {
      templates[req.userId][existing].content = content;
      templates[req.userId][existing].updatedAt = Date.now();
    } else {
      templates[req.userId].push({ id: Date.now().toString(36), name, type, content, createdAt: Date.now() });
    }
    res.json({ success: true, templates: templates[req.userId] });
  });

  router.get('/api/templates', authMiddleware, (req, res) => {
    const type = req.query.type;
    let list = templates[req.userId] || [];
    if (type) list = list.filter((template) => template.type === type);
    res.json({ templates: list });
  });

  router.delete('/api/templates/:id', authMiddleware, (req, res) => {
    if (!templates[req.userId]) return res.json({ success: true });
    templates[req.userId] = templates[req.userId].filter((template) => template.id !== req.params.id);
    res.json({ success: true });
  });

  return router;
}

module.exports = {
  createTemplateRouter
};
