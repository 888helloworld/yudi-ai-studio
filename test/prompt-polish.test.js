const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  buildPromptPolishInstruction,
  compactPromptText,
  getUnresolvedReferenceCorrections,
  normalizePromptPolishResult
} = require('../services/prompt-polish-service');
const {
  DEFAULT_DEEPSEEK_VISION_MODEL,
  acquirePromptPolishSlot,
  buildDeepSeekVisionRequest,
  createPromptPolishRouter,
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
  assert.match(instruction, /以参考图中实际可见的特征为准/);
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
    referenceCorrections: [],
    warning: ''
  });
});

test('用户指定参考图属性时以图片实际内容为准，并静默纠正文字口误', () => {
  const instruction = buildPromptPolishInstruction({ prompt: '按图2颜色换成墨绿色袜子', size: '1024x1536', imageCount: 2 });
  assert.match(instruction, /以参考图中实际可见的特征为准/);
  assert.match(instruction, /视为可能口误/);
  assert.match(instruction, /明确表示.*才以文字覆盖参考图/);
  const result = normalizePromptPolishResult({
    polished_prompt: '将袜子替换为图2实际展示的黄色双指袜，保持其他内容不变。',
    warning: '用户文字写了墨绿色，但图2实际为黄色。',
    reference_corrections: [{ input_text: '墨绿色', reference_value: '黄色' }]
  });
  assert.equal(result.polishedPrompt, '将袜子替换为图2实际展示的黄色双指袜，保持其他内容不变。');
  assert.deepEqual(getUnresolvedReferenceCorrections(result), []);
  assert.equal(result.warning, '');
});

test('最终提示词仍保留错误图片属性时必须自动进入二次校正', () => {
  const result = normalizePromptPolishResult({
    polished_prompt: '将袜子替换为墨绿色双指袜。',
    reference_corrections: [{ input_text: '墨绿色', reference_value: '黄色' }]
  });
  const corrections = getUnresolvedReferenceCorrections(result);
  assert.deepEqual(corrections, [{ inputText: '墨绿色', referenceValue: '黄色' }]);
  assert.equal(shouldRetryPromptPolish({ choices: [{ finish_reason: 'stop' }] }, result), true);
  const retryRequest = buildDeepSeekVisionRequest({
    prompt: '按图2颜色换袜子',
    size: '1024x1536',
    files: [],
    correctionContext: corrections
  });
  assert.match(retryRequest.messages[1].content[0].text, /必须重新输出完整 JSON/);
  assert.match(retryRequest.messages[1].content[0].text, /referenceValue/);

  const corrected = normalizePromptPolishResult({
    polished_prompt: '将袜子替换为图2的黄色双指袜。',
    reference_corrections: [{
      input_text: '图2的墨绿色双指袜',
      reference_value: '图2中实际可见的袜子为黄色双指袜'
    }]
  });
  assert.deepEqual(getUnresolvedReferenceCorrections(corrected), []);
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

test('视觉润色限制单用户并发，并且释放函数幂等', () => {
  const original = process.env.PROMPT_POLISH_MAX_CONCURRENT_PER_USER;
  try {
    process.env.PROMPT_POLISH_MAX_CONCURRENT_PER_USER = '1';
    const release = acquirePromptPolishSlot(9001);
    assert.throws(() => acquirePromptPolishSlot(9001), /最多同时润色/);
    release();
    release();
    const releaseAgain = acquirePromptPolishSlot(9001);
    releaseAgain();
  } finally {
    if (original === undefined) delete process.env.PROMPT_POLISH_MAX_CONCURRENT_PER_USER;
    else process.env.PROMPT_POLISH_MAX_CONCURRENT_PER_USER = original;
  }
});

test('视觉润色成功扣费，失败自动退款', async () => {
  const originalApiKey = process.env.DEEPSEEK_API_KEY;
  const originalFetch = global.fetch;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  let charged = 0;
  let refunded = 0;
  let upstreamOk = true;
  global.fetch = async () => ({
    ok: upstreamOk,
    status: upstreamOk ? 200 : 503,
    text: async () => JSON.stringify(upstreamOk
      ? { choices: [{ finish_reason: 'stop', message: { content: '{"polished_prompt":"改为黄色双指袜","reference_corrections":[{"input_text":"墨绿色","reference_value":"黄色"}]}' } }] }
      : { error: { message: 'temporary failure' } })
  });

  const app = express();
  app.use(express.json());
  app.use(createPromptPolishRouter({
    authMiddleware: (req, res, next) => { req.userId = 42; next(); },
    copyLimiter: (req, res, next) => next(),
    upload: { array: () => (req, res, next) => { req.files = []; next(); } },
    validateUploadedImageFiles: (req, res, next) => next(),
    chargePoints: (userId, amount) => { charged += amount; },
    refundPoints: (userId, amount) => { refunded += amount; },
    getRemainingPoints: () => 995,
    pointCost: 5
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const success = await originalFetch(`${baseUrl}/api/xi-image/polish-prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '润色它' })
    });
    assert.equal(success.status, 200);
    const successBody = await success.json();
    assert.equal(successBody.remainingPoints, 995);
    assert.deepEqual(successBody.referenceCorrections, [{ inputText: '墨绿色', referenceValue: '黄色' }]);
    assert.equal(charged, 5);
    assert.equal(refunded, 0);

    upstreamOk = false;
    const failed = await originalFetch(`${baseUrl}/api/xi-image/polish-prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '再润色一次' })
    });
    assert.equal(failed.status, 502);
    assert.equal(charged, 10);
    assert.equal(refunded, 5);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalApiKey;
  }
});
