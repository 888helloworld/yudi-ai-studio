const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAllowedUploadMime,
  sniffImageMime,
  validateUploadedImageFiles
} = require('../middleware/image-upload');

test('上传图片按魔数识别，并拒绝声明格式与内容不一致', () => {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(100, 16);
  png.writeUInt32BE(100, 20);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webp = Buffer.from('RIFF0000WEBP', 'ascii');
  const gif = Buffer.from('GIF89a000000', 'ascii');

  assert.equal(sniffImageMime(png), 'image/png');
  assert.equal(sniffImageMime(jpeg), 'image/jpeg');
  assert.equal(sniffImageMime(webp), 'image/webp');
  assert.equal(sniffImageMime(gif), 'image/gif');
  assert.equal(sniffImageMime(Buffer.from('not-an-image')), null);
  assert.equal(isAllowedUploadMime('image/png'), true);
  assert.equal(isAllowedUploadMime('text/plain'), false);

  let nextCalled = false;
  const validRequest = { file: { mimetype: 'image/png', buffer: png } };
  validateUploadedImageFiles(validRequest, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  let statusCode = 0;
  let responseBody = null;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    }
  };
  validateUploadedImageFiles(
    { file: { mimetype: 'image/jpeg', buffer: png } },
    response,
    () => assert.fail('格式不一致时不应继续执行')
  );
  assert.equal(statusCode, 400);
  assert.match(responseBody.error, /格式与文件内容不一致/);

  const pixelBomb = Buffer.from(png);
  pixelBomb.writeUInt32BE(8192, 16);
  pixelBomb.writeUInt32BE(8192, 20);
  statusCode = 0;
  responseBody = null;
  validateUploadedImageFiles(
    { file: { mimetype: 'image/png', buffer: pixelBomb } },
    response,
    () => assert.fail('超大像素图片不应继续执行')
  );
  assert.equal(statusCode, 400);
  assert.match(responseBody.error, /像素尺寸过大/);
});
