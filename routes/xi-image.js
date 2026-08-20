const express = require('express');
const { POINTS } = require('../config/points');
const { getSourceImageFilename, normalizeSourceImageFilename } = require('../services/prompt-service');
const { getXiImageApiKey } = require('../services/upstream-http');
const { assertXiImageSizeSupported, parseXiImageSize } = require('../services/xi-image-size');
const {
  getLocalImageDimensions,
  getUploadedImageDimensions,
  saveUploadedSourceImages
} = require('../utils/image-storage');
const { formatBeijingDateTime, parseImageCount, sanitizeInput } = require('../utils/request-utils');

function buildImageHistoryContent({ upstreamMeta = {}, quality, size, count, durationMs, outputDimensions, extra = {} }) {
  return JSON.stringify({
    model: process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2',
    quality,
    requested_quality: upstreamMeta.requested_quality || quality,
    actual_quality: upstreamMeta.actual_quality || '',
    requested_size: upstreamMeta.requested_size || size,
    actual_size: upstreamMeta.actual_size || '',
    billing_output_tokens: upstreamMeta.billing_output_tokens || 0,
    usage_output_tokens: upstreamMeta.usage_output_tokens || 0,
    billing_mode: upstreamMeta.billing_mode || '',
    billing_note: upstreamMeta.billing_note || '',
    image_parameter_mode: upstreamMeta.image_parameter_mode || '',
    image_parameter_note: upstreamMeta.image_parameter_note || '',
    size_source: upstreamMeta.size_source || '',
    size_parameter_affects_output_guarantee: upstreamMeta.size_parameter_affects_output_guarantee,
    quality_parameter_affects_output_guarantee: upstreamMeta.quality_parameter_affects_output_guarantee,
    count,
    duration_ms: durationMs,
    output_dimensions: outputDimensions,
    ...extra
  });
}

function validateEditFiles(sourceFiles) {
  if (sourceFiles.length === 0) return '请至少上传一张原图';
  if (sourceFiles.some((file) => file.mimetype !== 'image/png')) return '改图原图需为 PNG 格式，请刷新页面后重新上传，页面会自动转换';
  if (sourceFiles.some((file) => (file.buffer?.length || 0) > 20 * 1024 * 1024)) return '改图原图处理后仍超过 20MB，请换一张更小的参考图';
  return '';
}

