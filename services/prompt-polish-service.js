const { parseJsonLike } = require('./reverse-prompt-service');

function buildPromptPolishInstruction({ prompt, size, imageCount }) {
  const imageHint = imageCount > 0
    ? `用户上传了 ${imageCount} 张参考图，顺序为图1到图${imageCount}。只按用户需要说明每张图的作用，不要默认把所有图片内容混在一起。`
    : '用户没有上传参考图，只需要整理文字要求。';

  return `你是 DeepSeek 文本与视觉提示词润色助手，负责为 gpt-image-2 整理图片生成和图片编辑指令。你的目标是先准确理解文字和参考图，再让提示词更短、更明确、更容易执行，不是把一句话扩写成长文。

目标画布：${size}
${imageHint}

用户原始要求：
${prompt}

必须遵守：
1. 当用户明确要求参考某张图的颜色、款式、形状、材质或结构时，以参考图中实际可见的特征为准；文字中与图片冲突的颜色或描述视为可能口误，直接在最终提示词中纠正，不要解释冲突或单独提醒。只有用户明确表示“不要参考图中的某特征，改成另一种”时，才以文字覆盖参考图。
2. 普通任务输出 1-3 句、约 80-220 个中文字符；多图合成、复杂海报等任务也尽量控制在 350 个中文字符以内。
3. 按“修改目标 → 参考图分工 → 必须保留 → 必要视觉要求”的顺序组织，只写影响成败的信息。
4. 图片编辑要明确“只修改什么”和“什么保持不变”。没有要求修改的产品身份、结构、颜色、材质、数量、logo、人物身份和环境不要擅自改变。
5. 多图任务用“图1、图2”明确各自作用；某张图只是风格或场景参考时，不要复制其中无关物体。
6. 只在确有帮助时补充构图、视角、光线、材质或真实感，不要自动添加用户没有要求的道具、情节和装饰。
7. 服务端会另外附加目标尺寸和通用保护规则，polished_prompt 不要重复 ${size}、安全留白、水印等固定套话。
8. 不要堆砌 masterpiece、best quality、8K、ultra detailed 等空洞词；不要重复同一要求。
9. 如果用户原始描述已经清楚，只做轻量整理，不要为了显得专业而扩写。
10. 不要输出违法、侵权或不安全的强化建议。

严格返回 JSON，不要使用 Markdown，不要添加前后说明：
{
  "polished_prompt": "1-3句、简短明确、可直接发送给 gpt-image-2 的中文提示词",
  "visual_understanding": ["图1：简短说明它在本次任务中的作用"],
  "changes": ["简短说明本次补强了什么，最多4条"],
  "reference_corrections": [{"input_text":"用户文字中与参考图冲突的属性","reference_value":"参考图中实际可见的属性"}]
}`;
}

function compactPromptText(value, maximum = 500) {
  const text = String(value || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= maximum) return text;
  const sliced = text.slice(0, maximum);
  const punctuationIndex = Math.max(
    sliced.lastIndexOf('。'),
    sliced.lastIndexOf('！'),
    sliced.lastIndexOf('？'),
    sliced.lastIndexOf(';'),
    sliced.lastIndexOf('；')
  );
  return punctuationIndex >= Math.floor(maximum * 0.5)
    ? sliced.slice(0, punctuationIndex + 1).trim()
    : sliced.trim();
}

function normalizeStringList(value, maximum = 4) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, maximum)
    .map((item) => item.slice(0, 160));
}

function normalizeReferenceCorrections(value, maximum = 4) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      inputText: String(item?.input_text || item?.inputText || '').trim().slice(0, 80),
      referenceValue: String(item?.reference_value || item?.referenceValue || '').trim().slice(0, 80)
    }))
    .filter((item) => item.inputText && item.referenceValue && item.inputText !== item.referenceValue)
    .slice(0, maximum);
}

function getUnresolvedReferenceCorrections(result) {
  const prompt = String(result?.polishedPrompt || '');
  return (result?.referenceCorrections || []).filter((item) => (
    prompt.includes(item.inputText) || !prompt.includes(item.referenceValue)
  ));
}

function normalizePromptPolishResult(content) {
  const parsed = typeof content === 'string' ? parseJsonLike(content) : content;
  if (!parsed || typeof parsed !== 'object') {
    const fallback = compactPromptText(content);
    return fallback ? { polishedPrompt: fallback, visualUnderstanding: [], changes: [], warning: '' } : null;
  }
  const polishedPrompt = compactPromptText(parsed.polished_prompt || parsed.polishedPrompt || parsed.prompt);
  if (!polishedPrompt) return null;
  return {
    polishedPrompt,
    visualUnderstanding: normalizeStringList(parsed.visual_understanding || parsed.visualUnderstanding),
    changes: normalizeStringList(parsed.changes),
    referenceCorrections: normalizeReferenceCorrections(parsed.reference_corrections || parsed.referenceCorrections),
    warning: ''
  };
}

module.exports = {
  buildPromptPolishInstruction,
  compactPromptText,
  getUnresolvedReferenceCorrections,
  normalizePromptPolishResult
};
