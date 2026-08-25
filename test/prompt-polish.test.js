const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPromptPolishInstruction, compactPromptText, normalizePromptPolishResult } = require('../services/prompt-polish-service');
const { getPromptPolishTimeoutMs } = require('../routes/prompt-polish');

test('视觉润色指令包含参考图顺序、画布和用户要求', () => {
  const instruction = buildPromptPolishInstruction({ prompt: '图1产品放进图2场景', size: '1024x1536', imageCount: 2 });
  assert.match(instruction, /图1到图2/);
  assert.match(instruction, /1024x1536/);
  assert.match(instruction, /图1产品放进图2场景/);
  assert.match(instruction, /用户明确要求优先级最高/);
  assert.match(instruction, /1-3 句/);
  assert.match(instruction, /80-220/);
  assert.match(instruction, /不要默认把所有图片内容混在一起/);
});

test('视觉润色结果限制在 500 字，并优先在完整句子处结束', () => {
  const longPrompt = `${'这是需要保留的有效要求，'.repeat(24)}这里是第一段结束。${'后续重复内容，'.repeat(40)}`;
  const compact = compactPromptText(longPrompt);
  assert.equal(compact.length <= 500, true);
  assert.match(compact, /。$/);
});

test('视觉润色结果会规范为前端需要的字段', () => {
  const result = normalizePromptPolishResult('```json\n{"polished_prompt":"最终提示词","visual_understanding":["图1：产品"],"changes":["补充光线"],"warning":""}\n```');
  assert.deepEqual(result, {
    polishedPrompt: '最终提示词',
    visualUnderstanding: ['图1：产品'],
    changes: ['补充光线'],
    warning: ''
  });
});

test('视觉润色超时沿用识图配置并限制范围', () => {
  const original = process.env.XI_XU_VISION_TIMEOUT_MS;
  try {
    delete process.env.XI_XU_VISION_TIMEOUT_MS;
    assert.equal(getPromptPolishTimeoutMs(), 180000);
    process.env.XI_XU_VISION_TIMEOUT_MS = '1000';
    assert.equal(getPromptPolishTimeoutMs(), 30000);
    process.env.XI_XU_VISION_TIMEOUT_MS = '999999';
    assert.equal(getPromptPolishTimeoutMs(), 600000);
  } finally {
    if (original === undefined) delete process.env.XI_XU_VISION_TIMEOUT_MS;
    else process.env.XI_XU_VISION_TIMEOUT_MS = original;
  }
});
