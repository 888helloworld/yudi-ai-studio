const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PNG } = require('pngjs');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_SAVED_IMAGE_BYTES = 80 * 1024 * 1024;
const MAX_THUMBNAIL_SOURCE_BYTES = 25 * 1024 * 1024;
const IMAGE_THUMBNAIL_MAX_SIDE = 480;

function isInternalHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host === '::1' || host === '::' || host === '0.0.0.0') return true;
  if (host.endsWith('.localhost')) return true;
  if (host.startsWith('127.')) return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  if (host.startsWith('169.254.')) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (/^(fc|fd|fe8|fe9|fea|feb)/.test(host)) return true;
  return false;
}

function assertSafeExternalUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('图片地址格式无效');
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('仅允许 http/https 图片地址');
  }
  if (isInternalHost(parsed.hostname)) {
    throw new Error('禁止下载内网图片地址');
  }
}

async function downloadAndSaveImage(url, prefix) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    assertSafeExternalUrl(url);
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`下载失败: ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) throw new Error('下载内容不是图片');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_SAVED_IMAGE_BYTES) throw new Error('图片文件过大');
    const ext = url.includes('.jpg') || url.includes('jpeg') ? '.jpg' : '.png';
    const filename = `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filepath, buffer);
    return `/uploads/${filename}`;
  } catch (err) {
    console.error('图片下载失败:', err.message);
    return url;
  } finally {
    clearTimeout(timeout);
  }
}

function getImageExtension(mimeType, fallback = '.png') {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/gif') return '.gif';
  return fallback;
}

function saveDataUrlImage(dataUrl, prefix) {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) return null;
  const mimeType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_SAVED_IMAGE_BYTES) return null;
  const ext = getImageExtension(mimeType);
  const filename = `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  return `/uploads/${filename}`;
}

function getLocalUploadPath(url) {
  const match = String(url || '').match(/^\/uploads\/([^/?#]+)$/);
  if (!match) return null;
  const filename = path.basename(match[1]);
  return path.join(UPLOAD_DIR, filename);
}

function resizePngToMaxSide(source, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const targetWidth = Math.max(1, Math.round(source.width * scale));
  const targetHeight = Math.max(1, Math.round(source.height * scale));
  if (targetWidth === source.width && targetHeight === source.height) return source;

  const target = new PNG({ width: targetWidth, height: targetHeight });
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor(y / scale));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor(x / scale));
      const sourceIndex = (sourceY * source.width + sourceX) * 4;
      const targetIndex = (y * targetWidth + x) * 4;
      target.data[targetIndex] = source.data[sourceIndex];
      target.data[targetIndex + 1] = source.data[sourceIndex + 1];
      target.data[targetIndex + 2] = source.data[sourceIndex + 2];
      target.data[targetIndex + 3] = source.data[sourceIndex + 3];
    }
  }
  return target;
}

function ensureImageThumbnail(filepath) {
  const thumbnailPath = `${filepath}.thumb.png`;
  if (fs.existsSync(thumbnailPath)) return thumbnailPath;

  try {
    const stats = fs.statSync(filepath);
    if (stats.size > MAX_THUMBNAIL_SOURCE_BYTES) return null;
    const source = PNG.sync.read(fs.readFileSync(filepath));
    if (source.width <= IMAGE_THUMBNAIL_MAX_SIDE && source.height <= IMAGE_THUMBNAIL_MAX_SIDE) {
      return filepath;
    }
    const thumbnail = resizePngToMaxSide(source, IMAGE_THUMBNAIL_MAX_SIDE);
    fs.writeFileSync(thumbnailPath, PNG.sync.write(thumbnail, { colorType: 6 }));
    return thumbnailPath;
  } catch {
    return null;
  }
}

function getJpegDimensionsFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height, size: `${width}x${height}` };
    }
    offset += 2 + length;
  }
  return null;
}

function getWebpDimensionsFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && buffer.length >= 30) {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { width, height, size: `${width}x${height}` };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return { width, height, size: `${width}x${height}` };
  }
  if (chunk === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height, size: `${width}x${height}` };
  }
  return null;
}

function getImageDimensionsFromBuffer(buffer) {
  try {
    const png = PNG.sync.read(buffer);
    return { width: png.width, height: png.height, size: `${png.width}x${png.height}` };
  } catch {
    return getJpegDimensionsFromBuffer(buffer) || getWebpDimensionsFromBuffer(buffer);
  }
}

function getLocalImageDimensions(localUrls) {
  return (localUrls || []).map((url) => {
    const filepath = getLocalUploadPath(url);
    if (!filepath || !fs.existsSync(filepath)) return null;
    return getImageDimensionsFromBuffer(fs.readFileSync(filepath));
  });
}

function getUploadedImageDimensions(files) {
  return (files || []).map((file) => getImageDimensionsFromBuffer(file.buffer));
}

function saveUploadedSourceImages(files, prefix = 'xixu_source') {
  return (files || []).map((file, index) => {
    const ext = getImageExtension(file.mimetype, '.bin').replace(/^\./, '');
    const filename = `${prefix}_${Date.now()}_${index + 1}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filepath, file.buffer);
    setImmediate(() => ensureImageThumbnail(filepath));
    return `/uploads/${filename}`;
  });
}

module.exports = {
  UPLOAD_DIR,
  assertSafeExternalUrl,
  downloadAndSaveImage,
  ensureImageThumbnail,
  getImageDimensionsFromBuffer,
  getImageExtension,
  getLocalImageDimensions,
  getLocalUploadPath,
  getUploadedImageDimensions,
  saveDataUrlImage,
  saveUploadedSourceImages
};
