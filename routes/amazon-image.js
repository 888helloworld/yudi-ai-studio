const express = require('express');
const { POINTS } = require('../config/points');
const {
  buildAmazonMainImagePrompt,
  buildAmazonMainImageVariationPrompt
} = require('../services/prompt-service');
const { formatUpstreamError, generateArkImageUrls } = require('../services/upstream-http');
const { downloadAndSaveImage } = require('../utils/image-storage');
const { formatBeijingDateTime, getRequiredEnv, parseImageCount, sanitizeInput } = require('../utils/request-utils');

const SIZE_MAP = {
  '1:1': { width: 1920, height: 1920 },
  '3:4': { width: 1920, height: 2560 },
  '4:3': { width: 2560, height: 1920 }
};

function createAmazonImageRouter({ authMiddleware, imageLimiter, upload, validateUploadedImageFiles, db, chargePoints, refundPoints, arkImageBaseUrl }) {
  const router = express.Router();
  router.post('/api/amazon-image/generate', imageLimiter, authMiddleware, upload.single('referenceImage'), validateUploadedImageFiles, async (req, res) => {
    const prompt = sanitizeInput(req.body.prompt, 2000);
    const ratio = req.body.ratio || '1:1';
    const imageCount = parseImageCount(req.body.imageCount ?? req.body.count);
    if (!prompt) return res.status(400).json({ error: '请输入图片描述' });
    if (!SIZE_MAP[ratio]) return res.status(400).json({ error: '无效的图片比例' });

    const totalCost = POINTS.image * imageCount;
    let refundablePoints = 0;
    try {
      chargePoints(req.userId, totalCost, `亚马逊主图生成 x${imageCount}`);
      refundablePoints = totalCost;
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message || '积分扣减失败' });
    }

    const apiKey = getRequiredEnv('ARK_API_KEY');
    if (!apiKey) {
      refundPoints(req.userId, refundablePoints, '亚马逊主图生成失败退款');
      return res.status(500).json({ error: '图片服务未配置' });
    }

    try {
      const size = SIZE_MAP[ratio];
      const requestBody = {
        model: 'doubao-seedream-5-0-lite-260128',
        prompt: buildAmazonMainImagePrompt(prompt, ratio),
        size: `${size.width}x${size.height}`,
        output_format: 'png',
        watermark: false
      };
      if (req.file) requestBody.image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      const remoteUrls = await generateArkImageUrls(arkImageBaseUrl, apiKey, requestBody, imageCount, buildAmazonMainImageVariationPrompt);
      if (remoteUrls.length === 0) throw new Error('图片生成失败');
      const localUrls = await Promise.all(remoteUrls.map((url, index) => downloadAndSaveImage(url, `amazon_${ratio.replace(':', '')}_${index + 1}`)));
      const missingCount = Math.max(imageCount - localUrls.length, 0);
      if (missingCount > 0) {
        const refundAmount = POINTS.image * missingCount;
        refundPoints(req.userId, refundAmount, `亚马逊主图少出${missingCount}张退款`);
        refundablePoints -= refundAmount;
      }
      const historyIds = localUrls.map((localUrl) => db.addHistory(req.userId, 'image', {
        sub_type: 'amazon-generate',
        image_url: localUrl,
        prompt,
        ratio,
        cost_points: POINTS.image
      }));
      refundablePoints = 0;
      res.json({
        imageUrl: localUrls[0],
        imageUrls: localUrls,
        historyId: historyIds[0] || null,
        remainingPoints: db.getUserPoints(req.userId),
        createdAt: formatBeijingDateTime()
      });
    } catch (error) {
      if (refundablePoints > 0) refundPoints(req.userId, refundablePoints, '亚马逊主图生成失败退款');
      console.error('亚马逊主图生成失败:', error.message || error);
      res.status(502).json({ error: formatUpstreamError(error.message || error, '图片生成失败，请稍后再试') });
    }
  });
  return router;
}

module.exports = { createAmazonImageRouter, SIZE_MAP };
