const express = require('express');
const { extractChatText } = require('../services/reverse-prompt-service');
const { buildPromptPolishInstruction, normalizePromptPolishResult } = require('../services/prompt-polish-service');
const { buildXiXuHeaders, buildXiXuUrl, formatUpstreamError } = require('../services/upstream-http');
const { getRequiredEnv, sanitizeInput } = require('../utils/request-utils');

const SUPPORTED_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024', '2048x1152', '1152x2048']);

function getPromptPolishTimeoutMs() {
  const configured = Number(process.env.XI_XU_VISION_TIMEOUT_MS || 180000);
  if (!Number.isFinite(configured)) return 180000;
  return Math.min(600000, Math.max(30000, Math.round(configured)));
}

function createPromptPolishRouter({ authMiddleware, copyLimiter, upload, validateUploadedImageFiles }) {
  const router = express.Router();
  router.post('/api/xi-image/polish-prompt', copyLimiter, authMiddleware, upload.array('image', 3), validateUploadedImageFiles, async (req, res) => {
    const prompt = sanitizeInput(req.body.prompt, 3000);
    const size = SUPPORTED_SIZES.has(req.body.size) ? req.body.size : '1024x1536';
    const files = Array.isArray(req.files) ? req.files : [];
    if (!prompt) return res.status(400).json({ error: '请先输入要润色的图片描述' });

    const apiKey = getRequiredEnv('XI_XU_API_KEY');
    if (!apiKey) return res.status(500).json({ error: '视觉润色服务未配置' });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getPromptPolishTimeoutMs());
    try {
      const userContent = [
        { type: 'text', text: '请结合用户原始要求、目标画布和所有参考图，输出最终润色结果。' },
        ...files.map((file) => ({
          type: 'image_url',
          image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}` }
        }))
      ];
      const response = await fetch(buildXiXuUrl('/v1/chat/completions'), {
        method: 'POST',
        signal: controller.signal,
        headers: buildXiXuHeaders({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: process.env.XI_XU_VISION_MODEL || 'gpt-5.5',
          messages: [
            { role: 'system', content: buildPromptPolishInstruction({ prompt, size, imageCount: files.length }) },
            { role: 'user', content: userContent }
          ],
          temperature: 0.2
        })
      });
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!response.ok) {
        const upstreamError = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
        return res.status(502).json({ error: formatUpstreamError(upstreamError, '视觉润色服务暂时不可用，请稍后再试') });
      }
      const result = normalizePromptPolishResult(extractChatText(data));
      if (!result) return res.status(502).json({ error: '视觉润色服务没有返回有效结果，请重试' });
      return res.json({ success: true, ...result });
    } catch (error) {
      const message = error.name === 'AbortError'
        ? '视觉润色请求超时，请稍后再试'
        : formatUpstreamError(error.message || error, '视觉润色失败，请稍后再试');
      return res.status(502).json({ error: message });
    } finally {
      clearTimeout(timeout);
    }
  });
  return router;
}

module.exports = { createPromptPolishRouter, getPromptPolishTimeoutMs };
