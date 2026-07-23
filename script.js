// =============================================
// 鍏ㄥ眬鐘舵€?// =============================================
let serverHistory = [];
let activeTasks = [];
let selectedRatio = '1:1';
let selectedCopyType = '种草';
let activePresets = new Set();

let isGeneratingImage = false;
let isGeneratingCopy = false;
let isRewriting = false;

let pageSize = 50;
let imagePage = 1;
let copyPage = 1;
let bothPage = 1;
let reversePage = 1;

let currentUser = null;
let referencePreviewUrl = '';
let xhsReverseFile = null;
let xhsReversePreviewUrl = '';
let selectedReverseMode = 'general';

const REVERSE_TEMPLATE_HINTS = {
  general: '按主体、场景、构图、光线、色彩、材质、镜头、风格和负面词完整拆解。',
  amazon: '适合家居、清洁、服饰配件等产品主图，重点输出专业棚拍和亚马逊白底主图提示词。',
  outfit: '适合模特穿搭、电商场景图，重点拆解姿势、服装层次、材质纹理、日系氛围和白底主图要求。',
  'style-only': '只提取风格、构图、光线、色彩和商业摄影感觉，不复制人物、品牌、logo 或独特设计。',
  structured: '按主体、背景、构图、镜头、光线、颜色、材质、风格、细节和画质关键词结构化拆图。'
};

// =============================================
// 宸ュ叿鍑芥暟
// =============================================
function getAuthHeader() {
  const token = localStorage.getItem('token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

function isProtectedUploadUrl(url) {
  try {
    const parsed = new URL(String(url || ''), window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/uploads/');
  } catch (err) {
    return false;
  }
}

async function fetchImageBlob(url) {
  const headers = isProtectedUploadUrl(url) ? getAuthHeader() : {};
  const res = await fetch(new URL(url, window.location.origin).href, {
    headers,
    credentials: 'same-origin',
    cache: 'no-store'
  });
  if (!res.ok) throw new Error('图片读取失败');
  return res.blob();
}

function setProtectedImageSource(img, url) {
  if (!img || !url) return;
  if (!isProtectedUploadUrl(url)) {
    img.src = url;
    return;
  }
  fetchImageBlob(url)
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      img.onload = () => setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      img.src = objectUrl;
    })
    .catch(() => {
      img.alt = '图片需要登录后查看';
    });
}

function protectedImageHtml(url, alt, className = '', style = '') {
  return `<img src="" data-protected-src="${escapeForAttr(url)}" alt="${escapeForAttr(alt)}"${className ? ` class="${escapeForAttr(className)}"` : ''}${style ? ` style="${escapeForAttr(style)}"` : ''}>`;
}

function hydrateProtectedImages(root = document) {
  root.querySelectorAll('img[data-protected-src]').forEach((img) => {
    setProtectedImageSource(img, img.dataset.protectedSrc);
  });
}

function getImageCountInput(id) {
  const value = parseInt(document.getElementById(id)?.value, 10);
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(value, 1), 4);
}

const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
const TARGET_REFERENCE_UPLOAD_BYTES = 4.5 * 1024 * 1024;

async function prepareReferenceImageForUpload(file) {
  if (!file) return null;
  if (!file.type.startsWith('image/')) {
    throw new Error('只能上传图片文件');
  }
  if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error('参考图不能超过 20MB');
  }

  const canSendOriginal = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    && file.size <= TARGET_REFERENCE_UPLOAD_BYTES;
  if (canSendOriginal) return file;

  const dataUrl = await readImageFileAsDataUrl(file);
  const image = await loadReferenceImage(dataUrl);
  const maxSides = [2048, 1600, 1280, 1024, 768];
  const qualities = [0.9, 0.82, 0.74];
  let lastBlob = null;

  for (const maxSide of maxSides) {
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      lastBlob = blob;
      if (blob.size <= TARGET_REFERENCE_UPLOAD_BYTES) {
        return new File([blob], normalizeReferenceUploadName(file.name), { type: 'image/jpeg' });
      }
    }
  }

  if (lastBlob && lastBlob.size <= 5 * 1024 * 1024) {
    return new File([lastBlob], normalizeReferenceUploadName(file.name), { type: 'image/jpeg' });
  }
  throw new Error('参考图处理后仍然太大，请换一张更小的图片');
}

function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function loadReferenceImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片无法解码，请换一张 PNG/JPG/WebP 图片'));
    image.src = src;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('参考图压缩失败'));
    }, type, quality);
  });
}

function normalizeReferenceUploadName(name) {
  const base = String(name || 'reference').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'reference';
  return `${base}.jpg`;
}

// =============================================
// 鍒濆鍖?// =============================================
function initToolScript() {
  checkLoginStatus();
  initStylePresets();
  initRatioSelector();
  initCopyTypeSelector();
  initDropZone();
  initGenerateImage();
  initGenerateCopy();
  initRewrite();
  initGenerateBoth();
  initXhsToolTabs();
  initXhsWorkStats();
  initXhsReversePrompt();
  initPagination();
}

function initXhsToolTabs() {
  const switcher = document.getElementById('xhsToolSwitcher');
  if (!switcher) return;
  const tabs = Array.from(switcher.querySelectorAll('[data-xhs-tool]'));
  const panels = Array.from(document.querySelectorAll('[data-xhs-panel]'));
  if (!tabs.length || !panels.length) return;

  window.switchXhsTool = function(tool) {
    const nextTool = tool || 'image';
    tabs.forEach(tab => {
      const active = tab.dataset.xhsTool === nextTool;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    panels.forEach(panel => {
      panel.hidden = panel.dataset.xhsPanel !== nextTool;
    });
  };

  tabs.forEach(tab => {
    tab.setAttribute('aria-selected', tab.classList.contains('active') ? 'true' : 'false');
    tab.addEventListener('click', () => window.switchXhsTool(tab.dataset.xhsTool));
  });
}

function initXhsWorkStats() {
  const concurrency = document.getElementById('xhsStatConcurrency');
  if (concurrency) {
    concurrency.addEventListener('input', () => {
      const value = Math.max(Math.floor(Number(concurrency.value || 1)), 1);
      concurrency.value = value;
      updateXhsWorkStats();
    });
  }
  updateXhsWorkStats();
}

// 动态加载时 DOMContentLoaded 可能已触发，兜底处理
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initToolScript);
} else {
  initToolScript();
}

// 妫€鏌ョ櫥褰曠姸鎬?
async function checkLoginStatus() {
  const token = localStorage.getItem('token');
  
  if (!token) {
    showLoginPrompt();
    return;
  }
  
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) throw new Error();
    
    const data = await res.json();
    const user = data.user || data;
    currentUser = user;
    showUserBar(user);
    await loadServerHistory();
  } catch {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    showLoginPrompt();
  }
}

function showLoginPrompt() {
  document.getElementById('loginPrompt').style.display = 'flex';
  document.getElementById('userBar').style.display = 'none';
}

function showUserBar(user) {
  document.getElementById('loginPrompt').style.display = 'none';
  document.getElementById('userBar').style.display = 'flex';
  document.getElementById('userName').textContent = user.username;
  document.getElementById('userPoints').textContent = `积分: ${user.points}`;
  
  if (user.role === 'admin') {
    document.getElementById('adminLink').style.display = 'block';
  }
  
  // 避免重复绑定
  const logoutBtn = document.getElementById('logoutBtn');
  const newBtn = logoutBtn.cloneNode(true);
  logoutBtn.parentNode.replaceChild(newBtn, logoutBtn);
  newBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    location.reload();
  });
}

function updatePoints(points) {
  if (currentUser) {
    currentUser.points = points;
    document.getElementById('userPoints').textContent = `积分: ${points}`;
  }
}

