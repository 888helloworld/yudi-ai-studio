const {
  buildImageVariationPrompt,
  buildReferenceBoardPrompt,
  buildXiEditPrompt,
  buildXiGeneratePrompt,
  getSourceImageFilename
} = require('./prompt-service');
const { getUploadedImageDimensions } = require('../utils/image-storage');
const { getRequiredEnv } = require('../utils/request-utils');
const {
  buildXiImageHeaders,
  buildXiImageUrl,
  formatUpstreamError,
  generateArkImageUrls,
  getXiImageApiKey,
  isTransientXiXuError,
  parseXiXuImages,
  withTimeout
} = require('./upstream-http');
const { createReferenceBoardFile, saveXiXuImages, summarizeImageFiles } = require('./xi-image-compositor');
const { extractXiXuImageMetadata, xiSizeToArkSize } = require('./xi-image-size');

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ARK_IMAGE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

function boundedRetryCount(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(Math.floor(parsed), 2)) : fallback;
}

function createXiImageProvider() {
  const generateTimeoutMs = Number(process.env.XI_XU_GENERATE_TIMEOUT_MS || TEN_MINUTES_MS);
  const editTimeoutMs = Number(process.env.XI_XU_EDIT_TIMEOUT_MS || TEN_MINUTES_MS);
  const generateRetries = boundedRetryCount(process.env.XI_XU_GENERATE_RETRIES, 1);
  const editRetries = boundedRetryCount(process.env.XI_XU_EDIT_RETRIES, 1);
  const editCircuitBreakerMs = Number(process.env.XI_XU_EDIT_CIRCUIT_BREAKER_MS || 0);
  const forceEditFallback = /^true$/i.test(process.env.XI_XU_EDIT_FORCE_FALLBACK || '');
  const arkFallbackEnabled = /^true$/i.test(process.env.ARK_FALLBACK_ENABLED || '');
  const editCircuit = { failures: 0, openUntilMs: 0 };

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

  function getEditCircuitMessage() {
    const remainingMs = editCircuit.openUntilMs - Date.now();
    return remainingMs > 0 ? `gpt-image-2 改图暂时不稳定，${Math.ceil(remainingMs / 1000)}秒内直接走备用通道` : '';
  }

  function markEditSuccess() {
    editCircuit.failures = 0;
    editCircuit.openUntilMs = 0;
  }

  function markEditFailure(error) {
    editCircuit.failures += 1;
    if (editCircuitBreakerMs > 0 && editCircuit.failures >= 2) {
      editCircuit.openUntilMs = Date.now() + Math.max(editCircuitBreakerMs, 60000);
      console.error('gpt-image-2 改图临时熔断:', JSON.stringify({
        failures: editCircuit.failures,
        seconds: Math.round((editCircuit.openUntilMs - Date.now()) / 1000),
        reason: error?.message || String(error)
      }));
    }
  }

  async function callXiXuGenerateOnce({ prompt, size, count, quality }, attempt = 1) {
    const apiKey = getXiImageApiKey();
    if (!apiKey) throw new Error('gpt-image-2 图片服务未配置');
    const controller = new AbortController();
    const timeoutMs = Math.max(generateTimeoutMs, 30000);
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
      }), timeoutMs, `gpt-image-2 生图请求超时（超过${Math.round(timeoutMs / 1000)}秒）`, () => controller.abort());
      const text = await withTimeout(response.text(), timeoutMs, `gpt-image-2 生图结果下载超时（超过${Math.round(timeoutMs / 1000)}秒）`, () => controller.abort());
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
        ? new Error(`gpt-image-2 生图请求超时（超过${Math.round(timeoutMs / 1000)}秒）`)
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

  async function callArkGenerateForXiJob({ prompt, size, count }) {
    if (!arkFallbackEnabled) throw new Error('图片服务暂时不可用，请稍后重试。本次没有生成图片，积分已退回。');
    const apiKey = getRequiredEnv('ARK_API_KEY');
    if (!apiKey) throw new Error('备用图片服务未配置');
    const arkSize = xiSizeToArkSize(size);
    const remoteUrls = [];
    for (let index = 0; index < count; index += 1) {
      const response = await fetch(`${ARK_IMAGE_BASE_URL}/images/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'doubao-seedream-5-0-lite-260128',
          prompt: buildImageVariationPrompt(prompt, index, count),
          size: `${arkSize.width}x${arkSize.height}`,
          output_format: 'png',
          watermark: false
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const upstreamError = data?.error?.message || data?.message || `HTTP ${response.status}`;
        throw new Error(formatUpstreamError(upstreamError, '备用图片服务暂时不可用，请稍后再试'));
      }
      const url = data.data?.[0]?.url;
      if (!url) throw new Error('备用图片服务未返回图片地址');
      remoteUrls.push(url);
    }
    if (remoteUrls.length === 0) throw new Error('备用图片服务未返回图片');
    return saveXiXuImages(remoteUrls, `xixu_ark_fallback_${size.replace('x', '_')}`, size);
  }

  async function callArkEditFallback({ prompt, size, count, sourceFiles, promptOverride }) {
    if (!arkFallbackEnabled) throw new Error('图片服务暂时不可用，请稍后重试。本次没有生成图片，积分已退回。');
    const apiKey = getRequiredEnv('ARK_API_KEY');
    if (!apiKey) throw new Error('备用图片服务未配置');
    const firstSource = Array.isArray(sourceFiles) ? sourceFiles[0] : null;
    if (!firstSource?.buffer || !firstSource?.mimetype) throw new Error('备用改图缺少参考图');
    const arkSize = xiSizeToArkSize(size);
    const remoteUrls = await generateArkImageUrls(ARK_IMAGE_BASE_URL, apiKey, {
      model: 'doubao-seedream-5-0-lite-260128',
      prompt: promptOverride || buildXiEditPrompt(prompt, sourceFiles, size),
      image: `data:${firstSource.mimetype};base64,${Buffer.from(firstSource.buffer).toString('base64')}`,
      size: `${arkSize.width}x${arkSize.height}`,
      output_format: 'png',
      watermark: false
    }, count);
    if (remoteUrls.length === 0) throw new Error('备用改图服务未返回图片');
    return saveXiXuImages(remoteUrls, `xixu_ark_edit_fallback_${size.replace('x', '_')}`, size);
  }

  async function callXiXuEditOnce({ prompt, size, count, quality, sourceFiles, promptOverride }, attempt = 1) {
    const apiKey = getXiImageApiKey();
    if (!apiKey) throw new Error('gpt-image-2 图片服务未配置');
    if (forceEditFallback) throw new Error('gpt-image-2 改图已临时切到备用通道');
    const circuitMessage = getEditCircuitMessage();
    if (circuitMessage) throw new Error(circuitMessage);
    const controller = new AbortController();
    const timeoutMs = Math.max(editTimeoutMs, 30000);
    try {
      const form = new FormData();
      const requestSourceFiles = sourceFiles.length > 1 ? [createReferenceBoardFile(sourceFiles), ...sourceFiles] : sourceFiles;
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
      }), timeoutMs, `gpt-image-2 改图请求超时（超过${Math.round(timeoutMs / 1000)}秒）`, () => controller.abort());
      const text = await withTimeout(response.text(), timeoutMs, `gpt-image-2 改图结果下载超时（超过${Math.round(timeoutMs / 1000)}秒）`, () => controller.abort());
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!response.ok) {
        const upstreamError = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
        throw new Error(formatUpstreamError(upstreamError, '改图服务暂时不可用，请稍后再试'));
      }
      const imageUrls = parseXiXuImages(data);
      if (imageUrls.length === 0) throw new Error('上游未返回图片');
      const localUrls = await saveXiXuImages(imageUrls, `xixu_edit_${size.replace('x', '_')}`, size);
      markEditSuccess();
      return { localUrls, upstreamMeta: extractXiXuImageMetadata(data, { size, quality }) };
    } catch (error) {
      const normalizedError = error.name === 'AbortError'
        ? new Error(`gpt-image-2 改图请求超时（超过${Math.round(timeoutMs / 1000)}秒）`)
        : error;
      logEditError(normalizedError, sourceFiles, { attempt });
      markEditFailure(normalizedError);
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

  async function callXiEditWithFallback(job) {
    try {
      const result = await callXiXuEdit(job);
      return { localUrls: result.localUrls, upstreamMeta: result.upstreamMeta || {}, provider: 'xixu', fallbackReason: '' };
    } catch (error) {
      const fallbackReason = error.message || 'gpt-image-2 改图失败';
      if (!arkFallbackEnabled) {
        const finalError = new Error(formatUpstreamError(fallbackReason, '图片服务暂时不可用，请稍后重试。本次没有生成图片，积分已退回。'));
        finalError.fallbackReason = fallbackReason;
        throw finalError;
      }
      if ((job.sourceFiles || []).length > 1) {
        try {
          const referenceBoard = createReferenceBoardFile(job.sourceFiles || []);
          const localUrls = await callArkEditFallback({
            ...job,
            sourceFiles: [referenceBoard],
            promptOverride: buildReferenceBoardPrompt(job.prompt, job.sourceFiles || [])
          });
          return { localUrls, upstreamMeta: {}, provider: 'ark-reference-board-fallback', fallbackReason };
        } catch (boardError) {
          const finalError = new Error('多参考图改图请求失败，上游服务没有完成处理。系统已尝试把参考图合成参考板走备用改图，但仍未成功，请稍后再试。');
          finalError.fallbackReason = `${fallbackReason}; 参考板备用改图失败: ${boardError.message || boardError}`;
          throw finalError;
        }
      }
      return {
        localUrls: await callArkEditFallback(job),
        upstreamMeta: {},
        provider: 'ark-edit-fallback',
        fallbackReason
      };
    }
  }

  return {
    arkFallbackEnabled,
    arkImageBaseUrl: ARK_IMAGE_BASE_URL,
    callArkGenerateForXiJob,
    callXiEditWithFallback,
    callXiXuGenerate,
    fixedQuality: 'medium'
  };
}

module.exports = { createXiImageProvider };
