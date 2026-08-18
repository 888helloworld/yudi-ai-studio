const express = require('express');
const { POINTS } = require('../config/points');
const { getSourceImageFilename, normalizeSourceImageFilename } = require('../services/prompt-service');
const { assertXiImageSizeSupported, parseXiImageSize } = require('../services/xi-image-size');
const { getUploadedImageDimensions, saveUploadedSourceImages } = require('../utils/image-storage');
const { parseImageCount, sanitizeInput } = require('../utils/request-utils');

function createXiJobsRouter({ authMiddleware, xiImageLimiter, upload, validateUploadedImageFiles, manager, chargePoints, refundPoints, fixedQuality }) {
  const router = express.Router();

  router.get('/api/xi-image/jobs', authMiddleware, (req, res) => {
    res.json({ jobs: manager.listActiveJobsForUser(req.userId) });
  });

  router.get('/api/xi-image/jobs/:id', authMiddleware, (req, res) => {
    const job = manager.getUserJob(req.userId, req.params.id);
    if (!job) return res.status(404).json({ error: '任务不存在' });
    res.json({ job: manager.serializeJob(job) });
  });

  router.post('/api/xi-image/jobs/generate', xiImageLimiter, authMiddleware, (req, res) => {
    const prompt = sanitizeInput(req.body.prompt, 3000);
    const size = parseXiImageSize(req.body.size);
    const count = parseImageCount(req.body.count, 5);
    if (!prompt) return res.status(400).json({ error: '请输入图片描述' });
    try { assertXiImageSizeSupported(size); } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message });
    }
    const costPoints = POINTS.image * count;
    let charged = false;
    try {
      chargePoints(req.userId, costPoints, `gpt-image-2 生图 x${count}`);
      charged = true;
      const job = manager.createJob(req.userId, { mode: 'generate', prompt, size, count, quality: fixedQuality, costPoints });
      return res.json({ success: true, job: manager.serializeJob(job) });
    } catch (error) {
      if (charged) refundPoints(req.userId, costPoints, 'gpt-image-2 创建任务失败退款');
      return res.status(error.statusCode || 500).json({ error: error.message || '任务创建失败' });
    }
  });

  router.post('/api/xi-image/jobs/edit', xiImageLimiter, authMiddleware, upload.array('image', 4), validateUploadedImageFiles, (req, res) => {
    const prompt = sanitizeInput(req.body.prompt, 3000);
    const size = parseXiImageSize(req.body.size);
    const count = parseImageCount(req.body.count, 5);
    const sourceFiles = Array.isArray(req.files) ? req.files : [];
    sourceFiles.forEach((file, index) => { file.originalname = normalizeSourceImageFilename(file.originalname, index); });
    if (!prompt) return res.status(400).json({ error: '请输入图片编辑描述' });
    if (sourceFiles.length === 0) return res.status(400).json({ error: '请至少上传一张原图' });
    try { assertXiImageSizeSupported(size); } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message });
    }
    if (sourceFiles.some((file) => file.mimetype !== 'image/png')) {
      return res.status(400).json({ error: '改图原图需为 PNG 格式，请刷新页面后重新上传，页面会自动转换' });
    }
    if (sourceFiles.some((file) => (file.buffer?.length || 0) > 20 * 1024 * 1024)) {
      return res.status(400).json({ error: '改图原图处理后仍超过 20MB，请换一张更小的参考图' });
    }
    const costPoints = POINTS.image * count;
    let charged = false;
    try {
      chargePoints(req.userId, costPoints, `gpt-image-2 改图 x${count}`);
      charged = true;
      const sourcePreviewUrls = saveUploadedSourceImages(sourceFiles);
      const job = manager.createJob(req.userId, {
        mode: 'edit',
        prompt,
        size,
        count,
        quality: fixedQuality,
        sourceFiles: sourceFiles.map((file) => ({
          buffer: Buffer.from(file.buffer),
          mimetype: file.mimetype,
          originalname: file.originalname
        })),
        sourceFileNames: sourceFiles.map((file, index) => file.originalname || getSourceImageFilename(index)),
        sourcePreviewUrls,
        sourceDimensions: getUploadedImageDimensions(sourceFiles),
        costPoints
      });
      return res.json({ success: true, job: manager.serializeJob(job) });
    } catch (error) {
      if (charged) refundPoints(req.userId, costPoints, 'gpt-image-2 创建改图任务失败退款');
      return res.status(error.statusCode || 500).json({ error: error.message || '任务创建失败' });
    }
  });

  return router;
}

module.exports = { createXiJobsRouter };
