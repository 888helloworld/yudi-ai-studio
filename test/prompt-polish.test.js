const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPromptPolishInstruction, compactPromptText, normalizePromptPolishResult } = require('../services/prompt-polish-service');
const {
  DEFAULT_DEEPSEEK_VISION_MODEL,
  buildDeepSeekVisionRequest,
  formatPromptPolishError,
  getDeepSeekChoiceMetadata,
  getDeepSeekChatUrl,
  getPromptPolishTimeoutMs,
  shouldRetryPromptPolish
} = require('../routes/prompt-polish');

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

test('视觉润色使用 DeepSeek 视觉模型，图片只出现在 user 消息', () => {
  const request = buildDeepSeekVisionRequest({
    prompt: '保留产品，换成雨夜街景',
    size: '1024x1536',
    files: [{ mimetype: 'image/png', buffer: Buffer.from('image') }]
  });
  assert.equal(request.model, DEFAULT_DEEPSEEK_VISION_MODEL);
  assert.equal(request.messages[0].role, 'system');
  assert.equal(typeof request.messages[0].content, 'string');
  assert.equal(request.messages[1].role, 'user');
  assert.equal(request.messages[1].content[1].type, 'image_url');
  assert.equal(request.messages[1].content[1].image_url.detail, 'original');
  assert.match(request.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.deepEqual(request.thinking, { type: 'disabled' });
  assert.equal(request.max_tokens, 4096);
});

test('视觉润色在模型输出被截断或正文无效时重试', () => {
  const truncated = {
    choices: [{ finish_reason: 'length', message: { content: '{"polished_prompt":', reasoning_content: '思考过程' } }]
  };
  assert.deepEqual(getDeepSeekChoiceMetadata(truncated), {
    finishReason: 'length',
    contentLength: 19,
    reasoningLength: 4
  });
  assert.equal(shouldRetryPromptPolish(truncated, null), true);
  assert.equal(shouldRetryPromptPolish({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }, { polishedPrompt: '完成' }), false);
});

test('视觉润色连接错误不会误报生图积分退款', () => {
  const message = formatPromptPolishError('fetch failed');
  assert.match(message, /DeepSeek/);
  assert.doesNotMatch(message, /生成图片|积分已退回/);
});

test('视觉润色使用 DeepSeek 官方兼容端点', () => {
  const original = process.env.DEEPSEEK_API_BASE_URL;
  try {
    delete process.env.DEEPSEEK_API_BASE_URL;
    assert.equal(getDeepSeekChatUrl(), 'https://api.deepseek.com/chat/completions');
    process.env.DEEPSEEK_API_BASE_URL = 'https://example.com/v1/';
    assert.equal(getDeepSeekChatUrl(), 'https://example.com/v1/chat/completions');
  } finally {
    if (original === undefined) delete process.env.DEEPSEEK_API_BASE_URL;
    else process.env.DEEPSEEK_API_BASE_URL = original;
  }
});

test('视觉润色超时使用 DeepSeek 配置并限制范围', () => {
  const originalVision = process.env.DEEPSEEK_VISION_TIMEOUT_MS;
  const originalText = process.env.DEEPSEEK_TIMEOUT_MS;
  try {
    delete process.env.DEEPSEEK_VISION_TIMEOUT_MS;
    delete process.env.DEEPSEEK_TIMEOUT_MS;
    assert.equal(getPromptPolishTimeoutMs(), 180000);
    process.env.DEEPSEEK_VISION_TIMEOUT_MS = '1000';
    assert.equal(getPromptPolishTimeoutMs(), 30000);
    process.env.DEEPSEEK_VISION_TIMEOUT_MS = '999999';
    assert.equal(getPromptPolishTimeoutMs(), 600000);
  } finally {
    if (originalVision === undefined) delete process.env.DEEPSEEK_VISION_TIMEOUT_MS;
    else process.env.DEEPSEEK_VISION_TIMEOUT_MS = originalVision;
    if (originalText === undefined) delete process.env.DEEPSEEK_TIMEOUT_MS;
    else process.env.DEEPSEEK_TIMEOUT_MS = originalText;
  }
});
