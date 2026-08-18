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
      ? (saveDataUrlImage(url, `${prefix}_${index + 1}`) || url)
      : downloadAndSaveImage(url, `${prefix}_${index + 1}`)
  )));
  if (/^true$/i.test(process.env.XI_XU_NORMALIZE_OUTPUT_SIZE || '')) {
    normalizeSavedImageDimensions(saved, expectedSize);
  }
  assertSavedImageDimensions(saved, expectedSize);
  return saved;
}

function drawFilledRect(png, x, y, width, height, rgba) {
  const [red, green, blue, alpha] = rgba;
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(png.width, Math.ceil(x + width));
  const endY = Math.min(png.height, Math.ceil(y + height));
  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      const index = (py * png.width + px) * 4;
      png.data[index] = red;
      png.data[index + 1] = green;
      png.data[index + 2] = blue;
      png.data[index + 3] = alpha;
    }
  }
}

function drawNumberBadge(png, x, y, number) {
  const digits = {
    1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
    3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'],
    5: ['111', '100', '111', '001', '111'], 6: ['111', '100', '111', '101', '111']
  };
  const pattern = digits[String(number)] || digits[1];
  const scale = 7;
  drawFilledRect(png, x, y, 34, 44, [20, 20, 20, 255]);
  pattern.forEach((row, rowIndex) => {
    [...row].forEach((cell, columnIndex) => {
      if (cell === '1') drawFilledRect(png, x + 7 + columnIndex * scale, y + 5 + rowIndex * scale, scale - 1, scale - 1, [255, 255, 255, 255]);
    });
  });
}

function pasteResizedImage(target, source, destX, destY, destWidth, destHeight) {
  for (let y = 0; y < destHeight; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor((y / destHeight) * source.height));
    for (let x = 0; x < destWidth; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x / destWidth) * source.width));
      const sourceIndex = (sourceY * source.width + sourceX) * 4;
      const targetIndex = ((destY + y) * target.width + destX + x) * 4;
      const alpha = source.data[sourceIndex + 3] / 255;
      target.data[targetIndex] = Math.round(source.data[sourceIndex] * alpha + target.data[targetIndex] * (1 - alpha));
      target.data[targetIndex + 1] = Math.round(source.data[sourceIndex + 1] * alpha + target.data[targetIndex + 1] * (1 - alpha));
      target.data[targetIndex + 2] = Math.round(source.data[sourceIndex + 2] * alpha + target.data[targetIndex + 2] * (1 - alpha));
      target.data[targetIndex + 3] = 255;
    }
  }
}

function createReferenceBoardFile(sourceFiles = []) {
  const images = sourceFiles.map((file, index) => ({
    labelNumber: Number((/图\s*([1-4])/i.exec(String(file?.originalname || '')) || [])[1]) || index + 1,
    image: PNG.sync.read(file.buffer)
  }));
  if (images.length <= 1) throw new Error('参考板至少需要两张参考图');
  const columns = images.length <= 2 ? images.length : 3;
  const rows = Math.ceil(images.length / columns);
  const cell = 512;
  const padding = 24;
  const board = new PNG({ width: columns * cell, height: rows * cell });
  drawFilledRect(board, 0, 0, board.width, board.height, [246, 246, 242, 255]);
  images.forEach(({ image, labelNumber }, index) => {
    const cellX = (index % columns) * cell;
    const cellY = Math.floor(index / columns) * cell;
    const scale = Math.min((cell - padding * 2) / image.width, (cell - padding * 2) / image.height);
    const destWidth = Math.max(1, Math.round(image.width * scale));
    const destHeight = Math.max(1, Math.round(image.height * scale));
    const destX = cellX + Math.round((cell - destWidth) / 2);
    const destY = cellY + Math.round((cell - destHeight) / 2);
    pasteResizedImage(board, image, destX, destY, destWidth, destHeight);
    drawNumberBadge(board, cellX + 14, cellY + 14, labelNumber);
  });
  return {
    buffer: PNG.sync.write(board, { colorType: 6 }),
    mimetype: 'image/png',
    originalname: `reference_board_${images.length}.png`,
    isReferenceBoard: true,
    boardSourceCount: images.length
  };
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

module.exports = {
  createReferenceBoardFile,
  saveXiXuImages,
  summarizeImageFiles
};
