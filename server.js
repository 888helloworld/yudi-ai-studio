require('dotenv').config();

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./db');
const { isAllowedUploadMime, validateUploadedImageFiles } = require('./middleware/image-upload');
const { authMiddleware, optionalAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const { createAmazonImageRouter, SIZE_MAP } = require('./routes/amazon-image');
const { createGenerationRouter } = require('./routes/generation');
const { createPaymentRouter } = require('./routes/payment');
const { createPublicInfoRouter } = require('./routes/public-info');
const { createReversePromptRouter } = require('./routes/reverse-prompt');
const { createTemplateRouter } = require('./routes/templates');
const { createUploadRouter } = require('./routes/uploads');
const { createXiImageRouter } = require('./routes/xi-image');
const { createXiJobsRouter } = require('./routes/xi-jobs');
const { buildImageVariationPrompt } = require('./services/prompt-service');
const { chargePoints, refundPoints } = require('./services/point-service');
const { createXiImageProvider } = require('./services/xi-image-provider');
const { createXiJobRuntime } = require('./services/xi-job-runtime');
const { formatUpstreamError, generateArkImageUrls } = require('./services/upstream-http');
const {
  formatBeijingDateTime,
  getRequiredEnv,
  normalizeClientTaskId,
  parseImageCount,
  safeCompareSecret,
  sanitizeInput
} = require('./utils/request-utils');

const app = express();
const ARK_IMAGE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
app.set('trust proxy', Number.isSafeInteger(trustProxyHops) && trustProxyHops > 0 ? trustProxyHops : false);
app.disable('x-powered-by');

const corsOptions = {
  origin: process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(',') : 'http://localhost:3001',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
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
  ].join('; '));
  next();
});

const PUBLIC_FILES = new Set([
  'index.html', 'xhs.html', 'admin.html', 'login.html', 'register.html', 'profile.html',
  'help.html', 'privacy.html', 'terms.html', 'content-policy.html', 'image-studio.html',
  'reverse-prompt.html', 'xi-image.html', 'favicon.svg', 'favicon.ico', 'style.css',
  'script.js', 'shared-shell.js', 'image-studio.js', 'admin.js', 'profile.js',
  'reverse-prompt.js', 'login.js', 'register.js'
]);
const PUBLIC_STATIC_FILES = new Set([
  'style.css', 'script.js', 'shared-shell.js', 'image-studio.js', 'admin.js', 'profile.js',
  'reverse-prompt.js', 'login.js', 'register.js', 'favicon.svg', 'favicon.ico'
]);
const XHS_TOOL_FILES = new Set([
  'state.js', 'image-utils.js', 'workspace.js', 'generation.js', 'task-ui.js',
  'history-reverse.js', 'history-card.js', 'history.js', 'modals.js', 'bootstrap.js'
]);
const IMAGE_STUDIO_FILES = new Set([
  'state.js', 'auth-history.js', 'detail-suite.js', 'task-queue.js', 'task-rendering.js',
  'image-actions.js', 'source-images.js', 'reverse-prompt.js', 'utilities.js', 'bootstrap.js'
]);
const FRONTEND_FILES = new Set(['shared-utils.js']);
const ADMIN_FILES = new Set(['state-users.js', 'history.js', 'billing.js', 'audit.js', 'bootstrap.js']);
const PUBLIC_HTML_CACHE_CONTROL = 'private, no-cache, must-revalidate';
const PUBLIC_STATIC_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

function sendPublicFile(res, filename, next) {
  res.setHeader('Cache-Control', PUBLIC_STATIC_FILES.has(filename) ? PUBLIC_STATIC_CACHE_CONTROL : PUBLIC_HTML_CACHE_CONTROL);
  return res.sendFile(path.join(__dirname, filename), { cacheControl: false }, next);
}

app.get('/', (req, res) => sendPublicFile(res, 'index.html'));
app.get('/:filename', (req, res, next) => {
  const filename = path.basename(req.params.filename);
  if (filename !== req.params.filename || !PUBLIC_FILES.has(filename)) return next();
  return sendPublicFile(res, filename, next);
});
app.get('/xhs-tool/:filename', (req, res, next) => {
  const filename = path.basename(req.params.filename);
  if (filename !== req.params.filename || !XHS_TOOL_FILES.has(filename)) return next();
  res.setHeader('Cache-Control', PUBLIC_STATIC_CACHE_CONTROL);
  return res.sendFile(path.join(__dirname, 'xhs-tool', filename), { cacheControl: false }, next);
});
app.get('/image-studio/:filename', (req, res, next) => {
  const filename = path.basename(req.params.filename);
  if (filename !== req.params.filename || !IMAGE_STUDIO_FILES.has(filename)) return next();
  res.setHeader('Cache-Control', PUBLIC_STATIC_CACHE_CONTROL);
  return res.sendFile(path.join(__dirname, 'image-studio', filename), { cacheControl: false }, next);
});
app.get('/frontend/:filename', (req, res, next) => {
  const filename = path.basename(req.params.filename);
  if (filename !== req.params.filename || !FRONTEND_FILES.has(filename)) return next();
  res.setHeader('Cache-Control', PUBLIC_STATIC_CACHE_CONTROL);
  return res.sendFile(path.join(__dirname, 'frontend', filename), { cacheControl: false }, next);
});
app.get('/admin/:filename', (req, res, next) => {
  const filename = path.basename(req.params.filename);
  if (filename !== req.params.filename || !ADMIN_FILES.has(filename)) return next();
  res.setHeader('Cache-Control', PUBLIC_STATIC_CACHE_CONTROL);
  return res.sendFile(path.join(__dirname, 'admin', filename), { cacheControl: false }, next);
});

