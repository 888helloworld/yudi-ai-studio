const test = require('node:test');
const assert = require('node:assert/strict');
const { buildXiEditPrompt, buildXiGeneratePrompt } = require('../services/prompt-service');

test('文生图包装保持精简，并允许用户明确要求图片文字', () => {
  const result = buildXiGeneratePrompt('制作海报，写上“新品上市”', '1024x1536');
  assert.match(result, /任务：制作海报/);
  assert.match(result, /1024x1536/);
  assert.match(result, /除非任务明确要求/);
  assert.doesNotMatch(result, /不要加文字/);
});

test('参考图改图只保留编号、任务、尺寸和不变项', () => {
  const files = [
    { originalname: '图1.png' },
    { originalname: '图2.png' }
  ];
  const result = buildXiEditPrompt('图1是产品，图2只参考光线', files, '1536x1024');
  assert.match(result, /图1：第 1 张输入图片/);
  assert.match(result, /图2：第 2 张输入图片/);
  assert.match(result, /不要自动混合所有图片内容/);
  assert.doesNotMatch(result, /脚尖|脚跟|袜口|袜身/);
  assert.doesNotMatch(result, /需要把用户指定的各参考图元素组合/);
});
