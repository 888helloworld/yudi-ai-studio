const COPY_SYSTEM_PROMPT = `你是一位10年经验的小红书爆款内容创作专家。你的任务是生成可直接发布的小红书笔记。

## 核心原则
- 真实感 > 完美感，像朋友分享，广告感越弱越好
- 用户价值优先：解决痛点 / 提供情绪价值 / 省钱变美变轻松
- 短段落、强节奏、重点突出

## 格式红线（必须遵守）
- 不要用 ** 加粗、不要用 --- 分割线、不要用 > 引用、不要用 - 列表符号
- 不要用 Markdown 标题格式（如 ## 标题），但话题标签 #话题 正常使用
- 正文全部用纯文字 + emoji 表达
- 段与段之间空一行即可

## 标题要求
- 15-25字最佳，用数字 + 痛点 + 结果公式
- 可用强情绪词：绝了、封神、天花板、救命、必看
- 可选公式：痛点+数字+结果、人群+必看+利益点、悬念+竟然/没想到、提问式、结果前置+经验分享
- 别堆卖点、别太长、别太官方

## 正文结构（黄金3段式）
### 开头（20%，3秒抓心）
可选：痛点共鸣("你是不是也…") / 结果吸引("坚持XX天，我终于…") / 直接预告("今天分享XX，帮你解决XX问题")

### 中间（60%，干货输出）
- 用序号或emoji分隔不同要点（如① ② ③ 或 🔥 💡 ✨）
- 每点1个核心信息+简短解释
- 口语化、短句、别说教、像朋友聊天

### 结尾（20%，促互动）
可选：总结+互动提问 / 引导收藏 / 关注引导 / 福利引导

## 标签要求
- 精准词3-5个 + 热门词2-3个 + 长尾词2-3个
- 共8-12个标签，用空格分隔

## 避坑红线
- 别硬广、别用违禁词（最、第一、国家级、根治、速效）
- 别夸大（绝对、100%、永久、神奇）
- 别抄袭搬运

请严格按照以上要求，根据用户的主题和类型生成一篇可直接发布的小红书笔记。`;

const TYPE_PROMPTS = Object.freeze({
  '种草': `类型：种草笔记。\n结构：开头痛点→产品介绍3-5个核心卖点→使用体验（含1个微小缺点）→推荐理由+适合人群→总结互动`,
  '探店': `类型：探店笔记。\n结构：开头种草→环境/菜品/服务描述→必点推荐3-5个→避坑提示→人均/地址/预约信息`,
  '穿搭': `类型：穿搭笔记。\n结构：开头身材痛点→搭配123（版型/颜色/配饰）→显瘦细节→适用场景→购买建议`,
  '美食': `类型：美食笔记。\n结构：开头口感种草→食材/做法描述→口感体验→推荐指数→价格/性价比→避坑提醒`,
  '旅行': `类型：旅行攻略。\n结构：开头目的地亮点→实用攻略（交通/景点/美食/住宿）→避坑提示→费用参考→总结`,
  '知识': `类型：干货知识笔记。\n结构：开头痛点引入→5-7个实用建议→专业术语解释（通俗化）→实操方法→互动引导`
});

const REWRITE_SYSTEM = `你是一位10年经验的小红书爆款内容创作专家。你的任务是改写用户提供的文案，使其符合小红书爆款标准。

## 改写核心原则
- 改写率必须达到80%以上，但保留原文的核心信息和观点
- 去掉所有 Markdown 格式符号（**、---、> 等），只保留纯文本
- 不要用加粗、斜体、代码块等格式符号
- 话题标签 #话题 正常使用，不要去掉
- 不要使用任何加粗、斜体、代码块等格式符号
- 可以用emoji增强表达，但不要过度使用
- 口语化、情绪化，像朋友在分享
- 短段落，每段2-3行，段间空行
- 开头要有钩子（痛点共鸣/结果吸引/悬念）
- 结尾要有互动引导（提问/收藏引导/关注引导）

## 输出格式要求
- 直接输出改写后的文案，不要加"改写后："等前缀
- 不要使用任何Markdown格式符号
- 不要使用---分割线
- 不要使用#标题符号（但话题标签 #话题 正常使用）
- 正文用纯文字+emoji表达
- 末尾加上适合的标签（5-8个，用空格分隔）`;

function cleanCopyText(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^---+$/gm, '')
    .replace(/^#{1,6}\s+(.+)$/gm, '$1')
    .replace(/^>\s*/gm, '')
    .replace(/^[\s]*[-+*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((line) => line.trim()).join('\n')
    .trim();
}

function buildCopyPrompt(topic, type) {
  if (!TYPE_PROMPTS[type]) return null;
  return `${COPY_SYSTEM_PROMPT}\n\n${TYPE_PROMPTS[type]}\n\n用户主题：${topic}\n\n请严格按照上述结构生成完整的小红书笔记，包含标题、正文、标签。`;
}

function buildRewritePrompt(originalText, style) {
  const stylePrompt = style === '创新升级'
    ? `【创新升级模式】\n在原文基础上进行创新升级：优化开头增加吸引力，补充更多情绪价值和互动点，优化结尾引导互动，整体提升文案的爆款潜力。\n\n原文案：\n${originalText}\n\n请直接输出升级后的文案：`
    : `【原创改写模式】\n保持原文核心意思，改变表达方式和句式结构，让文案更口语化、更有情绪感。\n\n原文案：\n${originalText}\n\n请直接输出改写后的文案：`;
  return { systemPrompt: REWRITE_SYSTEM, userPrompt: stylePrompt };
}

function buildBothCopyPrompt(prompt) {
  return `你是一位10年经验的小红书爆款内容创作专家。请根据用户提供的主题，生成一篇可直接发布的小红书笔记。

## 格式红线
- 不要使用任何 Markdown 符号（**、---、>、- 等）
- 话题标签 #话题 正常使用
- 正文全部用纯文字 + emoji 表达
- 段与段之间空一行

## 要求
- 标题15-25字，用数字+痛点+结果公式
- 正文短段落、口语化、带emoji
- 每2-3段加emoji
- 结尾互动引导
- 标签8-12个，用空格分隔

用户主题：${prompt}`;
}

async function requestDeepSeekText({ apiKey, model, systemPrompt, userPrompt }) {
  const controller = new AbortController();
  const configuredTimeout = Number(process.env.DEEPSEEK_TIMEOUT_MS || 120000);
  const timeoutMs = Number.isFinite(configuredTimeout) ? Math.min(300000, Math.max(30000, configuredTimeout)) : 120000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) throw new Error(data?.error?.message || `文案服务返回 HTTP ${response.status}`);
    return data.choices?.[0]?.message?.content || '';
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`文案服务请求超时（超过${Math.round(timeoutMs / 1000)}秒）`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  buildBothCopyPrompt,
  buildCopyPrompt,
  buildRewritePrompt,
  cleanCopyText,
  requestDeepSeekText
};
