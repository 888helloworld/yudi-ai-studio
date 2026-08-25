const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertXiImageSizeSupported,
  parseXiImageSize
} = require('../services/xi-image-size');

test('图片尺寸原样解析，不再转换成其他请求尺寸', () => {
  for (const size of ['1024x1536', '1536x1024']) {
    assert.equal(parseXiImageSize(size), size);
    assert.doesNotThrow(() => assertXiImageSizeSupported(size));
  }
});

test('旧映射尺寸和任意尺寸不再进入生图链路', () => {
  for (const size of ['1254x1254', '1024x1024', '2048x1152', '1152x2048', '1672x941', '941x1672', '1280x1280']) {
    assert.equal(parseXiImageSize(size), '');
    assert.throws(() => assertXiImageSizeSupported(size), /原生支持且可严格对齐/);
  }
});
