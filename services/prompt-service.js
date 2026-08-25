function buildXhsImagePrompt(prompt, ratio) {
  const ratioHint = ratio === '3:4'
    ? '竖版封面构图，适合小红书信息流首图'
    : ratio === '4:3'
      ? '横版场景构图，适合合集或详情配图'
      : '方形封面构图，主体醒目，适合小红书首图';

  return `小红书爆款图片风格和框架：
${ratioHint}
高点击率封面图，真实生活方式场景，主体清晰居中，画面干净高级，明亮自然光，色彩有记忆点但不过度饱和，视觉层级明确，留有适合标题排版的干净区域，商业种草感，高质感摄影，细节精致，适合手机端浏览。
避免杂乱背景，避免低清晰度，避免水印，避免乱码文字，避免夸张变形。

用户需求：
${prompt}`.trim();
}

function buildImageVariationPrompt(prompt, index, total) {
  if (total <= 1) return prompt;
  return `${prompt}

这是同一主题的第 ${index + 1}/${total} 张图，请生成不同角度、不同构图或不同细节版本，保持同一小红书爆款风格，但避免和其他图片重复。`;
}

function getXiCanvasLabel(size = '') {
  const [width, height] = String(size || '').split('x').map(Number);
  if (!width || !height) return '目标画布';
  if (width === height) return '方图画布';
  if (width > height) return width / height > 1.7 ? '16:9 横图画布' : '横图画布';
  return height / width > 1.7 ? '竖图画布' : '竖图画布';
}

function buildXiGeneratePrompt(prompt, size = '') {
  if (!size) return prompt;
  return [
    `任务：${prompt}`,
    `输出：${size}（${getXiCanvasLabel(size)}），按这个画布比例构图。`,
    '除非任务明确要求，否则不要额外添加文字、水印或边框。重要主体保持完整；如果任务明确要求特写或裁切，以任务要求为准。'
  ].join('\n\n');
}

function buildAmazonMainImagePrompt(prompt, ratio) {
  const ratioHint = ratio === '3:4'
    ? '竖版主图候选，主体占画面 85% 以上，适合电商移动端首屏浏览'
    : ratio === '4:3'
      ? '横版主图候选，主体完整、结构清晰，适合商品详情或组合展示'
      : '方形主图候选，主体居中、识别度高，适合 Amazon 1:1 主图';

  return `你现在在生成亚马逊产品主图候选，要求是专业棚拍产品主图，不是场景海报，也不是营销海报。
${ratioHint}

硬性要求：
- 纯白背景，接近 RGB 255,255,255 / #FFFFFF
- 只突出商品本体，主体占画面 85% 以上
- 画面干净，无文字、无水印、无角标、无价格、无促销信息、无比较图标
- 不要添加多余道具、装饰物、手势、人物、复杂场景
- 保持真实产品比例、颜色、材质、logo 位置和包装结构
- 光线、阴影、色温统一，像同一套棚拍系统拍出来的主图
- 如果一次生成多张，请保持同一视觉风格，只允许角度、裁切、产品在画面中的位置轻微变化，不要改变整体风格

用户产品信息：
${prompt}`.trim();
}

function buildAmazonMainImageVariationPrompt(prompt, index, total) {
  if (total <= 1) return prompt;
  return `${prompt}

这是同一商品的第 ${index + 1}/${total} 张亚马逊主图候选。
请严格保持同一白底、同一棚拍光线、同一阴影方向、同一色温、同一材质表现和同一产品识别方式，只做轻微的拍摄角度、裁切或主体居中方式变化。
不要改变产品本体、包装、颜色、logo、配件或任何结构细节。`;
}

function getSourceImageFilename(index) {
  return `图${index + 1}.png`;
}

function normalizeSourceImageFilename(name, index) {
  const match = /图\s*([1-4])/i.exec(String(name || ''));
  return match ? `图${match[1]}.png` : getSourceImageFilename(index);
}

function getSourceImageLabel(file, index) {
  const match = /图\s*([1-4])/i.exec(String(file?.originalname || ''));
  return match ? `图${match[1]}` : `图${index + 1}`;
}

function buildXiEditPrompt(prompt, sourceFiles = [], size = '') {
  const sourceList = sourceFiles
    .map((file, index) => `${getSourceImageLabel(file, index)}：第 ${index + 1} 张输入图片`)
    .join('\n');
  return [
    sourceList ? `参考图顺序：\n${sourceList}` : '',
    `任务：${prompt}`,
    size ? `输出：${size}，按这个画布比例完成编辑。` : '',
    '执行原则：只修改任务明确要求的内容；未要求修改的主体身份、结构、颜色、材质、数量、人物身份和环境保持不变。每张参考图只承担任务指定的作用，不要自动混合所有图片内容。'
  ].filter(Boolean).join('\n\n');
}

module.exports = {
  buildAmazonMainImagePrompt,
  buildAmazonMainImageVariationPrompt,
  buildImageVariationPrompt,
  buildXiEditPrompt,
  buildXiGeneratePrompt,
  buildXhsImagePrompt,
  getSourceImageFilename,
  getSourceImageLabel,
  getXiCanvasLabel,
  normalizeSourceImageFilename
};
