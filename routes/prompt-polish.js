const express = require('express');
const { extractChatText } = require('../services/reverse-prompt-service');
const {
  buildPromptPolishInstruction,
  getUnresolvedReferenceCorrections,
  normalizePromptPolishResult
} = require('../services/prompt-polish-service');
const { formatUpstreamError } = require('../services/upstream-http');
const { getRequiredEnv, normalizeClientTaskId, sanitizeInput } = require('../utils/request-utils');

const SUPPORTED_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024', '2048x1152', '1152x2048']);
const DEFAULT_DEEPSEEK_VISION_MODEL = 'deepseek-v4-flash-vision-exp';
const MAX_DEEPSEEK_INLINE_IMAGE_BYTES = 34 * 1024 * 1024;
const activePromptPolishByUser = new Map();
let activePromptPolishTotal = 0;

function getPromptPolishConcurrencyLimit(name, fallback, maximum) {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(Math.floor(configured), maximum)
    : fallback;
}

function acquirePromptPolishSlot(userId) {
  const globalLimit = getPromptPolishConcurrencyLimit('PROMPT_POLISH_MAX_CONCURRENT', 6, 50);
  const userLimit = getPromptPolishConcurrencyLimit('PROMPT_POLISH_MAX_CONCURRENT_PER_USER', 2, 10);
  if (activePromptPolishTotal >= globalLimit) {
    const error = new Error('提示词润色当前任务较多，请稍后再试');
    error.statusCode = 503;
    throw error;
  }
  const activeForUser = activePromptPolishByUser.get(userId) || 0;
  if (activeForUser >= userLimit) {
    const error = new Error(`每个账号最多同时润色 ${userLimit} 个任务`);
    error.statusCode = 429;
    throw error;
  }
  activePromptPolishTotal += 1;
  activePromptPolishByUser.set(userId, activeForUser + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activePromptPolishTotal = Math.max(0, activePromptPolishTotal - 1);
    const remaining = Math.max(0, (activePromptPolishByUser.get(userId) || 1) - 1);
    if (remaining === 0) activePromptPolishByUser.delete(userId);
    else activePromptPolishByUser.set(userId, remaining);
  };
}

function getPromptPolishTimeoutMs() {
  const configured = Number(process.env.DEEPSEEK_VISION_TIMEOUT_MS || process.env.DEEPSEEK_TIMEOUT_MS || 180000);
  if (!Number.isFinite(configured)) return 180000;
  return Math.min(600000, Math.max(30000, Math.round(configured)));
}

