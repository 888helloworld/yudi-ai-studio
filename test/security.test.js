const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeExternalUrl, downloadAndSaveImage } = require('../utils/image-storage');

test('外部图片下载拒绝本机、内网和保留地址', async () => {
  await assert.rejects(assertSafeExternalUrl('http://127.0.0.1/a.png'), /禁止下载内网/);
  await assert.rejects(assertSafeExternalUrl('http://10.0.0.1/a.png'), /禁止下载内网/);
  await assert.rejects(assertSafeExternalUrl('http://192.168.1.1/a.png'), /禁止下载内网/);
  await assert.rejects(assertSafeExternalUrl('http://[::1]/a.png'), /禁止下载内网/);
  await assert.rejects(assertSafeExternalUrl('file:///etc/passwd'), /仅允许 http\/https/);
  await assert.rejects(downloadAndSaveImage('http://127.0.0.1/a.png', 'security-test'), /禁止下载内网/);
});
