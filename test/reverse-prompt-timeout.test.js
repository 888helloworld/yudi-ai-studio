const test = require('node:test');
const assert = require('node:assert/strict');
const { getVisionTimeoutMs } = require('../routes/reverse-prompt');

test('反推超时默认 3 分钟，并限制在 30 秒到 10 分钟', () => {
  const original = process.env.XI_XU_VISION_TIMEOUT_MS;
  try {
    delete process.env.XI_XU_VISION_TIMEOUT_MS;
    assert.equal(getVisionTimeoutMs(), 180000);

    process.env.XI_XU_VISION_TIMEOUT_MS = '1000';
    assert.equal(getVisionTimeoutMs(), 30000);

    process.env.XI_XU_VISION_TIMEOUT_MS = '240000';
    assert.equal(getVisionTimeoutMs(), 240000);

    process.env.XI_XU_VISION_TIMEOUT_MS = '999999';
    assert.equal(getVisionTimeoutMs(), 600000);

    process.env.XI_XU_VISION_TIMEOUT_MS = 'invalid';
    assert.equal(getVisionTimeoutMs(), 180000);
  } finally {
    if (original === undefined) delete process.env.XI_XU_VISION_TIMEOUT_MS;
    else process.env.XI_XU_VISION_TIMEOUT_MS = original;
  }
});
