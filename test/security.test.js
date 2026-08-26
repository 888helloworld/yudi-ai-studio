const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertSafeExternalUrl, downloadAndSaveImage, getLocalUploadPath, saveDataUrlImage } = require('../utils/image-storage');

test('外部图片下载拒绝本机、内网和保留地址', async () => {
  await assert.rejects(assertSafeExternalUrl('http://127.0.0.1/a.png'), /禁止下载内网/);
  await assert.rejects(assertSafeExternalUrl('http://10.0.0.1/a.png'), /禁止下载内网/);
  await assert.rejects(assertSafeExternalUrl('http://192.168.1.1/a.png'), /禁止下载内网/);
  await assert.rejects(assertSafeExternalUrl('http://[::1]/a.png'), /禁止下载内网/);
  await assert.rejects(assertSafeExternalUrl('file:///etc/passwd'), /仅允许 http\/https/);
  await assert.rejects(downloadAndSaveImage('http://127.0.0.1/a.png', 'security-test'), /禁止下载内网/);
});

test('上游 data URL 必须通过 MIME 魔数和尺寸校验', () => {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(100, 16);
  png.writeUInt32BE(100, 20);
  const encoded = png.toString('base64');

  assert.equal(saveDataUrlImage(`data:image/jpeg;base64,${encoded}`, 'security-mismatch'), null);
  assert.equal(saveDataUrlImage('data:image/png;base64,bm90LWEtcmVhbC1pbWFnZQ==', 'security-invalid'), null);

  const savedUrl = saveDataUrlImage(`data:image/png;base64,${encoded}`, 'security-valid');
  assert.match(savedUrl, /^\/uploads\/security-valid_/);
  const filepath = getLocalUploadPath(savedUrl);
  assert.equal(path.extname(filepath), '.png');
  fs.unlinkSync(filepath);
});
