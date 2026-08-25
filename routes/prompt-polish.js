const express = require('express');
const { extractChatText } = require('../services/reverse-prompt-service');
const { buildPromptPolishInstruction, normalizePromptPolishResult } = require('../services/prompt-polish-service');
const { formatUpstreamError } = require('../services/upstream-http');
const { getRequiredEnv, sanitizeInput } = require('../utils/request-utils');

const SUPPORTED_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024', '2048x1152', '1152x2048']);
const DEFAULT_DEEPSEEK_VISION_MODEL = 'deepseek-v4-flash-vision-exp';
const MAX_DEEPSEEK_INLINE_IMAGE_BYTES = 34 * 1024 * 1024;

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

function buildDeepSeekVisionRequest({ prompt, size, files, maxTokens = 4096 }) {
  const model = process.env.DEEPSEEK_VISION_MODEL || DEFAULT_DEEPSEEK_VISION_MODEL;
  const userContent = [
    { type: 'text', text: '请结合用户原始要求、目标画布和所有参考图，输出最终润色结果。' },
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
  return finishReason === 'length' || !result;
}

function createPromptPolishRouter({ authMiddleware, copyLimiter, upload, validateUploadedImageFiles }) {
  const router = express.Router();
  router.post('/api/xi-image/polish-prompt', copyLimiter, authMiddleware, upload.array('image', 3), validateUploadedImageFiles, async (req, res) => {
    const prompt = sanitizeInput(req.body.prompt, 3000);
    const size = SUPPORTED_SIZES.has(req.body.size) ? req.body.size : '1024x1536';
    const files = Array.isArray(req.files) ? req.files : [];
    if (!prompt) return res.status(400).json({ error: '请先输入要润色的图片描述' });
    const totalImageBytes = files.reduce((total, file) => total + (file.buffer?.length || 0), 0);
    if (totalImageBytes > MAX_DEEPSEEK_INLINE_IMAGE_BYTES) {
      return res.status(400).json({ error: '参考图总大小过大，请压缩到 34MB 以内再润色' });
    }

    const apiKey = getRequiredEnv('DEEPSEEK_API_KEY');
    if (!apiKey) return res.status(500).json({ error: 'DeepSeek 视觉润色服务未配置' });

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
      let retried = false;
      if (shouldRetryPromptPolish(data, result)) {
        const firstMetadata = getDeepSeekChoiceMetadata(data);
        console.warn('DeepSeek 视觉润色首次输出被截断或无效，准备重试:', JSON.stringify({
          userId: req.userId,
          imageCount: files.length,
          size,
          ...firstMetadata
        }));
        retried = true;
        requestBody = buildDeepSeekVisionRequest({ prompt, size, files, maxTokens: 8192 });
        ({ response, text, data } = await sendRequest());
        if (!response.ok) {
          const upstreamError = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
          return res.status(502).json({ error: formatPromptPolishError(upstreamError) });
        }
        result = normalizePromptPolishResult(extractChatText(data));
      }
      if (!result) {
        console.error('DeepSeek 视觉润色没有有效最终结果:', JSON.stringify({
          userId: req.userId,
          imageCount: files.length,
          size,
          retried,
          ...getDeepSeekChoiceMetadata(data)
        }));
        return res.status(502).json({ error: 'DeepSeek 输出被截断，自动重试后仍未完成，请减少要求或参考图后重试' });
      }
      return res.json({ success: true, model: requestBody.model, imageCount: files.length, retried, ...result });
    } catch (error) {
      const message = error.name === 'AbortError'
        ? '视觉润色请求超时，请稍后再试'
        : formatPromptPolishError(error.message || error, 'DeepSeek 视觉润色失败，请稍后再试');
      return res.status(502).json({ error: message });
    } finally {
      clearTimeout(timeout);
    }
  });
  return router;
}

module.exports = {
  DEFAULT_DEEPSEEK_VISION_MODEL,
  MAX_DEEPSEEK_INLINE_IMAGE_BYTES,
  buildDeepSeekVisionRequest,
  createPromptPolishRouter,
  formatPromptPolishError,
  getDeepSeekChoiceMetadata,
  getDeepSeekChatUrl,
  getPromptPolishTimeoutMs,
  shouldRetryPromptPolish
};
