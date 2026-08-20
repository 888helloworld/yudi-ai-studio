const fs = require('fs');
const { PNG } = require('pngjs');
const {
  downloadAndSaveImage,
  getImageDimensionsFromBuffer,
  getLocalUploadPath,
  saveDataUrlImage
} = require('../utils/image-storage');
const { getSourceImageFilename } = require('./prompt-service');
const { isExplicitXiImageSizeSupported } = require('./xi-image-size');

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
        [x0, y0, (1 - wx) * (1 - wy)], [x1, y0, wx * (1 - wy)],
        [x0, y1, (1 - wx) * wy], [x1, y1, wx * wy]
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
    try { png = PNG.sync.read(fs.readFileSync(filepath)); } catch { continue; }
    if (png.width === expectedWidth && png.height === expectedHeight) continue;
    const normalized = resizePngContainOnWhite(png, expectedWidth, expectedHeight);
    fs.writeFileSync(filepath, PNG.sync.write(normalized, { colorType: 6 }));
    console.warn('上游返回图片尺寸不匹配，已自动规整到请求尺寸:', JSON.stringify({
      url, expectedSize, upstreamSize: `${png.width}x${png.height}`
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
    if (dimensions && (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight)) {
      console.warn('上游返回图片尺寸不匹配，已保留原图继续返回:', JSON.stringify({
        url, expectedSize, actualSize: dimensions.size
      }));
    }
  }
}

async function saveXiXuImages(imageUrls, prefix, expectedSize = '') {
  const saved = await Promise.all(imageUrls.map(async (url, index) => (
    String(url).startsWith('data:image/')
      ? saveDataUrlImage(url, `${prefix}_${index + 1}`)
      : downloadAndSaveImage(url, `${prefix}_${index + 1}`)
  )));
  if (saved.some((url) => !url)) throw new Error('上游图片保存失败');
  if (/^true$/i.test(process.env.XI_XU_NORMALIZE_OUTPUT_SIZE || '')) {
    normalizeSavedImageDimensions(saved, expectedSize);
  }
  assertSavedImageDimensions(saved, expectedSize);
  return saved;
}

function summarizeImageFiles(files = []) {
  return files.map((file, index) => ({
    index: index + 1,
    name: file.originalname || getSourceImageFilename(index),
    type: file.mimetype || '',
    mb: Number(((file.buffer?.length || 0) / 1024 / 1024).toFixed(2))
  }));
}

module.exports = {
  saveXiXuImages,
  summarizeImageFiles
};
