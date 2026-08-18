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
    `最终图片目标画布是 ${size}，这是${getXiCanvasLabel(size)}。`,
    `请严格按照 ${size} 的画布比例构图，不要输出其他比例，不要把横图生成竖图或把竖图生成方图。`,
    '主体必须完整出现在画面内，四周保留安全留白；不要加边框，不要加文字，不要加水印。',
    `用户要求：${prompt}`
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
    .map((file, index) => `${getSourceImageLabel(file, index)}：${file?.originalname || getSourceImageFilename(index)}，第 ${index + 1} 个原始参考图`)
    .join('\n');
  return [
    '请严格按参考图编号理解图片，不要只参考第一张图。',
    sourceFiles.length > 1 ? '本次还会额外提供一张 reference_board.png 编号参考板；参考板里的数字就是图1、图2、图3、图4的编号，请用它确认每张图的对应关系。' : '',
    sourceList ? `参考图说明：\n${sourceList}` : '',
    '如果用户提到“图1、图2、图3、图4”，必须对应上面的编号说明和参考板数字，不要按任意顺序重新解释。',
    '需要把用户指定的各参考图元素组合到同一张最终图片里；不要遗漏用户点名的参考图元素。',
    size ? `最终图片目标画布是 ${size}，请按这个画布比例重新构图。` : '',
    '必须让主体完整出现在画面内，四周保留安全留白；不要裁掉脚尖、脚跟、袜口、袜身、产品边缘或用户要求保留的细节。',
    '如果原参考图主体贴边，请主动缩小构图并补足干净背景，而不是沿用贴边裁切。',
    '保持最终画面自然真实、构图完整，不要生成拼贴图或多宫格。',
    `用户要求：${prompt}`
  ].filter(Boolean).join('\n\n');
}

function buildReferenceBoardPrompt(prompt, sourceFiles = []) {
  const sourceList = sourceFiles
    .map((file, index) => `${getSourceImageLabel(file, index)}：${file?.originalname || getSourceImageFilename(index)}`)
    .join('\n');
  return [
    `上传图片是一张参考板，里面按数字标出了 ${sourceFiles.length} 张原始参考图。`,
    '请按参考板左上角的数字理解图1、图2、图3、图4，不要把参考板当成拼贴成品。',
    sourceList ? `编号说明：\n${sourceList}` : '',
    '需要把用户指定的元素组合成一张自然完整的新图；最终结果不要保留参考板、数字角标或多宫格布局。',
    `用户要求：${prompt}`
  ].filter(Boolean).join('\n\n');
}

module.exports = {
  buildAmazonMainImagePrompt,
  buildAmazonMainImageVariationPrompt,
  buildImageVariationPrompt,
  buildReferenceBoardPrompt,
  buildXiEditPrompt,
  buildXiGeneratePrompt,
  buildXhsImagePrompt,
  getSourceImageFilename,
  getSourceImageLabel,
  getXiCanvasLabel,
  normalizeSourceImageFilename
};