const limiterMessage = { error: '请求过于频繁，请稍后再试' };
const imageLimiter = rateLimit({ windowMs: 60000, max: 60, message: limiterMessage });
const copyLimiter = rateLimit({ windowMs: 60000, max: 60, message: limiterMessage });
const authLimiter = rateLimit({ windowMs: 60000, max: 20, message: limiterMessage });
const adminLimiter = rateLimit({ windowMs: 60000, max: 60, message: limiterMessage });
const xiImageLimiter = rateLimit({
  windowMs: 60000,
  max: Number(process.env.XI_XU_IMAGE_RATE_LIMIT_PER_MIN || 30),
  message: { error: 'gpt-image-2 生图请求过于频繁，请降低并发或稍后再试' }
});
const configuredUploadImageMb = Number(process.env.MAX_UPLOAD_IMAGE_MB || 20);
const maxUploadImageMb = Number.isFinite(configuredUploadImageMb) ? Math.max(configuredUploadImageMb, 1) : 20;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadImageMb * 1024 * 1024,
    files: 4,
    fields: 20,
    parts: 24,
    fieldNameSize: 100,
    fieldSize: 100 * 1024
  },
  fileFilter: (req, file, callback) => {
    if (isAllowedUploadMime(file.mimetype)) callback(null, true);
    else callback(new Error('只允许图片文件'), false);
  }
});

const provider = createXiImageProvider();
const xiRuntime = createXiJobRuntime({ db, provider, refundPoints, formatDateTime: formatBeijingDateTime });

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);
app.use(createUploadRouter({
  authMiddleware,
  canUserAccessUpload: (userId, filename) => xiRuntime.manager.canUserAccessUpload(userId, filename)
}));
app.use(createGenerationRouter({
  imageLimiter,
  copyLimiter,
  authMiddleware,
  upload,
  validateUploadedImageFiles,
  sanitizeInput,
  normalizeClientTaskId,
  parseImageCount,
  sizeMap: SIZE_MAP,
  getRequiredEnv,
  generateArkImageUrls,
  formatUpstreamError,
  arkImageBaseUrl: ARK_IMAGE_BASE_URL,
  buildImageVariationPrompt
}));
app.use(createTemplateRouter({ authMiddleware }));
app.use(createPublicInfoRouter({ optionalAuth }));
app.use(createXiJobsRouter({
  authMiddleware,
  xiImageLimiter,
  upload,
  validateUploadedImageFiles,
  manager: xiRuntime.manager,
  chargePoints,
  refundPoints,
  fixedQuality: provider.fixedQuality
}));
app.use(createXiImageRouter({
  authMiddleware,
  xiImageLimiter,
  upload,
  validateUploadedImageFiles,
  db,
  provider,
  chargePoints,
  refundPoints
}));
app.use(createAmazonImageRouter({
  authMiddleware,
  imageLimiter,
  upload,
  validateUploadedImageFiles,
  db,
  chargePoints,
  refundPoints,
  arkImageBaseUrl: ARK_IMAGE_BASE_URL
}));
app.use(createReversePromptRouter({
  authMiddleware,
  copyLimiter,
  upload,
  validateUploadedImageFiles,
  db,
  chargePoints,
  refundPoints
}));
app.use(createPaymentRouter({ authMiddleware, safeCompareSecret }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `图片文件太大，请上传 ${maxUploadImageMb}MB 以内的图片` });
  if (error.code === 'LIMIT_UNEXPECTED_FILE' || error.message === 'Unexpected field') return res.status(400).json({ error: '上传字段不正确' });
  if (error.message === '只允许图片文件') return res.status(400).json({ error: error.message });
  if (error.statusCode) return res.status(error.statusCode).json({ error: error.message || '请求处理失败' });
  console.error('服务器错误:', error.message || error);
  return res.status(500).json({ error: '服务器内部错误' });
});

if (require.main === module) {
  xiRuntime.initializeRecovery();
  const port = process.env.PORT || 3001;
  const host = process.env.HOST || '127.0.0.1';
  app.listen(port, host, () => {
    console.log(`服务已启动：http://${host}:${port}`);
    console.log('Administrator account is ready.');
  });
}

module.exports = app;