// =============================================
// 椋庢牸棰勮
// =============================================
function initStylePresets() {
  document.querySelectorAll('.preset-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      // 鍗曢€夋ā寮忥細鍙栨秷鍏朵粬閫変腑锛屽彧淇濈暀褰撳墠
      document.querySelectorAll('.preset-tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activePresets.clear();
      activePresets.add(btn.dataset.style);
    });
  });
  const firstPreset = document.querySelector('.preset-tag');
  if (firstPreset) {
    firstPreset.classList.add('active');
    activePresets.add(firstPreset.dataset.style);
  }
}

// =============================================
// 姣斾緥閫夋嫨鍣?// =============================================
function initRatioSelector() {
  document.querySelectorAll('.ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedRatio = btn.dataset.ratio;
    });
  });
}

// =============================================
// 鏂囨绫诲瀷閫夋嫨鍣?// =============================================
function initCopyTypeSelector() {
  document.querySelectorAll('.copy-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.copy-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedCopyType = btn.dataset.type;
    });
  });
}

// =============================================
// 鎷栨嫿涓婁紶
// =============================================
function initDropZone() {
  const dropZone = document.getElementById('dropZone');
  const dropHint = document.getElementById('dropHint');
  const previewRef = document.getElementById('previewRef');
  const referenceInput = document.getElementById('referenceImage');
  const promptInput = document.getElementById('imgPrompt');
  if (!dropZone || !dropHint || !previewRef || !referenceInput) return;

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setReferenceFile(file);
    }
  });

  referenceInput.addEventListener('change', () => {
    const file = referenceInput.files[0];
    if (file) showPreview(file);
  });

  dropZone.addEventListener('click', () => {
    dropZone.classList.add('paste-ready');
    setTimeout(() => dropZone.classList.remove('paste-ready'), 1800);
  });

  document.addEventListener('paste', (e) => {
    const file = getImageFileFromClipboard(e.clipboardData);
    if (!file) return;
    const active = document.activeElement;
    if (active?.closest?.('#xhsReverseDropZone') || active?.closest?.('#xhsReverseModeGrid')) return;
    const shouldPasteToReference = dropZone.contains(active)
      || active === promptInput
      || active === referenceInput
      || active === document.body;
    if (!shouldPasteToReference) return;
    e.preventDefault();
    setReferenceFile(file);
    dropZone.classList.add('paste-ready');
    setTimeout(() => dropZone.classList.remove('paste-ready'), 900);
  });

  function setReferenceFile(file) {
    const namedFile = file.name
      ? file
      : new File([file], `pasted-reference-${Date.now()}.png`, { type: file.type || 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(namedFile);
    referenceInput.files = dt.files;
    showPreview(namedFile);
  }

  function showPreview(file) {
    if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    const url = URL.createObjectURL(file);
    referencePreviewUrl = url;
    previewRef.innerHTML = `<img src="${url}" alt="参考图"><button class="remove-ref" onclick="removeRef()">×</button>`;
    dropHint.style.display = 'none';
  }
}

function getImageFileFromClipboard(clipboardData) {
  const items = Array.from(clipboardData?.items || []);
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      return item.getAsFile();
    }
  }
  return null;
}

window.removeRef = function() {
  const previewRef = document.getElementById('previewRef');
  const dropHint = document.getElementById('dropHint');
  const referenceInput = document.getElementById('referenceImage');
  if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
  referencePreviewUrl = '';
  previewRef.innerHTML = '';
  dropHint.style.display = 'flex';
  referenceInput.value = '';
};

function initXhsReversePrompt() {
  const dropZone = document.getElementById('xhsReverseDropZone');
  const input = document.getElementById('xhsReverseImage');
  const btn = document.getElementById('xhsReverseBtn');
  const modeGrid = document.getElementById('xhsReverseModeGrid');
  if (!dropZone || !input || !btn || !modeGrid) return;
  dropZone.tabIndex = 0;

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) setXhsReverseFile(file);
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('drag-over');
    });
  });

  dropZone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) setXhsReverseFile(file);
  });

  dropZone.addEventListener('click', () => {
    dropZone.focus();
    dropZone.classList.add('paste-ready');
    setTimeout(() => dropZone.classList.remove('paste-ready'), 1800);
  });

  document.addEventListener('paste', (event) => {
    const file = getImageFileFromClipboard(event.clipboardData);
    if (!file) return;
    const active = document.activeElement;
    const shouldPaste = dropZone.contains(active) || active === document.body;
    if (!shouldPaste) return;
    event.preventDefault();
    setXhsReverseFile(file.name ? file : new File([file], `pasted-reverse-${Date.now()}.png`, { type: file.type || 'image/png' }));
    dropZone.classList.add('paste-ready');
    setTimeout(() => dropZone.classList.remove('paste-ready'), 900);
  });

  modeGrid.addEventListener('click', (event) => {
    const modeBtn = event.target.closest('[data-reverse-mode]');
    if (!modeBtn) return;
    selectedReverseMode = modeBtn.dataset.reverseMode || 'general';
    modeGrid.querySelectorAll('[data-reverse-mode]').forEach(item => item.classList.toggle('active', item === modeBtn));
    const hint = document.getElementById('xhsReverseHint');
    if (hint) hint.textContent = REVERSE_TEMPLATE_HINTS[selectedReverseMode] || REVERSE_TEMPLATE_HINTS.general;
  });

  btn.addEventListener('click', runXhsReversePrompt);
}

function setXhsReverseFile(file) {
  if (!file.type.startsWith('image/')) {
    setXhsReverseStatus('只能上传图片文件。', 'error');
    return false;
  }
  if (file.size > 10 * 1024 * 1024) {
    setXhsReverseStatus('图片不能超过 10MB。', 'error');
    return false;
  }

  xhsReverseFile = file;
  const input = document.getElementById('xhsReverseImage');
  if (input && window.DataTransfer && (!input.files || input.files[0] !== file)) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  }
  if (xhsReversePreviewUrl) URL.revokeObjectURL(xhsReversePreviewUrl);
  xhsReversePreviewUrl = URL.createObjectURL(file);
  const hint = document.getElementById('xhsReverseDropHint');
  const preview = document.getElementById('xhsReversePreview');
  if (hint) hint.style.display = 'none';
  if (preview) {
    preview.innerHTML = '';
    const img = document.createElement('img');
    img.src = xhsReversePreviewUrl;
    img.alt = '反推参考图';
    const name = document.createElement('div');
    name.className = 'xhs-reverse-file';
    name.textContent = file.name || '粘贴图片';
    const remove = document.createElement('button');
    remove.className = 'remove-ref';
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearXhsReverseFile();
    });
    preview.append(img, name, remove);
  }
  document.getElementById('xhsReverseBtn').disabled = false;
  setXhsReverseStatus('图片已放入，可以反推 Prompt。', 'ok');
  return true;
}

function clearXhsReverseFile() {
  xhsReverseFile = null;
  const input = document.getElementById('xhsReverseImage');
  const hint = document.getElementById('xhsReverseDropHint');
  const preview = document.getElementById('xhsReversePreview');
  if (input) input.value = '';
  if (xhsReversePreviewUrl) URL.revokeObjectURL(xhsReversePreviewUrl);
  xhsReversePreviewUrl = '';
  if (preview) preview.innerHTML = '';
  if (hint) hint.style.display = 'flex';
  const btn = document.getElementById('xhsReverseBtn');
  if (btn) btn.disabled = true;
  setXhsReverseStatus('已移除图片。', '');
}

