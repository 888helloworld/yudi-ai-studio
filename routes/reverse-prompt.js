const express = require('express');
const { POINTS } = require('../config/points');
const {
  buildReversePromptInstruction,
  extractChatText,
  getReversePromptMode,
  normalizeReversePromptResult,
  parseJsonLike
} = require('../services/reverse-prompt-service');
const { buildXiXuHeaders, buildXiXuUrl, formatUpstreamError } = require('../services/upstream-http');
const { saveUploadedSourceImages } = require('../utils/image-storage');
const { formatBeijingDateTime, getRequiredEnv, normalizeClientTaskId, sanitizeInput } = require('../utils/request-utils');

function getVisionTimeoutMs() {
  const raw = String(process.env.XI_XU_VISION_TIMEOUT_MS || '').trim();
  if (!raw) return 180000;
  const configured = Number(raw);
  if (!Number.isFinite(configured)) return 180000;
  return Math.min(600000, Math.max(30000, Math.round(configured)));
}

function failedHistoryContent({ file, reverseMode, previewUrl, startedAtMs, error }) {
  return JSON.stringify({
    status: 'failed',
    model: process.env.XI_XU_VISION_MODEL || 'gpt-5.5',
    file,
    reverse_mode: reverseMode,
    preview_url: previewUrl,
    duration_ms: Date.now() - startedAtMs,
    error
  });
}

function createReversePromptRouter({ authMiddleware, copyLimiter, upload, validateUploadedImageFiles, db, chargePoints, refundPoints }) {
  const router = express.Router();
  router.post('/api/xi-image/reverse-prompt', copyLimiter, authMiddleware, upload.single('image'), validateUploadedImageFiles, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请上传要反推的图片' });
    const clientTaskId = normalizeClientTaskId(req.body.clientTaskId);
    const operationKey = clientTaskId ? `reverse:${req.userId}:${clientTaskId}` : null;
    const totalCost = POINTS.copy;
    let refundablePoints = 0;
    try {
      const charge = chargePoints(req.userId, totalCost, '看图写 Prompt', operationKey ? `${operationKey}:charge` : null);
      if (charge?.alreadyApplied) return res.status(409).json({ error: '该识图任务已提交，请在历史记录中查看' });
      refundablePoints = totalCost;
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message || '积分扣减失败' });
    }

    const apiKey = getRequiredEnv('XI_XU_API_KEY');
    if (!apiKey) {
      refundPoints(req.userId, refundablePoints, '看图写 Prompt 失败退款', operationKey ? `${operationKey}:failure` : null);
      return res.status(500).json({ error: 'gpt-image-2 服务未配置' });
    }

    const startedAtMs = Date.now();
    const file = req.file.originalname || 'image.png';
    const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getVisionTimeoutMs());
    const reverseMode = getReversePromptMode(sanitizeInput(req.body.reverseMode, 40));
    const historySource = sanitizeInput(req.body.historySource, 20) === 'xhs' ? 'xhs' : 'xi';
    let historyId = null;
    let previewUrl = '';

    try {
      if (historySource === 'xi') {
        previewUrl = saveUploadedSourceImages([req.file], 'xixu_reverse')[0] || '';
        historyId = db.addHistory(req.userId, 'reverse', {
          sub_type: 'xi-reverse',
          content: JSON.stringify({
            status: 'running',
            model: process.env.XI_XU_VISION_MODEL || 'gpt-5.5',
            file,
            reverse_mode: reverseMode,
            preview_url: previewUrl,
            duration_ms: 0
          }),
          prompt: file || '图片反推提示词',
          cost_points: totalCost,
          client_task_id: clientTaskId || null
        });
      }

      const response = await fetch(buildXiXuUrl('/v1/chat/completions'), {
        method: 'POST',
        signal: controller.signal,
        headers: buildXiXuHeaders({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: process.env.XI_XU_VISION_MODEL || 'gpt-5.5',
          messages: [
            { role: 'system', content: buildReversePromptInstruction(reverseMode) },
            {
              role: 'user',
              content: [
                { type: 'text', text: `请根据这张图片反推出高质量精美出图提示词。当前反推模式：${reverseMode}。保留原图核心内容，但按所选模式优化光线、构图、色彩、质感和审美，让生成结果更好看。` },
                { type: 'image_url', image_url: { url: dataUrl } }
              ]
            }
          ],
          temperature: 0.2
        })
      });
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!response.ok) {
        const upstreamError = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
        const message = formatUpstreamError(upstreamError, '识图服务暂时不可用，请稍后再试');
        refundPoints(req.userId, refundablePoints, '看图写 Prompt 失败退款', operationKey ? `${operationKey}:failure` : null);
        refundablePoints = 0;
        if (historyId) {
          db.updateHistory(req.userId, historyId, { content: failedHistoryContent({ file, reverseMode, previewUrl, startedAtMs, error: message }), cost_points: 0 });
        }
        return res.status(502).json({ error: message });
      }

      const content = extractChatText(data);
      if (!content) {
        refundPoints(req.userId, refundablePoints, '看图写 Prompt 失败退款', operationKey ? `${operationKey}:failure` : null);
        refundablePoints = 0;
        if (historyId) {
          db.updateHistory(req.userId, historyId, {
            content: failedHistoryContent({ file, reverseMode, previewUrl, startedAtMs, error: '上游未返回反推结果' }),
            cost_points: 0
          });
        }
        return res.status(502).json({ error: '上游未返回反推结果' });
      }

      const parsed = normalizeReversePromptResult(parseJsonLike(content));
      const durationMs = Date.now() - startedAtMs;
      if (!previewUrl) previewUrl = saveUploadedSourceImages([req.file], 'xixu_reverse')[0] || '';
      const completedHistory = {
        sub_type: historySource === 'xhs' ? 'xhs-reverse' : 'xi-reverse',
        content: JSON.stringify({
          status: 'done',
          model: process.env.XI_XU_VISION_MODEL || 'gpt-5.5',
          result: parsed || null,
          raw: parsed ? '' : content,
          file,
          reverse_mode: reverseMode,
          preview_url: previewUrl,
          duration_ms: durationMs
        }),
        prompt: parsed?.title || file || '图片反推提示词',
        cost_points: totalCost,
        client_task_id: clientTaskId || null
      };
      if (historyId) db.updateHistory(req.userId, historyId, completedHistory);
      else historyId = db.addHistory(req.userId, 'reverse', completedHistory);
      refundablePoints = 0;
      res.json({
        success: true,
        model: process.env.XI_XU_VISION_MODEL || 'gpt-5.5',
        result: parsed || null,
        raw: parsed ? '' : content,
        historyId,
        reverseMode,
        previewUrl,
        durationMs,
        remainingPoints: db.getUserPoints(req.userId),
        createdAt: formatBeijingDateTime()
      });
    } catch (error) {
      if (refundablePoints > 0) refundPoints(req.userId, refundablePoints, '看图写 Prompt 失败退款', operationKey ? `${operationKey}:failure` : null);
      const message = error.name === 'AbortError' ? '识图请求超时' : '识图请求失败';
      if (historyId) {
        db.updateHistory(req.userId, historyId, {
          content: failedHistoryContent({ file, reverseMode, previewUrl, startedAtMs, error: message }),
          cost_points: 0
        });
      }
      res.status(502).json({ error: message });
    } finally {
      clearTimeout(timeout);
    }
  });
  return router;
}

module.exports = { createReversePromptRouter, getVisionTimeoutMs };