function createXiImageRouter({ authMiddleware, xiImageLimiter, upload, validateUploadedImageFiles, db, provider, chargePoints, refundPoints }) {
  const router = express.Router();

  router.post('/api/xi-image/generate', xiImageLimiter, authMiddleware, async (req, res) => {
    const prompt = sanitizeInput(req.body.prompt, 3000);
    const size = parseXiImageSize(req.body.size);
    const count = parseImageCount(req.body.count, 5);
    const quality = provider.fixedQuality;
    if (!prompt) return res.status(400).json({ error: '请输入图片描述' });
    try { assertXiImageSizeSupported(size); } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message });
    }
    const totalCost = POINTS.image * count;
    let refundablePoints = 0;
    try {
      chargePoints(req.userId, totalCost, `gpt-image-2 生图 x${count}`);
      refundablePoints = totalCost;
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message || '积分扣减失败' });
    }
    if (!getXiImageApiKey()) {
      refundPoints(req.userId, refundablePoints, 'gpt-image-2 生图失败退款');
      return res.status(500).json({ error: 'gpt-image-2 图片服务未配置' });
    }

    const startedAtMs = Date.now();
    try {
      const result = await provider.callXiXuGenerate({ prompt, size, count, quality });
      const localUrls = result.localUrls;
      const upstreamMeta = result.upstreamMeta || {};
      const outputDimensions = getLocalImageDimensions(localUrls);
      const actualCount = Math.min(localUrls.length, count);
      const actualCost = POINTS.image * actualCount;
      const refundAmount = Math.max(totalCost - actualCost, 0);
      if (refundAmount > 0) {
        refundPoints(req.userId, refundAmount, `gpt-image-2 少出${count - actualCount}张退款`);
        refundablePoints -= refundAmount;
      }
      const durationMs = Date.now() - startedAtMs;
      const historyId = db.addHistory(req.userId, 'image', {
        sub_type: 'xi-generate',
        image_url: JSON.stringify(localUrls),
        content: buildImageHistoryContent({ upstreamMeta, quality, size, count, durationMs, outputDimensions }),
        prompt,
        ratio: size,
        cost_points: actualCost
      });
      refundablePoints = 0;
      res.json({
        success: true,
        imageUrls: localUrls,
        imageUrl: localUrls[0],
        historyId,
        remainingPoints: db.getUserPoints(req.userId),
        model: process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2',
        upstreamMeta,
        outputDimensions,
        createdAt: formatBeijingDateTime()
      });
    } catch (error) {
      if (refundablePoints > 0) refundPoints(req.userId, refundablePoints, 'gpt-image-2 生图失败退款');
      res.status(502).json({ error: error.message || '生图请求失败' });
    }
  });

  router.post('/api/xi-image/edit', xiImageLimiter, authMiddleware, upload.array('image', 4), validateUploadedImageFiles, async (req, res) => {
    const prompt = sanitizeInput(req.body.prompt, 3000);
    const size = parseXiImageSize(req.body.size);
    const count = parseImageCount(req.body.count, 5);
    const quality = provider.fixedQuality;
    const sourceFiles = Array.isArray(req.files) ? req.files : [];
    sourceFiles.forEach((file, index) => { file.originalname = normalizeSourceImageFilename(file.originalname, index); });
    if (!prompt) return res.status(400).json({ error: '请输入图片编辑描述' });
    const fileError = validateEditFiles(sourceFiles);
    if (fileError) return res.status(400).json({ error: fileError });
    try { assertXiImageSizeSupported(size); } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message });
    }

    const totalCost = POINTS.image * count;
    let refundablePoints = 0;
    try {
      chargePoints(req.userId, totalCost, `gpt-image-2 改图 x${count}`);
      refundablePoints = totalCost;
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message || '积分扣减失败' });
    }

    const sourceDimensions = getUploadedImageDimensions(sourceFiles);
    const startedAtMs = Date.now();
    try {
      const editResult = await provider.callXiXuEdit({
        prompt,
        size,
        count,
        quality,
        sourceFiles: sourceFiles.map((file) => ({
          buffer: Buffer.from(file.buffer),
          mimetype: file.mimetype,
          originalname: file.originalname
        }))
      });
      const localUrls = editResult.localUrls;
      const upstreamMeta = editResult.upstreamMeta || {};
      const outputDimensions = getLocalImageDimensions(localUrls);
      const actualCount = Math.min(localUrls.length, count);
      const actualCost = POINTS.image * actualCount;
      const refundAmount = Math.max(totalCost - actualCost, 0);
      if (refundAmount > 0) {
        refundPoints(req.userId, refundAmount, `gpt-image-2 改图少出${count - actualCount}张退款`);
        refundablePoints -= refundAmount;
      }
      const sourcePreviewUrls = saveUploadedSourceImages(sourceFiles);
      const durationMs = Date.now() - startedAtMs;
      const historyId = db.addHistory(req.userId, 'image', {
        sub_type: 'xi-edit',
        image_url: JSON.stringify(localUrls),
        content: buildImageHistoryContent({
          upstreamMeta,
          quality,
          size,
          count,
          durationMs,
          outputDimensions,
          extra: {
            provider: 'xixu',
            fallback_reason: '',
            sources: sourceFiles.map((file, index) => file.originalname || getSourceImageFilename(index)),
            source_urls: sourcePreviewUrls,
            source_dimensions: sourceDimensions
          }
        }),
        prompt,
        ratio: size,
        cost_points: actualCost
      });
      refundablePoints = 0;
      res.json({
        success: true,
        imageUrls: localUrls,
        imageUrl: localUrls[0],
        historyId,
        mode: 'edit',
        remainingPoints: db.getUserPoints(req.userId),
        model: process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2',
        upstreamMeta,
        sourceDimensions,
        outputDimensions,
        durationMs,
        createdAt: formatBeijingDateTime()
      });
    } catch (error) {
      if (refundablePoints > 0) refundPoints(req.userId, refundablePoints, 'gpt-image-2 改图失败退款');
      console.error('改图请求失败:', error.message || error);
      res.status(502).json({ error: error.message || '改图请求失败' });
    }
  });

  return router;
}

module.exports = { buildImageHistoryContent, createXiImageRouter };