async function runXhsReversePrompt() {
  if (!localStorage.getItem('token')) {
    alert('请先登录');
    return;
  }
  if (!xhsReverseFile) {
    setXhsReverseStatus('请先上传或粘贴图片。', 'error');
    return;
  }

  const btn = document.getElementById('xhsReverseBtn');
  const span = btn?.querySelector('span');
  if (btn) btn.disabled = true;
  if (span) span.textContent = '反推中...';
  setXhsReverseStatus('正在识图并生成 Prompt...', '');

  try {
    const form = new FormData();
    form.append('image', xhsReverseFile, xhsReverseFile.name || 'reverse.png');
    form.append('reverseMode', selectedReverseMode || 'general');
    form.append('historySource', 'xhs');
    const res = await fetch('/api/xi-image/reverse-prompt', {
      method: 'POST',
      headers: getAuthHeader(),
      body: form
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '反推失败');
    if (data.remainingPoints !== undefined) updatePoints(data.remainingPoints);
    clearXhsReverseFile();
    openReversePromptModal(data);
    await loadServerHistory();
    setXhsReverseStatus('Prompt 已生成，已保存到反推记录。', 'ok');
  } catch (err) {
    setXhsReverseStatus(err.message || '反推失败', 'error');
  } finally {
    if (span) span.textContent = '反推提示词';
    if (btn) btn.disabled = !xhsReverseFile;
  }
}

function setXhsReverseStatus(text, type) {
  const status = document.getElementById('xhsReverseStatus');
  if (!status) return;
  status.textContent = text || '';
  status.className = 'xhs-reverse-status' + (type ? ' ' + type : '');
}

// =============================================
// 鍥剧墖鐢熸垚
// =============================================
function initGenerateImage() {
  const btn = document.getElementById('generateBtn');
  btn.addEventListener('click', generateImage);
}

async function generateImage() {
  if (isGeneratingImage) return;
  
  if (!localStorage.getItem('token')) {
    alert('请先登录');
    return;
  }
  
  const prompt = document.getElementById('imgPrompt').value.trim();
  if (!prompt) {
    alert('请输入图片描述');
    return;
  }

  isGeneratingImage = true;
  updateButtonState('generateBtn', true, '生成中...');

  const imageCount = getImageCountInput('imageGenerateCount');
  const styleText = [...activePresets].join('，');
  const fullPrompt = styleText ? `${prompt}，${styleText}` : prompt;

  const taskId = 'task_' + Date.now();
  const taskCard = createTaskCard(taskId, 'image', `图片生成中（${imageCount}张）...`);
  addTask(taskCard);

  const formData = new FormData();
  formData.append('prompt', fullPrompt);
  formData.append('ratio', selectedRatio);
  formData.append('imageCount', imageCount);
  
  const referenceInput = document.getElementById('referenceImage');
  if (referenceInput.files[0]) {
    try {
      const referenceFile = await prepareReferenceImageForUpload(referenceInput.files[0]);
      formData.append('referenceImage', referenceFile, referenceFile.name || 'reference.jpg');
    } catch (err) {
      updateTaskCard(taskId, { error: err.message || '参考图处理失败' });
      isGeneratingImage = false;
      updateButtonState('generateBtn', false, '立即生成图片');
      return;
    }
  }

  try {
    const res = await fetch('/generate', { 
      method: 'POST', 
      body: formData,
      headers: getAuthHeader()
    });
    const data = await res.json();

    if (data.imageUrl || data.imageUrls?.length) {
      if (data.remainingPoints !== undefined) {
        updatePoints(data.remainingPoints);
      }
      updateTaskCard(taskId, {
        type: 'image',
        imageUrl: data.imageUrl,
        imageUrls: data.imageUrls,
        createdAt: data.createdAt,
        prompt: prompt,
        ratio: selectedRatio
      });
      loadServerHistory();
    } else {
      updateTaskCard(taskId, { error: data.error || '生成失败' });
    }
  } catch (err) {
    updateTaskCard(taskId, { error: '请求失败：' + err.message });
  } finally {
    isGeneratingImage = false;
    updateButtonState('generateBtn', false, '立即生成图片');
  }
}

// =============================================
// 鏂囨鐢熸垚
// =============================================
function initGenerateCopy() {
  const btn = document.getElementById('generateCopyBtn');
  btn.addEventListener('click', generateCopy);
}

async function generateCopy() {
  if (isGeneratingCopy) return;
  
  if (!localStorage.getItem('token')) {
    alert('请先登录');
    return;
  }
  
  const topic = document.getElementById('copyTopic').value.trim();
  if (!topic) {
    alert('请输入内容主题');
    return;
  }

  isGeneratingCopy = true;
  updateButtonState('generateCopyBtn', true, '生成中...');

  const taskId = 'task_' + Date.now();
  const taskCard = createTaskCard(taskId, 'copy', '文案生成中...');
  addTask(taskCard);

  try {
    const res = await fetch('/generate-copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ topic, type: selectedCopyType })
    });
    const data = await res.json();

    if (data.copy) {
      if (data.remainingPoints !== undefined) {
        updatePoints(data.remainingPoints);
      }
      updateTaskCard(taskId, {
        type: 'copy',
        copy: data.copy,
        createdAt: data.createdAt,
        topic: topic,
        copyType: selectedCopyType,
        isRewrite: false
      });
      loadServerHistory();
    } else {
      updateTaskCard(taskId, { error: data.error || '生成失败' });
    }
  } catch (err) {
    updateTaskCard(taskId, { error: '请求失败：' + err.message });
  } finally {
    isGeneratingCopy = false;
    updateButtonState('generateCopyBtn', false, '生成文案');
  }
}

// =============================================
// 鏀瑰啓鐖嗘鏂囨
// =============================================
let selectedRewriteStyle = '原创改写';

function initRewrite() {
  // 椋庢牸閫夋嫨
  document.querySelectorAll('.rewrite-style-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rewrite-style-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedRewriteStyle = btn.dataset.style;
    });
  });

  // 鏀瑰啓鎸夐挳
  const btn = document.getElementById('rewriteBtn');
  btn.addEventListener('click', rewriteCopy);
}

// =============================================
// 图文一体生成
// =============================================
function initGenerateBoth() {
  // 比例选择
  const bothPanel = document.querySelector('.both-panel');
  if (!bothPanel) return;
  
  bothPanel.querySelectorAll('.ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      bothPanel.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  
  // 生成按钮
  document.getElementById('generateBothBtn').addEventListener('click', generateBoth);
}

async function generateBoth() {
  if (isGeneratingImage) return;
  
  if (!localStorage.getItem('token')) {
    alert('请先登录');
    return;
  }
  
  const prompt = document.getElementById('bothPrompt').value.trim();
  if (!prompt) {
    alert('请输入内容描述');
    return;
  }
  
  const ratio = document.querySelector('.both-panel .ratio-btn.active')?.dataset.ratio || '1:1';
  const imageCount = getImageCountInput('bothImageCount');
  
  isGeneratingImage = true;
  updateButtonState('generateBothBtn', true, '生成中...');
  
  const taskId = 'task_' + Date.now();
  const taskCard = createTaskCard(taskId, 'both', `图文生成中（${imageCount}张图）...`);
  addTask(taskCard);
  
  try {
    const res = await fetch('/generate-both', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ prompt, ratio, imageCount })
    });
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || '生成失败');
    }
    
    if (data.remainingPoints !== undefined) {
      updatePoints(data.remainingPoints);
    }
    
    // 更新任务卡片
    updateTaskCard(taskId, {
      type: 'both',
      imageUrl: data.imageUrl,
      imageUrls: data.imageUrls,
      copy: data.copy,
      createdAt: data.createdAt,
      ratio
    });
    
    // 刷新历史记录
    await loadServerHistory();
    
    document.getElementById('bothPrompt').value = '';
  } catch (err) {
    updateTaskCard(taskId, { error: err.message || '生成失败' });
  } finally {
    isGeneratingImage = false;
    updateButtonState('generateBothBtn', false, '一键生成图文');
  }
}

window.generateBoth = generateBoth;

async function rewriteCopy() {
  if (isRewriting) return;
  
  if (!localStorage.getItem('token')) {
    alert('请先登录');
    return;
  }
  
  const originalText = document.getElementById('rewriteInput').value.trim();
  if (!originalText) {
    alert('请输入要改写的文案');
    return;
  }

  isRewriting = true;
  updateButtonState('rewriteBtn', true, '改写中...');

  const taskId = 'task_' + Date.now();
  const taskCard = createTaskCard(taskId, 'copy', '改写中...');
  addTask(taskCard);

  try {
    const res = await fetch('/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ 
        originalText: originalText,
        style: selectedRewriteStyle 
      })
    });
    const data = await res.json();

    if (data.copy) {
      if (data.remainingPoints !== undefined) {
        updatePoints(data.remainingPoints);
      }
      updateTaskCard(taskId, {
        type: 'copy',
        copy: data.copy,
        createdAt: data.createdAt,
        topic: '改写：' + data.title,
        copyType: '改写',
        isRewrite: true
      });
      document.getElementById('rewriteInput').value = '';
      loadServerHistory();
    } else {
      updateTaskCard(taskId, { error: data.error || '改写失败' });
    }
  } catch (err) {
    updateTaskCard(taskId, { error: '请求失败：' + err.message });
  } finally {
    isRewriting = false;
    updateButtonState('rewriteBtn', false, '智能改写');
  }
}

