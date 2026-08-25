const fs = require('fs');
const {
  downloadAndSaveImage,
  getImageDimensionsFromBuffer,
  getLocalUploadPath,
  saveDataUrlImage
} = require('../utils/image-storage');
const { getSourceImageFilename } = require('./prompt-service');

function assertSavedImageDimensions(localUrls, expectedSize) {
  if (!expectedSize) return;
  const [expectedWidth, expectedHeight] = expectedSize.split('x').map(Number);
  for (const url of localUrls) {
    const filepath = getLocalUploadPath(url);
    if (!filepath || !fs.existsSync(filepath)) continue;
    const dimensions = getImageDimensionsFromBuffer(fs.readFileSync(filepath));
    if (dimensions && (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight)) {
      const error = new Error(`上游返回尺寸 ${dimensions.size}，与请求尺寸 ${expectedSize} 不一致，已停止交付`);
      error.statusCode = 502;
      throw error;
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
