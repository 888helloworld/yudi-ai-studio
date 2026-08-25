const {
  buildXiEditPrompt,
  buildXiGeneratePrompt,
  getSourceImageFilename
} = require('./prompt-service');
const { getUploadedImageDimensions } = require('../utils/image-storage');
const {
  buildXiImageHeaders,
  buildXiImageUrl,
  formatUpstreamError,
  getXiImageApiKey,
  isTransientXiXuError,
  parseXiXuImages,
  withTimeout
} = require('./upstream-http');
const { saveXiXuImages, summarizeImageFiles } = require('./xi-image-compositor');
const { extractXiXuImageMetadata } = require('./xi-image-size');

const TEN_MINUTES_MS = 10 * 60 * 1000;

function getTimeoutMs(name, fallback = TEN_MINUTES_MS) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed <= 0 ? 0 : Math.max(parsed, 30000);
}

function timeoutMessage(action, timeoutMs) {
  return `gpt-image-2 ${action}超时（超过${Math.round(timeoutMs / 1000)}秒）`;
}

function boundedRetryCount(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(Math.floor(parsed), 2)) : fallback;
}

function createXiImageProvider() {
  const generateTimeoutMs = getTimeoutMs('XI_XU_GENERATE_TIMEOUT_MS');
  const editTimeoutMs = getTimeoutMs('XI_XU_EDIT_TIMEOUT_MS');
  const generateRetries = boundedRetryCount(process.env.XI_XU_GENERATE_RETRIES, 1);
  const editRetries = boundedRetryCount(process.env.XI_XU_EDIT_RETRIES, 1);

  function logGenerateError(error, details = {}) {
    const cause = error?.cause || {};
    console.error('gpt-image-2 生图请求失败:', JSON.stringify({
      message: error?.message || String(error),
      name: error?.name || '',
      code: error?.code || '',
      causeMessage: cause.message || '',
      causeName: cause.name || '',
      causeCode: cause.code || '',
      causeErrno: cause.errno || '',
      transient: isTransientXiXuError(error),
      ...details
    }));
  }

  function logEditError(error, files = [], context = {}) {
    const cause = error?.cause || {};
    console.error('gpt-image-2 改图请求失败:', JSON.stringify({
      message: error?.message || String(error),
      name: error?.name || '',
      causeCode: cause.code || '',
      causeErrno: cause.errno || '',
      sourceCount: files.length,
      totalMb: Number((files.reduce((sum, file) => sum + (file.buffer?.length || 0), 0) / 1024 / 1024).toFixed(2)),
      files: summarizeImageFiles(files),
      ...context
    }));
  }

  async function callXiXuGenerateOnce({ prompt, size, count, quality }, attempt = 1) {
    const apiKey = getXiImageApiKey();
    if (!apiKey) throw new Error('gpt-image-2 图片服务未配置');
    const controller = new AbortController();
    const timeoutMs = generateTimeoutMs;
    const startedAt = Date.now();
    try {
      const response = await withTimeout(fetch(buildXiImageUrl('/v1/images/generations'), {
        method: 'POST',
        signal: controller.signal,
        headers: buildXiImageHeaders({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          model: process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2',
          prompt: buildXiGeneratePrompt(prompt, size),
          size,
          n: count,
          quality,
          output_format: 'png'
        })
      }), timeoutMs, timeoutMessage('生图请求', timeoutMs), () => controller.abort());
      const text = await withTimeout(response.text(), timeoutMs, timeoutMessage('生图结果下载', timeoutMs), () => controller.abort());
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!response.ok) {
        const upstreamError = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
        throw new Error(formatUpstreamError(upstreamError, '生图服务暂时不可用，请稍后再试'));
      }
      const imageUrls = parseXiXuImages(data);
      if (imageUrls.length === 0) throw new Error('上游未返回图片');
      return {
        localUrls: await saveXiXuImages(imageUrls, `xixu_gen_${size.replace('x', '_')}`, size),
        upstreamMeta: extractXiXuImageMetadata(data, { size, quality })
      };
    } catch (error) {
      const normalizedError = error.name === 'AbortError'
        ? new Error(timeoutMs > 0 ? timeoutMessage('生图请求', timeoutMs) : 'gpt-image-2 生图连接被中断')
        : error;
      logGenerateError(normalizedError, { attempt, size, count, quality, durationMs: Date.now() - startedAt });
      throw normalizedError;
    } finally {
      controller.abort();
    }
  }

  async function callXiXuGenerate(job) {
    let lastError;
    const maxAttempts = generateRetries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await callXiXuGenerateOnce(job, attempt);
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isTransientXiXuError(error)) break;
        const waitMs = Math.min(1000 * attempt, 3000);
        console.warn('gpt-image-2 生图瞬时故障，准备重试:', JSON.stringify({ attempt, nextAttempt: attempt + 1, waitMs, message: error.message || String(error) }));
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    throw lastError;
  }

  async function callXiXuEditOnce({ prompt, size, count, quality, sourceFiles, promptOverride }, attempt = 1) {
    const apiKey = getXiImageApiKey();
    if (!apiKey) throw new Error('gpt-image-2 图片服务未配置');
    const controller = new AbortController();
    const timeoutMs = editTimeoutMs;
    try {
      const form = new FormData();
      const requestSourceFiles = sourceFiles;
      requestSourceFiles.forEach((file, index) => {
        form.append('image', new Blob([file.buffer], { type: file.mimetype }), file.originalname || getSourceImageFilename(index));
      });
      form.append('model', process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2');
      form.append('prompt', promptOverride || buildXiEditPrompt(prompt, sourceFiles, size));
      form.append('size', size);
      form.append('n', String(count));
      form.append('quality', quality);
      form.append('output_format', 'png');
      console.log('gpt-image-2 改图请求:', JSON.stringify({
        size, quality, count,
        sourceDimensions: getUploadedImageDimensions(sourceFiles),
        requestFiles: summarizeImageFiles(requestSourceFiles),
        sourceBytes: sourceFiles.map((file) => file.buffer?.length || 0)
      }));
      const response = await withTimeout(fetch(buildXiImageUrl('/v1/images/edits'), {
        method: 'POST',
        signal: controller.signal,
        headers: buildXiImageHeaders({ Authorization: `Bearer ${apiKey}` }),
        body: form
      }), timeoutMs, timeoutMessage('改图请求', timeoutMs), () => controller.abort());
      const text = await withTimeout(response.text(), timeoutMs, timeoutMessage('改图结果下载', timeoutMs), () => controller.abort());
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!response.ok) {
        const upstreamError = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
        throw new Error(formatUpstreamError(upstreamError, '改图服务暂时不可用，请稍后再试'));
      }
      const imageUrls = parseXiXuImages(data);
      if (imageUrls.length === 0) throw new Error('上游未返回图片');
      const localUrls = await saveXiXuImages(imageUrls, `xixu_edit_${size.replace('x', '_')}`, size);
      return { localUrls, upstreamMeta: extractXiXuImageMetadata(data, { size, quality }) };
    } catch (error) {
      const normalizedError = error.name === 'AbortError'
        ? new Error(timeoutMs > 0 ? timeoutMessage('改图请求', timeoutMs) : 'gpt-image-2 改图连接被中断')
        : error;
      logEditError(normalizedError, sourceFiles, { attempt });
      throw normalizedError;
    } finally {
      controller.abort();
    }
  }

  async function callXiXuEdit(job) {
    let lastError;
    const maxAttempts = editRetries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await callXiXuEditOnce(job, attempt);
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isTransientXiXuError(error)) break;
        const waitMs = Math.min(1000 * attempt, 3000);
        console.warn('gpt-image-2 改图瞬时故障，准备重试:', JSON.stringify({ attempt, nextAttempt: attempt + 1, waitMs, message: error.message || String(error) }));
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    throw lastError;
  }

  return {
    callXiXuEdit,
    callXiXuGenerate,
    fixedQuality: 'medium'
  };
}

module.exports = { createXiImageProvider };