// =============================================
// 浠诲姟鍗＄墖绠＄悊
// =============================================
function createTaskCard(id, type, message) {
  const typeLabel = type === 'image' ? '图片' : (type === 'both' ? '图文' : '文案');
  const card = document.createElement('div');
  card.className = 'task-card';
  card.id = id;
  card.dataset.status = 'running';
  card.innerHTML = `
    <div class="task-header">
      <span class="task-type ${type}">${typeLabel}</span>
      <button class="task-close" onclick="removeTask('${id}')">×</button>
    </div>
    <div class="task-body">
      <div class="task-loading">
        <div class="spinner"></div>
        <span>${message}</span>
      </div>
    </div>
  `;
  return card;
}

function addTask(card) {
  const tasksSection = document.getElementById('tasksSection');
  const tasksGrid = document.getElementById('tasksGrid');
  tasksSection.style.display = 'block';
  tasksGrid.appendChild(card);
  activeTasks.push(card.id);
  updateXhsWorkStats();
  
  tasksSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateTaskCard(taskId, data) {
  const card = document.getElementById(taskId);
  if (!card) return;

  const body = card.querySelector('.task-body');

  if (data.error) {
    card.dataset.status = 'failed';
    body.innerHTML = `<div class="task-error">${escapeHtml(data.error)}</div>`;
    updateXhsWorkStats();
    return;
  }

  if (data.type === 'image') {
    card.dataset.status = 'done';
    const imageUrls = Array.isArray(data.imageUrls) && data.imageUrls.length ? data.imageUrls : [data.imageUrl].filter(Boolean);
    const imageHtml = imageUrls.map(url => protectedImageHtml(url, '生成的图片', 'task-image')).join('');
    const encodedImageUrls = encodeURIComponent(JSON.stringify(imageUrls));
    const encodedPrompt = encodeURIComponent(data.prompt || '');
    const actionsHtml = imageUrls.length
      ? `<button class="task-btn" onclick="downloadImagesFromEncoded('${encodedImageUrls}', decodeURIComponent('${encodedPrompt}'), '${escapeJsString(data.ratio || '1:1')}')">${imageUrls.length > 1 ? '下载全部图片' : '下载图片'}</button>`
      : '';
    body.innerHTML = `
      <div class="task-image-grid">${imageHtml}</div>
      <div class="task-meta">${escapeHtml(data.ratio || '1:1')} · ${imageUrls.length} 张 · ${escapeHtml(data.createdAt || '')}</div>
      <div class="task-actions">
        ${actionsHtml}
      </div>
    `;
  } else if (data.type === 'copy') {
    card.dataset.status = 'done';
    const typeLabel = data.isRewrite ? '改写' : (data.copyType || '生成');
    const header = card.querySelector('.task-header');
    const typeSpan = header.querySelector('.task-type');
    if (typeSpan) typeSpan.textContent = typeLabel;
    
    body.innerHTML = `
      <div class="task-copy">${escapeHtml(data.copy)}</div>
      <div class="task-meta">${escapeHtml(typeLabel)} · ${escapeHtml(data.createdAt || '')}</div>
      <div class="task-actions">
        <button class="task-btn" onclick="copyText(this, \`${escapeQuotes(data.copy)}\`)">复制</button>
      </div>
    `;
  } else if (data.type === 'both' || (data.imageUrl && data.copy)) {
    card.dataset.status = 'done';
    const header = card.querySelector('.task-header');
    const typeSpan = header.querySelector('.task-type');
    if (typeSpan) typeSpan.textContent = '图文';
    
    const copyPreview = (data.copy || '').substring(0, 100) + (data.copy && data.copy.length > 100 ? '...' : '');
    const imageUrls = Array.isArray(data.imageUrls) && data.imageUrls.length ? data.imageUrls : [data.imageUrl].filter(Boolean);
    const imageHtml = imageUrls.map(url => protectedImageHtml(url, '生成的图片', 'task-image', 'max-height:180px;')).join('');
    const encodedImageUrls = encodeURIComponent(JSON.stringify(imageUrls));
    const downloadButtons = imageUrls.length
      ? `<button class="task-btn" onclick="downloadImagesFromEncoded('${encodedImageUrls}')">${imageUrls.length > 1 ? '下载全部图片' : '下载图片'}</button>`
      : '';
    body.innerHTML = `
      ${imageHtml ? `<div class="task-image-grid">${imageHtml}</div>` : ''}
      <div class="task-copy" style="font-size:13px;margin-top:8px;">${escapeHtml(copyPreview)}</div>
      <div class="task-meta">${escapeHtml(data.ratio || '1:1')} · ${imageUrls.length} 张 · ${escapeHtml(data.createdAt || '')}</div>
      <div class="task-actions">
        ${downloadButtons}
        <button class="task-btn" onclick="copyText(this, \`${escapeQuotes(data.copy || '')}\`)">复制文案</button>
      </div>
    `;
  }
  hydrateProtectedImages(body);
  updateXhsWorkStats();

  // 3绉掑悗鑷姩绉诲埌鍘嗗彶
  setTimeout(() => {
    if (document.getElementById(taskId)) {
      removeTask(taskId);
      loadServerHistory();
    }
  }, 3000);
}

function escapeForAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function removeTask(taskId) {
  const card = document.getElementById(taskId);
  if (card) {
    card.remove();
    activeTasks = activeTasks.filter(id => id !== taskId);
  }
  
  const tasksSection = document.getElementById('tasksSection');
  const tasksGrid = document.getElementById('tasksGrid');
  if (tasksGrid.children.length === 0) {
    tasksSection.style.display = 'none';
  }
  updateXhsWorkStats();
}

window.removeTask = removeTask;

function escapeQuotes(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

function escapeJsString(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function downloadImage(url, prompt = '', ratio = 'image') {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const promptShort = prompt ? String(prompt).substring(0, 10).replace(/[^\w]/g, '_') : 'image';
  const ext = String(url || '').includes('.jpg') || String(url || '').includes('jpeg') ? 'jpg' : 'png';
  const filename = prompt || ratio !== 'image'
    ? `xhs_${ratio}_${promptShort}_${date}.${ext}`
    : `xiaohongshu_${Date.now()}.${ext}`;
  try {
    const blob = await fetchImageBlob(url);
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (err) {
    alert(err.message || '图片下载失败，请重新登录后再试');
  }
}

window.downloadImage = downloadImage;

function copyText(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '已复制';
    setTimeout(() => { btn.textContent = '复制'; }, 2000);
  });
}

window.copyText = copyText;

// 鎸夐挳鐘舵€佹洿鏂?
function updateButtonState(btnId, disabled, text) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = disabled;
  const span = btn.querySelector('span');
  if (span) span.textContent = text;
}

// HTML杞箟鍑芥暟锛堥槻XSS锛?
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function downloadImages(urls, prompt = '', ratio = 'image') {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  list.forEach((url, index) => {
    setTimeout(() => {
      const suffix = list.length > 1 ? `${ratio || 'image'}_${index + 1}` : ratio;
      window.downloadImage(url, prompt, suffix);
    }, index * 200);
  });
}

function downloadImagesFromEncoded(encodedUrls, prompt = '', ratio = 'image') {
  try {
    downloadImages(JSON.parse(decodeURIComponent(encodedUrls)), prompt, ratio);
  } catch (err) {
    console.error('批量下载图片失败', err);
  }
}

window.downloadImages = downloadImages;
window.downloadImagesFromEncoded = downloadImagesFromEncoded;

// =============================================
// 鍘嗗彶璁板綍
// =============================================
function setHeroStats(totalImages, totalCopies, totalRecords) {
  const imageEl = document.getElementById('statImageCount');
  const copyEl = document.getElementById('statCopyCount');
  const totalEl = document.getElementById('statTotalCount');
  if (imageEl) imageEl.textContent = Number(totalImages) || 0;
  if (copyEl) copyEl.textContent = Number(totalCopies) || 0;
  if (totalEl) totalEl.textContent = Number(totalRecords) || 0;
}

function updateHeroStatsFromHistory() {
  const xhsHistory = getXhsHistory();
  const totalImages = xhsHistory.reduce((sum, item) => {
    if (item.type === 'image' || item.type === 'both') return sum + getHistoryImageUrls(item).length;
    return sum;
  }, 0);
  const totalCopies = xhsHistory.filter(item => (
    item.type === 'copy' || (item.type === 'both' && getHistoryCopyContent(item))
  )).length;
  setHeroStats(totalImages, totalCopies, xhsHistory.length);
  updateXhsWorkStats();
}

function setStatText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = Number(value) || 0;
}

