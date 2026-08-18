require('dotenv').config();

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PNG } = require('pngjs');
const { POINTS, POINT_PACKAGES } = require('./config/points');
const {
  UPLOAD_DIR,
  downloadAndSaveImage,
  ensureImageThumbnail,
  getImageDimensionsFromBuffer,
  getLocalImageDimensions,
  getLocalUploadPath,
  getUploadedImageDimensions,
  saveDataUrlImage,
  saveUploadedSourceImages
} = require('./utils/image-storage');
const {
  buildAmazonMainImagePrompt,
  buildAmazonMainImageVariationPrompt,
  buildImageVariationPrompt,
  buildReferenceBoardPrompt,
  buildXiEditPrompt,
  buildXiGeneratePrompt,
  buildXhsImagePrompt,
  getSourceImageFilename,
  getSourceImageLabel,
  normalizeSourceImageFilename
} = require('./services/prompt-service');
const {
  buildBothCopyPrompt,
  buildCopyPrompt,
  buildRewritePrompt,
  cleanCopyText,
  requestDeepSeekText
} = require('./services/copy-service');
const {
  buildReversePromptInstruction,
  extractChatText,
  getReversePromptMode,
  normalizeReversePromptResult,
  parseJsonLike
} = require('./services/reverse-prompt-service');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

function formatBeijingDateTime(input = new Date(), options = {}) {
  const { date = true, seconds = false } = options;
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    ...(date ? { year: 'numeric', month: '2-digit', day: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hour12: false
  });
  return formatter.format(input).replace(/\//g, '-');
}

// CORS配置
const corsOptions = {
  origin: process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(',') : 'http://localhost:3001',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: http: https:",
      "connect-src 'self'",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  );
  next();
});

const PUBLIC_FILES = new Set([
  'index.html',
  'xhs.html',
  'admin.html',
  'login.html',
  'register.html',
  'profile.html',
  'help.html',
  'privacy.html',
  'terms.html',
  'content-policy.html',
  'image-studio.html',
  'xi-image.html',
  'favicon.svg',
  'favicon.ico',
  'style.css',
  'script.js',
  'shared-shell.js'
]);

const PUBLIC_STATIC_FILES = new Set([
  'style.css',
  'script.js',
  'shared-shell.js',
  'favicon.svg',
  'favicon.ico'
]);

const PUBLIC_HTML_CACHE_CONTROL = 'private, no-cache, must-revalidate';
const PUBLIC_STATIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function sendPublicFile(res, filename, next) {
  const filepath = path.join(__dirname, filename);
  res.setHeader(
    'Cache-Control',
    PUBLIC_STATIC_FILES.has(filename) ? PUBLIC_STATIC_CACHE_CONTROL : PUBLIC_HTML_CACHE_CONTROL
  );
  return res.sendFile(filepath, { cacheControl: false }, next);
}

app.get('/', (req, res) => {
  sendPublicFile(res, 'index.html');
});

app.get('/:filename', (req, res, next) => {
  const filename = path.basename(req.params.filename);
  if (filename !== req.params.filename || !PUBLIC_FILES.has(filename)) return next();
  sendPublicFile(res, filename, next);
});

// 速率限制（放宽阈值，避免正常操作被误限）
const imageLimiter = rateLimit({ windowMs: 60000, max: 60, message: { error: '请求过于频繁，请稍后再试' } });
const xiImageLimiter = rateLimit({
  windowMs: 60000,
  max: Number(process.env.XI_XU_IMAGE_RATE_LIMIT_PER_MIN || 30),
  message: { error: 'gpt-image-2 生图请求过于频繁，请降低并发或稍后再试' }
});
const copyLimiter = rateLimit({ windowMs: 60000, max: 60, message: { error: '请求过于频繁，请稍后再试' } });
const authLimiter = rateLimit({ windowMs: 60000, max: 20, message: { error: '请求过于频繁，请稍后再试' } });
const adminLimiter = rateLimit({ windowMs: 60000, max: 60, message: { error: '请求过于频繁，请稍后再试' } });
const TEN_MINUTES_MS = 10 * 60 * 1000;
const XI_XU_IMAGE_TIMEOUT_MS = Number(process.env.XI_XU_IMAGE_TIMEOUT_MS || TEN_MINUTES_MS);
const XI_XU_GENERATE_TIMEOUT_MS = Number(process.env.XI_XU_GENERATE_TIMEOUT_MS || TEN_MINUTES_MS);
const configuredXiGenerateRetries = Number(process.env.XI_XU_GENERATE_RETRIES || 1);
const XI_XU_GENERATE_RETRIES = Number.isFinite(configuredXiGenerateRetries)
  ? Math.max(0, Math.min(Math.floor(configuredXiGenerateRetries), 2))
  : 1;
const XI_XU_EDIT_TIMEOUT_MS = Number(process.env.XI_XU_EDIT_TIMEOUT_MS || TEN_MINUTES_MS);
const configuredXiEditRetries = Number(process.env.XI_XU_EDIT_RETRIES || 1);
const XI_XU_EDIT_RETRIES = Number.isFinite(configuredXiEditRetries)
  ? Math.max(0, Math.min(Math.floor(configuredXiEditRetries), 2))
  : 1;
const XI_XU_EDIT_CIRCUIT_BREAKER_MS = Number(process.env.XI_XU_EDIT_CIRCUIT_BREAKER_MS || 0);
const XI_XU_EDIT_FORCE_FALLBACK = /^true$/i.test(process.env.XI_XU_EDIT_FORCE_FALLBACK || '');
const XI_XU_FIXED_QUALITY = 'medium';
const ARK_FALLBACK_ENABLED = /^true$/i.test(process.env.ARK_FALLBACK_ENABLED || '');
const XI_XU_NORMALIZE_OUTPUT_SIZE = /^true$/i.test(process.env.XI_XU_NORMALIZE_OUTPUT_SIZE || '');
const configuredXiMaxActiveJobsRaw = String(process.env.XI_XU_MAX_ACTIVE_JOBS || '1').trim();
const configuredXiMaxActiveJobs = Number(configuredXiMaxActiveJobsRaw);
const XI_XU_MAX_ACTIVE_JOBS = /^(0|unlimited|infinite|none)$/i.test(configuredXiMaxActiveJobsRaw)
  ? Number.MAX_SAFE_INTEGER
  : (Number.isFinite(configuredXiMaxActiveJobs) ? Math.max(1, Math.floor(configuredXiMaxActiveJobs)) : 1);
const ARK_IMAGE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const xiXuEditCircuit = { failures: 0, openUntilMs: 0 };
const configuredUploadImageMb = Number(process.env.MAX_UPLOAD_IMAGE_MB || 20);
const MAX_UPLOAD_IMAGE_MB = Number.isFinite(configuredUploadImageMb)
  ? Math.max(configuredUploadImageMb, 1)
  : 20;

// 上传配置
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_IMAGE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (isAllowedUploadMime(file.mimetype)) cb(null, true);
    else cb(new Error('只允许图片文件'), false);
  }
});

const ALLOWED_UPLOAD_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

function normalizeMimeType(mimeType) {
  return String(mimeType || '').toLowerCase().split(';')[0].trim();
}

function isAllowedUploadMime(mimeType) {
  return ALLOWED_UPLOAD_MIME_TYPES.has(normalizeMimeType(mimeType));
}

function sniffImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  const gifHeader = buffer.subarray(0, 6).toString('ascii');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'image/gif';
  return null;
}

function validateUploadedImageFiles(req, res, next) {
  const files = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  if (req.files && !Array.isArray(req.files) && typeof req.files === 'object') {
    Object.values(req.files).forEach((value) => {
      if (Array.isArray(value)) files.push(...value);
    });
  }

  for (const file of files) {
    const declaredMime = normalizeMimeType(file.mimetype);
    const detectedMime = sniffImageMime(file.buffer);
    if (!detectedMime) {
      return res.status(400).json({ error: '上传文件不是有效图片' });
    }
    if (declaredMime === 'image/jpg') file.mimetype = 'image/jpeg';
    if (normalizeMimeType(file.mimetype) !== detectedMime) {
      return res.status(400).json({ error: '上传图片格式与文件内容不一致' });
    }
  }

  next();
}

function sanitizeInput(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLen).replace(/[<>]/g, '').trim();
}

function normalizeClientTaskId(value) {
  const taskId = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{1,100}$/.test(taskId) ? taskId : null;
}