function getDeepSeekChatUrl() {
  const baseUrl = String(process.env.DEEPSEEK_API_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  return `${baseUrl}/chat/completions`;
}

function formatPromptPolishError(message, fallback = 'DeepSeek 视觉润色暂时不可用，请稍后再试') {
  return formatUpstreamError(message, fallback)
    .replace(/上游图片服务/g, 'DeepSeek 服务')
    .replace(/图片服务/g, 'DeepSeek 服务')
    .replace(/本次没有生成图片，积分已退回。/g, '')
    .trim();
}

function buildDeepSeekVisionRequest({ prompt, size, files, maxTokens = 4096, correctionContext = null }) {
  const model = process.env.DEEPSEEK_VISION_MODEL || DEFAULT_DEEPSEEK_VISION_MODEL;
  const requestText = correctionContext
    ? `上一次结果没有正确应用参考图事实。必须重新输出完整 JSON，逐项使用 referenceValue，删除 inputText 对应的错误属性，不要解释冲突。校正信息：${JSON.stringify(correctionContext)}`
    : '请结合用户原始要求、目标画布和所有参考图，输出最终润色结果。';
  const userContent = [
    { type: 'text', text: requestText },
    ...files.map((file) => ({
      type: 'image_url',
      image_url: {
        url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
        detail: 'original'
      }
    }))
  ];
  return {
    model,
    messages: [
      { role: 'system', content: buildPromptPolishInstruction({ prompt, size, imageCount: files.length }) },
      { role: 'user', content: userContent }
    ],
    thinking: { type: 'disabled' },
    temperature: 0.2,
    max_tokens: maxTokens
  };
}

function getDeepSeekChoiceMetadata(data) {
  const choice = data?.choices?.[0] || {};
  return {
    finishReason: String(choice.finish_reason || ''),
    contentLength: String(choice.message?.content || '').length,
    reasoningLength: String(choice.message?.reasoning_content || '').length
  };
}

function shouldRetryPromptPolish(data, result) {
  const { finishReason } = getDeepSeekChoiceMetadata(data);
  return finishReason === 'length' || !result || getUnresolvedReferenceCorrections(result).length > 0;
}

function createPromptPolishRouter({ authMiddleware, copyLimiter, upload, validateUploadedImageFiles, chargePoints, refundPoints, getRemainingPoints, pointCost }) {
  const router = express.Router();
  router.post('/api/xi-image/polish-prompt', copyLimiter, authMiddleware, upload.array('image', 3), validateUploadedImageFiles, async (req, res) => {
    const prompt = sanitizeInput(req.body.prompt, 3000);
    const clientTaskId = normalizeClientTaskId(req.body.clientTaskId || req.body.clientRequestId);
    const operationKey = clientTaskId ? `prompt-polish:${req.userId}:${clientTaskId}` : null;
    const size = SUPPORTED_SIZES.has(req.body.size) ? req.body.size : '1024x1536';
    const files = Array.isArray(req.files) ? req.files : [];
    if (!prompt) return res.status(400).json({ error: '请先输入要润色的图片描述' });
    const totalImageBytes = files.reduce((total, file) => total + (file.buffer?.length || 0), 0);
    if (totalImageBytes > MAX_DEEPSEEK_INLINE_IMAGE_BYTES) {
      return res.status(400).json({ error: '参考图总大小过大，请压缩到 34MB 以内再润色' });
    }

    const apiKey = getRequiredEnv('DEEPSEEK_API_KEY');
    if (!apiKey) return res.status(500).json({ error: 'DeepSeek 视觉润色服务未配置' });

    let releaseSlot;
    try {
      releaseSlot = acquirePromptPolishSlot(req.userId);
    } catch (error) {
      return res.status(error.statusCode || 429).json({ error: error.message });
    }
    const cost = Math.max(1, Number(pointCost) || 1);
    let shouldRefund = false;
    try {
      const charge = chargePoints(req.userId, cost, '提示词视觉润色', operationKey ? `${operationKey}:charge` : null);
      if (charge?.alreadyApplied) {
        releaseSlot();
        return res.status(409).json({ error: '该润色任务已提交，请不要重复提交' });
      }
      shouldRefund = true;
    } catch (error) {
      releaseSlot();
      return res.status(error.statusCode || 500).json({ error: error.message || '积分扣减失败' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getPromptPolishTimeoutMs());
    try {
      let requestBody = buildDeepSeekVisionRequest({ prompt, size, files });
      const sendRequest = async () => {
        const response = await fetch(getDeepSeekChatUrl(), {
          method: 'POST',
          signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
        const text = await response.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
        return { response, text, data };
      };

      let { response, text, data } = await sendRequest();
      if (!response.ok) {
        const upstreamError = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
        return res.status(502).json({ error: formatPromptPolishError(upstreamError) });
      }
      let result = normalizePromptPolishResult(extractChatText(data));
      let detectedReferenceCorrections = result?.referenceCorrections || [];
      let retried = false;
      if (shouldRetryPromptPolish(data, result)) {
        const firstMetadata = getDeepSeekChoiceMetadata(data);
        const unresolvedCorrections = getUnresolvedReferenceCorrections(result);
        console.warn('DeepSeek 视觉润色首次输出被截断或无效，准备重试:', JSON.stringify({
          userId: req.userId,
          imageCount: files.length,
          size,
          correctionCount: unresolvedCorrections.length,
          ...firstMetadata
        }));
        retried = true;
        requestBody = buildDeepSeekVisionRequest({
          prompt,
          size,
          files,
          maxTokens: 8192,
          correctionContext: unresolvedCorrections.length > 0 ? unresolvedCorrections : null
        });
        ({ response, text, data } = await sendRequest());
        if (!response.ok) {
          const upstreamError = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
          return res.status(502).json({ error: formatPromptPolishError(upstreamError) });
        }
        result = normalizePromptPolishResult(extractChatText(data));
        if ((result?.referenceCorrections || []).length > 0) {
          detectedReferenceCorrections = result.referenceCorrections;
        }
      }
      const finalUnresolvedCorrections = getUnresolvedReferenceCorrections(result);
      if (!result || finalUnresolvedCorrections.length > 0) {
        console.error('DeepSeek 视觉润色没有有效最终结果:', JSON.stringify({
          userId: req.userId,
          imageCount: files.length,
          size,
          retried,
          correctionCount: finalUnresolvedCorrections.length,
          ...getDeepSeekChoiceMetadata(data)
        }));
        return res.status(502).json({ error: 'DeepSeek 视觉校正未完成，请重新润色后再出图' });
      }
      shouldRefund = false;
      const { referenceCorrections, ...publicResult } = result;
      return res.json({
        success: true,
        model: requestBody.model,
        imageCount: files.length,
        retried,
        costPoints: cost,
        remainingPoints: typeof getRemainingPoints === 'function' ? getRemainingPoints(req.userId) : undefined,
        referenceCorrections: detectedReferenceCorrections,
        ...publicResult
      });
    } catch (error) {
      const message = error.name === 'AbortError'
        ? '视觉润色请求超时，请稍后再试'
        : formatPromptPolishError(error.message || error, 'DeepSeek 视觉润色失败，请稍后再试');
      return res.status(502).json({ error: message });
    } finally {
      clearTimeout(timeout);
      if (shouldRefund) {
        try { refundPoints(req.userId, cost, '提示词视觉润色失败退款', operationKey ? `${operationKey}:failure` : null); }
        catch (refundError) { console.error('提示词视觉润色退款失败:', refundError.message || refundError); }
      }
      releaseSlot();
    }
  });
  return router;
}

module.exports = {
  DEFAULT_DEEPSEEK_VISION_MODEL,
  MAX_DEEPSEEK_INLINE_IMAGE_BYTES,
  buildDeepSeekVisionRequest,
  acquirePromptPolishSlot,
  createPromptPolishRouter,
  formatPromptPolishError,
  getDeepSeekChoiceMetadata,
  getDeepSeekChatUrl,
  getPromptPolishTimeoutMs,
  shouldRetryPromptPolish
};
