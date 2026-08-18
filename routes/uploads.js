const express = require('express');
const fs = require('fs');
const path = require('path');
const { UPLOAD_DIR, ensureImageThumbnail } = require('../utils/image-storage');

function createUploadRouter({ authMiddleware, canUserAccessUpload }) {
  const router = express.Router();
  router.get('/uploads/:filename', authMiddleware, (req, res, next) => {
    const filename = path.basename(req.params.filename || '');
    if (!filename || filename !== req.params.filename) return res.status(400).json({ error: '图片路径无效' });
    if (req.user?.role !== 'admin' && !canUserAccessUpload(req.userId, filename)) {
      return res.status(403).json({ error: '无权访问这张图片' });
    }
    const filepath = path.join(UPLOAD_DIR, filename);
    if (!filepath.startsWith(UPLOAD_DIR + path.sep)) return res.status(400).json({ error: '图片路径无效' });
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: '图片不存在' });
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    const responseFilepath = String(req.query.variant || '').toLowerCase() === 'thumb'
      ? (ensureImageThumbnail(filepath) || filepath)
      : filepath;
    return res.sendFile(responseFilepath, { cacheControl: false }, next);
  });
  return router;
}

module.exports = { createUploadRouter };