function safeCompareSecret(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function getRequiredEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const DEEPSEEK_TEXT_MODEL = process.env.DEEPSEEK_TEXT_MODEL || 'deepseek-chat';

function buildXiXuUrl(pathname) {
  const baseUrl = (process.env.XI_XU_API_BASE_URL || 'https://api.xi-xu.me').replace(/\/+$/, '');
  if (baseUrl.endsWith('/v1') && pathname.startsWith('/v1/')) {
    return `${baseUrl}${pathname.slice(3)}`;
  }
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

function buildXiImageHeaders(headers = {}) {
  if (getRequiredEnv('OPENAI_IMAGE_API_KEY') || getRequiredEnv('OPENAI_IMAGE_API_BASE_URL')) return headers;
  return buildXiXuHeaders(headers);
}

function buildXiXuHeaders(headers = {}) {
  const proxyToken = String(process.env.XI_XU_PROXY_TOKEN || '').trim();
  return proxyToken
    ? { ...headers, 'X-XiXu-Proxy-Token': proxyToken }
    : headers;
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
    const b64 = item.b64_json || item.base64 || item.image_base64 || item.result;
    if (b64) urls.push(b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`);
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
  if (
    lower.includes('stream error') ||
    lower.includes('internal_error') ||
    lower.includes('internal error') ||
    lower.includes('terminated') ||
    lower.includes('socket hang up') ||
    lower.includes('other side closed') ||
    lower.includes('body timeout') ||
    lower.includes('response body')
  ) {
    return '图片服务连接中断，请稍后重试。本次没有生成图片，积分已退回。';
  }
  if (lower.includes('fetch failed') || lower.includes('connect timeout') || lower.includes('connect_timeout') || lower.includes('und_err_connect_timeout')) {
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
  if (/^http\s*5\d\d/i.test(text) || /\b5\d\d\b/.test(text)) {
    return '上游服务暂时异常，请稍后重试。';
  }
  if (/^http\s*4\d\d/i.test(text) || /\b4\d\d\b/.test(text)) {
    return '请求没有被上游接受，请检查提示词、图片格式或接口配置。';
  }
  return text.replace(/\s+/g, ' ').slice(0, 220);
}

function getErrorText(err) {
  return [
    err?.message,
    err?.name,
    err?.code,
    err?.cause?.message,
    err?.cause?.name,
    err?.cause?.code,
    err?.cause?.errno
  ].filter(Boolean).join(' ');
}

function isTransientXiXuError(err) {
  const lower = getErrorText(err).toLowerCase();
  return [
    'stream error',
    'internal_error',
    'terminated',
    'socket hang up',
    'other side closed',
    'body timeout',
    'response body',
    'fetch failed',
    'connect timeout',
    'connect_timeout',
    'und_err_connect_timeout',
    'und_err_headers_timeout',
    'headers timeout',
    'und_err_socket',
    'econnreset',
    'etimedout',
    'timeout',
    'timed out',
    'abort',
    'rate limit',
    'too many requests',
    'all credentials',
    'temporarily unavailable',
    '上游服务暂时异常',
    '服务暂时异常',
    ' 429',
    ' 500',
    ' 502',
    ' 503',
    ' 504'
  ].some((pattern) => lower.includes(pattern));
}

function logXiXuGenerateError(err, details = {}) {
  const cause = err?.cause || {};
  console.error('gpt-image-2 生图请求失败:', JSON.stringify({
    message: err?.message || String(err),
    name: err?.name || '',
    code: err?.code || '',
    causeMessage: cause.message || '',
    causeName: cause.name || '',
    causeCode: cause.code || '',
    causeErrno: cause.errno || '',
    causeSyscall: cause.syscall || '',
    causeHostname: cause.hostname || '',
    transient: isTransientXiXuError(err),
    ...details
  }));
}

function parseImageCount(value) {
  const count = parseInt(value, 10);
  if (!Number.isFinite(count)) return 1;
  return Math.min(Math.max(count, 1), 4);
}

function parseXiXuImageCount(value) {
  const count = parseInt(value, 10);
  if (!Number.isFinite(count)) return 1;
  return Math.min(Math.max(count, 1), 4);
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

function handleRequestError(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: `图片文件太大，请上传 ${MAX_UPLOAD_IMAGE_MB}MB 以内的图片` });
  }
  if (err.message === '只允许图片文件') return res.status(400).json({ error: err.message });
  if (err.message === 'Unexpected field') return res.status(400).json({ error: '上传字段不正确' });
  console.error('服务器错误:', err.message);
  res.status(500).json({ error: '服务器内部错误' });
}

// 数据库和认证
const db = require('./db');
const { authMiddleware, optionalAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const { chargePoints, refundPoints } = require('./services/point-service');

// API路由
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);

// 尺寸配置
const SIZE_MAP = {
  '1:1': { width: 1920, height: 1920 },
  '3:4': { width: 1920, height: 2560 },
  '4:3': { width: 2560, height: 1920 },
};

app.get('/uploads/:filename', authMiddleware, (req, res, next) => {
  const filename = path.basename(req.params.filename || '');
  if (!filename || filename !== req.params.filename) {
    return res.status(400).json({ error: '图片路径无效' });
  }

  if (req.user?.role !== 'admin' && !canUserAccessUpload(req.userId, filename)) {
    return res.status(403).json({ error: '无权访问这张图片' });
  }

  const filepath = path.join(UPLOAD_DIR, filename);
  if (!filepath.startsWith(UPLOAD_DIR + path.sep)) {
    return res.status(400).json({ error: '图片路径无效' });
  }
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: '图片不存在' });
  }

  // 图片文件名包含时间戳和随机串，内容不会原地覆盖；允许同一浏览器缓存一天，减少重复读盘。
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  const variant = String(req.query.variant || '').toLowerCase();
  const responseFilepath = variant === 'thumb'
    ? (ensureImageThumbnail(filepath) || filepath)
    : filepath;
  return res.sendFile(responseFilepath, { cacheControl: false }, next);
});

function resizePngContainOnWhite(source, targetWidth, targetHeight) {
  const target = new PNG({ width: targetWidth, height: targetHeight });
  target.data.fill(255);

  const scale = Math.min(targetWidth / source.width, targetHeight / source.height);
  const scaledWidth = Math.max(1, Math.round(source.width * scale));
  const scaledHeight = Math.max(1, Math.round(source.height * scale));
  const offsetX = Math.floor((targetWidth - scaledWidth) / 2);
  const offsetY = Math.floor((targetHeight - scaledHeight) / 2);

  for (let y = 0; y < scaledHeight; y += 1) {
    const srcY = (y + 0.5) / scale - 0.5;
    const y0 = Math.max(0, Math.floor(srcY));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const wy = srcY - y0;

    for (let x = 0; x < scaledWidth; x += 1) {
      const srcX = (x + 0.5) / scale - 0.5;
      const x0 = Math.max(0, Math.floor(srcX));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const wx = srcX - x0;
      const targetIndex = ((offsetY + y) * targetWidth + offsetX + x) * 4;
      const color = [0, 0, 0, 0];

      for (const [sampleX, sampleY, weight] of [
        [x0, y0, (1 - wx) * (1 - wy)],
        [x1, y0, wx * (1 - wy)],
        [x0, y1, (1 - wx) * wy],
        [x1, y1, wx * wy]
      ]) {
        const sourceIndex = (sampleY * source.width + sampleX) * 4;
        color[0] += source.data[sourceIndex] * weight;
        color[1] += source.data[sourceIndex + 1] * weight;
        color[2] += source.data[sourceIndex + 2] * weight;
        color[3] += source.data[sourceIndex + 3] * weight;
      }

      const alpha = Math.max(0, Math.min(255, Math.round(color[3]))) / 255;
      target.data[targetIndex] = Math.round(color[0] * alpha + 255 * (1 - alpha));
      target.data[targetIndex + 1] = Math.round(color[1] * alpha + 255 * (1 - alpha));
      target.data[targetIndex + 2] = Math.round(color[2] * alpha + 255 * (1 - alpha));
      target.data[targetIndex + 3] = 255;
    }
  }

  return target;
}

function normalizeSavedImageDimensions(localUrls, expectedSize) {
  if (!isExplicitXiImageSizeSupported(expectedSize)) return;
  const [expectedWidth, expectedHeight] = expectedSize.split('x').map(Number);
  for (const url of localUrls) {
    const filepath = getLocalUploadPath(url);
    if (!filepath || !fs.existsSync(filepath)) continue;
    let png;
    try {
      png = PNG.sync.read(fs.readFileSync(filepath));
    } catch {
      continue;
    }
    if (png.width === expectedWidth && png.height === expectedHeight) continue;
    const normalized = resizePngContainOnWhite(png, expectedWidth, expectedHeight);
    fs.writeFileSync(filepath, PNG.sync.write(normalized, { colorType: 6 }));
    console.warn('上游返回图片尺寸不匹配，已自动规整到请求尺寸:', JSON.stringify({
      url,
      expectedSize,
      upstreamSize: `${png.width}x${png.height}`
    }));
  }
}

function assertSavedImageDimensions(localUrls, expectedSize) {
  if (!isExplicitXiImageSizeSupported(expectedSize)) return;
  const [expectedWidth, expectedHeight] = expectedSize.split('x').map(Number);
  for (const url of localUrls) {
    const filepath = getLocalUploadPath(url);
    if (!filepath || !fs.existsSync(filepath)) continue;
    const dimensions = getImageDimensionsFromBuffer(fs.readFileSync(filepath));
    if (!dimensions) continue;
    if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
      console.warn('上游返回图片尺寸不匹配，已保留原图继续返回:', JSON.stringify({
        url,
        expectedSize,
        actualSize: dimensions.size
      }));
    }
  }
}

async function saveXiXuImages(imageUrls, prefix, expectedSize = '') {
  const saved = await Promise.all(imageUrls.map(async (url, index) => {
    if (String(url).startsWith('data:image/')) {
      return saveDataUrlImage(url, `${prefix}_${index + 1}`) || url;
    }
    return downloadAndSaveImage(url, `${prefix}_${index + 1}`);
  }));
  if (XI_XU_NORMALIZE_OUTPUT_SIZE) normalizeSavedImageDimensions(saved, expectedSize);
  assertSavedImageDimensions(saved, expectedSize);
  return saved;
}

async function generateArkImageUrls(baseUrl, apiKey, requestBody, count, buildVariationPrompt = buildImageVariationPrompt) {
  const tasks = Array.from({ length: count }, async (_, index) => {
    const body = {
      ...requestBody,
      prompt: buildVariationPrompt(requestBody.prompt, index, count)
    };

    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
  });

  const results = await Promise.allSettled(tasks);
  const urls = results
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value)
    .slice(0, count);
  if (urls.length === 0) {
    const firstError = results.find(result => result.status === 'rejected')?.reason;
    if (firstError) throw firstError;
  }
  return urls;
}

const GPT_IMAGE_2_QUALITY_BASE = { low: 16, medium: 48, high: 96 };

function normalizeXiQuality(value) {
  const quality = String(value || '').trim().toLowerCase();
  return ['low', 'medium', 'high'].includes(quality) ? quality : '';
}

function getGPTImage2OutputTokens(quality, size) {
  const base = GPT_IMAGE_2_QUALITY_BASE[normalizeXiQuality(quality)];
  const dimensions = parseXiImageSizeDimensions(size);
  if (!base || !dimensions) return 0;
  const { width, height } = dimensions;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const scaledShort = Math.round(base * short / long);
  const grid = base * scaledShort;
  return Math.ceil(grid * (2000000 + width * height) / 4000000);
}

function extractXiXuImageMetadata(data = {}, requested = {}) {
  const first = Array.isArray(data.data) ? data.data.find((item) => item && typeof item === 'object') : null;
  const requestedQuality = normalizeXiQuality(data.requested_quality || first?.requested_quality || requested.quality) || normalizeXiQuality(requested.quality);
  const actualQuality = normalizeXiQuality(data.quality || first?.quality) || requestedQuality;
  const requestedSize = normalizeXiImageSizeText(data.requested_size || first?.requested_size || requested.size);
  const actualSize = normalizeXiImageSizeText(data.size || first?.size) || requestedSize;
  const billingOutputTokens = getGPTImage2OutputTokens(actualQuality, actualSize);
  const usageOutputTokens = Number(data.usage?.output_tokens);
  return {
    requested_quality: requestedQuality,
    actual_quality: actualQuality,
    requested_size: requestedSize,
    actual_size: actualSize,
    billing_output_tokens: billingOutputTokens || 0,
    usage_output_tokens: Number.isFinite(usageOutputTokens) ? usageOutputTokens : 0,
    billing_mode: data.billing_mode || first?.billing_mode || '',
    billing_note: data.billing_note || first?.billing_note || '',
    image_parameter_mode: data.image_parameter_mode || first?.image_parameter_mode || '',
    image_parameter_note: data.image_parameter_note || first?.image_parameter_note || '',
    size_source: data.size_source || first?.size_source || '',
    size_parameter_affects_output_guarantee: data.size_parameter_affects_output_guarantee,
    quality_parameter_affects_output_guarantee: data.quality_parameter_affects_output_guarantee
  };
}

// 图片生成
app.post('/generate', imageLimiter, authMiddleware, upload.single('referenceImage'), validateUploadedImageFiles, async (req, res) => {
  const prompt = sanitizeInput(req.body.prompt, 2000);
  const ratio = req.body.ratio || '1:1';
  const imageCount = parseImageCount(req.body.imageCount);
  const clientTaskId = normalizeClientTaskId(req.body.clientTaskId);
  if (!prompt) return res.status(400).json({ error: '请输入图片描述' });
  if (!SIZE_MAP[ratio]) return res.status(400).json({ error: '无效的图片比例' });

  const totalCost = POINTS.image * imageCount;
  let charged = false;
  try {
    chargePoints(req.userId, totalCost, `图片生成 x${imageCount}`);
    charged = true;
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || '积分扣减失败' });
  }

  const size = SIZE_MAP[ratio];
  const API_KEY = getRequiredEnv('ARK_API_KEY');
  if (!API_KEY) {
    refundPoints(req.userId, totalCost, '图片生成失败退款');
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
      refundPoints(req.userId, totalCost, '图片生成失败退款');
      return res.status(500).json({ error: '图片生成失败' });
    }

    // 下载到本地
    const localUrls = await Promise.all(remoteUrls.map((url, index) => (
      downloadAndSaveImage(url, `xhs_${ratio.replace(':', '')}_${index + 1}`)
    )));
    const missingCount = Math.max(imageCount - localUrls.length, 0);
    if (missingCount > 0) {
      refundPoints(req.userId, POINTS.image * missingCount, `图片生成少出${missingCount}张退款`);
    }
    const createdAt = new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-');
    localUrls.forEach((localUrl) => {
      db.addHistory(req.userId, 'image', { sub_type: 'generate', image_url: localUrl, prompt: prompt, ratio: ratio, cost_points: POINTS.image, client_task_id: clientTaskId });
    });

    res.json({ imageUrl: localUrls[0], imageUrls: localUrls, remainingPoints: db.getUserPoints(req.userId), createdAt });
  } catch (err) {
    if (charged) refundPoints(req.userId, totalCost, '图片生成失败退款');
    console.error('小红书图片生成失败:', err.message || err);
    res.status(502).json({ error: formatUpstreamError(err.message || err, '图片生成失败，请稍后再试') });
  }
});

// 文案生成（DeepSeek API）
app.post('/generate-copy', copyLimiter, authMiddleware, async (req, res) => {
  const topic = sanitizeInput(req.body.topic, 500);
  const type = req.body.type;
  const clientTaskId = normalizeClientTaskId(req.body.clientTaskId);
  if (!topic) return res.status(400).json({ error: '请输入主题' });

  const pointsResult = db.deductPoints(req.userId, POINTS.copy, '文案生成');
  if (!pointsResult.success) return res.status(400).json({ error: '积分不足，请充值' });

  const fullPrompt = buildCopyPrompt(topic, type);
  if (!fullPrompt) {
    db.rechargePoints(req.userId, POINTS.copy, '文案生成失败退款');
    return res.status(400).json({ error: '无效的文案类型' });
  }

  const DEEPSEEK_API_KEY = getRequiredEnv('DEEPSEEK_API_KEY');
  if (!DEEPSEEK_API_KEY) {
    db.rechargePoints(req.userId, POINTS.copy, '文案生成失败退款');
    return res.status(500).json({ error: '文案服务未配置' });
  }
  try {
    const text = await requestDeepSeekText({
      apiKey: DEEPSEEK_API_KEY,
      model: DEEPSEEK_TEXT_MODEL,
      systemPrompt: fullPrompt,
      userPrompt: `主题：${topic}`
    });
    
    if (!text) {
      db.rechargePoints(req.userId, POINTS.copy, '文案生成失败退款');
      return res.status(500).json({ error: '文案生成失败' });
    }

    const cleanText = cleanCopyText(text);
    const titleMatch = cleanText.match(/^(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim().substring(0, 30) : (topic.length > 20 ? topic.substring(0, 20) + '...' : topic);
    const createdAt = new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-');
    
    db.addHistory(req.userId, 'copy', { sub_type: 'generate', content: cleanText, prompt: topic, cost_points: POINTS.copy, client_task_id: clientTaskId });
    res.json({ copy: cleanText, title, remainingPoints: pointsResult.balance, createdAt });
  } catch (err) {
    db.rechargePoints(req.userId, POINTS.copy, '文案生成失败退款');
    res.status(500).json({ error: '请求失败' });
  }
});

// 文案改写（DeepSeek API）
app.post('/rewrite', copyLimiter, authMiddleware, async (req, res) => {
  const originalText = sanitizeInput(req.body.originalText, 5000);
  const style = req.body.style;
  const clientTaskId = normalizeClientTaskId(req.body.clientTaskId);
  if (!originalText) return res.status(400).json({ error: '请输入要改写的文案' });

  const pointsResult = db.deductPoints(req.userId, POINTS.rewrite, '文案改写');
  if (!pointsResult.success) return res.status(400).json({ error: '积分不足，请充值' });

  const rewritePrompt = buildRewritePrompt(originalText, style);

  const DEEPSEEK_API_KEY = getRequiredEnv('DEEPSEEK_API_KEY');
  if (!DEEPSEEK_API_KEY) {
    db.rechargePoints(req.userId, POINTS.rewrite, '文案改写失败退款');
    return res.status(500).json({ error: '文案服务未配置' });
  }
  try {
    const text = await requestDeepSeekText({
      apiKey: DEEPSEEK_API_KEY,
      model: DEEPSEEK_TEXT_MODEL,
      systemPrompt: rewritePrompt.systemPrompt,
      userPrompt: rewritePrompt.userPrompt
    });
    
    if (!text) {
      db.rechargePoints(req.userId, POINTS.rewrite, '文案改写失败退款');
      return res.status(500).json({ error: '文案改写失败' });
    }

    const cleanText = cleanCopyText(text);
    const titleMatch = cleanText.match(/^(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim().substring(0, 30) : '改写文案';
    const createdAt = new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-');
    
    db.addHistory(req.userId, 'copy', { sub_type: 'rewrite', content: cleanText, prompt: title, cost_points: POINTS.rewrite, client_task_id: clientTaskId });
    res.json({ copy: cleanText, title, remainingPoints: pointsResult.balance, createdAt });
  } catch (err) {
    db.rechargePoints(req.userId, POINTS.rewrite, '文案改写失败退款');
    res.status(500).json({ error: '请求失败' });
  }
});

// =============================================
// 图文一体生成
// =============================================
app.post('/generate-both', imageLimiter, authMiddleware, async (req, res) => {
  const prompt = sanitizeInput(req.body.prompt, 2000);
  const ratio = req.body.ratio || '1:1';
  const imageCount = parseImageCount(req.body.imageCount);
  const clientTaskId = normalizeClientTaskId(req.body.clientTaskId);
  if (!prompt) return res.status(400).json({ error: '请输入描述' });
  if (!SIZE_MAP[ratio]) return res.status(400).json({ error: '无效的图片比例' });

  const totalCost = POINTS.copy + (POINTS.image * imageCount);
  const pointsResult = db.deductPoints(req.userId, totalCost, `图文一体生成 x${imageCount}`);
  if (!pointsResult.success) return res.status(400).json({ error: '积分不足，请充值' });

  const size = SIZE_MAP[ratio];
  const API_KEY = getRequiredEnv('ARK_API_KEY');
  if (!API_KEY) {
    db.rechargePoints(req.userId, totalCost, '图文一体生成失败退款');
    return res.status(500).json({ error: '图片服务未配置' });
  }
  const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
  const DEEPSEEK_API_KEY = getRequiredEnv('DEEPSEEK_API_KEY');
  if (!DEEPSEEK_API_KEY) {
    db.rechargePoints(req.userId, totalCost, '图文一体生成失败退款');
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
        const urls = await generateArkImageUrls(ARK_BASE_URL, API_KEY, body, imageCount);
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
      db.rechargePoints(req.userId, totalCost, '图文一体生成失败退款');
      return res.status(500).json({ error: '图片和文案生成均失败' });
    }

    const imageUrls = imageResult.status === 'fulfilled' ? imageResult.value : [];
    const imageUrl = imageUrls[0] || null;
    const rawCopy = copyResult.status === 'fulfilled' ? copyResult.value : null;
    const copyText = rawCopy ? cleanCopyText(rawCopy) : null;

    // 如果图片失败退图片部分的积分
    const missingImageCount = Math.max(imageCount - imageUrls.length, 0);
    if (missingImageCount > 0) db.rechargePoints(req.userId, POINTS.image * missingImageCount, `图文一体-图片少出${missingImageCount}张退款`);
    // 如果文案失败退文案部分的积分
    if (!copyText) db.rechargePoints(req.userId, POINTS.copy, '图文一体-文案失败退款');

    const createdAt = new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-');
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
    const remainingPoints = pointsResult.balance + refundedPoints;

    res.json({
      imageUrl,
      imageUrls,
      copy: copyText,
      remainingPoints,
      createdAt
    });
  } catch (err) {
    db.rechargePoints(req.userId, totalCost, '图文一体生成失败退款');
    res.status(500).json({ error: '请求失败' });
  }
});

// 模板管理
const templates = {};

// 保存模板
app.post('/api/templates', authMiddleware, (req, res) => {
  const { name, type, content } = req.body;
  if (!name || !type || !content) return res.status(400).json({ error: '参数不完整' });
  if (name.length > 50) return res.status(400).json({ error: '模板名称太长' });
  
  if (!templates[req.userId]) templates[req.userId] = [];
  const existing = templates[req.userId].findIndex(t => t.name === name && t.type === type);
  if (existing >= 0) {
    templates[req.userId][existing].content = content;
    templates[req.userId][existing].updatedAt = Date.now();
  } else {
    templates[req.userId].push({ id: Date.now().toString(36), name, type, content, createdAt: Date.now() });
  }
  res.json({ success: true, templates: templates[req.userId] });
});

// 获取模板列表
app.get('/api/templates', authMiddleware, (req, res) => {
  const type = req.query.type;
  let list = templates[req.userId] || [];
  if (type) list = list.filter(t => t.type === type);
  res.json({ templates: list });
});

// 删除模板
app.delete('/api/templates/:id', authMiddleware, (req, res) => {
  if (!templates[req.userId]) return res.json({ success: true });
  templates[req.userId] = templates[req.userId].filter(t => t.id !== req.params.id);
  res.json({ success: true });
});

// 简化版用户信息接口
app.get('/api/user/info', optionalAuth, (req, res) => {
  if (req.user) res.json({ loggedIn: true, user: req.user });
  else res.json({ loggedIn: false });
});

// =============================================
// 支付功能
// =============================================

// 获取积分商品列表
app.get('/api/packages', (req, res) => {
  res.json({ packages: POINT_PACKAGES, paymentAvailable: false });
});

app.get('/api/public/stats', (req, res) => {
  const totalUsers = db.db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const totalRecords = db.db.prepare('SELECT COUNT(*) AS count FROM history').get().count;
  const totalCopies = db.db.prepare("SELECT COUNT(*) AS count FROM history WHERE type IN ('copy', 'both') AND content IS NOT NULL AND TRIM(content) <> ''").get().count;
  res.json({ totalUsers, totalRecords, totalCopies });
});

const xiJobs = new Map();

function localUploadMatchesFilename(url, filename) {
  return String(url || '') === `/uploads/${filename}`;
}

function canUserAccessUpload(userId, filename) {
  if (db.userOwnsUpload(userId, filename)) return true;
  for (const job of xiJobs.values()) {
    if (job.userId !== userId) continue;
    const outputUrls = Array.isArray(job.imageUrls) ? job.imageUrls : [];
    const sourceUrls = Array.isArray(job.sourcePreviewUrls) ? job.sourcePreviewUrls : [];
    if ([...outputUrls, ...sourceUrls].some((url) => localUploadMatchesFilename(url, filename))) {
      return true;
    }
  }
  return false;
}
const xiJobQueue = [];
let xiActiveJobs = 0;

function getXiJobHistorySubType(job) {
  return job.mode === 'edit' ? 'xi-edit' : 'xi-generate';
}

function buildXiJobHistoryContent(job, status, extra = {}) {
  const durationMs = job.finishedAtMs && job.startedAtMs ? job.finishedAtMs - job.startedAtMs : 0;
  return JSON.stringify({
    status,
    model: process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2',
    provider: job.provider || '',
    fallback_reason: job.fallbackReason || '',
    quality: job.quality,
    requested_quality: job.upstreamMeta?.requested_quality || job.quality,
    actual_quality: job.upstreamMeta?.actual_quality || '',
    requested_size: job.upstreamMeta?.requested_size || job.size,
    actual_size: job.upstreamMeta?.actual_size || '',
    billing_output_tokens: job.upstreamMeta?.billing_output_tokens || 0,
    usage_output_tokens: job.upstreamMeta?.usage_output_tokens || 0,
    billing_mode: job.upstreamMeta?.billing_mode || '',
    billing_note: job.upstreamMeta?.billing_note || '',
    image_parameter_mode: job.upstreamMeta?.image_parameter_mode || '',
    image_parameter_note: job.upstreamMeta?.image_parameter_note || '',
    size_source: job.upstreamMeta?.size_source || '',
    size_parameter_affects_output_guarantee: job.upstreamMeta?.size_parameter_affects_output_guarantee,
    quality_parameter_affects_output_guarantee: job.upstreamMeta?.quality_parameter_affects_output_guarantee,
    count: job.count,
    sources: job.sourceFileNames || [],
    source_urls: job.sourcePreviewUrls || [],
    source_dimensions: job.sourceDimensions || [],
    output_dimensions: job.outputDimensions || [],
    duration_ms: durationMs,
    error: job.error || '',
    refunded_points: job.refundedPoints || 0,
    ...extra
  });
}

function createXiJobHistory(job) {
  try {
    job.historyId = db.addHistory(job.userId, 'image', {
      sub_type: getXiJobHistorySubType(job),
      image_url: null,
      content: buildXiJobHistoryContent(job, 'queued'),
      prompt: job.prompt,
      ratio: job.size,
      cost_points: job.costPoints || 0
    });
  } catch (historyErr) {
    console.error('创建 gpt-image-2 任务历史失败:', historyErr);
  }
}

function updateXiJobHistory(job, status, imageUrls, costPoints, extra = {}) {
  if (!job.historyId) return false;
  try {
    db.db.prepare(`
      UPDATE history
      SET content = ?, image_url = ?, cost_points = ?
      WHERE id = ? AND user_id = ?
    `).run(
      buildXiJobHistoryContent(job, status, extra),
      imageUrls && imageUrls.length ? JSON.stringify(imageUrls) : null,
      costPoints,
      job.historyId,
      job.userId
    );
    return true;
  } catch (historyErr) {
    console.error('更新 gpt-image-2 任务历史失败:', historyErr);
    return false;
  }
}

function createXiJob(userId, payload) {
  const id = `xijob_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const now = Date.now();
  const job = {
    id,
    userId,
    status: 'queued',
    createdAtMs: now,
    startedAtMs: 0,
    finishedAtMs: 0,
    imageUrls: [],
    error: '',
    historyId: null,
    ...payload
  };
  createXiJobHistory(job);
  xiJobs.set(id, job);
  enqueueXiJob(job);
  return job;
}

function enqueueXiJob(job) {
  xiJobQueue.push(job);
  scheduleXiJobs();
}

function scheduleXiJobs() {
  while (xiActiveJobs < XI_XU_MAX_ACTIVE_JOBS && xiJobQueue.length > 0) {
    const job = xiJobQueue.shift();
    if (!job || !xiJobs.has(job.id) || job.status !== 'queued') continue;
    xiActiveJobs += 1;
    runXiJob(job)
      .catch((err) => {
        console.error('gpt-image-2 任务运行异常:', err);
      })
      .finally(() => {
        xiActiveJobs = Math.max(0, xiActiveJobs - 1);
        scheduleXiJobs();
      });
  }
}

function serializeXiJob(job) {
  const durationMs = job.startedAtMs
    ? ((job.finishedAtMs || (job.status === 'running' ? Date.now() : 0)) - job.startedAtMs)
    : 0;
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    prompt: job.prompt,
    size: job.size,
    count: job.count,
    quality: job.quality,
    upstreamMeta: job.upstreamMeta || {},
    sourceFileNames: job.sourceFileNames || [],
    sourcePreviewUrls: job.sourcePreviewUrls || [],
    sourceDimensions: job.sourceDimensions || [],
    outputDimensions: job.outputDimensions || [],
    createdAtMs: job.createdAtMs,
    createdAt: formatBeijingDateTime(new Date(job.createdAtMs), { date: false }),
    startedAtMs: job.startedAtMs,
    finishedAtMs: job.finishedAtMs,
    durationMs: Math.max(durationMs, 0),
    imageUrls: job.imageUrls || [],
    imageUrl: job.imageUrls?.[0] || '',
    error: job.error || '',
    historyId: job.historyId,
    costPoints: job.costPoints || 0,
    refundedPoints: job.refundedPoints || 0,
    provider: job.provider || '',
    fallbackReason: job.fallbackReason || '',
    remainingPoints: db.getUserPoints(job.userId),
    model: process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2'
  };
}

function saveXiJobFailureHistory(job) {
  const durationMs = job.finishedAtMs && job.startedAtMs ? job.finishedAtMs - job.startedAtMs : 0;
  if (updateXiJobHistory(job, 'failed', [], 0, {
    duration_ms: durationMs,
    error: job.error || '任务失败',
    refunded_points: job.refundedPoints || 0
  })) {
    return job.historyId;
  }
  try {
    job.historyId = db.addHistory(job.userId, 'image', {
      sub_type: getXiJobHistorySubType(job),
      image_url: null,
      content: JSON.stringify({
        status: 'failed',
        model: process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2',
        provider: job.provider || '',
        fallback_reason: job.fallbackReason || '',
        quality: job.quality,
        count: job.count,
        sources: job.sourceFileNames || [],
        source_urls: job.sourcePreviewUrls || [],
        source_dimensions: job.sourceDimensions || [],
        output_dimensions: job.outputDimensions || [],
        duration_ms: durationMs,
        error: job.error || '任务失败',
        refunded_points: job.refundedPoints || 0
      }),
      prompt: job.prompt,
      ratio: job.size,
      cost_points: 0
    });
  } catch (historyErr) {
    console.error('保存 gpt-image-2 失败历史失败:', historyErr);
  }
  return job.historyId;
}

function buildXiRecoveredSourceFiles(meta, mode) {
  if (mode !== 'edit') return [];
  const sourceUrls = Array.isArray(meta.source_urls) ? meta.source_urls : [];
  if (sourceUrls.length === 0) throw new Error('任务参考图记录不存在');
  const sourceNames = Array.isArray(meta.sources) ? meta.sources : [];
  return sourceUrls.map((url, index) => {
    const filepath = getLocalUploadPath(url);
    if (!filepath || !fs.existsSync(filepath)) throw new Error(`参考图${index + 1}文件不存在`);
    const buffer = fs.readFileSync(filepath);
    const mimetype = sniffImageMime(buffer);
    if (!mimetype) throw new Error(`参考图${index + 1}文件已损坏`);
    return {
      buffer,
      mimetype,
      originalname: sourceNames[index] || getSourceImageFilename(index)
    };
  });
}

function markXiHistoryRecoveryFailed(row, meta, reason) {
  meta.status = 'failed';
  meta.error = `服务重启后任务恢复失败，积分未退回：${reason}`;
  db.db.prepare('UPDATE history SET content = ?, image_url = ? WHERE id = ?')
    .run(JSON.stringify(meta), null, row.id);
}

function recoverStaleXiJobHistories() {
  let recovered = 0;
  let blocked = 0;
  try {
    const rows = db.db.prepare(`
      SELECT id, user_id, sub_type, content, prompt, ratio, cost_points, created_at
      FROM history
      WHERE type = 'image'
        AND sub_type IN ('xi-edit', 'xi-generate')
        AND (image_url IS NULL OR image_url = '')
      ORDER BY id DESC
      LIMIT 500
    `).all();
    for (const row of rows) {
      let meta = {};
      try { meta = JSON.parse(row.content || '{}'); } catch {}
      if (!['queued', 'running'].includes(meta.status)) continue;
      try {
        const mode = row.sub_type === 'xi-edit' ? 'edit' : 'generate';
        const prompt = String(row.prompt || '').trim();
        const size = parseXiImageSize(row.ratio || meta.requested_size || meta.actual_size);
        const count = parseXiXuImageCount(meta.count);
        const quality = XI_XU_FIXED_QUALITY;
        if (!prompt) throw new Error('任务提示词为空');
        assertXiImageSizeSupported(size);
        const sourceFiles = buildXiRecoveredSourceFiles(meta, mode);
        const job = {
          id: `xijob_recovered_${row.id}_${crypto.randomBytes(4).toString('hex')}`,
          userId: row.user_id,
          status: 'queued',
          createdAtMs: Date.parse(row.created_at) || Date.now(),
          startedAtMs: 0,
          finishedAtMs: 0,
          imageUrls: [],
          error: '',
          historyId: row.id,
          mode,
          prompt,
          size,
          count,
          quality,
          costPoints: Math.max(Number(row.cost_points) || 0, 0),
          sourceFiles,
          sourceFileNames: Array.isArray(meta.sources) ? meta.sources : [],
          sourcePreviewUrls: Array.isArray(meta.source_urls) ? meta.source_urls : [],
          sourceDimensions: Array.isArray(meta.source_dimensions) ? meta.source_dimensions : [],
          outputDimensions: [],
          upstreamMeta: {},
          provider: '',
          fallbackReason: '',
          refundedPoints: 0,
          refundedOnFail: false
        };
        meta.status = 'queued';
        meta.error = '';
        db.db.prepare('UPDATE history SET content = ?, image_url = NULL WHERE id = ?')
          .run(JSON.stringify(meta), row.id);
        xiJobs.set(job.id, job);
        enqueueXiJob(job);
        recovered += 1;
      } catch (err) {
        markXiHistoryRecoveryFailed(row, meta, err.message || '任务参数无效');
        blocked += 1;
      }
    }
    if (recovered > 0 || blocked > 0) {
      console.log(`已处理重启遗留的 gpt-image-2 任务：恢复 ${recovered} 条，无法恢复 ${blocked} 条（积分未退）`);
    }
  } catch (err) {
    console.error('处理重启遗留 gpt-image-2 任务失败:', err);
  }
}

async function callXiXuGenerateOnce({ prompt, size, count, quality }, attempt) {
  const apiKey = getXiImageApiKey();
  if (!apiKey) throw new Error('gpt-image-2 图片服务未配置');

  const controller = new AbortController();
  const timeoutMs = Math.max(XI_XU_GENERATE_TIMEOUT_MS, 30000);
  const startedAt = Date.now();
  try {
    const response = await withTimeout(fetch(buildXiImageUrl('/v1/images/generations'), {
      method: 'POST',
      signal: controller.signal,
      headers: buildXiImageHeaders({
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({
        model: process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2',
        prompt: buildXiGeneratePrompt(prompt, size),
        size,
        n: count,
        quality,
        output_format: 'png'
      })
    }), timeoutMs, `gpt-image-2 生图请求超时（超过${Math.round(timeoutMs / 1000)}秒）`, () => controller.abort());
    const text = await withTimeout(
      response.text(),
      timeoutMs,
      `gpt-image-2 生图结果下载超时（超过${Math.round(timeoutMs / 1000)}秒）`,
      () => controller.abort()
    );
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) {
      const upstreamError = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
      throw new Error(formatUpstreamError(upstreamError, '生图服务暂时不可用，请稍后再试'));
    }
    const imageUrls = parseXiXuImages(data);
    if (imageUrls.length === 0) throw new Error('上游未返回图片');
    const localUrls = await saveXiXuImages(imageUrls, `xixu_gen_${size.replace('x', '_')}`, size);
    return {
      localUrls,
      upstreamMeta: extractXiXuImageMetadata(data, { size, quality })
    };
  } catch (err) {
    const normalizedErr = err.name === 'AbortError'
      ? new Error(`gpt-image-2 生图请求超时（超过${Math.round(timeoutMs / 1000)}秒）`)
      : err;
    logXiXuGenerateError(normalizedErr, {
      attempt,
      size,
      count,
      quality,
      durationMs: Date.now() - startedAt
    });
    if (err.name === 'AbortError') throw normalizedErr;
    throw err;
  } finally {
    controller.abort();
  }
}

async function callXiXuGenerate(job) {
  let lastErr;
  const maxAttempts = XI_XU_GENERATE_RETRIES + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await callXiXuGenerateOnce(job, attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isTransientXiXuError(err)) break;
      const waitMs = Math.min(1000 * attempt, 3000);
      console.warn('gpt-image-2 生图瞬时故障，准备重试:', JSON.stringify({
        attempt,
        nextAttempt: attempt + 1,
        waitMs,
        message: err.message || String(err)
      }));
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastErr;
}

function xiSizeToArkSize(size) {
  const map = {
    '1024x1024': { width: 1920, height: 1920 },
    '1024x1536': { width: 1920, height: 2560 },
    '1536x1024': { width: 2560, height: 1920 },
    '2560x1440': { width: 2560, height: 1440 },
    '2048x2048': { width: 2048, height: 2048 },
    '2048x1152': { width: 2048, height: 1152 },
    '1152x2048': { width: 1152, height: 2048 },
    '3840x2160': { width: 3840, height: 2160 },
    '2160x3840': { width: 2160, height: 3840 }
  };
  if (map[size]) return map[size];
  const parsed = parseXiImageSizeDimensions(size);
  if (parsed) return parsed;
  return map['1024x1024'];
}

const XI_IMAGE_MIN_DIMENSION = 16;
const XI_IMAGE_MAX_WIDTH = 3840;
const XI_IMAGE_MAX_HEIGHT = 3840;
const XI_IMAGE_MAX_AREA = 3840 * 2160;
const XI_IMAGE_SIZE_ALIASES = {
  '1254x1254': '1024x1024',
  '1672x941': '2048x1152',
  '941x1672': '1152x2048'
};

function normalizeXiImageSizeText(size) {
  return String(size || '').trim().toLowerCase().replace(/[×＊*]/g, 'x');
}

function parseXiImageSizeDimensions(size) {
  const match = /^(\d{2,4})x(\d{2,4})$/i.exec(normalizeXiImageSizeText(size));
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function isExplicitXiImageSizeSupported(size) {
  const dimensions = parseXiImageSizeDimensions(size);
  if (!dimensions) return false;
  const { width, height } = dimensions;
  if (width < XI_IMAGE_MIN_DIMENSION || height < XI_IMAGE_MIN_DIMENSION) return false;
  if (width > XI_IMAGE_MAX_WIDTH || height > XI_IMAGE_MAX_HEIGHT) return false;
  if (width * height > XI_IMAGE_MAX_AREA) return false;
  if (width % 16 !== 0 || height % 16 !== 0) return false;
  const ratio = width / height;
  return ratio >= 1 / 3 && ratio <= 3;
}

function parseXiImageSize(size) {
  const value = normalizeXiImageSizeText(size);
  if (!value) return '1024x1536';
  if (XI_IMAGE_SIZE_ALIASES[value]) return XI_IMAGE_SIZE_ALIASES[value];
  return isExplicitXiImageSizeSupported(value) ? value.toLowerCase() : '';
}

function assertXiImageSizeSupported(size) {
  if (!isExplicitXiImageSizeSupported(size)) {
    const err = new Error('无效的图片尺寸：宽高必须是16的倍数，比例在1:3到3:1之间，且不超过3840x2160等量像素');
    err.statusCode = 400;
    throw err;
  }
}

function repairXiRecoveryInitializationFailures() {
  const brokenMessage = "服务重启后任务恢复失败，积分已自动退回：Cannot access 'XI_IMAGE_SIZE_ALIASES' before initialization";
  try {
    const rows = db.db.prepare(`
      SELECT id, content
      FROM history
      WHERE type = 'image'
        AND sub_type IN ('xi-edit', 'xi-generate')
        AND image_url IS NULL
    `).all();
    let repaired = 0;
    for (const row of rows) {
      let meta = {};
      try { meta = JSON.parse(row.content || '{}'); } catch { continue; }
      if (meta.status !== 'failed' || meta.error !== brokenMessage) continue;
      meta.status = 'queued';
      meta.error = '';
      db.db.prepare('UPDATE history SET content = ? WHERE id = ?').run(JSON.stringify(meta), row.id);
      repaired += 1;
    }
    if (repaired > 0) console.log(`已修复 ${repaired} 条初始化顺序导致的任务，准备重新生成`);
  } catch (err) {
    console.error('修复初始化顺序导致的任务失败:', err);
  }
}

if (require.main === module) {
  repairXiRecoveryInitializationFailures();
  recoverStaleXiJobHistories();
}

async function callArkGenerateForXiJob({ prompt, size, count }) {
  if (!ARK_FALLBACK_ENABLED) throw new Error('图片服务暂时不可用，请稍后重试。本次没有生成图片，积分已退回。');
  const apiKey = getRequiredEnv('ARK_API_KEY');
  if (!apiKey) throw new Error('备用图片服务未配置');
  const arkSize = xiSizeToArkSize(size);
  const remoteUrls = [];
  for (let index = 0; index < count; index += 1) {
    const response = await fetch(`${ARK_IMAGE_BASE_URL}/images/generations`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
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

async function callArkEditFallbackForXiJob({ prompt, size, count, sourceFiles, promptOverride }) {
  if (!ARK_FALLBACK_ENABLED) throw new Error('图片服务暂时不可用，请稍后重试。本次没有生成图片，积分已退回。');
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

function summarizeImageFiles(files = []) {
  return files.map((file, index) => ({
    index: index + 1,
    name: file.originalname || getSourceImageFilename(index),
    type: file.mimetype || '',
    mb: Number(((file.buffer?.length || 0) / 1024 / 1024).toFixed(2)),
    referenceBoard: Boolean(file.isReferenceBoard)
  }));
}

function logXiXuEditError(err, files = [], context = {}) {
  const cause = err?.cause || {};
  console.error('gpt-image-2 改图请求失败:', JSON.stringify({
    message: err?.message || String(err),
    name: err?.name || '',
    causeCode: cause.code || '',
    causeErrno: cause.errno || '',
    causeSyscall: cause.syscall || '',
    causeHostname: cause.hostname || '',
    sourceCount: files.length,
    totalMb: Number((files.reduce((sum, file) => sum + (file.buffer?.length || 0), 0) / 1024 / 1024).toFixed(2)),
    files: summarizeImageFiles(files),
    ...context
  }));
}

function getXiXuEditCircuitMessage() {
  const remainingMs = xiXuEditCircuit.openUntilMs - Date.now();
  if (remainingMs <= 0) return '';
  return `gpt-image-2 改图暂时不稳定，${Math.ceil(remainingMs / 1000)}秒内直接走备用通道`;
}

function markXiXuEditSuccess() {
  xiXuEditCircuit.failures = 0;
  xiXuEditCircuit.openUntilMs = 0;
}

function markXiXuEditFailure(err) {
  xiXuEditCircuit.failures += 1;
  if (XI_XU_EDIT_CIRCUIT_BREAKER_MS > 0 && xiXuEditCircuit.failures >= 2) {
    xiXuEditCircuit.openUntilMs = Date.now() + Math.max(XI_XU_EDIT_CIRCUIT_BREAKER_MS, 60000);
    console.error('gpt-image-2 改图临时熔断:', JSON.stringify({
      failures: xiXuEditCircuit.failures,
      seconds: Math.round((xiXuEditCircuit.openUntilMs - Date.now()) / 1000),
      reason: err?.message || String(err)
    }));
  }
}

function drawFilledRect(png, x, y, width, height, rgba) {
  const [r, g, b, a] = rgba;
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(png.width, Math.ceil(x + width));
  const endY = Math.min(png.height, Math.ceil(y + height));
  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      const idx = (py * png.width + px) * 4;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }
}

function drawNumberBadge(png, x, y, number) {
  const digits = {
    '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'],
    '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111']
  };
  const pattern = digits[String(number)] || digits['1'];
  const scale = 7;
  drawFilledRect(png, x, y, 34, 44, [20, 20, 20, 255]);
  pattern.forEach((row, rowIndex) => {
    [...row].forEach((cell, colIndex) => {
      if (cell === '1') {
        drawFilledRect(png, x + 7 + colIndex * scale, y + 5 + rowIndex * scale, scale - 1, scale - 1, [255, 255, 255, 255]);
      }
    });
  });
}

function pasteResizedImage(target, source, destX, destY, destW, destH) {
  for (let y = 0; y < destH; y += 1) {
    const sy = Math.min(source.height - 1, Math.floor((y / destH) * source.height));
    for (let x = 0; x < destW; x += 1) {
      const sx = Math.min(source.width - 1, Math.floor((x / destW) * source.width));
      const sIdx = (sy * source.width + sx) * 4;
      const dIdx = ((destY + y) * target.width + (destX + x)) * 4;
      const alpha = source.data[sIdx + 3] / 255;
      target.data[dIdx] = Math.round(source.data[sIdx] * alpha + target.data[dIdx] * (1 - alpha));
      target.data[dIdx + 1] = Math.round(source.data[sIdx + 1] * alpha + target.data[dIdx + 1] * (1 - alpha));
      target.data[dIdx + 2] = Math.round(source.data[sIdx + 2] * alpha + target.data[dIdx + 2] * (1 - alpha));
      target.data[dIdx + 3] = 255;
    }
  }
}

function createReferenceBoardFile(sourceFiles = []) {
  const images = sourceFiles.map((file, index) => ({
    index,
    labelNumber: Number((/图\s*([1-4])/i.exec(String(file?.originalname || '')) || [])[1]) || index + 1,
    image: PNG.sync.read(file.buffer)
  }));
  const count = images.length;
  if (count <= 1) throw new Error('参考板至少需要两张参考图');
  const cols = count <= 2 ? count : 3;
  const rows = Math.ceil(count / cols);
  const cell = 512;
  const padding = 24;
  const board = new PNG({ width: cols * cell, height: rows * cell });
  drawFilledRect(board, 0, 0, board.width, board.height, [246, 246, 242, 255]);

  images.forEach(({ image, labelNumber }, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const cellX = col * cell;
    const cellY = row * cell;
    const maxW = cell - padding * 2;
    const maxH = cell - padding * 2;
    const scale = Math.min(maxW / image.width, maxH / image.height);
    const destW = Math.max(1, Math.round(image.width * scale));
    const destH = Math.max(1, Math.round(image.height * scale));
    const destX = cellX + Math.round((cell - destW) / 2);
    const destY = cellY + Math.round((cell - destH) / 2);
    pasteResizedImage(board, image, destX, destY, destW, destH);
    drawNumberBadge(board, cellX + 14, cellY + 14, labelNumber);
  });

  return {
    buffer: PNG.sync.write(board, { colorType: 6 }),
    mimetype: 'image/png',
    originalname: `reference_board_${count}.png`,
    isReferenceBoard: true,
    boardSourceCount: count
  };
}

async function callXiXuEditOnce({ prompt, size, count, quality, sourceFiles, promptOverride }, attempt = 1) {
  const apiKey = getXiImageApiKey();
  if (!apiKey) throw new Error('gpt-image-2 图片服务未配置');
  if (XI_XU_EDIT_FORCE_FALLBACK) throw new Error('gpt-image-2 改图已临时切到备用通道');
  const circuitMessage = getXiXuEditCircuitMessage();
  if (circuitMessage) throw new Error(circuitMessage);

  const controller = new AbortController();
  const timeoutMs = Math.max(XI_XU_EDIT_TIMEOUT_MS, 30000);
  try {
    const form = new FormData();
    const requestSourceFiles = sourceFiles.length > 1
      ? [createReferenceBoardFile(sourceFiles), ...sourceFiles]
      : sourceFiles;
    requestSourceFiles.forEach((file, index) => {
      const imageBlob = new Blob([file.buffer], { type: file.mimetype });
      form.append('image', imageBlob, file.originalname || getSourceImageFilename(index));
    });
    form.append('model', process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2');
    form.append('prompt', promptOverride || buildXiEditPrompt(prompt, sourceFiles, size));
    form.append('size', size);
    form.append('n', String(count));
    form.append('quality', quality);
    form.append('output_format', 'png');

    console.log('gpt-image-2 改图请求:', JSON.stringify({
      size,
      quality,
      count,
      sourceDimensions: getUploadedImageDimensions(sourceFiles),
      requestFiles: summarizeImageFiles(requestSourceFiles),
      sourceBytes: sourceFiles.map((file) => file.buffer?.length || 0)
    }));

    const response = await withTimeout(fetch(buildXiImageUrl('/v1/images/edits'), {
      method: 'POST',
      signal: controller.signal,
      headers: buildXiImageHeaders({ 'Authorization': `Bearer ${apiKey}` }),
      body: form
    }), timeoutMs, `gpt-image-2 改图请求超时（超过${Math.round(timeoutMs / 1000)}秒）`, () => controller.abort());
    const text = await withTimeout(
      response.text(),
      timeoutMs,
      `gpt-image-2 改图结果下载超时（超过${Math.round(timeoutMs / 1000)}秒）`,
      () => controller.abort()
    );
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) {
      const upstreamError = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
      throw new Error(formatUpstreamError(upstreamError, '改图服务暂时不可用，请稍后再试'));
    }
    const imageUrls = parseXiXuImages(data);
    if (imageUrls.length === 0) throw new Error('上游未返回图片');
    const localUrls = await saveXiXuImages(imageUrls, `xixu_edit_${size.replace('x', '_')}`, size);
    markXiXuEditSuccess();
    return {
      localUrls,
      upstreamMeta: extractXiXuImageMetadata(data, { size, quality })
    };
  } catch (err) {
    const normalizedErr = err.name === 'AbortError'
      ? new Error(`gpt-image-2 改图请求超时（超过${Math.round(timeoutMs / 1000)}秒）`)
      : err;
    logXiXuEditError(normalizedErr, sourceFiles, { attempt });
    markXiXuEditFailure(normalizedErr);
    throw normalizedErr;
  } finally {
    controller.abort();
  }
}

async function callXiXuEdit(job) {
  let lastErr;
  const maxAttempts = XI_XU_EDIT_RETRIES + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await callXiXuEditOnce(job, attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isTransientXiXuError(err)) break;
      const waitMs = Math.min(1000 * attempt, 3000);
      console.warn('gpt-image-2 改图瞬时故障，准备重试:', JSON.stringify({
        attempt,
        nextAttempt: attempt + 1,
        waitMs,
        message: err.message || String(err),
        causeCode: err?.cause?.code || ''
      }));
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastErr;
}

async function callXiEditWithFallback(job) {
  try {
    const result = await callXiXuEdit(job);
    return { localUrls: result.localUrls, upstreamMeta: result.upstreamMeta || {}, provider: 'xixu', fallbackReason: '' };
  } catch (err) {
    const fallbackReason = err.message || 'gpt-image-2 改图失败';
    if (!ARK_FALLBACK_ENABLED) {
      const error = new Error(formatUpstreamError(fallbackReason, '图片服务暂时不可用，请稍后重试。本次没有生成图片，积分已退回。'));
      error.fallbackReason = fallbackReason;
      throw error;
    }
    if ((job.sourceFiles || []).length > 1) {
      try {
        const referenceBoard = createReferenceBoardFile(job.sourceFiles || []);
        const localUrls = await callArkEditFallbackForXiJob({
          ...job,
          sourceFiles: [referenceBoard],
          promptOverride: buildReferenceBoardPrompt(job.prompt, job.sourceFiles || [])
        });
        return { localUrls, upstreamMeta: {}, provider: 'ark-reference-board-fallback', fallbackReason };
      } catch (boardErr) {
        const combinedReason = `${fallbackReason}; 参考板备用改图失败: ${boardErr.message || boardErr}`;
        const error = new Error('多参考图改图请求失败，上游服务没有完成处理。系统已尝试把参考图合成参考板走备用改图，但仍未成功，请稍后再试。');
        error.fallbackReason = combinedReason;
        throw error;
      }
    }

    const localUrls = await callArkEditFallbackForXiJob(job);
    return { localUrls, upstreamMeta: {}, provider: 'ark-edit-fallback', fallbackReason };
  }
}

async function runXiJob(job) {
  job.status = 'running';
  job.startedAtMs = Date.now();
  updateXiJobHistory(job, 'running', [], job.costPoints || 0);
  try {
    let localUrls;
    if (job.mode === 'edit') {
      const editResult = await callXiEditWithFallback(job);
      localUrls = editResult.localUrls;
      job.upstreamMeta = editResult.upstreamMeta || {};
      job.provider = editResult.provider;
      job.fallbackReason = editResult.fallbackReason;
    } else {
      try {
        const generateResult = await callXiXuGenerate(job);
        localUrls = generateResult.localUrls;
        job.upstreamMeta = generateResult.upstreamMeta || {};
        job.provider = 'xixu';
      } catch (err) {
        job.fallbackReason = err.message || 'gpt-image-2 生图失败';
        if (!ARK_FALLBACK_ENABLED) {
          throw new Error(formatUpstreamError(job.fallbackReason, '图片服务暂时不可用，请稍后重试。本次没有生成图片，积分已退回。'));
        }
        localUrls = await callArkGenerateForXiJob(job);
        job.upstreamMeta = {};
        job.provider = 'ark-fallback';
      }
    }
    job.status = 'done';
    job.finishedAtMs = Date.now();
    const durationMs = job.finishedAtMs - job.startedAtMs;
    job.imageUrls = localUrls;
    job.outputDimensions = getLocalImageDimensions(localUrls);
    console.log('gpt-image-2 任务完成:', JSON.stringify({
      id: job.id,
      mode: job.mode,
      provider: job.provider || '',
      size: job.size,
      outputDimensions: job.outputDimensions,
      quality: job.quality,
      upstreamMeta: job.upstreamMeta || {},
      count: job.count,
      durationMs
    }));
    const expectedCount = Math.max(Number(job.count) || 1, 1);
    const actualCount = Math.min(localUrls.length, expectedCount);
    const actualCost = POINTS.image * actualCount;
    const refundAmount = Math.max((job.costPoints || 0) - actualCost, 0);
    if (refundAmount > 0) {
      refundPoints(job.userId, refundAmount, `gpt-image-2 少出${expectedCount - actualCount}张退款`);
      job.refundedPoints = (job.refundedPoints || 0) + refundAmount;
    }
    if (!updateXiJobHistory(job, 'done', localUrls, actualCost, { duration_ms: durationMs })) {
      job.historyId = db.addHistory(job.userId, 'image', {
        sub_type: getXiJobHistorySubType(job),
        image_url: JSON.stringify(localUrls),
        content: buildXiJobHistoryContent(job, 'done', { duration_ms: durationMs }),
        prompt: job.prompt,
        ratio: job.size,
        cost_points: actualCost
      });
    }
  } catch (err) {
    if (job.costPoints && !job.refundedOnFail) {
      refundPoints(job.userId, job.costPoints, `gpt-image-2 ${job.mode === 'edit' ? '改图' : '生图'}失败退款`);
      job.refundedPoints = (job.refundedPoints || 0) + job.costPoints;
      job.refundedOnFail = true;
    }
    job.status = 'failed';
    job.finishedAtMs = Date.now();
    if (err.fallbackReason && !job.fallbackReason) job.fallbackReason = err.fallbackReason;
    job.error = err.message || '任务失败';
    console.error('gpt-image-2 任务失败:', JSON.stringify({
      id: job.id,
      mode: job.mode,
      size: job.size,
      quality: job.quality,
      count: job.count,
      durationMs: job.startedAtMs ? job.finishedAtMs - job.startedAtMs : 0,
      error: job.error
    }));
    saveXiJobFailureHistory(job);
  }
  // 内存泄漏防护：任务结束后立即释放原图 buffer（改图任务可能携带数 MB 的 PNG），
  // 并在 10 分钟后从 xiJobs 移除该条目，给前端留出轮询取结果的时间。
  scheduleXiJobCleanup(job);
}

const XI_JOB_CLEANUP_DELAY_MS = 10 * 60 * 1000;
const xiJobCleanupTimers = new Map();

function scheduleXiJobCleanup(job) {
  // 立即清空大块 buffer，减轻内存压力（历史记录里只存了 URL，不依赖 buffer）
  if (Array.isArray(job.sourceFiles)) {
    job.sourceFiles.forEach((file) => { if (file) file.buffer = null; });
  }
  // 已有定时器则不重复设置
  if (xiJobCleanupTimers.has(job.id)) return;
  const timer = setTimeout(() => {
    xiJobs.delete(job.id);
    xiJobCleanupTimers.delete(job.id);
  }, XI_JOB_CLEANUP_DELAY_MS);
  xiJobCleanupTimers.set(job.id, timer);
}

app.get('/api/xi-image/jobs', authMiddleware, (req, res) => {
  const jobs = Array.from(xiJobs.values())
    .filter((job) => job.userId === req.userId && ['queued', 'running'].includes(job.status))
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .map(serializeXiJob);
  res.json({ jobs });
});

app.get('/api/xi-image/jobs/:id', authMiddleware, (req, res) => {
  const job = xiJobs.get(req.params.id);
  if (!job || job.userId !== req.userId) return res.status(404).json({ error: '任务不存在' });
  res.json({ job: serializeXiJob(job) });
});

app.post('/api/xi-image/jobs/generate', xiImageLimiter, authMiddleware, (req, res) => {
  const prompt = sanitizeInput(req.body.prompt, 3000);
  const size = parseXiImageSize(req.body.size);
  const count = parseXiXuImageCount(req.body.count);
  const quality = XI_XU_FIXED_QUALITY;
  if (!prompt) return res.status(400).json({ error: '请输入图片描述' });
  try {
    assertXiImageSizeSupported(size);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  const costPoints = POINTS.image * count;
  try {
    chargePoints(req.userId, costPoints, `gpt-image-2 生图 x${count}`);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || '积分扣减失败' });
  }
  const job = createXiJob(req.userId, { mode: 'generate', prompt, size, count, quality, costPoints });
  res.json({ success: true, job: serializeXiJob(job) });
});

app.post('/api/xi-image/jobs/edit', xiImageLimiter, authMiddleware, upload.array('image', 4), validateUploadedImageFiles, (req, res) => {
  const prompt = sanitizeInput(req.body.prompt, 3000);
  const size = parseXiImageSize(req.body.size);
  const count = parseXiXuImageCount(req.body.count);
  const quality = XI_XU_FIXED_QUALITY;
  const sourceFiles = Array.isArray(req.files) ? req.files : [];
  sourceFiles.forEach((file, index) => {
    file.originalname = normalizeSourceImageFilename(file.originalname, index);
  });
  const sourceDimensions = getUploadedImageDimensions(sourceFiles);
  if (!prompt) return res.status(400).json({ error: '请输入图片编辑描述' });
  if (sourceFiles.length === 0) return res.status(400).json({ error: '请至少上传一张原图' });
  try {
    assertXiImageSizeSupported(size);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  if (sourceFiles.some((file) => file.mimetype !== 'image/png')) {
    return res.status(400).json({ error: '改图原图需为 PNG 格式，请刷新页面后重新上传，页面会自动转换' });
  }
  if (sourceFiles.some((file) => (file.buffer?.length || 0) > 20 * 1024 * 1024)) {
    return res.status(400).json({ error: '改图原图处理后仍超过 20MB，请换一张更小的参考图' });
  }
  const costPoints = POINTS.image * count;
  try {
    chargePoints(req.userId, costPoints, `gpt-image-2 改图 x${count}`);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || '积分扣减失败' });
  }
  const sourcePreviewUrls = saveUploadedSourceImages(sourceFiles);
  const job = createXiJob(req.userId, {
    mode: 'edit',
    prompt,
    size,
    count,
    quality,
    sourceFiles: sourceFiles.map((file) => ({
      buffer: Buffer.from(file.buffer),
      mimetype: file.mimetype,
      originalname: file.originalname
    })),
    sourceFileNames: sourceFiles.map((file, index) => file.originalname || getSourceImageFilename(index)),
    sourcePreviewUrls,
    sourceDimensions,
    costPoints
  });
  res.json({ success: true, job: serializeXiJob(job) });
});

// gpt-image-2 OpenAI兼容生图接口
app.post('/api/xi-image/generate', xiImageLimiter, authMiddleware, async (req, res) => {
  const prompt = sanitizeInput(req.body.prompt, 3000);
  const size = parseXiImageSize(req.body.size);
  const count = parseXiXuImageCount(req.body.count);
  const quality = XI_XU_FIXED_QUALITY;

  if (!prompt) return res.status(400).json({ error: '请输入图片描述' });
  try {
    assertXiImageSizeSupported(size);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  const totalCost = POINTS.image * count;
  let charged = false;
  try {
    chargePoints(req.userId, totalCost, `gpt-image-2 生图 x${count}`);
    charged = true;
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || '积分扣减失败' });
  }

  const apiKey = getXiImageApiKey();
  if (!apiKey) {
    refundPoints(req.userId, totalCost, 'gpt-image-2 生图失败退款');
    return res.status(500).json({ error: 'gpt-image-2 图片服务未配置' });
  }

  const startedAtMs = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), XI_XU_IMAGE_TIMEOUT_MS);

  try {
    const response = await fetch(buildXiImageUrl('/v1/images/generations'), {
      method: 'POST',
      signal: controller.signal,
      headers: buildXiImageHeaders({
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({
        model: process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2',
        prompt: buildXiGeneratePrompt(prompt, size),
        size,
        n: count,
        quality,
        output_format: 'png'
      })
    });

    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const upstreamError = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
      refundPoints(req.userId, totalCost, 'gpt-image-2 生图失败退款');
      charged = false;
      return res.status(502).json({ error: formatUpstreamError(upstreamError, '生图服务暂时不可用，请稍后再试') });
    }

    const imageUrls = parseXiXuImages(data);
    if (imageUrls.length === 0) {
      refundPoints(req.userId, totalCost, 'gpt-image-2 生图失败退款');
      charged = false;
      return res.status(502).json({ error: '上游未返回图片' });
    }
    const upstreamMeta = extractXiXuImageMetadata(data, { size, quality });
    const localUrls = await saveXiXuImages(imageUrls, `xixu_gen_${size.replace('x', '_')}`, size);
    const outputDimensions = getLocalImageDimensions(localUrls);
    const actualCount = Math.min(localUrls.length, count);
    const actualCost = POINTS.image * actualCount;
    const refundAmount = Math.max(totalCost - actualCost, 0);
    if (refundAmount > 0) refundPoints(req.userId, refundAmount, `gpt-image-2 少出${count - actualCount}张退款`);
    const durationMs = Date.now() - startedAtMs;
    const createdAt = formatBeijingDateTime();

    const historyId = db.addHistory(req.userId, 'image', {
      sub_type: 'xi-generate',
      image_url: JSON.stringify(localUrls),
      content: JSON.stringify({
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
        output_dimensions: outputDimensions
      }),
      prompt,
      ratio: size,
      cost_points: actualCost
    });

    res.json({
      success: true,
      imageUrls: localUrls,
      imageUrl: localUrls[0],
      historyId,
      remainingPoints: db.getUserPoints(req.userId),
      model: process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2',
      upstreamMeta,
      outputDimensions,
      createdAt
    });
  } catch (err) {
    if (charged) refundPoints(req.userId, totalCost, 'gpt-image-2 生图失败退款');
    const message = err.name === 'AbortError' ? '生图请求超时（超过5分钟）' : '生图请求失败';
    res.status(502).json({ error: message });
  } finally {
    clearTimeout(timeout);
  }
});

// 亚马逊主图批量生成接口：一次返回多张主图候选，风格保持统一
app.post('/api/amazon-image/generate', imageLimiter, authMiddleware, upload.single('referenceImage'), validateUploadedImageFiles, async (req, res) => {
  const prompt = sanitizeInput(req.body.prompt, 2000);
  const ratio = req.body.ratio || '1:1';
  const imageCount = parseImageCount(req.body.imageCount ?? req.body.count);

  if (!prompt) return res.status(400).json({ error: '请输入图片描述' });
  if (!SIZE_MAP[ratio]) return res.status(400).json({ error: '无效的图片比例' });

  const totalCost = POINTS.image * imageCount;
  const pointsResult = db.deductPoints(req.userId, totalCost, `亚马逊主图生成 x${imageCount}`);
  if (!pointsResult.success) return res.status(400).json({ error: '积分不足，请充值' });

  const size = SIZE_MAP[ratio];
  const API_KEY = getRequiredEnv('ARK_API_KEY');
  if (!API_KEY) {
    db.rechargePoints(req.userId, totalCost, '亚马逊主图生成失败退款');
    return res.status(500).json({ error: '图片服务未配置' });
  }

  try {
    const requestBody = {
      model: 'doubao-seedream-5-0-lite-260128',
      prompt: buildAmazonMainImagePrompt(prompt, ratio),
      size: `${size.width}x${size.height}`,
      output_format: 'png',
      watermark: false,
    };

    if (req.file) {
      requestBody.image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    const remoteUrls = await generateArkImageUrls(
      ARK_IMAGE_BASE_URL,
      API_KEY,
      requestBody,
      imageCount,
      buildAmazonMainImageVariationPrompt
    );

    if (remoteUrls.length === 0) {
      db.rechargePoints(req.userId, totalCost, '亚马逊主图生成失败退款');
      return res.status(500).json({ error: '图片生成失败' });
    }

    const localUrls = await Promise.all(remoteUrls.map((url, index) => (
      downloadAndSaveImage(url, `amazon_${ratio.replace(':', '')}_${index + 1}`)
    )));
    const missingCount = Math.max(imageCount - localUrls.length, 0);
    if (missingCount > 0) {
      db.rechargePoints(req.userId, POINTS.image * missingCount, `亚马逊主图少出${missingCount}张退款`);
    }

    const createdAt = new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-');
    const historyIds = [];
    localUrls.forEach((localUrl) => {
      const historyId = db.addHistory(req.userId, 'image', {
        sub_type: 'amazon-generate',
        image_url: localUrl,
        prompt: prompt,
        ratio: ratio,
        cost_points: POINTS.image
      });
      historyIds.push(historyId);
    });
    const remainingPoints = pointsResult.balance + (POINTS.image * missingCount);

    res.json({ imageUrl: localUrls[0], imageUrls: localUrls, historyId: historyIds[0] || null, remainingPoints, createdAt });
  } catch (err) {
    db.rechargePoints(req.userId, totalCost, '亚马逊主图生成失败退款');
    console.error('亚马逊主图生成失败:', err.message || err);
    res.status(502).json({ error: formatUpstreamError(err.message || err, '图片生成失败，请稍后再试') });
  }
});

// gpt-image-2 OpenAI兼容改图接口：上传原图后按用户提示词编辑
app.post('/api/xi-image/edit', xiImageLimiter, authMiddleware, upload.array('image', 4), validateUploadedImageFiles, async (req, res) => {
  const prompt = sanitizeInput(req.body.prompt, 3000);
  const size = parseXiImageSize(req.body.size);
  const count = parseXiXuImageCount(req.body.count);
  const quality = XI_XU_FIXED_QUALITY;
  const sourceFiles = Array.isArray(req.files) ? req.files : [];
  sourceFiles.forEach((file, index) => {
    file.originalname = normalizeSourceImageFilename(file.originalname, index);
  });
  const sourceDimensions = getUploadedImageDimensions(sourceFiles);
  const startedAtMs = Date.now();

  if (!prompt) return res.status(400).json({ error: '请输入图片编辑描述' });
  if (sourceFiles.length === 0) return res.status(400).json({ error: '请至少上传一张原图' });
  try {
    assertXiImageSizeSupported(size);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  if (sourceFiles.some((file) => file.mimetype !== 'image/png')) {
    return res.status(400).json({ error: '改图原图需为 PNG 格式，请刷新页面后重新上传，页面会自动转换' });
  }
  if (sourceFiles.some((file) => (file.buffer?.length || 0) > 20 * 1024 * 1024)) {
    return res.status(400).json({ error: '改图原图处理后仍超过 20MB，请换一张更小的参考图' });
  }
  const totalCost = POINTS.image * count;
  let charged = false;
  try {
    chargePoints(req.userId, totalCost, `gpt-image-2 改图 x${count}`);
    charged = true;
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || '积分扣减失败' });
  }

  try {
    const editResult = await callXiEditWithFallback({
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
    if (refundAmount > 0) refundPoints(req.userId, refundAmount, `gpt-image-2 改图少出${count - actualCount}张退款`);
    const sourcePreviewUrls = saveUploadedSourceImages(sourceFiles);
    const durationMs = Date.now() - startedAtMs;
    const createdAt = formatBeijingDateTime();

    const historyId = db.addHistory(req.userId, 'image', {
      sub_type: 'xi-edit',
      image_url: JSON.stringify(localUrls),
      content: JSON.stringify({
        model: process.env.XI_XU_IMAGE_MODEL || 'gpt-image-2',
        provider: editResult.provider,
        fallback_reason: editResult.fallbackReason || '',
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
        sources: sourceFiles.map((file, index) => file.originalname || getSourceImageFilename(index)),
        source_urls: sourcePreviewUrls,
        source_dimensions: sourceDimensions,
        output_dimensions: outputDimensions,
        duration_ms: durationMs
      }),
      prompt,
      ratio: size,
      cost_points: actualCost
    });

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
      createdAt
    });
  } catch (err) {
    if (charged) refundPoints(req.userId, totalCost, 'gpt-image-2 改图失败退款');
    console.error('改图请求失败:', err.message || err);
    res.status(502).json({ error: err.message || '改图请求失败' });
  }
});

// gpt-image-2 gpt-5.5 识图反推绘图提示词
app.post('/api/xi-image/reverse-prompt', copyLimiter, authMiddleware, upload.single('image'), validateUploadedImageFiles, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传要反推的图片' });

  const totalCost = POINTS.copy;
  let charged = false;
  try {
    chargePoints(req.userId, totalCost, '看图写 Prompt');
    charged = true;
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || '积分扣减失败' });
  }

  const apiKey = getRequiredEnv('XI_XU_API_KEY');
  if (!apiKey) {
    refundPoints(req.userId, totalCost, '看图写 Prompt 失败退款');
    return res.status(500).json({ error: 'gpt-image-2 服务未配置' });
  }

  const startedAtMs = Date.now();
  const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  const reverseMode = getReversePromptMode(sanitizeInput(req.body.reverseMode, 40));
  const historySource = sanitizeInput(req.body.historySource, 20) === 'xhs' ? 'xhs' : 'xi';
  const clientTaskId = sanitizeInput(req.body.clientTaskId, 120);
  let historyId = null;
  let previewUrl = '';

  const reversePromptInstruction = buildReversePromptInstruction(reverseMode);

  try {
    if (historySource === 'xi') {
      previewUrl = saveUploadedSourceImages([req.file], 'xixu_reverse')[0] || '';
      historyId = db.addHistory(req.userId, 'reverse', {
        sub_type: 'xi-reverse',
        content: JSON.stringify({
          status: 'running',
          model: process.env.XI_XU_VISION_MODEL || 'gpt-5.5',
          file: req.file.originalname || 'image.png',
          reverse_mode: reverseMode,
          preview_url: previewUrl,
          duration_ms: 0
        }),
        prompt: req.file.originalname || '图片反推提示词',
        cost_points: totalCost,
        client_task_id: clientTaskId || null
      });
    }

    const response = await fetch(buildXiXuUrl('/v1/chat/completions'), {
      method: 'POST',
      signal: controller.signal,
      headers: buildXiXuHeaders({
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({
        model: process.env.XI_XU_VISION_MODEL || 'gpt-5.5',
        messages: [
          { role: 'system', content: reversePromptInstruction },
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
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const upstreamError = data?.error?.message || data?.message || text || `HTTP ${response.status}`;
      refundPoints(req.userId, totalCost, '看图写 Prompt 失败退款');
      charged = false;
      db.updateHistory(req.userId, historyId, {
        content: JSON.stringify({
          status: 'failed',
          model: process.env.XI_XU_VISION_MODEL || 'gpt-5.5',
          file: req.file.originalname || 'image.png',
          reverse_mode: reverseMode,
          preview_url: previewUrl,
          duration_ms: Date.now() - startedAtMs,
          error: formatUpstreamError(upstreamError, '识图服务暂时不可用，请稍后再试')
        }),
        cost_points: 0
      });
      return res.status(502).json({ error: formatUpstreamError(upstreamError, '识图服务暂时不可用，请稍后再试') });
    }

    const content = extractChatText(data);
    if (!content) {
      refundPoints(req.userId, totalCost, '看图写 Prompt 失败退款');
      charged = false;
      db.updateHistory(req.userId, historyId, {
        content: JSON.stringify({
          status: 'failed',
          model: process.env.XI_XU_VISION_MODEL || 'gpt-5.5',
          file: req.file.originalname || 'image.png',
          reverse_mode: reverseMode,
          preview_url: previewUrl,
          duration_ms: Date.now() - startedAtMs,
          error: '上游未返回反推结果'
        }),
        cost_points: 0
      });
      return res.status(502).json({ error: '上游未返回反推结果' });
    }

    const parsed = normalizeReversePromptResult(parseJsonLike(content));
    const durationMs = Date.now() - startedAtMs;
    const createdAt = formatBeijingDateTime();
    if (!previewUrl) previewUrl = saveUploadedSourceImages([req.file], 'xixu_reverse')[0] || '';
    const completedHistory = {
      sub_type: historySource === 'xhs' ? 'xhs-reverse' : 'xi-reverse',
      content: JSON.stringify({
        status: 'done',
        model: process.env.XI_XU_VISION_MODEL || 'gpt-5.5',
        result: parsed || null,
        raw: parsed ? '' : content,
        file: req.file.originalname || 'image.png',
        reverse_mode: reverseMode,
        preview_url: previewUrl,
        duration_ms: durationMs
      }),
      prompt: parsed?.title || req.file.originalname || '图片反推提示词',
      cost_points: totalCost,
      client_task_id: clientTaskId || null
    };
    if (historyId) {
      db.updateHistory(req.userId, historyId, completedHistory);
    } else {
      historyId = db.addHistory(req.userId, 'reverse', completedHistory);
    }
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
      createdAt
    });
  } catch (err) {
    if (charged) refundPoints(req.userId, totalCost, '看图写 Prompt 失败退款');
    const message = err.name === 'AbortError' ? '识图请求超时' : '识图请求失败';
    if (historyId) {
      db.updateHistory(req.userId, historyId, {
        content: JSON.stringify({
          status: 'failed',
          model: process.env.XI_XU_VISION_MODEL || 'gpt-5.5',
          file: req.file.originalname || 'image.png',
          reverse_mode: reverseMode,
          preview_url: previewUrl,
          duration_ms: Date.now() - startedAtMs,
          error: message
        }),
        cost_points: 0
      });
    }
    res.status(502).json({ error: message });
  } finally {
    clearTimeout(timeout);
  }
});

// 创建支付订单
app.post('/api/payment/create', authMiddleware, async (req, res) => {
  res.status(503).json({ error: '在线充值暂未开放，请使用卡密兑换' });
});

// 模拟支付回调 - 实际应替换为支付平台异步通知和平台验签
app.post('/api/payment/callback', authMiddleware, async (req, res) => {
  const mockPaymentEnabled = process.env.ENABLE_MOCK_PAYMENT === 'true';
  const mockPaymentToken = process.env.MOCK_PAYMENT_TOKEN;

  if (!mockPaymentEnabled) {
    return res.status(403).json({ error: '模拟支付回调已禁用，请接入真实支付平台回调和验签' });
  }
  if (!mockPaymentToken) {
    return res.status(500).json({ error: '模拟支付回调缺少服务端保护令牌配置' });
  }
  const providedToken = req.get('X-Mock-Payment-Token') || req.body.mockPaymentToken;
  if (!safeCompareSecret(providedToken, mockPaymentToken)) {
    return res.status(403).json({ error: '模拟支付回调令牌无效' });
  }

  const { orderNo, tradeNo } = req.body;
  if (!orderNo) return res.status(400).json({ error: '参数不完整' });

  const order = db.db.prepare('SELECT * FROM payment_orders WHERE order_no = ? AND user_id = ?').get(orderNo, req.userId);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  
  const result = db.paySuccess(orderNo, tradeNo || ('MOCK' + Date.now()));
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, balance: result.balance });
});

