const { buildImageVariationPrompt } = require('./prompt-service');
const { getRequiredEnv } = require('../utils/request-utils');

function buildXiXuUrl(pathname) {
  const baseUrl = (process.env.XI_XU_API_BASE_URL || 'https://api.xi-xu.me').replace(/\/+$/, '');
  if (baseUrl.endsWith('/v1') && pathname.startsWith('/v1/')) return `${baseUrl}${pathname.slice(3)}`;
  return `${baseUrl}${pathname}`;
}

function buildXiImageUrl(pathname) {
  const baseUrl = (process.env.OPENAI_IMAGE_API_BASE_URL || process.env.XI_XU_API_BASE_URL || 'https://api.xi-xu.me').replace(/\/+$/, '');
  if (baseUrl.includes('?path=')) return `${baseUrl}${encodeURIComponent(pathname)}`;
  if (baseUrl.endsWith('/v1') && pathname.startsWith('/v1/')) return `${baseUrl}${pathname.slice(3)}`;
  return `${baseUrl}${pathname}`;
}

function getXiImageApiKey() {
  if (getRequiredEnv('OPENAI_IMAGE_API_KEY') || getRequiredEnv('OPENAI_IMAGE_API_BASE_URL')) {
    return getRequiredEnv('OPENAI_IMAGE_API_KEY');
  }
  return getRequiredEnv('XI_XU_API_KEY');
}

function isOfficialOpenAIImageApi() {
  const baseUrl = (process.env.OPENAI_IMAGE_API_BASE_URL || '').trim();
  return Boolean(getRequiredEnv('OPENAI_IMAGE_API_KEY')) && (!baseUrl || /api\.openai\.com/i.test(baseUrl));
}

function buildXiXuHeaders(headers = {}) {
  const proxyToken = String(process.env.XI_XU_PROXY_TOKEN || '').trim();
  return proxyToken ? { ...headers, 'X-XiXu-Proxy-Token': proxyToken } : headers;
}

function buildXiImageHeaders(headers = {}) {
  if (getRequiredEnv('OPENAI_IMAGE_API_KEY') || getRequiredEnv('OPENAI_IMAGE_API_BASE_URL')) return headers;
  return buildXiXuHeaders(headers);
}

