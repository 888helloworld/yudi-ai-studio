const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { Agent } = require('undici');
const { PNG } = require('pngjs');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_SAVED_IMAGE_BYTES = 80 * 1024 * 1024;
const MAX_THUMBNAIL_SOURCE_BYTES = 25 * 1024 * 1024;
const IMAGE_THUMBNAIL_MAX_SIDE = 480;

const privateAddressBlockList = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]
].forEach(([address, prefix]) => privateAddressBlockList.addSubnet(address, prefix, 'ipv4'));
[
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['2001:db8::', 32]
].forEach(([address, prefix]) => privateAddressBlockList.addSubnet(address, prefix, 'ipv6'));

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

function isPrivateIpAddress(address) {
  const family = net.isIP(address);
  if (!family) return true;
  if (family === 4) return privateAddressBlockList.check(address, 'ipv4');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return privateAddressBlockList.check(mapped[1], 'ipv4');
  return privateAddressBlockList.check(address, 'ipv6');
}

async function assertSafeExternalUrl(rawUrl) {
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
  const addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIpAddress(entry.address))) {
    throw new Error('图片地址解析到了内网或保留地址');
  }
  const selected = addresses[0];
  return { parsed, address: selected.address, family: selected.family };
}

async function fetchExternalImage(url, signal) {
  let currentUrl = String(url || '');
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const resolved = await assertSafeExternalUrl(currentUrl);
    const dispatcher = new Agent({
      connect: {
        lookup(hostname, options, callback) {
          callback(null, resolved.address, resolved.family);
        }
      }
    });
    let response;
    try {
      response = await fetch(currentUrl, { signal, redirect: 'manual', dispatcher });
    } catch (error) {
      await dispatcher.close().catch(() => {});
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      try {
        const location = response.headers.get('location');
        if (!location) throw new Error('图片下载跳转地址缺失');
        if (redirects >= 5) throw new Error('图片下载跳转次数过多');
        currentUrl = new URL(location, currentUrl).href;
      } finally {
        try { await response.body?.cancel(); } catch {}
        await dispatcher.close().catch(() => {});
      }
      continue;
    }
    return { response, finalUrl: currentUrl, dispatcher };
  }
  throw new Error('图片下载跳转次数过多');
}

async function readResponseWithLimit(response, maximumBytes) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maximumBytes) throw new Error('图片文件过大');
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maximumBytes) throw new Error('图片文件过大');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

async function downloadAndSaveImage(url, prefix) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const { response, dispatcher } = await fetchExternalImage(url, controller.signal);
    try {
      if (!response.ok) throw new Error(`下载失败: ${response.status}`);
      const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('image/')) throw new Error('下载内容不是图片');
      const buffer = await readResponseWithLimit(response, MAX_SAVED_IMAGE_BYTES);
      const detectedMime = detectImageMime(buffer);
      if (!detectedMime || (contentType !== 'image/jpg' && contentType !== detectedMime)) throw new Error('下载图片格式与内容不一致');
      const dimensions = getImageDimensionsFromBuffer(buffer);
      const maximumPixels = Math.max(1000000, Number(process.env.MAX_SAVED_IMAGE_PIXELS || 24000000) || 24000000);
      const pixels = dimensions ? dimensions.width * dimensions.height : 0;
      if (!dimensions || !Number.isSafeInteger(pixels) || pixels > maximumPixels || dimensions.width > 8192 || dimensions.height > 8192) {
        throw new Error('下载图片尺寸无效或过大');
      }
      const ext = getImageExtension(detectedMime);
      const filename = `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`;
      const filepath = path.join(UPLOAD_DIR, filename);
      fs.writeFileSync(filepath, buffer);
      return `/uploads/${filename}`;
    } finally {
      await dispatcher.close().catch(() => {});
    }
  } catch (err) {
    console.error('图片下载失败:', err.message);
    throw err;
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

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function saveDataUrlImage(dataUrl, prefix) {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) return null;
  const declaredMime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const encoded = match[2].replace(/\s+/g, '');
  if (!encoded || encoded.length % 4 !== 0 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded)) return null;
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > MAX_SAVED_IMAGE_BYTES) return null;
  const detectedMime = detectImageMime(buffer);
  if (!detectedMime || detectedMime !== declaredMime) return null;
  const dimensions = getImageDimensionsFromBuffer(buffer);
  const configuredMaximumPixels = Number(process.env.MAX_SAVED_IMAGE_PIXELS || 24000000);
  const maximumPixels = Number.isFinite(configuredMaximumPixels)
    ? Math.max(1000000, configuredMaximumPixels)
    : 24000000;
  const pixels = dimensions ? dimensions.width * dimensions.height : 0;
  if (!dimensions || !Number.isSafeInteger(pixels) || pixels > maximumPixels || dimensions.width > 8192 || dimensions.height > 8192) return null;
  const ext = getImageExtension(detectedMime);
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
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) return null;
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height, size: `${width}x${height}` } : null;
  }
  const gifHeader = buffer.subarray(0, 6).toString('ascii');
  if ((gifHeader === 'GIF87a' || gifHeader === 'GIF89a') && buffer.length >= 10) {
    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);
    return width > 0 && height > 0 ? { width, height, size: `${width}x${height}` } : null;
  }
  return getJpegDimensionsFromBuffer(buffer) || getWebpDimensionsFromBuffer(buffer);
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
