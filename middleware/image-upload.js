const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif'
]);

function normalizeMimeType(mimeType) {
  return String(mimeType || '').toLowerCase().split(';')[0].trim();
}

function isAllowedUploadMime(mimeType) {
  return ALLOWED_UPLOAD_MIME_TYPES.has(normalizeMimeType(mimeType));
}

function readPositiveEnvNumber(name, fallback, minimum) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(parsed, minimum) : fallback;
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

function collectUploadedFiles(req) {
  const files = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  if (req.files && !Array.isArray(req.files) && typeof req.files === 'object') {
    Object.values(req.files).forEach((value) => {
      if (Array.isArray(value)) files.push(...value);
    });
  }
  return files;
}

function validateUploadedImageFiles(req, res, next) {
  const files = collectUploadedFiles(req);
  const maxTotalBytes = readPositiveEnvNumber('MAX_UPLOAD_TOTAL_MB', 40, 1) * 1024 * 1024;
  const maxPixelsPerImage = readPositiveEnvNumber('MAX_UPLOAD_PIXELS', 16000000, 1000000);
  const maxTotalPixels = Math.max(maxPixelsPerImage, readPositiveEnvNumber('MAX_UPLOAD_TOTAL_PIXELS', 24000000, maxPixelsPerImage));
  const totalBytes = files.reduce((sum, file) => sum + (file.buffer?.length || 0), 0);
  if (totalBytes > maxTotalBytes) return res.status(400).json({ error: '本次上传图片总大小过大，请减少图片数量或压缩后重试' });

  let totalPixels = 0;
  for (const file of files) {
    const declaredMime = normalizeMimeType(file.mimetype);
    const detectedMime = sniffImageMime(file.buffer);
    if (!detectedMime) return res.status(400).json({ error: '上传文件不是有效图片' });
    if (declaredMime === 'image/jpg') file.mimetype = 'image/jpeg';
    if (normalizeMimeType(file.mimetype) !== detectedMime) {
      return res.status(400).json({ error: '上传图片格式与文件内容不一致' });
    }
    const dimensions = getImageDimensionsFromBuffer(file.buffer);
    if (!dimensions) return res.status(400).json({ error: '无法读取上传图片尺寸，文件可能已损坏' });
    const pixels = dimensions.width * dimensions.height;
    if (!Number.isSafeInteger(pixels) || pixels > maxPixelsPerImage || dimensions.width > 8192 || dimensions.height > 8192) {
      return res.status(400).json({ error: '上传图片像素尺寸过大，请缩小图片后重试' });
    }
    totalPixels += pixels;
    if (totalPixels > maxTotalPixels) return res.status(400).json({ error: '本次上传图片总像素过大，请减少图片数量或缩小图片' });
  }
  next();
}

module.exports = {
  isAllowedUploadMime,
  normalizeMimeType,
  sniffImageMime,
  validateUploadedImageFiles
};
const { getImageDimensionsFromBuffer } = require('../utils/image-storage');
