function extractChatText(data) {
  return data?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.text
    || data?.output_text
    || data?.text
    || '';
}

function parseJsonLike(text) {
  if (!text) return null;
  const trimmed = text.trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function stripLowValueAiWords(text) {
  return String(text || '')
    .replace(/\b(?:masterpiece|best\s*quality|trending\s+on\s+artstation)\b/gi, '')
    .replace(/\b(?:bad anatomy|deformed|extra fingers|extra limbs|low quality|worst quality)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;，。；])/g, '$1')
    .replace(/(?:,\s*){2,}/g, ', ')
    .trim();
}

function ensurePromptSuffix(text, suffix) {
  const source = stripLowValueAiWords(text);
  if (!source) return suffix;
  const lower = source.toLowerCase();
  const marker = suffix.slice(0, 28).toLowerCase();
  return lower.includes(marker) ? source : `${source}${/[。.!?]$/.test(source) ? '' : '.'} ${suffix}`;
}

function normalizeReversePromptResult(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const polishedEn = parsed.polished_prompt_en || parsed.universal_prompt_en || parsed.dalle_prompt || parsed.midjourney_prompt || '';
  const polishedZh = parsed.polished_prompt_zh || parsed.universal_prompt_zh || '';
  const faithfulEn = parsed.faithful_prompt_en || parsed.realistic_prompt_en || '';
  const faithfulZh = parsed.faithful_prompt_zh || parsed.realistic_prompt_zh || '';
  return {
    ...parsed,
    polished_prompt_en: ensurePromptSuffix(
      polishedEn,
      'Polished editorial photography, elegant composition, flattering natural light, refined color grading, rich but believable details, premium visual taste, realistic textures, clean background hierarchy, sharp subject focus, aesthetically pleasing final image.'
    ),
    polished_prompt_zh: ensurePromptSuffix(
      polishedZh,
      '精美商业摄影和小红书审美，构图干净高级，光线自然但有层次，色彩协调耐看，主体清晰，材质真实，背景有秩序，整体精致好看但不过度塑料。'
    ),
    faithful_prompt_en: ensurePromptSuffix(
      faithfulEn || polishedEn,
      'Faithful to the uploaded image, realistic everyday photography, natural available light, believable lens imperfections, real textures, no CGI, no plastic skin, no artificial glow.'
    ),
    faithful_prompt_zh: ensurePromptSuffix(
      faithfulZh || polishedZh,
      '忠实参考原图，真实生活摄影感，自然现场光，材质和细节可信，避免CG感、塑料皮肤和不真实光晕。'
    ),
    universal_prompt_en: ensurePromptSuffix(
      parsed.universal_prompt_en || polishedEn,
      'Polished editorial photography, elegant composition, flattering natural light, refined color grading, realistic textures, premium visual taste, clean background hierarchy, aesthetically pleasing final image.'
    ),
    universal_prompt_zh: ensurePromptSuffix(
      parsed.universal_prompt_zh || polishedZh,
      '精美商业摄影和小红书审美，构图干净高级，光线自然但有层次，色彩协调耐看，主体清晰，材质真实，整体精致好看但不过度塑料。'
    )
  };
}

const REVERSE_PROMPT_MODES = new Set(['general', 'amazon', 'outfit', 'style-only', 'structured']);

function getReversePromptMode(mode) {
  return REVERSE_PROMPT_MODES.has(mode) ? mode : 'general';
}

