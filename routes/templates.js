const express = require('express');
const {
  deleteTemplate,
  getTemplates,
  saveTemplate
} = require('../repositories/template-repository');

function createTemplateRouter({ authMiddleware }) {
  const router = express.Router();

  router.post('/api/templates', authMiddleware, (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const type = typeof req.body.type === 'string' ? req.body.type.trim() : '';
    const content = typeof req.body.content === 'string' ? req.body.content : '';
    if (!name || !type || !content) return res.status(400).json({ error: '参数不完整' });
    if (name.length > 50) return res.status(400).json({ error: '模板名称太长' });
    if (type.length > 30) return res.status(400).json({ error: '模板类型太长' });
    if (content.length > 50000) return res.status(400).json({ error: '模板内容太长' });

    saveTemplate(req.userId, { name, type, content });
    res.json({ success: true, templates: getTemplates(req.userId) });
  });

  router.get('/api/templates', authMiddleware, (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type.trim().slice(0, 30) : '';
    res.json({ templates: getTemplates(req.userId, type) });
  });

  router.delete('/api/templates/:id', authMiddleware, (req, res) => {
    const templateId = Number(req.params.id);
    if (!Number.isSafeInteger(templateId) || templateId <= 0) return res.status(400).json({ error: '模板编号无效' });
    res.json({ success: true, deleted: deleteTemplate(req.userId, templateId) });
  });

  return router;
}

module.exports = {
  createTemplateRouter
};