// 真实支付回调占位：密钥和验签逻辑未完成前，不自动入账，避免被伪造回调刷积分。
app.post('/api/payment/alipay/notify', async (req, res) => {
  console.warn('收到支付宝回调，但真实支付验签尚未接入。');
  res.status(501).json({ error: '支付宝回调验签尚未接入，请在管理后台人工核对订单后确认到账' });
});

app.post('/api/payment/wxpay/notify', async (req, res) => {
  console.warn('收到微信支付回调，但真实支付验签尚未接入。');
  res.status(501).json({ error: '微信支付回调验签尚未接入，请在管理后台人工核对订单后确认到账' });
});

// 查询订单状态
app.get('/api/payment/status/:orderNo', authMiddleware, (req, res) => {
  const order = db.db.prepare('SELECT * FROM payment_orders WHERE order_no = ? AND user_id = ?').get(req.params.orderNo, req.userId);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  res.json({ order, balance: db.getUserPoints(req.userId) });
});

// 获取用户支付订单列表
app.get('/api/payment/orders', authMiddleware, (req, res) => {
  const orders = db.getUserPaymentOrders(req.userId);
  res.json({ orders });
});

// =============================================
// 卡密兑换
// =============================================

// 兑换卡密
app.post('/api/cdkey/redeem', authMiddleware, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: '请输入卡密' });
  
  const result = db.redeemCdkey(code.trim().toUpperCase(), req.userId);
  if (!result.success) return res.status(400).json({ error: result.error });
  
  res.json({ success: true, points: result.points, balance: result.balance });
});

app.use(handleRequestError);

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  const HOST = process.env.HOST || '127.0.0.1';
  app.listen(PORT, HOST, () => {
    console.log(`服务已启动：http://${HOST}:${PORT}`);
    console.log('Administrator account is ready.');
  });
}

module.exports = app;