function updateXhsWorkStats() {
  const xhsHistory = getXhsHistory();
  const reverseHistory = typeof getReverseHistory === 'function' ? getReverseHistory() : [];
  const taskCards = Array.from(document.querySelectorAll('.task-card'));
  const running = taskCards.filter(card => card.dataset.status === 'running').length;
  const failed = taskCards.filter(card => card.dataset.status === 'failed').length;
  const doneTasks = taskCards.filter(card => card.dataset.status === 'done').length;
  const done = xhsHistory.length + reverseHistory.length + doneTasks;
  const total = done + failed;
  const images = xhsHistory.reduce((sum, item) => {
    if (item.type === 'image' || item.type === 'both') return sum + getHistoryImageUrls(item).length;
    return sum;
  }, 0);
  setStatText('xhsStatQueued', 0);
  setStatText('xhsStatRunning', running);
  setStatText('xhsStatDone', done);
  setStatText('xhsStatTotal', total);
  setStatText('xhsStatImages', images);
  setStatText('xhsStatFailed', failed);
}

async function loadUserStats() {
  if (!localStorage.getItem('token')) {
    setHeroStats(0, 0, 0);
    return;
  }
  if (serverHistory.length > 0) {
    updateHeroStatsFromHistory();
    return;
  }

  try {
    const res = await fetch('/api/user/stats', {
      headers: getAuthHeader()
    });
    if (!res.ok) throw new Error('stats request failed');
    const stats = await res.json();
    const totalImages = Number(stats.totalImages) || 0;
    const totalCopies = Number(stats.totalCopies) || 0;
    const totalBoth = Number(stats.totalBoth) || 0;
    const totalRecords = stats.totalRecords !== undefined
      ? Number(stats.totalRecords)
      : Math.max(0, totalImages + totalCopies - totalBoth);
    setHeroStats(totalImages, totalCopies, totalRecords);
  } catch (e) {
    updateHeroStatsFromHistory();
  }
}

async function loadServerHistory() {
  if (!localStorage.getItem('token')) return;
  
  try {
    const res = await fetch('/api/user/history?limit=1000', {
      headers: getAuthHeader()
    });
    const data = await res.json();
    serverHistory = data.history || [];
    renderHistory();
    updateHeroStatsFromHistory();
  } catch (e) {
    console.error('加载历史记录失败', e);
  }
}

// 鐐瑰嚮鍘嗗彶璁板綍
function getHistoryId(item) {
  return Number(item?.id);
}

function getHistoryImageUrls(item) {
  const value = item?.image_url || item?.imageUrl || '';
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);

  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (err) {}
  }

  return [text];
}

function getHistoryImageUrl(item) {
  return getHistoryImageUrls(item)[0] || '';
}

function getHistoryCreatedAt(item) {
  return item?.created_at || item?.createdAt || '';
}

function getHistoryCopyContent(item) {
  return item?.content || item?.copy || '';
}

function safeParseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (err) {
    return fallback;
  }
}

function isRewriteHistory(item) {
  return item?.sub_type === 'rewrite' || item?.copyType === '改写';
}

function getHistorySourceLabel(item) {
  if (isRewriteHistory(item)) return '智能文案改写';
  if (item?.type === 'both' || item?.sub_type === 'both-copy') return '图文一体生成';
  if (item?.type === 'copy') return 'AI 文案生成';
  return '记录';
}

