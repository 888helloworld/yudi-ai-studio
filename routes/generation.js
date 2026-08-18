const express = require('express');
const { POINTS } = require('../config/points');
const db = require('../db');
const { downloadAndSaveImage } = require('../utils/image-storage');
const { buildXhsImagePrompt } = require('../services/prompt-service');
const {
  buildBothCopyPrompt,
  buildCopyPrompt,
  buildRewritePrompt,
  cleanCopyText,
  requestDeepSeekText
} = require('../services/copy-service');
const { chargePoints, refundPoints } = require('../services/point-service');
const { formatBeijingDateTime } = require('../utils/request-utils');

const DEEPSEEK_TEXT_MODEL = process.env.DEEPSEEK_TEXT_MODEL || 'deepseek-chat';

function createGenerationRouter({
  imageLimiter,
  copyLimiter,
  authMiddleware,
  upload,
  validateUploadedImageFiles,
  sanitizeInput,
  normalizeClientTaskId,
  parseImageCount,
  sizeMap,
  getRequiredEnv,
  generateArkImageUrls,
  formatUpstreamError,
  arkImageBaseUrl
}) {
  const router = express.Router();
  const SIZE_MAP = sizeMap;
  const ARK_IMAGE_BASE_URL = arkImageBaseUrl;

  // 图片生成
  router.post('/generate', imageLimiter, authMiddleware, upload.single('referenceImage'), validateUploadedImageFiles, async (req, res) => {
    const prompt = sanitizeInput(req.body.prompt, 2000);
    const ratio = req.body.ratio || '1:1';
    const imageCount = parseImageCount(req.body.imageCount);
    const clientTaskId = normalizeClientTaskId(req.body.clientTaskId);
    if (!prompt) return res.status(400).json({ error: '请输入图片描述' });
    if (!SIZE_MAP[ratio]) return res.status(400).json({ error: '无效的图片比例' });
  
    const totalCost = POINTS.image * imageCount;
    let refundablePoints = 0;
    try {
      chargePoints(req.userId, totalCost, `图片生成 x${imageCount}`);
      refundablePoints = totalCost;
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message || '积分扣减失败' });
    }
  
    const size = SIZE_MAP[ratio];
    const API_KEY = getRequiredEnv('ARK_API_KEY');
    if (!API_KEY) {
      refundPoints(req.userId, refundablePoints, '图片生成失败退款');
      return res.status(500).json({ error: '图片服务未配置' });
    }
    try {
      const requestBody = {
        model: 'doubao-seedream-5-0-lite-260128',
        prompt: buildXhsImagePrompt(prompt, ratio),
        size: `${size.width}x${size.height}`,
        output_format: 'png',
        watermark: false,
      };
      if (req.file) {
        requestBody.image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      }
  
      const remoteUrls = await generateArkImageUrls(ARK_IMAGE_BASE_URL, API_KEY, requestBody, imageCount);
      
      if (remoteUrls.length === 0) {
        refundPoints(req.userId, refundablePoints, '图片生成失败退款');
        return res.status(500).json({ error: '图片生成失败' });
      }
  
      // 下载到本地
      const localUrls = await Promise.all(remoteUrls.map((url, index) => (
        downloadAndSaveImage(url, `xhs_${ratio.replace(':', '')}_${index + 1}`)
      )));
      const missingCount = Math.max(imageCount - localUrls.length, 0);
      if (missingCount > 0) {
        const refundAmount = POINTS.image * missingCount;
        refundPoints(req.userId, refundAmount, `图片生成少出${missingCount}张退款`);
        refundablePoints -= refundAmount;
      }
      const createdAt = formatBeijingDateTime();
      localUrls.forEach((localUrl) => {
        db.addHistory(req.userId, 'image', { sub_type: 'generate', image_url: localUrl, prompt: prompt, ratio: ratio, cost_points: POINTS.image, client_task_id: clientTaskId });
      });
      refundablePoints = 0;
  
      res.json({ imageUrl: localUrls[0], imageUrls: localUrls, remainingPoints: db.getUserPoints(req.userId), createdAt });
    } catch (err) {
      if (refundablePoints > 0) refundPoints(req.userId, refundablePoints, '图片生成失败退款');
      console.error('小红书图片生成失败:', err.message || err);
      res.status(502).json({ error: formatUpstreamError(err.message || err, '图片生成失败，请稍后再试') });
    }
  });
  
  // 文案生成（DeepSeek API）
  router.post('/generate-copy', copyLimiter, authMiddleware, async (req, res) => {
    const topic = sanitizeInput(req.body.topic, 500);
    const type = req.body.type;
    const clientTaskId = normalizeClientTaskId(req.body.clientTaskId);
    if (!topic) return res.status(400).json({ error: '请输入主题' });
    const fullPrompt = buildCopyPrompt(topic, type);
    if (!fullPrompt) return res.status(400).json({ error: '无效的文案类型' });

    let refundablePoints = 0;
    try {
      chargePoints(req.userId, POINTS.copy, '文案生成');
      refundablePoints = POINTS.copy;
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message || '积分扣减失败' });
    }

    const DEEPSEEK_API_KEY = getRequiredEnv('DEEPSEEK_API_KEY');
    if (!DEEPSEEK_API_KEY) {
      refundPoints(req.userId, refundablePoints, '文案生成失败退款');
      return res.status(500).json({ error: '文案服务未配置' });
    }
    try {
      const text = await requestDeepSeekText({
        apiKey: DEEPSEEK_API_KEY,
        model: DEEPSEEK_TEXT_MODEL,
        systemPrompt: fullPrompt,
        userPrompt: `主题：${topic}`
      });
      
      if (!text) throw new Error('文案生成失败');
  
      const cleanText = cleanCopyText(text);
      const titleMatch = cleanText.match(/^(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim().substring(0, 30) : (topic.length > 20 ? topic.substring(0, 20) + '...' : topic);
      const createdAt = formatBeijingDateTime();
      
      db.addHistory(req.userId, 'copy', { sub_type: 'generate', content: cleanText, prompt: topic, cost_points: POINTS.copy, client_task_id: clientTaskId });
      refundablePoints = 0;
      res.json({ copy: cleanText, title, remainingPoints: db.getUserPoints(req.userId), createdAt });
    } catch (err) {
      if (refundablePoints > 0) refundPoints(req.userId, refundablePoints, '文案生成失败退款');
      res.status(500).json({ error: '请求失败' });
    }
  });
  
  // 文案改写（DeepSeek API）
  router.post('/rewrite', copyLimiter, authMiddleware, async (req, res) => {
    const originalText = sanitizeInput(req.body.originalText, 5000);
    const style = req.body.style;
    const clientTaskId = normalizeClientTaskId(req.body.clientTaskId);
    if (!originalText) return res.status(400).json({ error: '请输入要改写的文案' });
    const rewritePrompt = buildRewritePrompt(originalText, style);

    let refundablePoints = 0;
    try {
      chargePoints(req.userId, POINTS.rewrite, '文案改写');
      refundablePoints = POINTS.rewrite;
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message || '积分扣减失败' });
    }

    const DEEPSEEK_API_KEY = getRequiredEnv('DEEPSEEK_API_KEY');
    if (!DEEPSEEK_API_KEY) {
      refundPoints(req.userId, refundablePoints, '文案改写失败退款');
      return res.status(500).json({ error: '文案服务未配置' });
    }
    try {
      const text = await requestDeepSeekText({
        apiKey: DEEPSEEK_API_KEY,
        model: DEEPSEEK_TEXT_MODEL,
        systemPrompt: rewritePrompt.systemPrompt,
        userPrompt: rewritePrompt.userPrompt
      });
      
      if (!text) throw new Error('文案改写失败');
  
      const cleanText = cleanCopyText(text);
      const titleMatch = cleanText.match(/^(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim().substring(0, 30) : '改写文案';
      const createdAt = formatBeijingDateTime();
      
      db.addHistory(req.userId, 'copy', { sub_type: 'rewrite', content: cleanText, prompt: title, cost_points: POINTS.rewrite, client_task_id: clientTaskId });
      refundablePoints = 0;
      res.json({ copy: cleanText, title, remainingPoints: db.getUserPoints(req.userId), createdAt });
    } catch (err) {
      if (refundablePoints > 0) refundPoints(req.userId, refundablePoints, '文案改写失败退款');
      res.status(500).json({ error: '请求失败' });
    }
  });
  
  // =============================================
  // 图文一体生成
  // =============================================
  router.post('/generate-both', imageLimiter, authMiddleware, async (req, res) => {
    const prompt = sanitizeInput(req.body.prompt, 2000);
    const ratio = req.body.ratio || '1:1';
    const imageCount = parseImageCount(req.body.imageCount);
    const clientTaskId = normalizeClientTaskId(req.body.clientTaskId);
    if (!prompt) return res.status(400).json({ error: '请输入描述' });
    if (!SIZE_MAP[ratio]) return res.status(400).json({ error: '无效的图片比例' });
  
    const totalCost = POINTS.copy + (POINTS.image * imageCount);
    let refundablePoints = 0;
    try {
      chargePoints(req.userId, totalCost, `图文一体生成 x${imageCount}`);
      refundablePoints = totalCost;
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message || '积分扣减失败' });
    }
  
    const size = SIZE_MAP[ratio];
    const API_KEY = getRequiredEnv('ARK_API_KEY');
    if (!API_KEY) {
      refundPoints(req.userId, refundablePoints, '图文一体生成失败退款');
      return res.status(500).json({ error: '图片服务未配置' });
    }
    const DEEPSEEK_API_KEY = getRequiredEnv('DEEPSEEK_API_KEY');
    if (!DEEPSEEK_API_KEY) {
      refundPoints(req.userId, refundablePoints, '图文一体生成失败退款');
      return res.status(500).json({ error: '文案服务未配置' });
    }
    try {
      // 并行调用：同时生成图片和文案
      const [imageResult, copyResult] = await Promise.allSettled([
        // 1. 生成图片
        (async () => {
          const body = {
            model: 'doubao-seedream-5-0-lite-260128',
            prompt: buildXhsImagePrompt(prompt, ratio),
            size: `${size.width}x${size.height}`,
            output_format: 'png',
            watermark: false,
          };
          const urls = await generateArkImageUrls(ARK_IMAGE_BASE_URL, API_KEY, body, imageCount);
          if (urls.length === 0) throw new Error('图片生成失败');
          return await Promise.all(urls.map((url, index) => (
            downloadAndSaveImage(url, `both_${ratio.replace(':', '')}_${index + 1}`)
          )));
        })(),
  
        // 2. 生成文案
        (async () => {
          const text = await requestDeepSeekText({
            apiKey: DEEPSEEK_API_KEY,
            model: DEEPSEEK_TEXT_MODEL,
            systemPrompt: '你是小红书爆款内容专家。',
            userPrompt: buildBothCopyPrompt(prompt)
          });
          if (!text) throw new Error('文案生成失败');
          return text;
        })()
      ]);
  
      // 检查结果
      if (imageResult.status === 'rejected' && copyResult.status === 'rejected') {
        refundPoints(req.userId, refundablePoints, '图文一体生成失败退款');
        return res.status(500).json({ error: '图片和文案生成均失败' });
      }
  
      const imageUrls = imageResult.status === 'fulfilled' ? imageResult.value : [];
      const imageUrl = imageUrls[0] || null;
      const rawCopy = copyResult.status === 'fulfilled' ? copyResult.value : null;
      const copyText = rawCopy ? cleanCopyText(rawCopy) : null;
  
      // 如果图片失败退图片部分的积分
      const missingImageCount = Math.max(imageCount - imageUrls.length, 0);
      if (missingImageCount > 0) {
        const refundAmount = POINTS.image * missingImageCount;
        refundPoints(req.userId, refundAmount, `图文一体-图片少出${missingImageCount}张退款`);
        refundablePoints -= refundAmount;
      }
      // 如果文案失败退文案部分的积分
      if (!copyText) {
        refundPoints(req.userId, POINTS.copy, '图文一体-文案失败退款');
        refundablePoints -= POINTS.copy;
      }
  
      const createdAt = formatBeijingDateTime();
      const refundedPoints = (POINTS.image * missingImageCount) + (copyText ? 0 : POINTS.copy);
      const actualCost = Math.max(totalCost - refundedPoints, 0);
      
      if (imageUrls.length > 0) {
        db.addHistory(req.userId, 'both', {
          sub_type: 'generate',
          image_url: JSON.stringify(imageUrls),
          content: copyText || '',
          prompt: prompt,
          ratio: ratio,
          cost_points: actualCost,
          client_task_id: clientTaskId
        });
      } else if (copyText) {
        db.addHistory(req.userId, 'copy', {
          sub_type: 'both-copy',
          content: copyText,
          prompt: prompt,
          cost_points: POINTS.copy,
          client_task_id: clientTaskId
        });
      }
      refundablePoints = 0;
  
      res.json({
        imageUrl,
        imageUrls,
        copy: copyText,
        remainingPoints: db.getUserPoints(req.userId),
        createdAt
      });
    } catch (err) {
      if (refundablePoints > 0) refundPoints(req.userId, refundablePoints, '图文一体生成失败退款');
      res.status(500).json({ error: '请求失败' });
    }
  });
  
  
  return router;
}

module.exports = {
  createGenerationRouter
};
