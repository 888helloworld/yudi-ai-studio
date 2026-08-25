const { parseJsonLike } = require('./reverse-prompt-service');

function buildPromptPolishInstruction({ prompt, size, imageCount }) {
  const imageHint = imageCount > 0
    ? `用户同时上传了 ${imageCount} 张参考图，图片顺序就是图1到图${imageCount}。必须逐张理解并严格按编号对应。`
    : '用户没有上传参考图，只根据文字和目标画布润色。';

  return `你是专门为 gpt-image-2 优化提示词的视觉导演和提示词工程师。你的任务不是反推图片，也不是单纯扩写句子，而是把用户的粗略想法整理成更准确、更容易执行、更能出好图的最终提示词。

目标画布：${size}
${imageHint}

用户原始要求：
${prompt}

必须遵守：
1. 用户明确要求优先级最高；参考图编号和顺序优先于你的审美发挥。
2. 如果有参考图，分别识别每张图承担的角色，例如产品主体、人物姿势、背景场景、构图、光线或风格，不要只看第一张。
3. 严格保留产品或主体的可见形状、比例、数量、颜色、材质、结构、配件和 logo 位置。用户没有要求时，不要擅自换产品、换颜色、加文字或加配件。
4. 根据 ${size} 补充明确的横竖构图、主体完整、安全留白和画面边缘保护要求。
5. 可以优化镜头、构图、光线、色彩、空间层次、材质表现和真实感，但不要用 masterpiece、best quality、8K 等空洞词堆砌。
6. 最终提示词要能直接发送给 gpt-image-2，使用清楚自然的中文，复杂任务可分句说明，避免互相冲突。
7. 如果文字要求与参考图冲突，不要自行猜测，在 warning 中简短指出；最终提示词仍以用户文字要求为准。
8. 不要输出违法、侵权或不安全的强化建议。

严格返回 JSON，不要使用 Markdown，不要添加前后说明：
{
  "polished_prompt": "可直接发送给 gpt-image-2 的最终中文提示词",
  "visual_understanding": ["图1：简短说明它在本次任务中的作用"],
  "changes": ["简短说明本次补强了什么，最多4条"],
  "warning": "没有冲突时返回空字符串"
}`;
}

function normalizeStringList(value, maximum = 4) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, maximum)
    .map((item) => item.slice(0, 160));
}

function normalizePromptPolishResult(content) {
  const parsed = typeof content === 'string' ? parseJsonLike(content) : content;
  if (!parsed || typeof parsed !== 'object') {
    const fallback = String(content || '').trim();
    return fallback ? { polishedPrompt: fallback.slice(0, 3000), visualUnderstanding: [], changes: [], warning: '' } : null;
  }
  const polishedPrompt = String(parsed.polished_prompt || parsed.polishedPrompt || parsed.prompt || '').trim();
  if (!polishedPrompt) return null;
  return {
    polishedPrompt: polishedPrompt.slice(0, 3000),
    visualUnderstanding: normalizeStringList(parsed.visual_understanding || parsed.visualUnderstanding),
    changes: normalizeStringList(parsed.changes),
    warning: String(parsed.warning || '').trim().slice(0, 300)
  };
}

module.exports = {
  buildPromptPolishInstruction,
  normalizePromptPolishResult
};
