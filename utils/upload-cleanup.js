const fs = require('fs');
const path = require('path');
const { db } = require('../database');
const { UPLOAD_DIR } = require('./image-storage');

function extractUploadFilenames(...values) {
  const filenames = new Set();
  const pattern = /\/uploads\/([^"'?#\\/\s]+)/g;
  for (const value of values.flat(Infinity)) {
    const text = String(value || '');
    let match;
    while ((match = pattern.exec(text))) filenames.add(path.basename(match[1]));
  }
  return [...filenames];
}

function deleteUnreferencedUploads(filenames) {
  const deleted = [];
  for (const filename of new Set(filenames || [])) {
    if (!filename || filename !== path.basename(filename)) continue;
    const needle = `%/uploads/${filename}%`;
    const referenced = db.prepare('SELECT id FROM history WHERE image_url LIKE ? OR content LIKE ? LIMIT 1').get(needle, needle);
    if (referenced) continue;
    for (const candidate of [path.join(UPLOAD_DIR, filename), path.join(UPLOAD_DIR, `${filename}.thumb.png`)]) {
      try {
        if (fs.existsSync(candidate)) {
          fs.unlinkSync(candidate);
          deleted.push(candidate);
        }
      } catch (error) {
        console.error('删除无引用图片失败:', error.message || error);
      }
    }
  }
  return deleted;
}

module.exports = { deleteUnreferencedUploads, extractUploadFilenames };
