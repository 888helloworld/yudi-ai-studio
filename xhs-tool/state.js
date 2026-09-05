const XhsTool = window.XhsTool = window.XhsTool || {};

// =============================================
// 鍏ㄥ眬鐘舵€?// =============================================
let serverHistory = [];
let activeTasks = [];
let selectedRatio = '1:1';
let selectedCopyType = '种草';
let activePresets = new Set();


const HISTORY_FETCH_PAGE_SIZE = 50;
let historyFetchPage = 0;
let historyFetchTotalPages = 1;
let historyFetchLoading = false;
let pageSize = 50;
let imagePage = 1;
let copyPage = 1;
let bothPage = 1;
let reversePage = 1;
let rewritePage = 1;

let currentUser = null;
let referencePreviewUrl = '';
let xhsReverseFile = null;
let xhsReversePreviewUrl = '';
let selectedReverseMode = 'general';
localStorage.removeItem('yudi_xhs_pending_tasks');
const PENDING_XHS_TASKS_KEY = 'yudi_xhs_pending_tasks:' + (() => { try { return JSON.parse(localStorage.getItem('user') || '{}').id || 'guest'; } catch { return 'guest'; } })();
const XHS_ACTIVE_TOOL_KEY = 'yudi_xhs_active_tool';
let pendingTaskPollTimer = null;

const REVERSE_TEMPLATE_HINTS = {
  general: '按主体、场景、构图、光线、色彩、材质、镜头、风格和负面词完整拆解。',
  amazon: '适合家居、清洁、服饰配件等产品主图，重点输出专业棚拍和亚马逊白底主图提示词。',
  outfit: '适合模特穿搭、电商场景图，重点拆解姿势、服装层次、材质纹理、日系氛围和白底主图要求。',
  'style-only': '只提取风格、构图、光线、色彩和商业摄影感觉，不复制人物、品牌、logo 或独特设计。',
  structured: '按主体、背景、构图、镜头、光线、颜色、材质、风格、细节和画质关键词结构化拆图。'
};

const xhsToolState = {};
Object.defineProperties(xhsToolState, {
  serverHistory: { get: () => serverHistory, set: (value) => { serverHistory = value; } },
  activeTasks: { get: () => activeTasks, set: (value) => { activeTasks = value; } },
  selectedRatio: { get: () => selectedRatio, set: (value) => { selectedRatio = value; } },
  selectedCopyType: { get: () => selectedCopyType, set: (value) => { selectedCopyType = value; } },
  activePresets: { get: () => activePresets },
  pageSize: { get: () => pageSize, set: (value) => { pageSize = value; } },
  currentUser: { get: () => currentUser, set: (value) => { currentUser = value; } }
});
XhsTool.state = xhsToolState;

// =============================================
// 宸ュ叿鍑芥暟
// =============================================
