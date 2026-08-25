const GPT_IMAGE_2_QUALITY_BASE = { low: 16, medium: 48, high: 96 };
const XI_IMAGE_MIN_DIMENSION = 16;
const XI_IMAGE_MAX_WIDTH = 3840;
const XI_IMAGE_MAX_HEIGHT = 3840;
const XI_IMAGE_MAX_AREA = 3840 * 2160;
const XI_IMAGE_NATIVE_SIZES = new Set([
  '1024x1536',
  '1536x1024'
]);

function normalizeXiQuality(value) {
  const quality = String(value || '').trim().toLowerCase();
  return ['low', 'medium', 'high'].includes(quality) ? quality : '';
}

function normalizeXiImageSizeText(size) {
  return String(size || '').trim().toLowerCase().replace(/[×＊*]/g, 'x');
}

function parseXiImageSizeDimensions(size) {
  const match = /^(\d{2,4})x(\d{2,4})$/i.exec(normalizeXiImageSizeText(size));
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function isExplicitXiImageSizeSupported(size) {
  const normalized = normalizeXiImageSizeText(size);
  if (XI_IMAGE_NATIVE_SIZES.has(normalized)) return true;
  const dimensions = parseXiImageSizeDimensions(normalized);
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
  return XI_IMAGE_NATIVE_SIZES.has(value) ? value : '';
}

function assertXiImageSizeSupported(size) {
  if (XI_IMAGE_NATIVE_SIZES.has(normalizeXiImageSizeText(size))) return;
  const error = new Error('无效的图片尺寸：当前上游原生支持且可严格对齐的尺寸只有 1024x1536 和 1536x1024');
  error.statusCode = 400;
  throw error;
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
  return map[size] || parseXiImageSizeDimensions(size) || map['1024x1024'];
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
  const usageOutputTokens = Number(data.usage?.output_tokens);
  return {
    requested_quality: requestedQuality,
    actual_quality: actualQuality,
    requested_size: requestedSize,
    actual_size: actualSize,
    billing_output_tokens: getGPTImage2OutputTokens(actualQuality, actualSize) || 0,
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

module.exports = {
  assertXiImageSizeSupported,
  extractXiXuImageMetadata,
  getGPTImage2OutputTokens,
  isExplicitXiImageSizeSupported,
  normalizeXiImageSizeText,
  normalizeXiQuality,
  parseXiImageSize,
  parseXiImageSizeDimensions,
  xiSizeToArkSize
};