function parseXiXuImages(data) {
  const urls = [];
  const addImage = (item) => {
    if (!item) return;
    if (typeof item === 'string') {
      urls.push(item);
      return;
    }
    const url = item.url || item.image_url;
    if (url) urls.push(url);
    const base64 = item.b64_json || item.base64 || item.image_base64 || item.result;
    if (base64) urls.push(base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`);
  };

  if (Array.isArray(data?.data)) data.data.forEach(addImage);
  if (Array.isArray(data?.images)) data.images.forEach(addImage);
  if (Array.isArray(data?.output)) {
    data.output.forEach((entry) => {
      if (Array.isArray(entry?.content)) entry.content.forEach(addImage);
      addImage(entry);
    });
  }
  return [...new Set(urls)].filter(Boolean);
}

function formatUpstreamError(message, fallback = '上游服务暂时不可用，请稍后再试') {
  const text = String(message || '').trim();
  if (!text) return fallback;
  const lower = text.toLowerCase();
  if (lower.includes('und_err_headers_timeout') || lower.includes('headers timeout')) {
    return '上游图片服务长时间没有返回响应头，请稍后重试。本次没有生成图片，积分已退回。';
  }
  if (['stream error', 'internal_error', 'internal error', 'terminated', 'socket hang up', 'other side closed', 'body timeout', 'response body'].some((value) => lower.includes(value))) {
    return '图片服务连接中断，请稍后重试。本次没有生成图片，积分已退回。';
  }
  if (['fetch failed', 'connect timeout', 'connect_timeout', 'und_err_connect_timeout'].some((value) => lower.includes(value))) {
    return '图片服务连接失败，请稍后重试。本次没有生成图片，积分已退回。';
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('abort')) {
    return '图片服务响应超时，请稍后重试。本次没有生成图片，积分已退回。';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('429')) {
    return '请求太密集，上游限流了。请把同时开跑调低一点再试。';
  }
  if (lower.includes('insufficient') || lower.includes('quota') || lower.includes('billing')) {
    return '上游账号额度不足或计费异常，请检查接口账号余额。';
  }
  if (lower.includes('content policy') || lower.includes('safety') || lower.includes('policy')) {
    return '这段描述可能触发了安全规则，请换一种更温和、明确的表达。';
  }
  if (lower.includes('openai_error')) {
    return '上游返回 openai_error。请确认参考图能正常预览，建议使用 PNG/JPG/WebP 重新上传。';
  }
  if (/^http\s*5\d\d/i.test(text) || /\b5\d\d\b/.test(text)) return '上游服务暂时异常，请稍后重试。';
  if (/^http\s*4\d\d/i.test(text) || /\b4\d\d\b/.test(text)) return '请求没有被上游接受，请检查提示词、图片格式或接口配置。';
  return text.replace(/\s+/g, ' ').slice(0, 220);
}

function getErrorText(error) {
  return [
    error?.message,
    error?.name,
    error?.code,
    error?.cause?.message,
    error?.cause?.name,
    error?.cause?.code,
    error?.cause?.errno
  ].filter(Boolean).join(' ');
}

function isTransientXiXuError(error) {
  const lower = getErrorText(error).toLowerCase();
  return [
    'stream error', 'internal_error', 'terminated', 'socket hang up', 'other side closed',
    'body timeout', 'response body', 'fetch failed', 'connect timeout', 'connect_timeout',
    'und_err_connect_timeout', 'und_err_headers_timeout', 'headers timeout', 'und_err_socket',
    'econnreset', 'etimedout', 'timeout', 'timed out', 'abort', 'rate limit',
    'too many requests', 'all credentials', 'temporarily unavailable', '上游服务暂时异常',
    '服务暂时异常', ' 429', ' 500', ' 502', ' 503', ' 504'
  ].some((pattern) => lower.includes(pattern));
}

function withTimeout(promise, timeoutMs, message, onTimeout) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      try { if (onTimeout) onTimeout(); } catch {}
      reject(new Error(message));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function generateArkImageUrls(baseUrl, apiKey, requestBody, count, buildVariationPrompt = buildImageVariationPrompt) {
  const tasks = Array.from({ length: count }, async (_, index) => {
    const controller = new AbortController();
    const configuredTimeout = Number(process.env.ARK_IMAGE_TIMEOUT_MS || 180000);
    const timeoutMs = Number.isFinite(configuredTimeout) ? Math.min(600000, Math.max(30000, configuredTimeout)) : 180000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestBody, prompt: buildVariationPrompt(requestBody.prompt, index, count) })
      });
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!response.ok) {
        const upstreamError = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
        throw new Error(formatUpstreamError(upstreamError, `图片生成失败: ${response.status}`));
      }
      const url = data.data?.[0]?.url;
      if (!url) throw new Error('图片服务未返回图片地址');
      return url;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(`图片服务请求超时（超过${Math.round(timeoutMs / 1000)}秒）`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  });

  const results = await Promise.allSettled(tasks);
  const urls = results.filter((result) => result.status === 'fulfilled').map((result) => result.value).slice(0, count);
  if (urls.length === 0) {
    const firstError = results.find((result) => result.status === 'rejected')?.reason;
    if (firstError) throw firstError;
  }
  return urls;
}

module.exports = {
  buildXiImageHeaders,
  buildXiImageUrl,
  buildXiXuHeaders,
  buildXiXuUrl,
  formatUpstreamError,
  generateArkImageUrls,
  getErrorText,
  getXiImageApiKey,
  isOfficialOpenAIImageApi,
  isTransientXiXuError,
  parseXiXuImages,
  withTimeout
};