function getCopySummary(content) {
  return String(content || '')
    .replace(/\s+/g, ' ')
    .replace(/[#*_`~]/g, '')
    .trim()
    .slice(0, 34);
}

function isXiToolHistory(item) {
  return item?.sub_type === 'xi-generate'
    || item?.sub_type === 'xi-edit'
    || item?.sub_type === 'xi-reverse'
    || item?.type === 'reverse';
}

function getXhsHistory() {
  return serverHistory.filter(item => !isXiToolHistory(item));
}

function getReverseHistory() {
  return serverHistory.filter(item => item?.sub_type === 'xhs-reverse');
}

function getDisplayHistory() {
  return [...getXhsHistory(), ...getReverseHistory()];
}

function getReverseMeta(item) {
  return safeParseJson(item?.content, {}) || {};
}

function getReversePromptDataFromHistory(item) {
  const meta = getReverseMeta(item);
  return {
    success: true,
    model: meta.model || item?.model || '',
    result: meta.result || null,
    raw: meta.raw || '',
    historyId: getHistoryId(item),
    reverseMode: meta.reverse_mode || item?.reverseMode || 'general',
    previewUrl: meta.preview_url || item?.previewUrl || '',
    durationMs: meta.duration_ms || item?.durationMs || 0,
    createdAt: getHistoryCreatedAt(item)
  };
}

function getReversePromptSummary(item) {
  const data = item?.result ? item : getReversePromptDataFromHistory(item);
  const result = data?.result || {};
  return result.polished_prompt_zh
    || result.polished_prompt_en
    || result.universal_prompt_zh
    || result.universal_prompt_en
    || result.faithful_prompt_zh
    || result.dalle_prompt
    || result.midjourney_prompt
    || data?.raw
    || '';
}

document.addEventListener('click', (e) => {
  const card = e.target.closest('.history-card');
  if (!card) return;
  
  const id = Number(card.dataset.id);
  const item = getDisplayHistory().find(h => getHistoryId(h) === id);
  if (!item) return;
  
  if (item.type === 'reverse' || item.sub_type === 'xhs-reverse') {
    openReversePromptModal(getReversePromptDataFromHistory(item));
  } else if (item.type === 'image' && getHistoryImageUrl(item)) {
    // 图片预览弹窗：大图 + 下载按钮
    const imgUrl = getHistoryImageUrl(item);
    const body = document.createElement('div');
    body.style.cssText = 'text-align:center;';
    
    const img = document.createElement('img');
    setProtectedImageSource(img, imgUrl);
    img.alt = '历史图片';
    img.style.cssText = 'max-width:100%;max-height:65vh;border-radius:12px;display:block;margin:0 auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
    
    const btnWrapper = document.createElement('div');
    btnWrapper.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:16px;';
    
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'task-btn';
    downloadBtn.textContent = '下载图片';
    downloadBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:700;background:linear-gradient(135deg,var(--neon-pink),#d92d6a);color:#fff;border:none;border-radius:var(--radius-md);cursor:pointer;';
    downloadBtn.onmouseover = () => { downloadBtn.style.opacity = '0.9'; };
    downloadBtn.onmouseout = () => { downloadBtn.style.opacity = '1'; };
    downloadBtn.onclick = () => downloadImage(imgUrl);
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'task-btn';
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:700;background:var(--bg-surface);border:1px solid var(--border);color:var(--text-secondary);border-radius:var(--radius-md);cursor:pointer;';
    closeBtn.onclick = () => { const m = document.querySelector('.modal-overlay'); if (m) m.remove(); };
    
    btnWrapper.appendChild(downloadBtn);
    btnWrapper.appendChild(closeBtn);
    
    body.appendChild(img);
    body.appendChild(btnWrapper);
    
    showModal(getHistoryCreatedAt(item) || '历史图片', body);
  } else if (item.type === 'copy' && getHistoryCopyContent(item)) {
    // 文案预览弹窗：直接展示完整文案 + 复制按钮
    const isRewrite = isRewriteHistory(item);
    const typeLabel = isRewrite ? '改写' : '文案';
    const content = getHistoryCopyContent(item);
    
    const body = document.createElement('div');
    
    const preview = document.createElement('div');
    preview.style.cssText = 'background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-md);padding:20px;font-size:14px;line-height:1.9;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow-y:auto;';
    preview.textContent = content;
    
    const btnWrapper = document.createElement('div');
    btnWrapper.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:16px;';
    
    const copyBtn = document.createElement('button');
    copyBtn.className = 'task-btn';
    copyBtn.textContent = '复制文案';
    copyBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:700;background:linear-gradient(135deg,var(--neon-green),#1da07a);color:#fff;border:none;border-radius:var(--radius-md);cursor:pointer;';
    copyBtn.onmouseover = () => { copyBtn.style.opacity = '0.9'; };
    copyBtn.onmouseout = () => { copyBtn.style.opacity = '1'; };
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(content).then(() => {
        copyBtn.textContent = '已复制 ✓';
        setTimeout(() => { copyBtn.textContent = '复制文案'; }, 2000);
      });
    };
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'task-btn';
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:700;background:var(--bg-surface);border:1px solid var(--border);color:var(--text-secondary);border-radius:var(--radius-md);cursor:pointer;';
    closeBtn.onclick = () => { const m = document.querySelector('.modal-overlay'); if (m) m.remove(); };
    
    btnWrapper.appendChild(copyBtn);
    btnWrapper.appendChild(closeBtn);
    
    body.appendChild(preview);
    body.appendChild(btnWrapper);
    
    showModal(`${typeLabel} · ${getHistoryCreatedAt(item)}`, body);
  } else if (item.type === 'both') {
    // 图文一体弹窗：多图 + 完整文案 + 下载/复制按钮
    const imageUrls = getHistoryImageUrls(item);
    const content = getHistoryCopyContent(item);
    
    const body = document.createElement('div');
    
    // 图片区域
    if (imageUrls.length) {
      const imageGrid = document.createElement('div');
      imageGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px;';
      imageUrls.forEach((url, index) => {
        const img = document.createElement('img');
        setProtectedImageSource(img, url);
        img.alt = `图文一体图片 ${index + 1}`;
        img.style.cssText = 'width:100%;max-height:45vh;object-fit:cover;border-radius:12px;display:block;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
        imageGrid.appendChild(img);
      });
      body.appendChild(imageGrid);
    }
    
    // 文案区域
    if (content) {
      const preview = document.createElement('div');
      preview.style.cssText = 'background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-md);padding:20px;font-size:14px;line-height:1.9;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;max-height:40vh;overflow-y:auto;';
      preview.textContent = content;
      body.appendChild(preview);
    }
    
    const btnWrapper = document.createElement('div');
    btnWrapper.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:16px;flex-wrap:wrap;';
    
    if (imageUrls.length) {
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'task-btn';
      downloadBtn.textContent = imageUrls.length > 1 ? '下载全部图片' : '下载图片';
      downloadBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:700;background:linear-gradient(135deg,var(--neon-pink),#d92d6a);color:#fff;border:none;border-radius:var(--radius-md);cursor:pointer;';
      downloadBtn.onclick = () => downloadImages(imageUrls);
      btnWrapper.appendChild(downloadBtn);
    }
    
    if (content) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'task-btn';
      copyBtn.textContent = '复制文案';
      copyBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:700;background:linear-gradient(135deg,var(--neon-green),#1da07a);color:#fff;border:none;border-radius:var(--radius-md);cursor:pointer;';
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(content).then(() => {
          copyBtn.textContent = '已复制 ✓';
          setTimeout(() => { copyBtn.textContent = '复制文案'; }, 2000);
        });
      };
      btnWrapper.appendChild(copyBtn);
    }
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'task-btn';
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'padding:10px 24px;font-size:14px;font-weight:700;background:var(--bg-surface);border:1px solid var(--border);color:var(--text-secondary);border-radius:var(--radius-md);cursor:pointer;';
    closeBtn.onclick = () => { const m = document.querySelector('.modal-overlay'); if (m) m.remove(); };
    btnWrapper.appendChild(closeBtn);
    
    body.appendChild(btnWrapper);
    
    showModal(`图文一体 · ${getHistoryCreatedAt(item)}`, body);
  }
});

// 鍒犻櫎鍘嗗彶璁板綍
document.addEventListener('click', (e) => {
  const deleteBtn = e.target.closest('.delete-btn');
  if (!deleteBtn) return;
  e.stopPropagation();
  
  const id = Number(deleteBtn.dataset.id);
  if (!confirm('确定要删除这条记录吗？')) return;
  
  fetch(`/api/user/history/${id}`, { 
    method: 'DELETE',
    headers: getAuthHeader()
  })
    .then(() => {
      serverHistory = serverHistory.filter(h => getHistoryId(h) !== id);
      renderHistory();
      loadUserStats();
    })
    .catch(() => alert('删除失败'));
});

// 鍒犻櫎鍏ㄩ儴鍘嗗彶璁板綍
async function clearAllHistory(type) {
  if (!confirm(`确定要清空全部${type}历史记录吗？此操作不可恢复！`)) return;
  
  try {
    // 鑾峰彇璇ョ被鍨嬬殑鎵€鏈夊巻鍙茶褰旾D
    const targetHistory = type === 'reverse' ? getReverseHistory() : getXhsHistory();
    const typeHistory = targetHistory.filter(h => {
      if (type === 'image') return h.type === 'image';
      if (type === 'copy') return h.type === 'copy';
      if (type === 'both') return h.type === 'both';
      if (type === 'reverse') return h.sub_type === 'xhs-reverse';
      return false;
    });
    for (const item of typeHistory) {
      await fetch(`/api/user/history/${item.id}`, { 
        method: 'DELETE',
        headers: getAuthHeader()
      });
    }
    const deletedIds = new Set(typeHistory.map(item => getHistoryId(item)));
    serverHistory = serverHistory.filter(h => {
      if (deletedIds.has(getHistoryId(h))) return false;
      return true;
    });
    if (type === 'image') imagePage = 1;
    else if (type === 'copy') copyPage = 1;
    else if (type === 'both') bothPage = 1;
    else if (type === 'reverse') reversePage = 1;
    renderHistory();
    loadUserStats();
  } catch (e) {
    alert('清空失败');
  }
}

window.clearAllHistory = clearAllHistory;

function renderHistory() {
  const historySection = document.getElementById('historySection');
  const imageHistoryGrid = document.getElementById('imageHistoryGrid');
  const copyHistoryGrid = document.getElementById('copyHistoryGrid');
  const bothHistoryGrid = document.getElementById('bothHistoryGrid');
  const reverseHistoryGrid = document.getElementById('reverseHistoryGrid');
  
  const xhsHistory = getXhsHistory();
  const reverseHistory = getReverseHistory();
  if (xhsHistory.length === 0 && reverseHistory.length === 0) {
    historySection.style.display = 'none';
    return;
  }
  
  historySection.style.display = 'block';
  imageHistoryGrid.innerHTML = '';
  copyHistoryGrid.innerHTML = '';
  if (bothHistoryGrid) bothHistoryGrid.innerHTML = '';
  if (reverseHistoryGrid) reverseHistoryGrid.innerHTML = '';
  
  const imageHistory = xhsHistory.filter(item => item.type === 'image' && getHistoryImageUrl(item));
  const copyHistory = xhsHistory.filter(item => item.type === 'copy' && getHistoryCopyContent(item));
  const bothHistory = xhsHistory.filter(item => item.type === 'both');
  
  // 璁＄畻鍒嗛〉
  const imageTotalPages = Math.ceil(imageHistory.length / pageSize);
  const copyTotalPages = Math.ceil(copyHistory.length / pageSize);
  const bothTotalPages = Math.ceil(bothHistory.length / pageSize);
  const reverseTotalPages = Math.ceil(reverseHistory.length / pageSize);
  
  // 纭繚椤电爜鍦ㄦ湁鏁堣寖鍥村唴
  if (imagePage > imageTotalPages && imageTotalPages > 0) imagePage = imageTotalPages;
  if (copyPage > copyTotalPages && copyTotalPages > 0) copyPage = copyTotalPages;
  if (bothPage > bothTotalPages && bothTotalPages > 0) bothPage = bothTotalPages;
  if (reversePage > reverseTotalPages && reverseTotalPages > 0) reversePage = reverseTotalPages;
  
  // 鏇存柊璁℃暟
  document.getElementById('imageCount').textContent = `共 ${imageHistory.length} 条`;
  document.getElementById('copyCount').textContent = `共 ${copyHistory.length} 条`;
  const bothCountEl = document.getElementById('bothCount');
  if (bothCountEl) bothCountEl.textContent = `共 ${bothHistory.length} 条`;
  const reverseCountEl = document.getElementById('reverseCount');
  if (reverseCountEl) reverseCountEl.textContent = `共 ${reverseHistory.length} 条`;
  
  const imageStart = (imagePage - 1) * pageSize;
  const imageEnd = imageStart + pageSize;
  imageHistory.slice(imageStart, imageEnd).forEach(item => {
    const card = createHistoryCard(item);
    imageHistoryGrid.appendChild(card);
  });
  
  const copyStart = (copyPage - 1) * pageSize;
  const copyEnd = copyStart + pageSize;
  copyHistory.slice(copyStart, copyEnd).forEach(item => {
    const card = createHistoryCard(item);
    copyHistoryGrid.appendChild(card);
  });
  
  const bothStart = (bothPage - 1) * pageSize;
  const bothEnd = bothStart + pageSize;
  bothHistory.slice(bothStart, bothEnd).forEach(item => {
    const card = createHistoryCard(item);
    if (bothHistoryGrid) bothHistoryGrid.appendChild(card);
  });

  const reverseStart = (reversePage - 1) * pageSize;
  const reverseEnd = reverseStart + pageSize;
  reverseHistory.slice(reverseStart, reverseEnd).forEach(item => {
    const card = createHistoryCard(item);
    if (reverseHistoryGrid) reverseHistoryGrid.appendChild(card);
  });
  
  // 娓叉煋鍒嗛〉鎺т欢
  renderPagination('imagePagination', imagePage, imageTotalPages, imageHistory.length, (page) => {
    imagePage = page;
    renderHistory();
  });
  
  renderPagination('copyPagination', copyPage, copyTotalPages, copyHistory.length, (page) => {
    copyPage = page;
    renderHistory();
  });
  
  const bothPagination = document.getElementById('bothPagination');
  if (bothPagination) {
    renderPagination('bothPagination', bothPage, bothTotalPages, bothHistory.length, (page) => {
      bothPage = page;
      renderHistory();
    });
  }

  const reversePagination = document.getElementById('reversePagination');
  if (reversePagination) {
    renderPagination('reversePagination', reversePage, reverseTotalPages, reverseHistory.length, (page) => {
      reversePage = page;
      renderHistory();
    });
  }
}

function createHistoryCard(item) {
  const card = document.createElement('div');
  card.className = 'history-card';
  card.dataset.id = getHistoryId(item);
  
  if (item.type === 'reverse' || item.sub_type === 'xhs-reverse') {
    const meta = getReverseMeta(item);
    const previewUrl = meta.preview_url || item.previewUrl || '';
    const summary = getReversePromptSummary(item);
    const thumb = previewUrl
      ? document.createElement('img')
      : document.createElement('div');

    if (previewUrl) {
      setProtectedImageSource(thumb, previewUrl);
      thumb.alt = '反推参考图';
    } else {
      thumb.className = 'copy-thumb';
      thumb.textContent = 'P';
    }

    const infoDiv = document.createElement('div');
    infoDiv.className = 'history-info';

    const typeSpan = document.createElement('span');
    typeSpan.className = 'history-type copy-type';
    typeSpan.textContent = '看图写 Prompt';

    const dateSpan = document.createElement('span');
    dateSpan.className = 'history-date';
    dateSpan.textContent = getHistoryCreatedAt(item);

    infoDiv.appendChild(typeSpan);
    infoDiv.appendChild(dateSpan);

    if (item.prompt) {
      const title = document.createElement('p');
      title.className = 'history-title-text';
      title.textContent = item.prompt.length > 18 ? item.prompt.substring(0, 18) + '...' : item.prompt;
      title.title = item.prompt;
      infoDiv.appendChild(title);
    }

    if (summary) {
      const summaryP = document.createElement('p');
      summaryP.className = 'history-copy-summary';
      summaryP.textContent = getCopySummary(summary);
      summaryP.title = summary;
      infoDiv.appendChild(summaryP);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.dataset.id = getHistoryId(item);
    deleteBtn.textContent = '×';

    card.appendChild(thumb);
    card.appendChild(infoDiv);
    card.appendChild(deleteBtn);
  } else if (item.type === 'image' && getHistoryImageUrl(item)) {
    const img = document.createElement('img');
    setProtectedImageSource(img, getHistoryImageUrl(item));
    img.alt = '历史图片';
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'history-info';
    
    const typeSpan = document.createElement('span');
    typeSpan.className = 'history-type';
    typeSpan.textContent = item.ratio || '1:1';
    
    const dateSpan = document.createElement('span');
    dateSpan.className = 'history-date';
    dateSpan.textContent = getHistoryCreatedAt(item);
    
    infoDiv.appendChild(typeSpan);
    infoDiv.appendChild(dateSpan);
    
    if (item.prompt) {
      const p = document.createElement('p');
      p.className = 'history-info-text';
      p.textContent = item.prompt.substring(0, 20) + '...';
      p.title = item.prompt;
      infoDiv.appendChild(p);
    }
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.dataset.id = getHistoryId(item);
    deleteBtn.textContent = '×';
    
    card.appendChild(img);
    card.appendChild(infoDiv);
    card.appendChild(deleteBtn);
    
  } else if (item.type === 'copy' && getHistoryCopyContent(item)) {
    const isRewrite = isRewriteHistory(item);
    const typeLabel = getHistorySourceLabel(item);
    const content = getHistoryCopyContent(item);
    
    const thumbDiv = document.createElement('div');
    thumbDiv.className = 'copy-thumb' + (isRewrite ? ' rewrite' : '');
    thumbDiv.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>`;
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'history-info';
    
    const typeSpan = document.createElement('span');
    typeSpan.className = 'history-type copy-type' + (isRewrite ? ' rewrite-type' : '');
    typeSpan.textContent = typeLabel;
    
    const dateSpan = document.createElement('span');
    dateSpan.className = 'history-date';
    dateSpan.textContent = getHistoryCreatedAt(item);
    
    infoDiv.appendChild(typeSpan);
    infoDiv.appendChild(dateSpan);
    
    if (item.prompt) {
      const p = document.createElement('p');
      p.className = 'history-title-text';
      p.textContent = item.prompt.length > 18 ? item.prompt.substring(0, 18) + '...' : item.prompt;
      p.title = item.prompt;
      infoDiv.appendChild(p);
    }

    const summary = getCopySummary(content);
    if (summary) {
      const summaryP = document.createElement('p');
      summaryP.className = 'history-copy-summary';
      summaryP.textContent = summary;
      summaryP.title = content;
      infoDiv.appendChild(summaryP);
    }
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.dataset.id = getHistoryId(item);
    deleteBtn.textContent = '×';
    
    card.appendChild(thumbDiv);
    card.appendChild(infoDiv);
    card.appendChild(deleteBtn);
    
  } else if (item.type === 'both') {
    // 图文一体卡片：小图 + 文案摘要
    const imageUrls = getHistoryImageUrls(item);
    const imgUrl = imageUrls[0] || '';
    const content = getHistoryCopyContent(item);
    
    const img = document.createElement('img');
    if (imgUrl) setProtectedImageSource(img, imgUrl);
    img.alt = '图文一体';
    img.style.cssText = 'width:100%;height:120px;object-fit:cover;border-radius:var(--radius-sm) 0 0 0;';
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'history-info';
    
    const typeSpan = document.createElement('span');
    typeSpan.className = 'history-type both-type';
    typeSpan.textContent = imageUrls.length > 1 ? `图文一体生成 · ${imageUrls.length}图` : '图文一体生成';
    
    const dateSpan = document.createElement('span');
    dateSpan.className = 'history-date';
    dateSpan.textContent = getHistoryCreatedAt(item);
    
    infoDiv.appendChild(typeSpan);
    infoDiv.appendChild(dateSpan);
    
    if (item.prompt) {
      const p = document.createElement('p');
      p.className = 'history-title-text';
      p.textContent = item.prompt.length > 18 ? item.prompt.substring(0, 18) + '...' : item.prompt;
      p.title = item.prompt;
      infoDiv.appendChild(p);
    }
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.dataset.id = getHistoryId(item);
    deleteBtn.textContent = '×';
    
    card.appendChild(img);
    card.appendChild(infoDiv);
    card.appendChild(deleteBtn);
  }
  
  return card;
}

function renderPagination(containerId, currentPage, totalPages, totalItems, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }
  
  let html = '';
  
  // 涓婁竴椤?
  html += `<button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="window.pagination_${containerId}(${currentPage - 1})">上一页</button>`;
  
  // 椤电爜
  html += '<div class="pagination-pages">';
  const maxVisible = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);
  
  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }
  
  if (startPage > 1) {
    html += `<button class="pagination-btn" onclick="window.pagination_${containerId}(1)">1</button>`;
    if (startPage > 2) html += '<span class="pagination-info">...</span>';
  }
  
  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="window.pagination_${containerId}(${i})">${i}</button>`;
  }
  
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += '<span class="pagination-info">...</span>';
    html += `<button class="pagination-btn" onclick="window.pagination_${containerId}(${totalPages})">${totalPages}</button>`;
  }
  html += '</div>';
  
  // 涓嬩竴椤?
  html += `<button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="window.pagination_${containerId}(${currentPage + 1})">下一页</button>`;
  
  // 淇℃伅
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  html += `<span class="pagination-info">${start}-${end} / ${totalItems}</span>`;
  
  container.innerHTML = html;
  
  // 缁戝畾缈婚〉鍑芥暟
  window[`pagination_${containerId}`] = onPageChange;
}

function initPagination() {
  const select = document.getElementById('pageSizeSelect');
  select.addEventListener('change', () => {
    pageSize = parseInt(select.value);
    imagePage = 1;
    copyPage = 1;
    bothPage = 1;
    reversePage = 1;
    renderHistory();
  });
}

function openReversePromptModal(data) {
  const body = document.createElement('div');
  const result = data?.result || {};
  const zhPrompt = result.polished_prompt_zh
    || result.universal_prompt_zh
    || result.faithful_prompt_zh
    || '';
  const enPrompt = result.polished_prompt_en
    || result.universal_prompt_en
    || result.dalle_prompt
    || result.midjourney_prompt
    || data?.raw
    || '';

  if (data?.previewUrl) {
    const preview = document.createElement('img');
    setProtectedImageSource(preview, data.previewUrl);
    preview.alt = '反推参考图';
    preview.style.cssText = 'width:100%;max-height:220px;object-fit:contain;border-radius:var(--radius-md);background:var(--bg-input);margin-bottom:14px;';
    body.appendChild(preview);
  }

  addPromptBlock(body, '中文 Prompt', zhPrompt);
  addPromptBlock(body, '英文 Prompt', enPrompt);

  if (!zhPrompt && !enPrompt) {
    const empty = document.createElement('div');
    empty.className = 'prompt-content';
    empty.textContent = '没有解析到可用 Prompt。';
    body.appendChild(empty);
  }

  showModal(result.title || '看图写 Prompt', body);
}

function addPromptBlock(targetEl, title, text) {
  if (!text) return;
  const block = document.createElement('section');
  block.className = 'prompt-block';

  const header = document.createElement('div');
  header.className = 'prompt-block-header';

  const h3 = document.createElement('h3');
  h3.textContent = title;
  header.appendChild(h3);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.type = 'button';
  copyBtn.textContent = '复制';
  copyBtn.addEventListener('click', () => {
    copyTextToClipboard(text).then(() => {
      copyBtn.textContent = '已复制';
      setTimeout(() => { copyBtn.textContent = '复制'; }, 1400);
    }).catch(() => alert('复制失败，请手动选择文本复制。'));
  });
  header.appendChild(copyBtn);

  const content = document.createElement('div');
  content.className = 'prompt-content';
  content.textContent = text;

  const actions = document.createElement('div');
  actions.className = 'prompt-block-actions';

  const useBtn = document.createElement('button');
  useBtn.className = 'prompt-use-btn';
  useBtn.type = 'button';
  useBtn.textContent = '用它生图';
  useBtn.addEventListener('click', () => usePromptForXhsImage(text, title));
  actions.appendChild(useBtn);

  block.append(header, content, actions);
  targetEl.appendChild(block);
}

function usePromptForXhsImage(text, title = 'Prompt') {
  const promptEl = document.getElementById('imgPrompt');
  if (!promptEl) return;
  if (typeof window.switchXhsTool === 'function') window.switchXhsTool('image', false);
  promptEl.value = text;
  const modal = document.querySelector('.modal-overlay');
  if (modal) modal.remove();
  promptEl.focus();
  promptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setXhsReverseStatus(`已填入${title}，可以直接开始生成图片。`, 'ok');
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('copy failed');
}

// =============================================
// 寮圭獥
// =============================================
function showModal(title, content, editable) {
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  if (editable) modal.style.width = 'min(700px, 96%)';

  const header = document.createElement('div');
  header.className = 'modal-header';

  const titleSpan = document.createElement('span');
  titleSpan.textContent = title;
  header.appendChild(titleSpan);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => overlay.remove();
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body';

  if (editable && typeof content === 'string') {
    const textarea = document.createElement('textarea');
    textarea.value = content;
    textarea.style.cssText = 'width:100%;min-height:300px;padding:14px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:14px;line-height:1.8;resize:vertical;outline:none;font-family:inherit;';
    textarea.addEventListener('focus', () => { textarea.style.borderColor = 'var(--neon-pink)'; textarea.style.boxShadow = '0 0 0 3px rgba(255,45,120,0.15)'; });
    textarea.addEventListener('blur', () => { textarea.style.borderColor = ''; textarea.style.boxShadow = ''; });
    body.appendChild(textarea);

    const btnWrapper = document.createElement('div');
    btnWrapper.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:12px;';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'task-btn';
    copyBtn.textContent = '复制文案';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(textarea.value).then(() => {
        copyBtn.textContent = '已复制 ✓';
        setTimeout(() => copyBtn.textContent = '复制文案', 2000);
      });
    };

    const closeBtn2 = document.createElement('button');
    closeBtn2.className = 'task-btn';
    closeBtn2.textContent = '关闭';
    closeBtn2.onclick = () => overlay.remove();
    closeBtn2.style.cssText = 'background:var(--bg-surface);color:var(--text-secondary);';

    btnWrapper.appendChild(copyBtn);
    btnWrapper.appendChild(closeBtn2);
    body.appendChild(btnWrapper);
  } else if (typeof content === 'string') {
    body.textContent = content;
  } else if (content instanceof Node) {
    body.appendChild(content);
  }

  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

window.showModal = showModal;