function buildReversePromptInstruction(mode) {
  const modeText = {
    general: `当前模式：通用反推。
请从主体、场景、构图、光线、色彩、材质、镜头角度、风格、画面质感、负面提示词十个维度拆解，并输出适合通用 AI 生图、Midjourney、Stable Diffusion / Flux 的版本。`,
    amazon: `当前模式：亚马逊产品主图。
请作为专业亚马逊产品摄影师分析图片，重点判断产品主体、摆放方式、背景是否纯白、光线方向和阴影、材质纹理颜色、1:1 主图构图、是否符合亚马逊主图风格、应该保留和去掉的元素。输出要更真实、更像专业棚拍，适合电商主图。`,
    outfit: `当前模式：模特穿搭电商图。
请重点拆解模特姿势、身体动作、服装风格、产品材质、颜色纹理、鞋履或配饰状态、背景、光线、构图、日系氛围和画面高级感。要求保留产品为主体，背景可优化为纯白 RGB 255 255 255，画面比例适合 1:1，日本亚马逊产品主图风格，不要杂乱背景、文字或 logo。`,
    'style-only': `当前模式：只取风格，不复制内容。
请不要复制图片中的具体人物、品牌、logo、独特设计或可识别版权元素。只提取视觉风格、构图方式、光线、色彩、镜头语言和商业摄影感觉，并生成可用于原创电商图片的提示词。提示词要能替换成用户自己的产品，避免侵权元素。`,
    structured: `当前模式：精准拆图。
请把图片拆成结构化 AI 生图提示词：主体、背景、构图、镜头、光线、颜色、材质、风格、细节、画质关键词、负面提示词，并最后整合成完整英文 prompt。`
  }[getReversePromptMode(mode)];

  return `你是一名高级图像生成提示词工程师、商业摄影美术指导和视觉分析师。请分析用户上传的图片，并反推出能让生图模型生成“更好看、更精致、更有审美”的提示词。

${modeText}

通用要求：
1. 不要只描述图片，要提炼成可直接出图的高质量 prompt。
2. 先忠实识别原图主体、场景、构图、色彩、材质、镜头视角和关键细节，再做审美增强。
3. 默认输出“精美出图版”：适合小红书、商业摄影、电商、生活方式视觉和高级感海报；画面要干净、有层次、主体明确、色彩协调、光线好看、质感真实。
4. 可以适度加入更好的光线、构图、色彩分级、背景秩序、镜头语言和质感描述，但不要改变原图主体身份、核心物体、场景类型和主要风格。
5. 不要把画面写脏、写灰、写普通；不要强制加入杂物、瑕疵、噪点、运动模糊、随手拍、不完美等会降低出图质量的要求。
6. 避免低价值 AI 口号：不要堆砌 masterpiece、best quality、8K、ultra detailed、trending on artstation。可以写具体美术质量，例如 elegant composition、soft directional light、refined color grading、premium editorial photography、realistic textures。
7. 如果原图是人像：要保留自然真实的皮肤质感，但可以写 flattering light、clean styling、natural retouching、healthy skin tone；不要写塑料皮肤、蜡像、过度磨皮、虚拟模特。
8. 如果图片包含文字、logo、人物身份、品牌或版权角色，不要臆造具体不可确认信息，只描述可见视觉元素。
9. 提示词以英文为主，因为主流绘图模型通常更稳定；同时给出中文版本方便用户理解。

请严格返回 JSON，不要使用 Markdown，不要输出解释性前后缀。JSON 字段如下：
{
  "title": "10-20字中文标题",
  "visual_summary_zh": "用中文简要概括原图主体、场景、构图和风格，60-100字",
  "polished_prompt_en": "精美出图英文提示词，140-240词，强调高级审美、好看的光线、构图、色彩、材质和真实质感",
  "polished_prompt_zh": "精美出图中文提示词，140-240字，强调小红书/商业摄影审美、好看的光线、构图、色彩、材质和真实质感",
  "faithful_prompt_en": "忠实还原英文提示词，100-180词，更接近原图但仍保持干净自然",
  "faithful_prompt_zh": "忠实还原中文提示词，100-180字，更接近原图但仍保持干净自然",
  "midjourney_prompt": "适合 Midjourney 的英文提示词，包含必要参数建议",
  "sdxl_flux_prompt": "适合 Stable Diffusion / Flux 的英文正向提示词",
  "dalle_prompt": "适合 ChatGPT / GPT Image 的中文或英文提示词",
  "negative_prompt": "负面提示词，避免低质、变形、塑料感、过曝、脏乱、文字错误等",
  "composition": "构图和镜头建议，中文",
  "lighting": "光线和氛围建议，中文",
  "color_palette": "色彩建议，中文",
  "style_keywords": ["5-10个中文风格关键词"],
  "recommended_params": "适合主流绘图工具的简短参数建议"
}`;
}

module.exports = {
  buildReversePromptInstruction,
  extractChatText,
  getReversePromptMode,
  normalizeReversePromptResult,
  parseJsonLike
};
